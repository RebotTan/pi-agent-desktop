# 0014 — SidecarEngine 真隔离（跨进程 Worker Session）

## 目标

`SidecarEngine` 从「委托 InProcess」升级为「每 worker 一个子进程」：骨架（#12）已证明
`AgentEngine` 接口足以承载第二实现，本票把「委托目标引擎」换成「spawn `pi --mode rpc`
子进程 + stdio JSON-RPC」，实现真正的故障/性能/上下文/生命周期隔离。

同时定义跨进程 `SessionHandle` 的最小接口 —— 因为 `AgentEngine` 语义方法目前引用的是
具体类 `AgentSessionWrapper`（含几十个本进程方法），而跨进程 worker 只有一个 JSON-RPC
桩。本票需要把接口的 wrapper 类型参数化成 `SessionHandle`，主进程包装器与 RPC 桩都实现它。

## 前置勘察结论（已核实）

- `AgentSessionWrapper` 是具体类（rpc-manager.ts:326），构造需要 `AgentSessionLike`（SDK
  内部类型）+ 几十个方法。跨进程引擎无法构造真实实例，需要接口化。
- 调用方实际用到的方法子集很小：`isAlive()` / `isRunning()` / `send(command)` /
  `onEvent(listener)` / `shutdown()` / `destroy()` / `waitUntilDisposed(timeout)` /
  `start()` / `onDestroy(cb)` / `waitUntilReady()` / `beginExtensionBinding()` /
  `evictIfDiskAhead()` / 与各种 `isChat*()` / `hasSuppressedCompletionNotifications()` /
  `getPendingPromptPreview()`。这些都能由 JSON-RPC 桩实现。
- 骨架 SidecarEngine 已存在（lib/agent-engine-sidecar.ts），单例挂 `__piSidecarEngine`。
- PiDeck 实测冷启动 ~8s（spawn + SDK boot + 内置扩展），需要预热池。

## Seam

1. **SessionHandle 接口**（lib/agent-engine.ts 或独立 lib/session-handle.ts）：
   ```ts
   export interface SessionHandle {
     isAlive(): boolean;
     isRunning(): boolean;
     send(command: Record<string, unknown>): Promise<unknown>;
     onEvent(listener: EventListener): () => void;
     onDestroy(cb: () => void): void;
     start(): void;
     shutdown(): Promise<void>;
     destroy(): void;
     waitUntilDisposed(timeoutMs: number): Promise<boolean>;
     waitUntilReady(): Promise<void>;
     beginExtensionBinding(): void;
     // 会话属性
     readonly sessionId: string;
     readonly cwd: string;
     // ...其余调用方需要的方法子集（isChat* 等策略谓词可先以「总是 false」桩实现，
     // 等编排器需要再补真值）
   }
   ```
2. `AgentEngine` 接口参数化：`AgentEngine<Handle extends SessionHandle = AgentSessionWrapper>`。
   `InProcessAgentEngine implements AgentEngine<AgentSessionWrapper>`；
   `SidecarEngine implements AgentEngine<RpcSessionHandle>`。向后兼容（缺省 type param =
   现有具体类）。
3. `RpcSessionHandle`（lib/session-handle-rpc.ts）：实现 SessionHandle，`send`/`onEvent`/
   `shutdown`/`destroy` 等通过 stdio JSON-RPC 与 worker 子进程通信。事件由子进程推流，
   主进程转发给本地 listener。
4. `WorkerProcessHost`（lib/worker-process-host.ts）：spawn/管理 worker 子进程：
   - `spawnWorker(options): Promise<WorkerProcess>`（预热池容量 1、TTL 3min，参考
     PiDeck standby 池思想；不抄代码）
   - worker 侧入口：本进程 `node lib/worker-process-main.mjs`（新），通过 `pi --mode rpc`
     或直接 createAgentSessionFromServices 在子进程里起会话。
   - stdio JSON-RPC 协议：`{type:"request",id,method,params}` / `{type:"response",id,result|error}`
     / `{type:"event",sessionId,event}`。
5. `SidecarEngine`（lib/agent-engine-sidecar.ts）：
   - `startSession(sessionId, assembler, options)`：向 WorkerProcessHost 要一个 worker，
     RPC `session.start`（参数来自 assembler 的序列化描述 —— 见下文「assembler 跨界」），
     返回 `{ session: rpcHandle, realSessionId }`。
   - 注册表（`sessions` Map）存 `RpcSessionHandle`；`startSession` 的协调协议（existing
     复用 / inflight 合并 / closing-wait）复用 `InProcessAgentEngine` 的同款实现
     （把协议抽成共用 helper 或让 Sidecar 继承 InProcess 改类型参数）。
   - `closingSessionWait` 等生命周期语义与 InProcess 一致。

## 关键设计点

### assembler 跨界
`startSession` 的 assembler 是「会话装配」回调，目前返回 `AgentSessionWrapper`。跨进程
后 assembler 在主进程执行不了（它需要 SDK 类型与本地文件路径）。方案：
- **A. assembler 留在主进程**：主进程起一个「占位 wrapper」（RpcSessionHandle），assembler
  收到占位后只做参数序列化，把真正的 SessionManager 创建+services+model 选择在子进程
  里完成。assembler 签名不变，返回占位即可。
- **B. assembler 拆两半**：`prepareAssembly()`（主进程，算参数）+ `assembleInWorker(params)`
  （子进程，真正 createAgentSessionFromServices）。
- 选 **A**：assembler 回调本来就只是个函数，主进程调用它时把 RpcSessionHandle 传进去，
  装配逻辑自然会把参数收集起来，通过 `rpcHandle.start(params)` 发给子进程。上层调用点
  （rpc-manager.startRpcSession）不变。

### 审批回传
`tool_call` 事件在 worker 触发，审批卡在主进程 `ApprovalCoordinator`。方案：
- worker 的 `tool_call` 事件通过 RPC `event` 通道推到主进程；
- 主进程 `ApprovalCoordinator.requestApproval` 挂起，等 HTTP `/api/tool-policy/settle`；
- 结果通过 RPC `response` 回给 worker 的 tool_call handler。
- 本票只做「事件能跨进程往返」的通路；审批规则（tool-policy store）仍在主进程，worker
  无需感知。

### 预热池
`WorkerProcessHost` 内部维护容量 1、TTL 3min 的预热池：空闲时提前 spawn 一个 worker
等下次 startSession；`startSession` 命中预热直接复用，否则同步 spawn（~8s 冷启动）。
spawn 参数（cwd、扩展根、模型、工具集）作为指纹，指纹变化即丢弃预热 worker。

## 验收标准

1. `tsc --noEmit` 通过；`npm run lint` 通过。
2. 新测试 `lib/agent-engine-sidecar-isolation.test.mjs`：
   - `startSession` 在跨进程语义下：existing 复用、inflight 合并、closing-wait 排队、
     assembler 只调用一次
   - `RpcSessionHandle.send/onEvent/shutdown/destroy` 通过 RPC 到达 worker 并返回
   - worker 崩溃（进程 exit）→ `isAlive()` 变 false、事件流断开、`startSession` 同 id
     能重建新 worker
   - 预热池：第二次 `startSession`（同指纹）耗时 < 第一次的 20%
3. 现有测试全绿：`lib/agent-engine-sidecar.test.mjs`（骨架协议）、rpc-manager 系列、
   session-search、fork 护栏。
4. dev 手测：建会话（走 SidecarEngine）、发 prompt、看 SSE 流、关会话、重建 —— 行为与
   InProcess 一致；`process` 列表里能看到独立的 worker 子进程。
5. 文档：`.agents/adr/0002-sidecar-engine.md`（记录 SessionHandle 参数化决策、assembler
   跨界方案 A、预热池参数）。

## Out-of-scope

- 不实现编排器（多 worker 并行、结果收集是后续 ticket）。
- 不改 `startRpcSession` 的调用点（上层仍走 InProcess；SidecarEngine 由编排器显式选用）。
- 不做 SSH RemoteEngine（#19）。
- 不做审批规则编辑的 worker 侧 UI（审批卡在主进程）。
- 不做 Windows 进程间 ACL/句柄继承的加固（开发期用默认 spawn 选项）。
