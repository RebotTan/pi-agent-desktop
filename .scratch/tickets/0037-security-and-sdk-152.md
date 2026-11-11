## 目标

补上上游 `1a6eb095` 修的远程访问密码绕过漏洞，并把 pi SDK 从 1.5.0 升到 1.5.2。

**漏洞**：Next.js 对带 `x-prerender-revalidate` 头的请求跳过 middleware。这个头的值来自 `.next-desktop/prerender-manifest.json`，每个安装包里都一样，谁下载安装包都能读。开着 Tailscale 或 LAN 模式时，请求带这个头就能绕过 `proxy.ts` 的密码门和 Host/Origin 检查。

**SDK**：1.5.1 把 `McpSignInCancelledError` 从 `oauth.js` 移到 `runtime.js`（`pi-mcp` 里），且 `signInMcpServer()` 开始取 per-server refresh lock，store 必须带 `withRefreshLock`。上游 `adf204fd` 只改 3 处。

## Seam

- 漏洞：`desktop/server-launcher.cjs` 在 `server.js` 加载前装两层防护 —— 剥掉 `x-prerender-revalidate` / `-if-generated` 头，且每次启动用新随机值重写三个 preview secret。测试 `scripts/server-launcher-preview-secrets.test.mjs`（4 项）。
- SDK：`lib/pi-sdk-internals.ts`（`McpSignInCancelledError` 换到 `mcpRuntime`、`McpSignInOptions.store` 换 `McpOAuthServerStore`）+ `lib/mcp-sign-in.ts`（3 处类型 + `watchedStore` 转发 `withRefreshLock`）。

## 验收标准

1. `scripts/server-launcher-preview-secrets.test.mjs` 4/4。
2. 八个 SDK 包都装到 1.5.2：`pi-agent-core`、`pi-ai`、`pi-codemode`、`pi-coding-agent`、`pi-mcp`、`pi-schema`、`pi-telemetry`、`pi-tui`。
3. `tsc --noEmit` 0 错；`npm run lint` 干净。
4. `node --test lib/*.test.mjs` 全绿（MCP 那批是 SDK 内部契约的探针，红了就说明适配没做完）。
5. `node --test components/*.test.mjs` 全绿；fork 护栏（`fork-ownership` + `upstream-css-baseline` + `ui-menu-consistency` + `release-workflows`）全绿。
6. dev 手测：起 dev，`/api/sessions`、`/api/plugins`、`/api/tool-policy` 都 200；建一个会话让模型回复，证明 SDK 1.5.2 真能跑。
7. `scripts/release-component-pins.json` 的 pi pin 与 `src-tauri/resources/component-versions.json` 的 pi 组件版本都是 1.5.2。

## Out-of-scope

- **不升 Next.js**。上游刻意 hold 在 16.4.4（16.4.5 丢 `Content-Encoding`），而 fork 还在 16.3.8 —— 单独一轮处理，与安全补丁解耦。
- **不引入上游的其他功能**（side chats、Settings 重构、models 大改等），那是批 2/批 3。
- **不把 SDK 版本改回 caret**。上游明确 pin 精确版本，因为 1.5.x 的 minor 之间不保证兼容。
- **不清理 relay**。直接 merge 才会把 relay 带回来，本批是 cherry-pick，不碰 relay。