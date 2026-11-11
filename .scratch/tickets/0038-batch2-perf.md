## 目标

把上游三批方案里的批 2 摘出来：低冲突的性能修复，不动 fork 的核心文件。

批 2 的取舍标准只有一条 —— **冲突面可控**。`lib/rpc-manager.ts`、`app/native-theme.css`、`hooks/useAgentSession.ts`、`app/api/plugins/route.ts` 这些 fork 动过的文件，改动超过几十行的上游 commit 一律留给批 3，因为解冲突的回归风险比性能收益大。

## Seam

五个上游 commit 的原有 seam，逐个 cherry-pick，冲突按 fork 的既有实现解：

1. `37d40453` — `public/sw.js` 不再把静态响应压在 cache 写入后面（`public/sw.test.mjs`）。
2. `3d1ac418` — 长 thinking 分片渲染（`lib/message-display.ts` 的 `splitThinkingPieces`）。
3. `6425d0d2` — 启动时预载 pi SDK import，不等第一个请求（`instrumentation-node.ts`）。
4. `b73fdebc` — 一轮跑完只重建一次会话列表（`components/AppShell.tsx` 去掉多余的 `hydrateSelectedSession`）。
5. `8f3a71e0` — provider 签名不进浏览器 payload（`lib/message-signatures.ts` + `lib/agent-event-wire.ts` + `lib/session-reader.ts`）。

## 验收标准

1. `tsc --noEmit` 0 错；`npm run lint` 干净。
2. `node --test lib/*.test.mjs` 全绿（1956 pass 0 fail）。
3. `node --test components/*.test.mjs` 全绿（820 pass 0 fail）。
4. fork 护栏全绿：`fork-ownership` + `upstream-css-baseline` + `ui-menu-consistency` + `release-workflows` + `server-launcher-preview-secrets` + `public/sw.test.mjs`（52 项）。
5. dev 手测：起 dev，首页与会话列表可用，消息轨道仍在，长 thinking 折叠正常。

## Out-of-scope

以下四个上游 commit **看过、算过、判定不做**，理由都写在下面，不是遗漏：

- `046bc67e perf(chat): load Prism languages on demand` — fork 的 `lib/syntax-highlighting.ts` 已用 `PrismLight` 静态注册 32 种语言，已经把上游这个 commit 要解决的主要问题（默认 `Prism` 拉进 300 种语言）解决了。剩下的收益是按需加载那 32 个小语言包，而要拆掉 fork 的封装、改 4 个文件（含 `demo/` 两份副本）。
- `e8d91efd perf(chat): re-render only the streaming reply per chunk` — 冲突 5 处，其中 `components/ChatMinimap.tsx` 是 fork 明确拒收的上游 UI（AGENTS.md 的 declined-upstream-UI 名单），`ChatWindow.tsx` / `ChatInput.tsx` 是 fork 的重灾区（消息轨道 + 审批卡）。流式选择器要接进这两处，回归风险高，留给批 3 与 ChatWindow 一起做。
- `1a94341c perf(sessions): rescan only the appended tail` — `lib/session-list-scanner.ts` 有 4 处冲突，其中一处是 500 行续扫逻辑重写，且两边 `INDEX_FORMAT_VERSION` 语义不同（fork 3 / 上游 1）。默认路径已有 30 秒列表缓存，`PI_SESSION_STORE=sqlite` 还能完全跳过扫描。
- `feb40f63 perf(settings): stop reloading every extension per provider` — 10+ 冲突，波及 `app/api/plugins/route.ts`（fork 刚做完 0024–0027 四个修复）和 `lib/model-runtime.ts`，还会删掉 `lib/deferred-provider-models.ts`。

另外明确不做：**不在这批里动 `app/native-theme.css`**。上游批 2 范围内的样式改动为 0，fork 的主题段不受影响。