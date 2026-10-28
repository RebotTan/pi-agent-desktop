# @agegr/pi-web

## 0.10.2

### Patch Changes

- [`b02ad78`](https://github.com/RebotTan/pi-agent-desktop/commit/b02ad78d8926544cf976e845c4122e3d6927a85e) Thanks [@tanjianwd](https://github.com/tanjianwd)! - 补 PR-5 事件总线的 `session_ended` 端到端测试（code-review 留的 partial）：注册 wrapper 时 emit `session_started`，destroy 时 emit `session_ended`。

- [`44e36fe`](https://github.com/RebotTan/pi-agent-desktop/commit/44e36fe5d51d3ef081955323e6551511541e4b32) Thanks [@tanjianwd](https://github.com/tanjianwd)! - 修复发版阻塞：`pi-agent-desktop-package.json` 与 `src-tauri/Cargo.toml` 的 version 从上游遗留的 0.7.7 同步到 0.10.1（避免 tag 撞上游 v0.7.7）；`release-component-pins.json` 的 pi-web pin 从 0.10.0 升到 0.10.1（fork 自有版本线，落后上游 agegr/pi-web 0.12.2 是有意选择）。`release:verify` 现通过。

- [`6e08e34`](https://github.com/RebotTan/pi-agent-desktop/commit/6e08e347bc99963b07cdf5fe0a09ba89ab3d0d05) Thanks [@tanjianwd](https://github.com/tanjianwd)! - 裁剪发版执行平台：`release.yml` 的 build job 加 `if: matrix.target != 'aarch64-apple-darwin'` 跳过 macOS，Linux 只打 rpm（去掉 deb），homebrew job 加 `if: false` 暂停（依赖 macOS DMG）。macOS matrix entry、SDK 检查、homebrew 配置全部保留在 yml 里，将来恢复只需删两个 `if` 守卫。`release-workflows.test.mjs` 断言同步更新。

- [`c35ae95`](https://github.com/RebotTan/pi-agent-desktop/commit/c35ae9531fcb1ab13a7f76c9ce8d036efc6ba0bd) Thanks [@tanjianwd](https://github.com/tanjianwd)! - 发版说明改为从 `CHANGELOG.md` 生成：新增 `scripts/release-notes.mjs`（`npm run release:notes`），按版本号提取 changesets 写的段落并追加内置组件版本行。`release.yml` 的 `releaseBody` 从写死的 0.7.7 中英文公告改成占位符，真实说明由 manifest job 在发布前用 `gh release edit --notes-file` 写入，从此发版说明自动跟随版本。

- [`e33c22d`](https://github.com/RebotTan/pi-agent-desktop/commit/e33c22d04fe103cd01548eb1cecfc1d896cd2aa5) Thanks [@tanjianwd](https://github.com/tanjianwd)! - Add a numbered rail to the conversation flow: every rendered message now carries a sequence number, a connecting line and a role dot in a 56px left column, so a run of agent actions reads as an ordered sequence instead of an undifferentiated stack.

## 0.10.1

### Patch Changes

- [`ecf8c22`](https://github.com/RebotTan/pi-agent-desktop/commit/ecf8c229d7ad331fbc47280c159c5684ed407f82) Thanks [@tanjianwd](https://github.com/tanjianwd)! - 引入 AgentEngine 接口，把会话运行时状态从四个散落的 `globalThis` 容器收敛成一个显式引擎实例（`InProcessAgentEngine`）。纯重构，行为零变化。

- [`88ebcbf`](https://github.com/RebotTan/pi-agent-desktop/commit/88ebcbfb9303924b379288a441a30aa17bb6c529) Thanks [@tanjianwd](https://github.com/tanjianwd)! - 把 `startRpcSession` 的并发协调协议（existing 复用 / inflight 合并 / closing-wait 排队 / start lock 管理）收进 `AgentEngine.startSession`，会话装配留在 rpc-manager 作为 assembler 回调。纯重构，行为零变化；SidecarEngine / RemoteEngine 将来可复用同一启动协议。

- [`5b274d8`](https://github.com/RebotTan/pi-agent-desktop/commit/5b274d82204586cdc8abf56ce60b5f9205fbe9cb) Thanks [@tanjianwd](https://github.com/tanjianwd)! - feat(store): session reading surface behind a SessionStore (PR-3)

- [`e3a646d`](https://github.com/RebotTan/pi-agent-desktop/commit/e3a646d182953bfc7805709949db04e0a07b8fef) Thanks [@tanjianwd](https://github.com/tanjianwd)! - feat(policy): tool-call approval pipeline with a rule table and pending approvals (PR-4)

- [`0fd9306`](https://github.com/RebotTan/pi-agent-desktop/commit/0fd9306c44c38e235862bfefef9da2cfafccd900) Thanks [@tanjianwd](https://github.com/tanjianwd)! - feat(events): engine-level event bus with a global SSE stream (PR-5)

- [`89ff487`](https://github.com/RebotTan/pi-agent-desktop/commit/89ff487055d13fdfa967a07fb54bef29410e55d2) Thanks [@tanjianwd](https://github.com/tanjianwd)! - feat(plugin): three-layer plugin registration seams with a contributions API (PR-6)
