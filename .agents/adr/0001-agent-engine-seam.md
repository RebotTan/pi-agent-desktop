# ADR 0001 — AgentEngine 作为会话运行时的唯一 seam

- **状态**：已采纳（PR-1 实施中）
- **日期**：2026-10（dev 分支首个 ADR）
- **相关**：`GLOSSARY.md`、`SCOPE.md`、`lib/rpc-manager.ts`、`lib/agent-engine.ts`

## 上下文

`lib/rpc-manager.ts`（2918 行）是 pi-web 的会话运行时核心。它把会话状态放在**四个模块级 `globalThis` 容器**里：

```ts
declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session; realSessionId }>> | undefined;
  var __piStartingSessionCwds: Map<string, number> | undefined;
}
declare global {
  var __piRunningListeners: Set<(ids: string[]) => void> | undefined;
}
```

`globalThis` 的选择是对的：Next.js 开发时热重载会重新求值模块，模块级 `Map` 会丢，`globalThis` 能活下来。这条纪律写在 `AGENTS.md` 的 Hard rules 里。

问题是**它是隐式的**：

- 四处 `globalThis.__pi*` 的 lazy init 逻辑（含 `process.once("exit"/"SIGINT"/"SIGTERM")` 注册）散在四个 getter 里。
- 「谁是会话状态的拥有者」在代码里没有名字。任何新代码想拿会话，只能 import `rpc-manager` 的内部函数或直接摸 `globalThis`。
- 将来要换实现（每个 worker 会话一个子进程做崩溃隔离；SSH 远程主机跑会话）时，没有可以替换的接缝——替代品只能去改 `rpc-manager` 本身。

## 决策

**引入 `lib/agent-engine.ts`，把会话运行时收敛成一个显式接口 + 一个实例。**

```ts
export interface AgentEngine {
  // registry
  getSession(id: string): AgentSessionWrapper | undefined;
  setSession(id: string, wrapper: AgentSessionWrapper): void;
  deleteSession(id: string): void;
  values(): IterableIterator<AgentSessionWrapper>;
  entries(): IterableIterator<[string, AgentSessionWrapper]>;
  size(): number;
  // start locks
  getStartLock(id: string): Promise<StartLockValue> | undefined;
  setStartLock(id: string, value: Promise<StartLockValue>): void;
  deleteStartLock(id: string): void;
  // starting cwds
  trackStartingCwd(cwd: string, delta: 1 | -1): void;
  hasStartingCwd(cwd: string): boolean;
  // running listeners
  subscribeRunning(listener: (ids: string[]) => void): () => void;
  notifyRunning(ids: string[]): void;
  runningListenerCount(): number;
}
```

`InProcessAgentEngine` 实现它，持有四个私有 Map（**仍然存 `globalThis.__piEngine` 一个实例**，保住 HMR 存活）。`process.once("exit"/"SIGINT"/"SIGTERM")` 从 `getRegistry()` 搬进引擎构造。

`rpc-manager.ts` 里四个访问函数（`getRegistry` / `getLocks` / `getStartingSessionCwds` / `getRunningListeners`）改成一行委托到 `getEngine()`。**调用点一行不动**——`registerRpcWrapper`、`startRpcSession`、`SUBAGENT_CONTROLLER`、13 个公开导出全部原样。

## 后果

**好处**

- 会话状态的拥有者有了名字：`AgentEngine`。新代码拿会话只走引擎，不再有第二条路。
- 换实现有了接缝：`SidecarEngine`（每 worker 一子进程）、`RemoteEngine`（SSH）都能实现同一接口，上层零改动。
- PR-2 可以把 `startRpcSession`（160 行工厂）也收进引擎，让它成为「引擎负责创建会话」而不是「一个碰巧在 rpc-manager 里的函数」。
- `process` 信号处理集中一处，不再藏在 getter 副作用里。

**代价**

- 多一层间接（`getSession` → `engine.registry.get`）。可忽略。
- 引擎接口会随 PR-2/PR-4/PR-5 长大。**刻意的**：接口长大说明我们在明确边界，而不是让边界继续隐含。

**明确没做**

- 没碰 `AgentSessionWrapper` 类、`startRpcSession` 函数体、任何事件常量、会话策略（`deriveSessionPolicy`）。
- 没引入新依赖。
- 没改任何 API 路由或公开导出签名。

## 为什么不用其它方案

**方案 B：保留 globalThis，只加一层包装函数。** 那就是现在这样，问题没解决——「拥有者」仍然没有名字。

**方案 C：把状态收进模块级 `Map`（去掉 globalThis）。** HMR 会丢会话，违反 `AGENTS.md` Hard rules 第三条。

**方案 D：现在就做 `SidecarEngine`，跳过中间态。** 违反「业余个人、几周一两个月」的投入约束。先做接口这个廉价步骤，把真正的重构押后到有多 Agent 需求时。

## 验证

- `tsc --noEmit` 通过
- `npm run lint` 通过
- `node --test scripts/fork-extractions.test.mjs` 通过
- 手测 `npm run dev`：起会话、对话、工具调用、fork、分支切换、关闭浏览器再开（HMR 场景）
