# GLOSSARY

fork 二开引入的术语。命名、文件名、函数名都从这里取词——统一语言减少 token 消耗，也让代码库更易导航。

只收录 **fork 新增或重新定义的** 概念。pi-web 上游自带的术语（AgentSession、session、compaction 等）不重复定义，见 `AGENTS.md` 与 `docs/agents/`。

格式：`**术语** — 一句话定义。` 需要展开的用二级标题。

---

## 流程词汇

**spec** — 已定决策的记录文档，不是新决策的地方。只用于跨多个会话的工作，存 `.scratch/specs/NNNN-*.md`。单会话能做完的改动不写 spec。

**ticket** — 一张 tracer-bullet 工单，大小等于一个全新上下文窗口。含目标 / seam / 验收标准 / out-of-scope。存 `.scratch/tickets/NNNN-*.md`。一个 ticket = 一次 implement 会话 = 一个提交。

**seam** — 观察行为的公共边界，测试只写在 seam 上。seam 在写代码前定好，之后实现可以随便换而测试不动。理想的 seam 数量是 1。

**changeset** — 附在每个 PR 上的版本变更声明，存 `.changeset/NNNN-*.md`。声明 patch/minor/major + 一句话描述。漏 changeset 的 PR 不合并。

**ADR**（Architecture Decision Record）— 一份不可逆或影响深远决策的记录。存 `.agents/adr/NNNN-*.md`。内容：标题 / 上下文 / 决策 / 后果 / 状态。

## 架构词汇

**AgentEngine** — 会话运行时引擎的显式接口。持有所有会话实例与启动锁，是**唯一的**会话状态容器。上层（API 路由、UI、subagent、插件）只通过它拿会话，不直接碰 `globalThis`。

**InProcessAgentEngine** — `AgentEngine` 的第一个实现：引擎跑在 Next.js 进程内，用 4 个 Map 存状态（registry / startLocks / startingCwds / runningListeners）。取代原先散落在 `lib/rpc-manager.ts` 的 4 个 `globalThis.__pi*` 容器。

**SidecarEngine** — `AgentEngine` 的预定第二个实现（未实现）：每个 worker 会话一个子进程，崩溃隔离。解锁 Worker Session 编排。

**RemoteEngine** — `AgentEngine` 的预定第三个实现（未实现）：会话跑在 SSH 远程主机上。

**AgentSessionWrapper** — pi-web 上游的类，包装 SDK 的 `AgentSession`，负责事件订阅、idle timer、命令分发（`send` 的大 switch）。**保留不动**，只是它的容器从 globalThis 换到 engine。

**SessionStore** — 会话持久化接口（PR-3 引入，未实现）。现在实现是 `JsonlSessionStore`（包 `SessionManager`），将来可换 SQLite。

**tool approval pipeline** — tool call 执行前的可中断审批钩子 + 规则表（PR-4 引入，未实现）。

**event bus** — agent 事件一处发出、多处订阅的分发层（PR-5 引入，未实现）。现有 `onEvent` + `notifyRunningChange` 是其雏形。

**plugin registry** — 插件三层注册点骨架（PR-6 引入，未实现）：UI contribution / agent contribution / service contribution。

## 会话层级

**subagent** — pi SDK 自带的内部委派：主 agent 在工具调用里发起，子 agent 结果是 toolResult，**回流主会话上下文**，生命周期随主会话。不重造。

**worker session** — 应用层的完整独立会话：自己的 `.jsonl`、自己的生命周期、隔离上下文、可暂停/恢复/复用、可事后查看完整 transcript，结果靠**显式报告**回填父会话。与 subagent 不同层，不混淆。

**session orchestrator** — 从父会话编排多个 worker session 的能力（PI-Desktop 的叫法，参考范本）。需要 `SidecarEngine` 支撑。

## 冻结项（见 `.out-of-scope/frozen.md`）

DSH 后端、生图后端、桌面宠物、live-voice、GPUI 重写、重造 subagent、重写 `AgentSessionWrapper.send` 状态机。
