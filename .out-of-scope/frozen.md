# Frozen — 明确不做的项

**冻结 = 不写代码、不写工单。** 想做必须先开一轮 grill 翻案，结论落进 `.agents/adr/`，再解冻。

理由记录在这里，是为了避免半年后重新讨论同一个问题。

---

## 1. 重造 pi 内置 subagent

pi SDK 自带 subagent（`SUBAGENT_CONTROL_TOOL_NAMES`），结果是 toolResult 回流主上下文，生命周期随主会话。**够用，不重造。**

要做「独立会话编排」时做的是另一层东西（worker session），见 `GLOSSARY.md`。

## 2. 桌面宠物

PiDeck 与 Percho 有（petdex 社区宠物、鲸鱼女仆 overlay）。本 fork 不做。与核心「agent 会话管理」无关，是独立浮动窗口 + 状态订阅的完整子系统。

## 3. live-voice 语音

PI-Desktop 有（`apps/desktop/electron/main/live-voice/`，WebSocket realtime + 麦克风租约 + 音频后端）。本 fork 不做。音频链路重、平台差异大、与核心价值弱相关。

## 4. DSH（DeepSeek Harness）后端

PiDeck 把它做成一等公民（~30 个 `@deepseek-ai/dsh-*` 包内嵌 utilityProcess）。本 fork 不做。**保持 pi 单后端**——多后端抽象会污染 `AgentEngine` 接口，且 DSH 尚在 RC 阶段。

## 5. 生图后端

PiDeck 有独立生图后端（OpenAI 兼容 `/images/generations`）。本 fork 不做。不是编码 agent 的核心路径。

## 6. GPUI / 纯 Rust 重写

评估结论：6–12 人月，不划算。三条拦路虎——pi SDK 是 TypeScript（重写 3–6 人月 / 嵌 deno_core 1–2 人月 / Node sidecar 2–4 周）、GPUI 富渲染生态真空（markdown/KaTeX/Mermaid/iframe 沙箱预览都要自己造）、xterm 与 7 个 Tauri 插件要重造。

## 7. 重写 `AgentSessionWrapper.send` 的命令状态机

那个大 switch（`prompt`/`abort`/`fork`/`fork_branch`/`set_model`/`get_state`/composer 队列）承载了 `pendingPromptCount`、`sessionReplacement` 互斥、closing-wait、idle timer 等一堆微妙时序。**重构它风险远大于收益。** PR-1/PR-2 只搬容器，不碰它。

## 8. 内嵌 Rust host-core

PI-Desktop 用 Rust 承担权限网关/审计/SQLite/密钥（99k 行 Rust）。本 fork 不做。双语种贡献门槛与构建复杂度对 solo 业余项目不划算。需要的能力用 TS 实现或交给操作系统。

## 9. 插件 marketplace / 云端目录

PI-Desktop 有 `plugins.aiuo.net`，PiDeck 有 prompts.chat / skills.sh 商店。本 fork 只做**本地插件注册点骨架**（PR-6），不做服务端目录。

## 10. 自动构建安装包

发版流程只做 `changeset version` 升版本 + 写 CHANGELOG（人工合并 version PR），安装包手动 `npm run dist:*` 出。将来再加 `tauri-action`。
