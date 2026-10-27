# 0002 — 会话启动协调协议收进引擎（PR-2）

## 目标

把 `startRpcSession` 的**并发协调协议**从 `lib/rpc-manager.ts` 收进 `lib/agent-engine.ts` 的
`AgentEngine` 接口：existing 复用、inflight 去重、closing-wait 排队、start lock 生命周期，
全部成为引擎语义方法。会话**装配**（SessionManager 创建、services、model 选择、wrapper 构造、
registerRpcWrapper）留在 rpc-manager，作为 assembler 回调传入。

这样 SidecarEngine / RemoteEngine 将来只需实现同一套启动协议（spawn 子进程 / SSH 远程），
上层调用 `startRpcSession` 的签名与调用点零改动。

## 为什么不整体搬

`startRpcSession` 函数体依赖 rpc-manager 的十几个模块内函数（deriveSessionPolicy、
createAgentSessionServices、resolveVisibleModels、SUBAGENT_CONTROLLER、chat-workspace 系列等）。
整体搬进 agent-engine.ts 会让引擎运行时 import rpc-manager（rpc-manager 已运行时 import
getEngine），形成运行时循环依赖。装配是 rpc-manager 域知识，留在原地；引擎只拥有
「会话生命周期」域知识。

## Seam

- 新引擎方法（接口 + 进程内实现）：
  - `startSession(sessionId, assembler, options?) => Promise<SessionStartResult>`
  - `closingSessionWait(sessionId, deadlineMs) => Promise<void> | null`
- `rpc-manager.startRpcSession` 保留原导出签名（13 个公开导出之一，调用点 15 文件不改），
  函数体改为「前置校验 + assembler + 委托 getEngine().startSession(...)」。
- `rpc-manager.closingRpcSessionWait` 保留内部包装函数，委托引擎方法（3 个内部调用点
  2316/2399/2603 不改）。
- `closingSessionWaits` WeakMap（rpc-manager:2231）、`CLOSING_SESSION_WAIT_MARGIN_MS`
  （rpc-manager:2230）随协调协议搬进引擎。

## 验收标准

1. `tsc --noEmit` 通过。
2. `npm run lint` 通过。
3. `node --test lib/rpc-manager-lifecycle.test.mjs lib/rpc-manager-running-state.test.mjs lib/rpc-session-info.test.mjs` 25/25 通过（行为零变化）。
4. `node --test scripts/fork-ownership.test.mjs` 通过（fork 护栏）。
5. 手测：dev 起服，建会话、并发建同一会话（inflight 合并）、关会话后立即重建
   （closing-wait 排队）行为与 PR-1 前一致。
6. `startRpcSession` 的公开导出签名不变；调用点零改动。
7. 新增测试：如果现有测试未覆盖 inflight 合并 / closing-wait 排队，在
   rpc-manager-lifecycle.test.mjs 补覆盖。

## Out-of-scope

- 不搬装配逻辑（services / model / wrapper 构造仍留 rpc-manager）。
- 不动 `registerRpcWrapper`、`notifyRunningChange`、raw 注册表方法（registry/startLocks/
  startingCwds/runningListeners 的既有调用点继续用，后续 PR 收敛）。
- 不引入 SidecarEngine / RemoteEngine。
