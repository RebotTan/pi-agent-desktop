# @agegr/pi-web

## 0.10.1

### Patch Changes

- [`ecf8c22`](https://github.com/RebotTan/pi-agent-desktop/commit/ecf8c229d7ad331fbc47280c159c5684ed407f82) Thanks [@tanjianwd](https://github.com/tanjianwd)! - 引入 AgentEngine 接口，把会话运行时状态从四个散落的 `globalThis` 容器收敛成一个显式引擎实例（`InProcessAgentEngine`）。纯重构，行为零变化。

- [`88ebcbf`](https://github.com/RebotTan/pi-agent-desktop/commit/88ebcbfb9303924b379288a441a30aa17bb6c529) Thanks [@tanjianwd](https://github.com/tanjianwd)! - 把 `startRpcSession` 的并发协调协议（existing 复用 / inflight 合并 / closing-wait 排队 / start lock 管理）收进 `AgentEngine.startSession`，会话装配留在 rpc-manager 作为 assembler 回调。纯重构，行为零变化；SidecarEngine / RemoteEngine 将来可复用同一启动协议。

- [`5b274d8`](https://github.com/RebotTan/pi-agent-desktop/commit/5b274d82204586cdc8abf56ce60b5f9205fbe9cb) Thanks [@tanjianwd](https://github.com/tanjianwd)! - feat(store): session reading surface behind a SessionStore (PR-3)

- [`e3a646d`](https://github.com/RebotTan/pi-agent-desktop/commit/e3a646d182953bfc7805709949db04e0a07b8fef) Thanks [@tanjianwd](https://github.com/tanjianwd)! - feat(policy): tool-call approval pipeline with a rule table and pending approvals (PR-4)

- [`0fd9306`](https://github.com/RebotTan/pi-agent-desktop/commit/0fd9306c44c38e235862bfefef9da2cfafccd900) Thanks [@tanjianwd](https://github.com/tanjianwd)! - feat(events): engine-level event bus with a global SSE stream (PR-5)

- [`89ff487`](https://github.com/RebotTan/pi-agent-desktop/commit/89ff487055d13fdfa967a07fb54bef29410e55d2) Thanks [@tanjianwd](https://github.com/tanjianwd)! - feat(plugin): three-layer plugin registration seams with a contributions API (PR-6)
