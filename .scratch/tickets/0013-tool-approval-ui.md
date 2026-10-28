## 目标

把 PR-4 已经做好的审批后端接上界面：①会话里出现待审批工具调用时浮出审批卡（允许/拒绝）②Settings 里能编辑规则表（pattern → allow/deny/ask）。

后端零改动 —— `/api/tool-policy`（GET 规则+pending、POST 加规则、DELETE 删规则）和 `/api/tool-policy/settle`（POST 结算）已经端到端可用。

## Seam

`components/ApprovalPrompts.tsx`（审批卡，自取 `/api/tool-policy`）与 `components/ToolPolicySettings.tsx`（规则编辑器，Settings › 工具审批）。两者只走既有 HTTP 契约，不 import `lib/approval-coordinator.ts` 或 `lib/tool-policy.ts`，所以将来把审批挪到 SidecarEngine 或加 web 端审批都不用改这两个组件。

## 实现

- **审批卡**：挂载在 `ChatWindow.tsx` 的 composer 上方（`{chatInputElement}` 之前）。每 1.5s 拉一次 `/api/tool-policy`，窗口隐藏（`document.visibilityState === "hidden"`）时暂停。多张排队时只展示第一张并显示「还有 N 个」，允许/拒绝后立即刷新。参数以等宽字体展示，长值折行不裁切。
- **规则编辑器**：`SettingsPanel` 新增 `tools` section（`lib/settings-navigation.ts` 的 `SETTINGS_SECTION_VALUES`、`SETTINGS_SECTION_ITEMS`、`sectionHost`、图标四处分派）。规则表用共享 `SettingsUi` 块；action 用 `AppSelect`（不用原生 `<select>`）。空态给一句话说明匹配规则：pattern 支持 `*`，首条匹配获胜，无匹配放行。
- **样式**：卡片和表格规则写进 `app/native-theme.css`（`globals.css` / `settings.css` 保持与上游字节一致）。
- **i18n**：新增 key 同步写 `lib/i18n/messages/{en,zh-CN,zh-TW}.ts`。

## 验收标准

1. `node_modules/.bin/tsc --noEmit` 通过
2. `npm run lint` 通过
3. `node --test scripts/fork-ownership.test.mjs scripts/upstream-css-baseline.test.mjs` 通过
4. 涉及共享选择控件：`node --test scripts/ui-menu-consistency.test.mjs` 通过
5. `npm run dev` 手测：规则表加 `bash → ask`，新建会话让模型跑一条 bash，审批卡浮出；点「允许」工具执行、点「拒绝」工具被 block 且模型收到拒绝原因；Settings › 工具审批 增删规则后 `GET /api/tool-policy` 反映变化
6. 窗口隐藏时轮询停止（Network 面板确认无请求）

## Out-of-scope

- 不做「允许并记住」（先手动去 Settings 加规则）
- 不做 web/手机端审批（依赖 web 鉴权层，roadmap #8）
- 不做审批超时自动拒绝（先由人决定）
- 不改 `lib/approval-coordinator.ts` 与 `lib/tool-policy.ts`（规则表仍是内存态，持久化另开）
