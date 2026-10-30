# @agegr/pi-web

## 0.10.9

### Patch Changes

- [`91781bd`](https://github.com/RebotTan/pi-agent-desktop/commit/91781bd) Thanks [@tanjianwd](https://github.com/tanjianwd)! - feat(plugins): marketplace search for pi packages on npm registry (PR-0022)

- [`57df7bc`](https://github.com/RebotTan/pi-agent-desktop/commit/57df7bc) Thanks [@tanjianwd](https://github.com/tanjianwd)! - merge: sync upstream abcwyc/pi-agent-desktop (18 commits) — terminal preferences, in-conversation find, GitHub alerts, front matter, neutral theme, menu placement

- [`a714edd`](https://github.com/RebotTan/pi-agent-desktop/commit/a714edd) Thanks [@tanjianwd](https://github.com/tanjianwd)! - fix(theme): close the CSS block broken by the merge and drop the stale sed backup

## 0.10.8

### Patch Changes

- [`d0e5a3d`](https://github.com/RebotTan/pi-agent-desktop/commit/d0e5a3dcdc652f35c574b575cdf5ac331bbda182) Thanks [@tanjianwd](https://github.com/tanjianwd)! - Mirror `compactionCount` in the SQLite session store (with an in-place schema migration that rebuilds the cache) and make `resetSessionStore()` close the store it held so the SQLite connection is released instead of leaking on every hot reload.

- [`dc2bed9`](https://github.com/RebotTan/pi-agent-desktop/commit/dc2bed9775aa5914fe960b132b7869f0848a6488) Thanks [@tanjianwd](https://github.com/tanjianwd)! - Drop the unused `files.session_id` column from the search index (migrating an existing cache in place), prepare the FTS delete statement once per file, and let `SqliteSessionStore` inherit the three read methods it only ever forwarded to the filesystem store.

## 0.10.7

### Patch Changes

- [`6522c8c`](https://github.com/RebotTan/pi-agent-desktop/commit/6522c8cf345b94e893ab28ead0b66ca3ffde994e) Thanks [@tanjianwd](https://github.com/tanjianwd)! - Index session search in SQLite FTS5 so the whole history is searchable (the streaming scan stops at 500 files) and Chinese two-character words match.

- [`1ef4b69`](https://github.com/RebotTan/pi-agent-desktop/commit/1ef4b6912d9e398c3abb2962d5bd4d0aa8500e29) Thanks [@tanjianwd](https://github.com/tanjianwd)! - Add SidecarEngine as a second AgentEngine implementation that delegates to the in-process engine by default, proving the interface can carry a second implementation before any cross-process isolation work starts.

- [`a1cec28`](https://github.com/RebotTan/pi-agent-desktop/commit/a1cec2836b4115f5c1395ed034d85f21b8400ae4) Thanks [@tanjianwd](https://github.com/tanjianwd)! - Add SessionHandle interface and cross-process worker scaffolding (RpcSessionHandle, WorkerProcessHost, worker entry) so SidecarEngine can later spawn real worker processes; the skeleton already proves the AgentEngine interface carries a second implementation.

- [`7535177`](https://github.com/RebotTan/pi-agent-desktop/commit/75351776ef902e637434e8f6cddeaa20c622d490) Thanks [@tanjianwd](https://github.com/tanjianwd)! - Add SqliteSessionStore as an opt-in SessionStore implementation (PI_SESSION_STORE=sqlite) that mirrors session list metadata into SQLite, so listing skips re-parsing changed JSONL headers and with `allowStale` skips the directory scan entirely; project info is cached with a 5-minute TTL.

- [`747eeba`](https://github.com/RebotTan/pi-agent-desktop/commit/747eeba15e098ba61f29b538e7cc7c724252a109) Thanks [@tanjianwd](https://github.com/tanjianwd)! - 修复代码审查发现的四个真实缺陷：SQLite 存储解析 fork 关系、sidecar 句柄把 destroy/响应送达 worker、预热池失败时杀进程、running_changed 在事件总线上独立去重。

- [`68626b9`](https://github.com/RebotTan/pi-agent-desktop/commit/68626b924ba2c4f5fa6dc6eb9ed346ab9bbc42d9) Thanks [@tanjianwd](https://github.com/tanjianwd)! - 修复代码审查第 5–11 条：会话销毁时取消挂起的工具审批、SSE 流实现 cancel()、插件贡献路由强制动态、SQLite 同步串行化且不再把读失败当删除、索引候选集按会话新旧截断、`allowStale` 真正跳过目录扫描。

- [`161a30f`](https://github.com/RebotTan/pi-agent-desktop/commit/161a30fb90e548b0aa6d750ef3578db4a81bd434) Thanks [@tanjianwd](https://github.com/tanjianwd)! - Align the root package.json version with the released 0.10.6 so the next changesets run produces 0.10.7 instead of colliding with the existing v0.10.6 tag.

- [`d0e5a3d`](https://github.com/RebotTan/pi-agent-desktop/commit/d0e5a3d) Thanks [@tanjianwd](https://github.com/tanjianwd)! - 镜像 `compactionCount` 到 SQLite 会话存储（老库就地补列并重建缓存），并让 `resetSessionStore()` 关闭持有的连接而不是只丢引用。

## 0.10.5

### Patch Changes

- [`2b47abc`](https://github.com/RebotTan/pi-agent-desktop/commit/2b47abc463b639b8af287ef5b10a7ad3d2c88921) Thanks [@tanjianwd](https://github.com/tanjianwd)! - Switch the app icon to a light tile with the dark pi glyph, a grey base and a hairline edge, and add `scripts/build-app-icon.mjs` to rebuild every size from one source image.

## 0.10.4

### Patch Changes

- [`ce0710b`](https://github.com/RebotTan/pi-agent-desktop/commit/ce0710b01fa262e4ff376111e43fff09c430defd) Thanks [@tanjianwd](https://github.com/tanjianwd)! - Rename the desktop app and distribution to PiD (identifier `com.rebotan.pid`, binary `pid`).

## 0.10.3

### Patch Changes

- [`f5f8495`](https://github.com/RebotTan/pi-agent-desktop/commit/f5f8495eecfab9afda1ff8d6ded13d3c3b99d63c) Thanks [@tanjianwd](https://github.com/tanjianwd)! - Add the tool approval UI: a card above the composer appears when a policy rule holds a tool call for approval (allow / deny), and Settings › Tool approval edits the rule table (`pattern` → allow, ask, deny with `*` wildcards). The approval backend from the previous release is now reachable without curl.

- [`1a51f5e`](https://github.com/RebotTan/pi-agent-desktop/commit/1a51f5ef0cb5f24288ab4cb71ea9ac69a249b95f) Thanks [@tanjianwd](https://github.com/tanjianwd)! - Enlarge the login form, approval card and rule editor touch targets on narrow screens.

- [`11a69c5`](https://github.com/RebotTan/pi-agent-desktop/commit/11a69c59f7dadd474d17d0c1dafe0f46a5afa6c3) Thanks [@tanjianwd](https://github.com/tanjianwd)! - Scope the message-rail live dot to the track's last direct row and interpolate the approval "more" count via the i18n params.

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
