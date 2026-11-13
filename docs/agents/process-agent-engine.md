# #24：完整主会话进程隔离实施方案

状态：**方案已定稿，生产切换尚未实施**。审计基线：`dev` / `22c2b1ec`（2026-11-13）。

目标：每个主会话在独立 Node worker 中运行完整 pi SDK；HTTP 服务保留会话代理与跨会话编排。扩展 UI、审批、MCP、任务、工具切换和持久化保持现有行为。不是另做 Ask，也不是把不支持的路由改成报错。

本轮仅落盘方案及纠正 roadmap；不修改生产引擎、不发布 0.11.1。后续按下面阶段交付，开关最后做。

## 1. 已交付与未交付

已交付：

- `lib/agent-engine-process.ts` 的 `ProcessAgentEngine`、`lib/session-handle-rpc.ts` 的 RPC handle、`lib/worker-process-host.ts` 的宿主与预热池。
- `lib/worker-process-main.mjs` 已在首次 `session.start` 时通过 jiti 加载 `lib/rpc-manager.ts`，运行真 `AgentSessionWrapper`，不再是模拟会话。
- `lib/session-start-params.ts` 集中启动决策；父进程传 `{ sessionFile, cwd, ...options }`，worker 自己 collect，不由父子分别打开同一个 `SessionManager`。
- 基线两个 worker 测试文件共 11 项通过；这只证明已有启动/RPC路径，不证明生产功能等价。

未交付：生产 `getEngine()` 仍返回 `InProcessAgentEngine`；路由、聚合器、跨进程服务和桌面产物尚未全部适配。

纠正两项旧判断：

1. 预热目前只起进程，`ready` 早于 SDK 加载。约 1.8s 起会话与约 5s 首次 jiti 加载来自不同测量，不能声称预热已经承担转译，也不能据此承诺启动时间。
2. 私有字段数量不是跨进程接口清单。状态留在 worker，只迁移真实调用需要的读结果、命令和事件；不搬整份 SDK 对象，不以恒 `false` 或空方法表示功能已支持。

## 2. 边界与所有权

### HTTP 父进程

- 生产 `AgentEngine` 注册表、启动锁、正在关闭的等待、worker 宿主、HTTP/SSE 连接与页面 lease。
- 跨会话列表、Tasks/Debug 聚合、全局事件总线、审批协调器、调度器、通知投递。
- 用户配置/信任/网络暴露状态的权威入口；负责向 worker 同步必要状态，而非依赖两边的 `globalThis` 恰好一致。
- 路由只依赖公共会话契约。父进程不创建或持有正在运行会话的 `AgentSession` / `SessionManager`；无活 owner 的离线会话仍可通过只读磁盘路径读取。

### 会话 worker

- `AgentSessionWrapper`、SDK 会话及 manager、模型运行时/凭证访问、prompt 队列、扩展绑定/UI请求、MCP host、工具执行、会话写入。
- 所有影响安全和并发的会话判定在执行命令时复查；父进程缓存的 `running`/chat 状态只用于展示和提前拒绝，不能作为唯一授权依据。
- 通过独立本地装配入口或显式 worker 角色使用本地引擎；不能再次走父进程的 Process 引擎选择，防止递归 spawn。
- 当前 `SUBAGENT_CONTROLLER` 会直接注册 SDK 创建的 wrapper。第一版保留其本地对象关系：子会话在所属主会话 worker 内运行，向父进程发布独立 handle/任务/生命周期。隔离单位是主会话及其子会话树；不把该回调中的 SDK 对象序列化，也不声称已逐个隔离子会话。

### 数据与通信

- 采用 Node 专用 IPC 通道；stdout/stderr 仅作日志。不能靠拦截 `console.log` 修补 stdout JSON 协议，扩展可能直接写 stdout。
- 三类消息：命令及结果、带顺序的会话事件/状态快照、worker 向父进程发起的服务请求及结果。携带协议版本、请求 ID、worker 实例标识、目标 session ID；仅分发白名单操作，验证消息形状及 session 归属。
- 不传类实例、函数、Map、凭证对象或任意远程属性访问。复用现有 `RpcEvent`/快照结构，增加传输所需的最小元数据。
- 快照包含 revision；事件与快照按同一会话顺序应用。旧 worker 的迟到结果不能覆盖重启后的新 handle。RPC 断开不是已完成；所有在途请求必须 settle。
- prompt/abort/UI 回复不能排在一个长操作锁后互相等待。只串行化需要互斥的启动、变更、关闭操作；保留现有 prompt 准入与队列规则。
- 浏览器继续使用现有 SSE。worker IPC 不直接透传到浏览器，保持签名/敏感信息过滤；内部读结果按需请求，不在每个 token 重发全部历史。

## 3. 真实调用迁移清单

以下是契约的来源，不是要求新增一套大而全的远程 SDK。同步查询读取最近快照；需要最新/原子状态的操作走异步语义命令。

| 调用面 | 现有代码证据 | 迁移及不可丢失的行为 |
| --- | --- | --- |
| 基础 handle / 生命周期 | `lib/session-handle.ts`；`lib/session-handle-rpc.ts`；`lib/agent-engine.ts` | 补足真实外部调用所需的 `sessionFile`、streaming、running/awaiting、chat 标志、pending preview、idle/debug/task 等契约。worker 的 running 必须保留 `inner.isIdle === false` 语义；移除生产路径上的空实现/固定值。 |
| 注册与聚合 | `lib/rpc-manager.ts` 的 `registerRpcWrapper`、`getRpcSessionInfos`、`getRpcTaskSnapshots`、`enforceIdleSessionCap` | 分离 SDK 本地启动/扩展绑定与父进程登记/通知。路径缓存、同 ID 身份检查、启动锁/关闭等待、idle cap、recent outcomes 和 suppressed 通知仍成立；启动/结束事件只发布一次。 |
| SSE / lease | `app/api/agent/[id]/events/route.ts`；`app/api/agent/[id]/lease/route.ts`；`createAgentEventStream` | 初始 streaming 快照、订阅/取消、断线重连、慢消费者背压、心跳保持等价。SSE 订阅与页面 lease 是两件事；无订阅不自动取消运行中的会话，续租不能被误当成启动。 |
| 未落盘读取 | `app/api/sessions/[id]/route.ts`、`app/api/sessions/[id]/context/route.ts`、`app/api/sessions/[id]/fork/route.ts`、`app/api/sessions/[id]/reference/route.ts`；`app/api/sessions/stats/route.ts`；`lib/session-manager-access.ts` | 当前 `getRpcSessionInfos` 读 `inner.sessionManager`；`openSessionManagerForRead` 在无文件时返回 live manager。改为 owner 返回可序列化的会话视图、上下文、统计、引用及分支读结果。首条 assistant 前未 flush 的会话必须可见；保留各调用原有的 disk-ahead/leaf 选择，不一律用磁盘替代。 |
| 重命名 / 自动标题 | `renameRpcSession`；`app/api/sessions/[id]/auto-name/route.ts`；`app/api/sessions/[id]/route.ts` | owner 调 `setSessionName` 并发布 `session_info_changed`。标题生成使用该会话模型/凭证，并复查手动改名竞态。rename 等待装配可访问 manager，但不等待可能被弹窗卡住的 `session_start`。无人持有会话时才走磁盘写，且与启动/关闭互斥。 |
| 工具策略 / chat unlock | `setRpcSessionTools`、`setRpcChatUnlock`（`lib/rpc-manager.ts`） | owner 判定并写会话策略，父进程编排需要的关闭/重开，整个变更受会话锁保护。同 policy 原位变更；跨 policy 等 dispose。无文件重建允许新 ID，并保留模型/thinking。保留禁 running、禁网络暴露 unlock、独立 chat folder、首次 flush 等安全条件。 |
| chat 与文件访问 | `app/api/agent/[id]/**`；`lib/session-delete.ts`；chat-folder、reveal、chat-access、continue-in-project 路径 | 迁移每个实际 handle 调用；文件/路径授权仍在 HTTP 边界检查，worker 不因缺少父进程安全状态而放行。重写、删除或替换同一会话文件必须等原 owner 释放，防止晚写复活或重复 writer；fork/continue 读取一致快照并写入新会话，不要求关闭原会话。 |
| 扩展 UI / MCP / Debug | `AgentSessionWrapper` 的 `beginExtensionBinding`、`waitUntilReady`、`prepareMcpForRun`、`getDebugSnapshot`、`getMcpDebugSnapshot` | UI 的请求 ID、等待、回复、取消、widget/status/theme 与现有协议一致；父进程能看到 worker 的 MCP 连接状态。磁盘比内存新时仍能驱逐/重开，不保留恒 `false` 的 `evictIfDiskAhead`。 |
| 子会话 / 调度 / 通知 | `SUBAGENT_CONTROLLER`；`lib/subagent*.ts`；`lib/scheduled-tasks/**`；`lib/web-push.ts` | 子会话注册、等待/运行/完成、取消与 session path 都桥接到父进程。调度器只在父进程启动一次；任务默认只读和通知抑制不变，完成通知不得父子各发一次。 |

实施时先把这些调用变成适用于本地 handle 的契约测试，再让 RPC handle 通过同一组行为测试。不要边开生产开关边补缺失方法。

## 4. 跨进程服务归属

| 服务 | 权威位置与桥接方案 | 验收重点 |
| --- | --- | --- |
| 工具审批 | 父进程 `lib/approval-coordinator.ts` 保存 pending/resolve；worker 的策略扩展向父进程申请，父 HTTP approve/deny 回传结果 | 父进程可见等待项；取消、关闭、超时或断线均拒绝未决审批，绝不能批准；父子不各建一张独立审批表。 |
| 生命周期 / Tasks / 通知 | 父进程 `lib/agent-event-bus.ts` 和全局聚合；worker 提供会话事件及快照 | 子会话可见、running_changed 去重、最近结果保留；推送/桌面完成通知单次投递。 |
| 配置 / trust / chat 安全 / allowed roots | 父进程管理权威更新；worker 起会话读取必要初始值，后续用 revision 通知刷新或重建本地资源 | 审计 `lib/allowed-roots.ts`、`lib/project-trust.ts` 及 chat file grants；撤销权限不能因陈旧缓存继续放行，无法确认权限则拒绝执行。磁盘共享不等于缓存已同步。 |
| 网络代理 / 模型目录 / theme | `lib/network-proxy.ts`、`lib/deferred-provider-models.ts`、`lib/extension-ui-theme.ts` 的进程内状态在各 worker 明确初始化及更新 | 代理更新重建 worker dispatcher；模型目录不额外触发网络刷新；theme/已加载 provider 与本地路径一致。敏感配置只走内部通道，不进入 SSE/Debug 日志。 |
| SessionStore / 文件持久化 | 父进程管理跨会话索引/store；活会话 worker 是唯一 SDK writer | 父进程重写、删除同一文件或以新 writer 重开前，必须确认原 owner 已释放；SQLite 等 store 不因 worker import 再起一份全局服务。 |
| 插件注册 | `lib/plugin-registry.ts` 的 `registerAgentExtension` 存函数，`registerService` 存任意对象；不能 JSON 化 | 把执行端需要的注册入口放到可在 worker 重建的模块，按角色提供内建服务。父进程负责 UI contribution 和全局服务；测试扩展仍拿到所需行为，不改 pi CLI 的扩展 API。 |

**插件注册是切换门槛，不是可忽略的边角。** P0 必须列出实际 `registerAgentExtension` / `registerService` 调用，区分模块可重建注册与仅父进程内存存在的动态实例。后者需迁移其注册来源或为具体服务提供桥接；不能序列化函数源码、丢弃扩展或把公开同步服务偷偷变成 Promise。若还有无法等价重建的调用，默认切换保持关闭，并记录具体调用方及修复项。

## 5. 生命周期与故障约束

- 每个主会话树独占一个已领取的 worker；预热 worker 未装会话时才可领取。关闭子会话不能直接 `process.exit()` 杀掉同 worker 的其他会话。
- 区分进程可通信、SDK 模块已加载、会话已装配、扩展 UI 可交互完成。保留原 `waitUntilReady` 语义，但 rename、UI 回复、abort 不应被交互等待阻塞。
- graceful shutdown：拒绝新写命令 → 等待现有会话关闭/持久化 → 回报 disposed → 回收进程；遵守现有 shutdown deadline，超时才强杀。租约/idle cap 只结束确实可回收的会话树。
- worker 异常退出/IPC 断开：拒绝所有 pending RPC、取消审批、终止 SSE 的运行态、清理注册及启动锁、记录一次失败。释放等待者不依赖 50ms 永久轮询。
- 父进程退出或被杀：worker 感知 IPC 断开并自行清理，不留下工具/MCP 孤儿。应用退出同时 drain 预热池与活动 worker。
- 不自动重放 prompt/tool call；它们可能有外部副作用。崩溃后可按已有磁盘恢复规则重新打开，未 flush 的内存无法保证恢复，必须显式告知丢失范围，不假报成功。
- IPC 队列有边界；慢浏览器不能无限积压 worker 消息。保留有序终态，已有 SSE 断线重连机制承担浏览器恢复，不为此新增一套事件存储。

## 6. 分阶段实施与验收

每阶段是独立可检查的提交单元；只有验收通过才开始依赖它的下一阶段。不按“搬多少字段”计进度，不再给未经验证的工期承诺。

### P0 — 锁定兼容性基线

- [x] 以第 3、4 节为清单，检索所有非测试的 `getRpcSession` / `AgentSessionWrapper` / `.inner` / 插件注册调用；逐项补齐遗漏及服务归属。盘点结果见下表。
- [x] 为未 flush 会话读取、rename 弹窗竞态、tool policy 重建、chat unlock、子会话登记补本地行为测试；保留当前测试中的故障基线。覆盖在 `lib/session-reader-latest-entry.test.mjs`、`lib/rpc-manager-lifecycle.test.mjs`（含 rename 不等 `session_start` 的用例）、`lib/chat-unlock.test.mjs`、`lib/rpc-manager.test.mjs`。
- [x] 纠正 `lib/worker-process-main.mjs` 的预热注释，以及 `lib/session-handle.ts` 允许 RPC 假值的生产契约说明。

P0 盘点结果（2026-11-13，仅非测试调用；`lib/rpc-manager.ts` 内部的 `.inner` 属 worker 侧，不计入）：

| 位置 | 现在读/写的内部状态 | 迁移目标 |
| --- | --- | --- |
| `app/api/sessions/[id]/route.ts:64,100,207` | 未落盘 `sessionManager`、`runtime:` sourceId、`setSessionName` | owner 返回会话视图；rename 走语义命令 |
| `app/api/sessions/[id]/fork/route.ts:63,68` | 内存 `getLeafId`、disk-ahead 命中判定 | owner 返回与磁盘一致的分支快照 |
| `app/api/sessions/[id]/context/route.ts:34,42` | 内存 manager、`modelRuntime` 计价 | owner 返回上下文与模型视图 |
| `app/api/sessions/[id]/auto-name/route.ts:27,36` | `generateSessionTitle(inner)`、`setSessionName` | 标题在 owner 内用该会话凭证生成 |
| `app/api/sessions/stats/route.ts:41` | 内存 manager 统计 | owner 返回统计视图 |
| `lib/session-manager-access.ts:21` | 无磁盘文件时回落到 live manager | 并入上面的读结果契约 |
| `lib/session-replacement.ts:120–183` | 扩展迁移、manager entries、`writeForkedSession` 直接写盘 | 由 owner 执行替换与分叉写入 |
| `lib/subagent-runtime.ts:367–1065` | 父会话上下文/模型/工具，子会话 prompt/abort/entries | 子会话树留同一 worker，父进程只发命令 |
| `lib/scheduled-tasks/runner.ts:117` | `appendCustomEntry` 写运行记录 | 经 owner 追加 |

插件注册的实测结论比方案预期简单：生产代码没有 `registerAgentExtension` 调用方，测试外也没有 `registerService`；`getPluginRegistry()` 只登记四个内建 id —— `agent-engine`、`session-store`、`agent-event-bus`、`tool-policy`（`lib/plugin-registry.ts:81-85`）。这四项留在父进程作为权威，worker 需要时经桥接取用，不做 JSON 序列化。当前动态函数实例风险为零；以后外部包注册时按第 4 节门槛处理。

验收：每个调用有目标契约和测试；本地实现行为不变；内存动态插件的去向明确。这里的未知项没有解决前，不能宣称默认切换只差配置。

### P1 — 把路由从 SDK 对象中分离

- [ ] 按真实调用扩充 `SessionHandle` 的快照/命令边界，让 `AgentSessionWrapper` 首先实现它；`getEngine()`、`getRpcSession()` 及 `SetRpcSessionToolsResult` 不再强制暴露具体 wrapper。
- [ ] 把 session/context/stats/reference/fork/title/rename 改成语义读写；替换返回 manager 的 `openSessionManagerForRead` 跨层用法。
- [ ] 提取父进程登记/清理与 worker 本地装配，保留启动锁、关闭等待、registry 身份检查和 idle/lease 行为。

验收：生产仍本地引擎；HTTP 层和跨会话聚合不再依赖 `inner`；P0 与现有会话/API测试通过。私有 UI/MCP/prompt 状态仍在 wrapper 内，不为消除类型错误复制它们。

### P2 — 加固真实 worker 通信与生命周期

- [ ] 替换 stdout 协议为专用 IPC，实现版本/消息校验、请求终止、实例隔离、有序事件/快照和有界发送。
- [ ] 显式分离父/worker 引擎选择；完成本地装配及子会话 handle 登记，处理 worker 崩溃、父断线、正常退出和强杀。
- [ ] RPC handle 的生产方法提供真实实现，不能残留空的 `beginExtensionBinding` 或恒假的磁盘驱逐判断。

主要文件：`lib/worker-process-host.ts`、`lib/worker-process-main.mjs`、`lib/session-handle-rpc.ts`、`lib/agent-engine-process.ts`、P1 的共享契约。

验收：既有 worker 测试及 P1 handle 行为套件在两种引擎都通过；故意写 stdout 不损坏通信；非法消息被拒绝；崩溃释放全部等待；两个主会话并行时一个退出不伤另一个；子会话退出不杀主会话；没有递归 spawn。

### P3 — 桥接完整功能与全局服务

- [ ] 完成第 4 节审批、事件/通知、配置安全状态、插件注册桥接；避免在 worker import 时启动调度器/推送等全局后台服务。
- [ ] 打通扩展 UI 请求/回复与状态重连、MCP 状态/信任/重载、Tasks/Debug、子会话及调度会话。
- [ ] 完成未落盘读取、disk-ahead、自动标题、tool policy 和 chat unlock 的跨进程竞态测试。

验收：同一组业务用例本地与 Process 模式输出等价；approve/deny/cancel 都可从 HTTP 完成；等待弹窗时 rename/abort 可用；权限撤销即时有效；运行/最近任务、子会话完成、通知抑制和持久化不降级。不得用测试中的恒定快照代替真实 worker 验证。

### P4 — 桌面与部署产物闭包

- [ ] 用现有 `esbuild` 生成独立 Node worker 产物，移除对仓库 TS 源码和开发 cwd 的运行时依赖；SDK/原生/动态依赖按现有 staging 方式带齐，不新增打包依赖。
- [ ] 调整 `scripts/prepare-desktop.mjs` 的 `assembleServer` 和宿主入口定位，覆盖仓库开发、Web 部署、Tauri 资源目录；禁止 hard-code 某个嵌套 `node_modules` 路径。
- [ ] 增加真实 packaged-worker smoke check 并接到 `package.json` 的 `desktop:verify`；更新 `scripts/release-workflows.test.mjs` 对闭包/入口的断言。

验收：只用 staged 目录、临时 agentDir 和不同 cwd 起真会话；扩展加载、Code mode、MCP 初始化、关闭都可运行；无 API key 时保留原始错误。至少 Windows 桌面产物及 Linux Web 产物通过；发布到其他平台前补对应产物验证。保留 Windows 三项覆盖安装守卫、pi 包去重、路径长度及 node-pty/quickjs 完整性。

本阶段在独立构建目录/CI执行产物构建，**不在正在运行 dev 的目录跑 `next build`**。`desktop:prepare` 可能触发构建；不能把它当无副作用的文档校验命令。

### P5 — 等价回归与隔离测量

- [ ] 使用临时配置/模拟 provider 执行确定性 API→真 worker→SSE 回归；再用本机受控配置做 UI/MCP 冒烟，不污染用户会话。
- [ ] 覆盖新建未 flush、流式/abort/retry/compaction、断线重连、UI 等待/回复、审批、MCP、Tools/ChatOnly/unlock、rename/title/fork/delete、子会话/定时任务、崩溃恢复及退出清理。
- [ ] 记录冷启动、仅进程预热、SDK 预加载（如果实现）的独立耗时；测两会话并行的 HTTP 响应、RSS、关闭后残留进程。隔离收益与每会话内存成本都记录，不只展示最快一次。
- [ ] 跑定向测试、`node_modules/.bin/tsc --noEmit`、`npm run lint`、全量测试；区分基线平台失败与新增失败。

验收：功能矩阵无缺口、没有新失败/孤儿/重复写入；真实 UI 用例通过，产物脱离源码可运行；测量方法及结果写回本文件。基线全量 4187 项中 4130 通过、52 skipped、5 项已知 Windows 环境失败不是免测理由，需当次复核。

### P6 — 最后接生产选择与回退

- [ ] 仅在 P0–P5 完成后增加进程启动时固定的引擎选择，先受控启用，再将默认值切到 Process；保留 InProcess 的显式回退。
- [ ] worker 角色强制本地装配，不受父进程选择影响；Debug 显示当前模式与 worker 状态。
- [ ] 验证进程重启回退、同一 session 唯一 owner、启动失败/非法配置的明确错误；同步 `docs/agents/fork-sessions.md`、`docs/agents/fork-desktop.md`、roadmap 和 changeset。

验收：默认生产路径确实创建 worker，全部原有路由可用；回退只在 drain/退出后重新启动时生效。不能失败后静默转本地重放已发送命令，不能热切换让同一文件出现两个 writer。0.11.1 的发布另行决定，不由完成本方案自动触发。

## 7. 当前完成标准

本方案定稿的标准：边界、调用面、服务所有权、故障语义、产物路径、阶段与验收已写入可跟踪文档，并由 roadmap 链接。

#24 完成的标准：P0–P6 的检查项与实测证据齐全，生产完整主会话走 Process 引擎，保留行为、可回退；仅 worker 测试通过或增加环境开关都不算完成。
