# Ticket 0001 — AgentEngine 接口 + globalThis 收敛

- **状态**：implementing
- **ADR**：`.agents/adr/0001-agent-engine-seam.md`
- **分支**：`dev`
- **预计**：半天（~120 行新文件 + ~35 行删改）

## 目标

把 `lib/rpc-manager.ts` 里四个模块级 `globalThis` 会话状态容器收敛成一个显式 `AgentEngine` 接口实例，行为零变化。

**这是纯重构。** 不改功能、不改公开 API、不改 UI、不改任何事件语义。

## Seam

**`lib/agent-engine.ts` 的导出面** —— 恰好一个：

```ts
export function getEngine(): AgentEngine;
```

测试（人）只在这个 seam 上观察：拿到引擎实例后，四个容器的读写都通过它。`rpc-manager.ts` 的四个访问函数是这层 seam 的**内部委托**，不是 seam 本身。

为什么选这个 seam：它是本 ticket 唯一新增的公共边界，且将来 `SidecarEngine` / `RemoteEngine` 会在这同一个位置替换实现。`rpc-manager.ts` 的 13 个公开导出签名不变，所以它们不能作为本 ticket 的 seam（不变的东西不是 seam）。

## 验收标准

- [ ] 新建 `lib/agent-engine.ts`，导出 `interface AgentEngine` + `class InProcessAgentEngine` + `getEngine()`
- [ ] 四个 `globalThis.__pi*` 容器变成 `InProcessAgentEngine` 的私有字段，实例仍存 `globalThis.__piEngine`（HMR 存活）
- [ ] `process.once("exit"/"SIGINT"/"SIGTERM")` 注册从 `getRegistry()` 搬进引擎构造，语义不变（exit=destroy 同步、SIGINT/SIGTERM=shutdown allSettled）
- [ ] `lib/rpc-manager.ts` 删掉 2 个 `declare global` 块，4 个访问函数改一行委托
- [ ] `lib/rpc-manager.ts` 的调用点**一行不改**（`registerRpcWrapper` / `startRpcSession` / `SUBAGENT_CONTROLLER` / `getRpcSessionInfos` / `hasBusyRpcSessionForCwd` / `destroyRpcSessionsForCwd` / `subscribeRunningSessions` / `notifyRunningChange` / `getRunningRpcSessionIds` / `getCompletionNotificationSuppressedRpcSessionIds`）
- [ ] 13 个公开导出签名不变
- [ ] `tsc --noEmit` 通过
- [ ] `npm run lint` 通过
- [ ] `node --test scripts/fork-extractions.test.mjs` 通过
- [ ] 手测 `npm run dev`：起会话 / 对话 / 工具调用 / fork / 分支切换 / HMR 后会话仍在
- [ ] 带 `.changeset/0001-agent-engine-seam.md`（patch）

## Out-of-scope

- 不碰 `AgentSessionWrapper` 类（含 `send` 的命令状态机、`isRunning` 的 `inner.isIdle === false` OR、idle timer、`sessionReplacement` 互斥）
- 不碰 `startRpcSession` 函数体（那是 ticket 0002）
- 不新增依赖
- 不改任何 API 路由、UI 组件、事件常量
- 不做 `SidecarEngine` / `RemoteEngine`
