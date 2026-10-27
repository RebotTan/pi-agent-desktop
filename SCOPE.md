# SCOPE

本 fork（`E:/teach/pi-agent-desktop`）做什么、不做什么。方向来自 grill 轮结论，改方向需先开新 grill 并落 ADR。

原始工程：`agegr/pi-web`（MIT）——pi 编码 agent 的 Web/桌面 GUI。本 fork 在其上做二开。

---

## 做什么

**目标**：一个自用的、开源发布的 pi 桌面工作台——极简内核起步，保留后续加插件与多 Agent 编排的接入点，桌面 + 可交互 Web 同一份代码。

已定的方向约束（来自 grill）：

| 决策 | 选择 | 理由 |
|---|---|---|
| 发布形态 | 开源 | 因此不能整体 fork PI-Desktop（LGPL-3.0 传染），只当设计参考 |
| 起步范围 | 极简内核 | 后续按需挂功能 |
| pi 集成 | 引擎进程内嵌 | 轻、简单；隔离问题靠引擎接口将来换实现的代价 |
| 平台 | 桌面 + 可交互 Web | 手机能发 prompt / 批准工具调用 |
| 投入 | 业余个人，几周到一两个月 | 每个 PR 必须小、可独立回退 |
| 架构起点 | 先做进程抽象层 | 一个接口同时服务插件与多 Agent |

**分阶段落地**：

1. **PR-1 AgentEngine 接口 + globalThis 收敛** — 纯重构，零行为变化
2. **PR-2 `startRpcSession` 收进引擎** — 会话工厂归属引擎
3. **PR-3 SessionStore 存储抽象** — JSONL 收口到接口，为 SQLite/会话导入预留
4. **PR-4 审批/权限管道** — tool call 前可中断钩子 + 规则表骨架
5. **PR-5 事件总线** — agent 事件一处发出、多处订阅
6. **PR-6 插件三层注册点骨架** — UI / agent / service contribution

**保持不动**：pi-web 上游的全部现有功能、`AgentSessionWrapper` 类、试金石测试（`scripts/fork-extractions.test.mjs`）、`app/globals.css` 与 `app/settings.css` 的字节一致性。

## 不做什么

见 `.out-of-scope/frozen.md`。

## 判断某个功能该不该做的三个问题

1. 它需要新的**进程边界**吗？需要 → 先确认 `AgentEngine` 接口够用，不够就先改接口。
2. 它需要新的**持久化格式**吗？需要 → 先确认 `SessionStore` 接口够用。
3. 它需要**打断 agent 行为**吗？需要 → 走审批管道 / 事件总线，不新开钩子路径。

三个都不用 → 纯 UI 或纯配置，随时可加，不阻塞。
