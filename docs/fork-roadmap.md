# Fork 二开路线图

本 fork（`RebotTan/pi-agent-desktop`，基座 `agegr/pi-web`）的功能点清单：**已交付**与**待做**，每项标注状态、对应 PR/commit、所依赖的 seam、解锁的能力。

方向与约束见 [`SCOPE.md`](../SCOPE.md)；术语见 [`GLOSSARY.md`](../GLOSSARY.md)；冻结项见 [`.out-of-scope/frozen.md`](../.out-of-scope/frozen.md)；架构决策见 [`.agents/adr/`](../.agents/adr/)。

---

## 一、已交付（第一轮，v0.10.1）

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

## 二、待做（第二轮及以后）

按投入产出排序。每项标注：依赖的 seam、解锁的能力、预估投入、优先级。

### 高优先级（直接影响可用性）

#### 8. Web 鉴权层

| 项 | 值 |
|---|---|
| seam | `/api/agent/*` 路由前置中间件 |
| 解锁 | 手机发 prompt / 批准工具调用（你 Q7=B 的核心诉求） |
| 投入 | 1–2 天 |
| 优先级 | ★★★ |

当前 `/api/agent/*` 无鉴权，只能本机用。加一层 token/密码鉴权 + 局域网发现，手机扫码或输 token 连上。复用 pi-web 既有的 web-auth 节流框架。

#### 9. 工具审批 UI 面板

| 项 | 值 |
|---|---|
| seam | PR-4 的 `/api/tool-policy` + `/api/tool-policy/settle` |
| 解锁 | 用户可见的审批卡片、规则编辑器 |
| 投入 | 半天 |
| 优先级 | ★★★ |

PR-4 后端已通（规则表 + pending 审批 + settle），缺前端：①审批卡（pending 时弹卡，批准/拒绝按钮调 settle）②规则编辑器（pattern/action 表格，调 tool-policy API）。

#### 10. 插件 UI contribution 落地（第一个真实插件）

| 项 | 值 |
|---|---|
| seam | PR-6 的 `registerUiContribution` |
| 解锁 | 验证三层注册点设计、工具卡片/面板扩展 |
| 投入 | 2–3 天 |
| 优先级 | ★★☆ |

PR-6 只留了注册点骨架。挂第一个真实 UI 插件（比如「会话用量统计卡」或「Git 状态面板」），跑通 contribution → `/api/plugins/contributions` → 前端 slot 渲染全链路。

### 中优先级（架构演进）

#### 11. SidecarEngine（多 Agent 并行隔离）

| 项 | 值 |
|---|---|
| seam | `AgentEngine` 接口（PR-1/2） |
| 解锁 | Worker Session 编排、Ask 并行问询、独立完整会话/独立 .jsonl/隔离上下文 |
| 投入 | 1–2 周 |
| 优先级 | ★★☆ |

每 worker 一个 `pi --mode rpc` 子进程（参考 PiDeck/PI-Desktop 思想，不抄代码避 LGPL）。`SidecarEngine` 实现 `AgentEngine` 接口，`startSession` spawn 子进程，`send` 走 stdio JSON-RPC，`events` 转发子进程事件。主进程 `InProcessAgentEngine` 不变，编排器按需选引擎。

#### 12. SessionStore SQLite 实现

| 项 | 值 |
|---|---|
| seam | `SessionStore` 接口（PR-3） |
| 解锁 | 会话搜索索引、大规模历史、用量统计查询 |
| 投入 | 3–5 天 |
| 优先级 | ★☆☆ |

新增 `SqliteSessionStore` 实现 `SessionStore` 接口，JSONL 写入时同步镜像到 SQLite（写路径仍走 SDK，SQLite 只做读索引）。`getSessionStore()` 按配置切实现。

#### 13. 外部会话导入转换器

| 项 | 值 |
|---|---|
| seam | `SessionStore` 接口（PR-3）+ 插件 agent contribution（PR-6） |
| 解锁 | 导入 Codex/Claude/OpenCode 会话 |
| 投入 | 2–3 天/每个格式 |
| 优先级 | ★☆☆ |

「外部会话转换器」插件点：jsonl 格式适配器，读外部会话文件 → 转 pi v3 jsonl → 落 SessionStore。

### 低优先级（纯 UI / 锦上添花）

#### 14. 事件总线出口：webhook / 飞书

| 项 | 值 |
|---|---|
| seam | `AgentEventBus`（PR-5） |
| 解锁 | agent 事件 → webhook 适配器 → 飞书机器人/外部通知 |
| 投入 | 1 天 |
| 优先级 | ★☆☆ |

订阅 `AgentEventBus`，按规则转发到 webhook。配置存 `~/.pi/agent/webhooks.json`。

#### 15. 用量统计

| 项 | 值 |
|---|---|
| seam | 事件总线（PR-5）+ SessionStore SQLite（#12） |
| 解锁 | 用量热力图/每日/模型/项目统计 |
| 投入 | 2–3 天 |
| 优先级 | ★☆☆ |

订阅 usage 事件 → 持久化到 SQLite → 前端统计面板。

#### 16. SSH RemoteEngine

| 项 | 值 |
|---|---|
| seam | `AgentEngine` 接口（PR-1/2） |
| 解锁 | 远程主机上跑 agent，本地 GUI 操作 |
| 投入 | 1 周 |
| 优先级 | ★☆☆ |

`RemoteEngine` 实现 `AgentEngine`，`startSession` SSH 连远程机起 pi sidecar，`send`/`events` 走 SSH 通道。远期。

#### 17. Plan Mode

| 项 | 值 |
|---|---|
| seam | 审批管道（PR-4）+ agent 配置透传 |
| 解锁 | 先计划后执行 |
| 投入 | 2–3 天 |
| 优先级 | ★☆☆ |

启动参数带 mode=plan，agent 只规划不执行，计划确认后切 mode=execute。复用审批管道的「挂起等确认」机制。

#### 18. 上下文蒸发

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
| 0.10.2+ | PR-5 session_ended 端测（`b02ad78`）+ 平台裁剪（`6e08e34`/`a6da4bc`）+ releaseBody（`c35ae95`），待 version PR 合并后发版 |
| 未定 | #8~#18 待做项，按优先级逐个 PR |
