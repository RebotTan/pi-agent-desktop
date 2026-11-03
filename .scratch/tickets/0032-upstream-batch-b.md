# 0032 · 上游批次 B 合并

## 目标

把上游 `abcwyc/pi-agent-desktop` 里不依赖 relay、不依赖 SDK 升级的那 20 个 commit 合进 fork：安全修复、数据写入安全、会话管理、UI 收敛。

## Seam

`dev` 分支 + 全套验收（tsc / lint / lib + components 测试 / fork 护栏 / dev 手测）。

## 合并的 commit（20，按时间正序）

| commit | 内容 |
|---|---|
| `d6744bf3` | 渲染错误页 `app/error.tsx` + `app/global-error.tsx`（打包版没有 DevTools，Next 默认页看不到异常） |
| `23031e27` | 手机跟进/驱动本地会话：`/api/remote-access`、`/api/push/{test,unsubscribe}`、`/api/agent/tasks`、Tasks 视图 |
| `3076a9ad` | 远程访问加固 + push/Tasks 轮询缺陷修复 |
| `a8000801` | **安全**：Tailscale Serve 后面的 Host 伪造漏洞；手机推送收紧 |
| `e8a14474` | 会话列表首条消息截断（省内存） |
| `84e5fe6b` | 用户数据文件原子替换（`lib/atomic-file.ts`） |
| `a10c17a6` | 删未挂载的 `BrowserPanel` / `DiffPanel` / `SessionStatsPanel` |
| `6a6f7ebb` | 未用 warm 会话超过 4 个或 256 MiB 才回收 |
| `66c51272` | `/api/files` 拒绝 credential store（`lib/credential-paths.ts`） |
| `360fec0d` | 删三个无人引用的模块（已核实 fork 也没用） |
| `c83df787` | 侧边栏项目归档 |
| `509e6101` | Full history / Branches 折进 topbar More 菜单 |
| `aa63f82d` | title-feedback e2e 按 class 定位 |
| `4bb41dfb` | idle 会话只按字节封顶 |
| `1a480ab6` | idle 会话保留上限 12 个 |
| `003d40bb` | 新会话欢迎页去掉 starter chips |
| `8aff26b5` | 侧边栏 GPU 降耗 + 单会话归档 + 自动命名会话 |
| `cd66bac1` | Tasks 时限从启动算而非从 prompt 算 |
| `c2041a57` | 运行中的会话通过自己的 manager 改名 |
| `f053743b` | 隐藏助手消息下的 cost / token 计数 |

**跳过的**：relay 整段（`05f73559`…`b92e4a3b`，批次 A）、SDK 1.5.0 升级（`0b5bc831`，批次 C）、上游发版杂务（`8b5d17df` / `91eeed91` / `620aa1ae` / `0a1c79ef`）。

## 冲突与处理

| 文件 | 处理 |
|---|---|
| `app/native-theme.css` | 上游新规则在上、fork 五段在下（同 `d6744bf3` 合并时的 `swap-conflict` 模式）；补回被 merge 切掉的 `}`（`.app-error-actions`、`@media (prefers-reduced-motion)`） |
| `lib/i18n/locale-plugins.ts` | 两侧都留；删掉上游重复的 `connection.offline`（"Pi Agent server"），保留 fork 的 "PiD server" 文案 |
| `app/api/sessions/[id]/route.ts`、`app/api/skills/route.ts` | 两侧 import 都留（fork 的 `json-body` + 上游的 `atomic-file`） |
| `lib/idle-session-cap.{ts,test.mjs}` | 取上游（`IDLE_SESSION_CAP_MAX_COUNT = 12`）；测试里 `globalThis.__piSessions` 改成 `getEngine().registry()` —— PR-1 之后 registry 在引擎上，塞到 globalThis 里 `enforceIdleSessionCap` 根本看不到 |
| `lib/rpc-manager.ts` | import 合并（fork 的 `IdleSessionCapLimits` + 上游的 `AgentSession`） |

## 验收标准

- [x] `tsc --noEmit` 0 错
- [x] `npm run lint` → `ESLint: No issues found`
- [x] `node --test lib/*.test.mjs` → 1973 tests / 1932 pass / 0 fail
- [x] `node --test components/*.test.mjs` → 818 pass / 0 fail
- [x] fork 护栏 **73/73**（上游新增 8 项断言）
- [x] dev 手测：首页 title `PiD`、hydration 正常、无 console 错误；`.chat-input-textarea` 1 个；侧边栏 New Session / **Tasks** / Scheduled / Artifacts 四行；会话打开后 `.msg-rail-row` 57 行、`padding-left: 56px`、伪元素渐变存在；topbar More 按钮存在

## 已知遗留

- `IDLE_SESSION_CAP_MAX_COUNT = 12` 在 `lib/idle-session-cap.ts` 里**无人引用**：上游 `4bb41dfb` 删掉了 count 逻辑，`1a480ab6` 只把常量加回并改了注释，`selectIdleSessionsToEvict` 仍然只看字节。照抄上游，未修（改成按 count 回收会偏离上游且没有测试覆盖）。

## Out-of-scope

- relay 端到端加密中继（批次 A）
- pi SDK 1.4 → 1.5.0（批次 C）
