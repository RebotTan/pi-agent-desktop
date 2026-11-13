---
"pid": patch
---

Worker 子进程里跑真 pi 会话：`lib/worker-process-main.mjs` 首次 `session.start` 时用 jiti 加载 `lib/rpc-manager.ts`，直接复用 `startRpcSession` 的整份装配，不再有 mock 的 `agent_start`/`agent_end`。`RpcSessionHandle` 新增 `startParams` 转发、`waitUntilReady()` 先等 `start` 的应答（worker 装配需要几百毫秒到数秒），`policy` 类型改显式四字段。
`AgentEngine.startSession` 的 options 新增 `startParams`，由 `startRpcSession` 传入 `{ sessionFile, cwd, ...options }`：跨进程引擎拿不到 assembler 的闭包，改为把原始启动入参交给 worker，由 worker 自己跑同一份决策段。
