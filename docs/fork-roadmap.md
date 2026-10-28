# Fork 二开路线图

本 fork（`RebotTan/pi-agent-desktop`，基座 `agegr/pi-web`）的功能点清单：**已交付**与**待做**，每项标注状态、对应 PR/commit、所依赖的 seam、解锁的能力。

方向与约束见 [`SCOPE.md`](../SCOPE.md)；术语见 [`GLOSSARY.md`](../GLOSSARY.md)；冻结项见 [`.out-of-scope/frozen.md`](../.out-of-scope/frozen.md)；架构决策见 [`.agents/adr/`](../.agents/adr/)。

---

## 一、已交付（第一轮 + 第二轮，v0.10.2 及以后）

### 1. 进程抽象层 —— AgentEngine 接口

| 项 | 值 |
|---|---|
| PR | PR-1 `bd84ac3` + PR-2 `88ebcbf` |
| seam | `lib/agent-engine.ts`（`getEngine()` 单例，HMR 存活于 `globalThis.__piEngine`） |
| 文件 | `lib/agent-engine.ts`、`lib/rpc-manager.ts` |
| 解锁 | 多 Agent 并行编排、SSH 远程、插件 service contribution |

- **PR-1**：把 4 个散落的 `globalThis` 容器（`__piSessions`/`__piStartLocks`/`__piStartingSessionCwds`/`__piRunningListeners`）收敛成 `InProcessAgentEngine` 一个显式实例。纯重构，行为零变化。
- **PR-2**：把 `startRpcSession` 的并发协调协议（existing 复用 / inflight 合并 / closing-wait 排队 / start lock 管理）收进 `AgentEngine.startSession(sessionId, assembler, options?)`，会话装配留在 rpc-manager 作为 assembler 回调。

接口契约：`start/send/events/stop`。当前唯一实现 `InProcessAgentEngine`；将来 `SidecarEngine`（每 worker 一子进程）、`RemoteEngine`（SSH）实现同一接口，调用方不改。

### 2. 存储抽象 —— SessionStore

| 项 | 值 |
|---|---|
| PR | PR-3 `5b274d8` |
| seam | `lib/session-store.ts`（`getSessionStore()` 单例） |
| 文件 | `lib/session-store.ts`、`app/api/sessions/route.ts`、`app/api/sessions/search/route.ts`、`lib/file-access.ts`、`lib/session-file-references.ts` |
| 解锁 | SQLite 索引、会话搜索、外部会话导入转换器 |

读路径收口到 `SessionStore` 接口（`listSessions`/`listSummaries`/`resolveSessionRef`/`getSessionEntries`/`invalidateListCache`），当前 `FileSystemSessionStore` 薄封装 JSONL。写路径仍由 pi SDK `SessionManager` 垄断，不碰。

### 3. 审批/权限管道

| 项 | 值 |
|---|---|
| PR | PR-4 `e3a646d` |
| seam | `lib/tool-policy.ts` + `lib/approval-coordinator.ts` + `lib/approval-policy-extension.ts` |
| 文件 | 上述 + `app/api/tool-policy/route.ts`、`app/api/tool-policy/settle/route.ts`、`lib/rpc-manager.ts` |
| 解锁 | 权限 UI、Plan Mode、审计日志、web 端审批 |

- `ToolPolicyStore`：pattern → `allow`/`deny`/`ask`，`*` 通配转正则，首匹配获胜，无匹配 `allow`。
- `ApprovalCoordinator`：`ask` 规则触发时挂起 tool call，`requestApproval` 返回 promise，`settle(id, approved)` 解锁。
- `createApprovalPolicyExtension`：pi `tool_call` 事件钩子，`deny` 直接 block，`ask` 挂起等审批。
- 端到端实测：`bash` 规则设 `ask` → 模型请求 `echo hello` 挂起 pending → 拒绝后工具 block。

### 4. 事件总线

| 项 | 值 |
|---|---|
| PR | PR-5 `0fd9306` + 端测 `b02ad78` |
| seam | `lib/agent-event-bus.ts`（`getAgentEventBus()` 单例） |
| 文件 | `lib/agent-event-bus.ts`、`app/api/events/route.ts`、`lib/rpc-manager.ts` |
| 解锁 | 全局 SSE、toast、webhook 通知、飞书机器人、审计 sink |

事件类型：`running_changed{ids}` / `session_started{sessionId}` / `session_ended{sessionId}`。3 个 emit 点：`registerRpcWrapper`（started）、`onDestroy`（ended）、`notifyRunningChange`（running_changed，含 listeners.size===0 分支）。`/api/events` 全局 SSE 流，30s 心跳，错误隔离单订户。

### 5. 插件三层注册点骨架

| 项 | 值 |
|---|---|
| PR | PR-6 `89ff487` |
| seam | `lib/plugin-registry.ts`（`getPluginRegistry()` 单例） |
| 文件 | `lib/plugin-registry.ts`、`app/api/plugins/contributions/route.ts`、`lib/rpc-manager.ts` |
| 解锁 | UI 插件（工具卡片/面板）、agent 插件（工具/skill）、service 插件（后台任务） |

三层 contribution：①UI（`registerUiContribution`/`listUiContributions`）②agent（`registerAgentExtension`/`getAgentExtensions`）③service（`registerService`/`listServiceIds`）。预注册 4 个内置 service（agent-engine/session-store/agent-event-bus/tool-policy）。rpc-manager 普通项目分支注入 agent extension。

### 6. 发版基建

| 项 | 值 |
|---|---|
| commit | `ecf8c22`（changesets + ADR 脚手架）、`44e36fe`（release:verify 修复）、`6e08e34`+`a6da4bc`（平台裁剪）、`c35ae95`（releaseBody 自动化） |
| 文件 | `.github/workflows/version.yml`、`.changeset/`、`.agents/adr/`、`GLOSSARY.md`、`SCOPE.md`、`.out-of-scope/frozen.md`、`.github/workflows/release.yml`、`scripts/release-notes.mjs` |

- **changesets 发版**：`dev→main` 合并触发 `version.yml` 自动开「chore: version」PR，升 `package.json` + 写 `CHANGELOG.md`。已发版 0.10.1。
- **签名发版**：`release.yml`（workflow_dispatch）跑 tauri-action 3 平台矩阵 → 签名 → GitHub Release。已配 `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_UPDATER_PUBLIC_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 三个 secret。
- **平台裁剪**：macOS 配置保留但 `if: matrix.target != 'aarch64-apple-darwin'` 跳过，Linux 只打 rpm（去 deb），homebrew `if: false` 暂停。以后只跑 Windows nsis + Linux rpm。
- **releaseBody 自动化**：`scripts/release-notes.mjs` 从 `CHANGELOG.md` 按版本号提取段落 + 追加内置组件版本行，manifest job 用 `gh release edit --notes-file` 写入。不再有写死的 0.7.7 文案。
- **release:verify**：`src-tauri/pi-agent-desktop-package.json` + `Cargo.toml` version 同步到 0.10.1，`release-component-pins.json` pi-web pin 0.10.1。

### 7. 工程流程

| 项 | 值 |
|---|---|
| commit | `01d3d9b`（AGENTS.md 开发流程节） |
| 文件 | `AGENTS.md`（「开发流程」节）、`.scratch/tickets/`、`.changeset/`、`.agents/adr/` |

分支模型 main/dev；开发链路 grill→spec→ticket→implement→code-review→pr→changeset→merge→release；验收硬门（tsc/lint/测试/fork 护栏/手测）；ADR + GLOSSARY + SCOPE + frozen。

---

### 8. 会话消息轨道

| 项 | 值 |
|---|---|
| commit | `e33c22d` |
| seam | `app/native-theme.css` 的 `.msg-rail-track` / `.msg-rail-row[data-role]` |
| 文件 | `components/ChatWindow.tsx`、`app/native-theme.css` |
| 解锁 | 消息流可读性；轨道节点后续可挂跳转 / 折叠 / 审批状态 |

每条渲染消息左侧 56px 轨道：CSS 计数器出的序号 + 贯穿连线 + 角色圆点，末行圆点为「运行中」绿。序号走 DOM 顺序而非 JS 传入，折叠的 process group 自然不递增，也不用在渲染层再维护一份 index→序号映射。

### 9. 工具审批 UI

| 项 | 值 |
|---|---|
| commit | `f5f8495` |
| seam | `/api/tool-policy` + `/api/tool-policy/settle`（PR-4 的 HTTP 契约） |
| 文件 | `components/ApprovalPrompts.tsx`、`components/ToolPolicySettings.tsx`、`components/SettingsPanel.tsx`、`lib/settings-navigation.ts` |
| 解锁 | 手机 / web 端审批（#10 的前置）、规则可视化编辑 |

composer 上方审批卡（允许 / 拒绝）+ Settings › 工具审批 规则表。窗口隐藏时轮询暂停；`ok: false` 视为他人已结算并重取，不报用户无法处理的错。

### 10. 手机 / LAN 访问可用性

| 项 | 值 |
|---|---|
| commit | 见 0014 ticket |
| seam | `app/native-theme.css` 末尾的 `@media (max-width: 640px)` 块 |
| 文件 | `app/native-theme.css` |
| 解锁 | 手机发 prompt、批准工具调用（Q7=B 的核心诉求） |

**勘误**：原计划写的「Web 鉴权层 1–2 天」不存在待做项 —— pi-web 上游已经具备完整密码鉴权：`lib/web-auth.ts` + `proxy.ts` middleware（cookie / Basic auth）+ `/login` 页面 + `lib/auth-throttle.ts` 全局限速 + `bin/network-exposure-warning.js`（无 `PI_WEB_PASSWORD` 时拒绝监听非 loopback）。`lib/request-security.ts:107` 对 IP 字面量直接放行（IP 无法 DNS rebind），所以局域网 IP 无需白名单。

真正的缺口是**控件尺寸**。桌面尺寸的按钮在 390px 宽的手机上低于 44px 可点范围：审批卡按钮 26px、登录页输入 30px / 按钮 34px。本项用一条移动端媒体查询把它们放大到 40–44px，两枚审批按钮等宽铺满；桌面端不受影响（规则在 ≥641px 全部不生效）。

移动端已经合格的项（实测，未改）：textarea 16px 不触发 iOS 缩放、轨道 34px、`viewport-fit=cover` + `interactive-widget=resizes-content`、无横向溢出、侧边栏抽屉正常滑出。

---

### 11. 会话搜索索引（SQLite FTS5）

| 项 | 值 |
|---|---|
| ticket | `.scratch/tickets/0005-session-search-index.md` |
| seam | `lib/session-search.ts` 的 `searchSessionContents`（内部先试索引，不可用回退流式） |
| 文件 | `lib/session-search-index.ts`（新增）、`lib/session-search.ts` |
| 解锁 | 全库搜索、毫秒级响应、中文两字词可搜 |

原实现 `searchSessionContents` 有 `MAX_FILES=500` 的硬上限（源码注释 `// ponytail: scan recent files without an index`），超过 500 个会话的历史永远搜不到，且每次搜索要顺序读最多 500 个文件。

本项新增 `lib/session-search-index.ts`：`node:sqlite`（Node 22 内置，零依赖）FTS5 虚表，按 `size + mtime` 增量同步。**分词器选 `unicode61` + 预切 bigram**，不用 FTS5 自带的 `trigram` —— 实测 trigram 对中文两字词（「测试」）命中为 0（它要求查询 ≥3 字符），bigram 则 2/3/4 字、英文、中英混合全部正确。

`PI_SESSION_SEARCH_INDEX=0` 可退回流式实现；`PI_SESSION_SEARCH_INDEX_PATH` 可指定库路径（诊断用）。流式实现与它的边界测试（16MB 字节上限、deadline、abort、501 文件 cap）保留，测的是流式专属行为。

---

### 12. SidecarEngine 骨架（多 Agent 隔离的接缝验证）

| 项 | 值 |
|---|---|
| ticket | `.scratch/tickets/0013-sidecar-engine-skeleton.md` |
| seam | `lib/agent-engine-sidecar.ts` 的 `getSidecarEngine(target?)` |
| 文件 | `lib/agent-engine-sidecar.ts`（新增）、`lib/agent-engine-sidecar.test.mjs`（新增） |
| 解锁 | 验证 `AgentEngine` 接口足以承载第二个实现；将来真隔离（spawn 子进程）在此换目标引擎 |

PR-1/PR-2 把会话运行时状态收进 `AgentEngine` 接口。骨架版 `SidecarEngine` 实现同一接口，所有语义方法委托给传入的目标引擎（默认 `InProcessAgentEngine`），`startSession` 的协调协议（existing/inflight/closing-wait/锁生命周期）通过调用目标引擎的 `startSession` 获得。

不做 spawn、不做 RPC、不做审批回传 —— 真跨进程隔离涉及审批回传、权限透传、事件转发、~8s 冷启动四件高危事项，任何一件做砸都会推翻方向。骨架先证明接口层面够用；如果证明不了，说明抽象层漏了洞，要先补接口再谈 spawn。

---

## 二、待做（第三轮及以后）

按投入产出排序。每项标注：依赖的 seam、解锁的能力、预估投入、优先级。

### 高优先级（直接影响可用性）

#### 13. 插件 UI contribution 落地（第一个真实插件）

| 项 | 值 |
|---|---|
| seam | PR-6 的 `registerUiContribution` |
| 解锁 | 验证三层注册点设计、工具卡片/面板扩展 |
| 投入 | 2–3 天 |
| 优先级 | ★★☆ |

PR-6 只留了注册点骨架。挂第一个真实 UI 插件（比如「会话用量统计卡」或「Git 状态面板」），跑通 contribution → `/api/plugins/contributions` → 前端 slot 渲染全链路。

### 中优先级（架构演进）

#### 14. SidecarEngine（多 Agent 并行隔离）

| 项 | 值 |
|---|---|
| seam | `AgentEngine` 接口（PR-1/2） |
| 解锁 | Worker Session 编排、Ask 并行问询、独立完整会话/独立 .jsonl/隔离上下文 |
| 投入 | 1–2 周 |
| 优先级 | ★★☆ |

**接口与骨架已交付（见已交付 #12）**，这一项剩下的是真跨进程隔离：每 worker 一个 `pi --mode rpc` 子进程（参考 PiDeck/PI-Desktop 思想，不抄代码避 LGPL），`SidecarEngine` 内部把「委托目标引擎」换成「spawn 子进程 + stdio JSON-RPC」。

#### 15. SessionStore SQLite 列表镜像

| 项 | 值 |
|---|---|
| seam | `SessionStore` 接口（PR-3） |
| 解锁 | 大规模历史列表、用量统计查询 |
| 投入 | 3–5 天 |
| 优先级 | ★☆☆ |

**搜索索引已交付（见已交付 #11）**，这一项剩下的是列表读路径的镜像：新增 `SqliteSessionStore` 实现 `SessionStore` 接口，JSONL 写入时同步镜像到 SQLite（写路径仍走 SDK，SQLite 只做读索引），`getSessionStore()` 按配置切实现。

降级理由：列表已经有 `lib/session-list-scanner.ts` 的增量 JSON 索引（`pi-web-session-index.json`，按 size+mtime 命中缓存），瓶颈只剩每个会话 `attachSessionProjectInfo` 的 git 调用；而搜索 —— 原先最痛的一刀 —— 已被 FTS5 索引解决。剩下的是「大规模历史 + 用量统计查询」，等会话数上千再说。

#### 16. 外部会话导入转换器

| 项 | 值 |
|---|---|
| seam | `SessionStore` 接口（PR-3）+ 插件 agent contribution（PR-6） |
| 解锁 | 导入 Codex/Claude/OpenCode 会话 |
| 投入 | 2–3 天/每个格式 |
| 优先级 | ★☆☆ |

「外部会话转换器」插件点：jsonl 格式适配器，读外部会话文件 → 转 pi v3 jsonl → 落 SessionStore。

### 低优先级（纯 UI / 锦上添花）

#### 17. 事件总线出口：webhook / 飞书

| 项 | 值 |
|---|---|
| seam | `AgentEventBus`（PR-5） |
| 解锁 | agent 事件 → webhook 适配器 → 飞书机器人/外部通知 |
| 投入 | 1 天 |
| 优先级 | ★☆☆ |

订阅 `AgentEventBus`，按规则转发到 webhook。配置存 `~/.pi/agent/webhooks.json`。

#### 18. 用量统计

| 项 | 值 |
|---|---|
| seam | 事件总线（PR-5）+ SessionStore SQLite（#15） |
| 解锁 | 用量热力图/每日/模型/项目统计 |
| 投入 | 2–3 天 |
| 优先级 | ★☆☆ |

订阅 usage 事件 → 持久化到 SQLite → 前端统计面板。

#### 19. SSH RemoteEngine

| 项 | 值 |
|---|---|
| seam | `AgentEngine` 接口（PR-1/2） |
| 解锁 | 远程主机上跑 agent，本地 GUI 操作 |
| 投入 | 1 周 |
| 优先级 | ★☆☆ |

`RemoteEngine` 实现 `AgentEngine`，`startSession` SSH 连远程机起 pi sidecar，`send`/`events` 走 SSH 通道。远期。

#### 20. Plan Mode

| 项 | 值 |
|---|---|
| seam | 审批管道（PR-4）+ agent 配置透传 |
| 解锁 | 先计划后执行 |
| 投入 | 2–3 天 |
| 优先级 | ★☆☆ |

启动参数带 mode=plan，agent 只规划不执行，计划确认后切 mode=execute。复用审批管道的「挂起等确认」机制。

#### 21. 上下文蒸发

| 项 | 值 |
|---|---|
| seam | 消息渲染管道 transform 钩子 |
| 解锁 | 旧工具输出变 stub，省 context |
| 投入 | 1–2 天 |
| 优先级 | ★☆☆ |

参考 Percho（默认开）。消息渲染时按策略把旧 toolResult 压成 stub。

---

## 三、不做（冻结项）

见 [`.out-of-scope/frozen.md`](../.out-of-scope/frozen.md)。改动需先开 grill 翻案：

- 重造 pi 内置 subagent（SDK 自带）
- 桌面宠物、live-voice 语音
- DSH 后端、生图后端（保持 pi 单后端）
- GPUI / 纯 Rust 重写（6–12 人月，不划算）
- 重写 `AgentSessionWrapper.send` 的命令状态机

---

## 状态图例

| 标记 | 含义 |
|---|---|
| ✅ | 已交付（已合并 main + 已发版或待发版） |
| 🔜 | 待做（已列入路线图） |
| 🧊 | 冻结（不做，翻案需开 grill） |

---

## 版本对应

| 版本 | 内容 |
|---|---|
| 0.10.1 | PR-1~PR-6（5 个 seam + 插件骨架）+ 发版基建 + releaseBody 自动化 |
| 0.10.2 | PR-5 `session_ended` 端测（`b02ad78`）+ 平台裁剪（`6e08e34`/`a6da4bc`）+ releaseBody（`c35ae95`）+ 消息轨道（`e33c22d`）+ 审批 UI（`f5f8495`） |
| 未定 | #13~#21 待做项，按优先级逐个 PR |
