# 0013 — SidecarEngine 骨架（多 Agent 隔离）

## 目标

`SidecarEngine` 实现 `AgentEngine` 接口的**完整方法集**（注册表 / start locks / starting
cwds / running listeners / `startSession` / `closingSessionWait`），提供**可选的进程内回退**：
默认沿用 `InProcessAgentEngine` 的同一个引擎实例（等价于开一个新的会话槽），需要隔离时
由上层显式传入。本次不做真正的跨进程 spawn。

这验证「`AgentEngine` 接口足以承载第二个实现」这一假设（接口抽象层的价值），为后续真正的
进程隔离（spawn `pi --mode rpc` 子进程、stdio JSON-RPC）立边界：上层调用方式在骨架版
与真隔离版之间保持不变。

## 为什么不直接 spawn 子进程

一次完成真实跨进程涉及 4 件高危事项（见 roadmap #13）：审批回传（`tool_call` 在 worker，
审批卡在主进程）、权限约束透传、事件转发回主进程 SSE、spawn 冷启动（~8s，需预热池）。
任何一个做砸都会推翻整个方向。先用同进程骨架把「接口层面是否够用」证明掉，再决定
要不要为真隔离投入那 1–2 周。

同时**防止过度工程**：如果这一刀证明同进程多槽已经够用（多会话并行、单任务不阻塞 UI），
就不做真隔离。

## Seam

- `lib/agent-engine-sidecar.ts`（新）：
  - `export class SidecarEngine implements AgentEngine` —— 引擎语义委托给传入的目标引擎，
    会话协调（`startSession`/`closingSessionWait`）走 `startSession` 组装出来的内部协议
    （与 `InProcessAgentEngine` 同一套）；`registry()` 等 raw 方法也委托。
  - `export function getSidecarEngine(target?: AgentEngine): AgentEngine` —— 单例挂
    `globalThis.__piSidecarEngine`（HMR 纪律同 `__piEngine`）。`target` 缺省
    `getEngine()`（InProcess）。
- `lib/agent-engine.ts`：不新增方法，不加 `createSidecarEngine()` 工厂（骨架直接 new
  SidecarEngine(target) 或 getSidecarEngine()；避免引擎文件回依赖骨架文件造成循环）。
- 上层调用方（本次不动）：将来 `startRpcSession` 不变，编排器按需选引擎。

## 验收标准

1. `tsc --noEmit` 通过。
2. `npm run lint` 通过。
3. 新测试 `lib/agent-engine-sidecar.test.mjs` 覆盖：
   - `startSession` 完整协调协议（existing 复用、inflight 合并、closing-wait 排队、
     start locks 生命周期、starting cwds 去重）
   - `registry()` / `startLocks()` / `startingCwds()` / `runningListeners()` 委托正确
   - `addRunningListener`/`removeRunningListener`/`runningListenerCount` 委托
   - `getSidecarEngine()` 单例：两次调用返回同一实例，`globalThis.__piSidecarEngine`
     可读且与返回值同引用
   - `getSidecarEngine(customEngine)`：显式传目标引擎时使用之（HMR 下模块多实例的
     纪律：单例以 globalThis 为准，模块局部缓存只是加速路径）
4. 复用 `lib/rpc-manager-lifecycle.test.mjs` 与 `lib/rpc-manager-running-state.test.mjs`
   的既有断言风格；不需要复制这两个文件（它们测 InProcess；骨架用同样的 wrapper
   桩测协议等价即可）。
5. fork 护栏 61/61；`lib/session-search.test.mjs lib/session-search-index.test.mjs` 21/21
   回退/索引测试仍绿（不回归）。
6. dev 手测：建会话、双端运行、关会话后重建，行为与 InProcess 一致（因为骨架就是它）。

## Out-of-scope

- 不 spawn 子进程、不做 RPC、不做审批回传、不做事件转发、不做预热池。
- 不改 `startRpcSession` / `rpc-manager` 任何调用点。
- 不做 `SidecarEngine` 的真实切换（将来由编排器按会话策略决定引擎）。
- 不动 `AgentEngine` 接口本身（接口已定型，骨架只是第二实现）。
