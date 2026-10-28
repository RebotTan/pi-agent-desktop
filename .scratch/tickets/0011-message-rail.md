## 目标

会话消息流左侧加一条 56px 的并行轨道（序号 + 贯穿连线 + 角色圆点），让「一串有序动作」在视觉上可读。这是样张方案 C 的落地。

轨道是**信息装置**，不是装饰：序号给出动作在会话中的位置，连线表达连续性，圆点区分角色，彩色只留给「运行中」。

## Seam

`app/native-theme.css` 里的 `.msg-rail-*` 规则 + `components/ChatWindow.tsx` 给消息包层加的两个 data 属性。纯视觉，不动 `MessageView` 的任何分支渲染、不动消息数据流。

## 实现

- `components/ChatWindow.tsx`：`messageContentRef` 容器的 div 加 `className="msg-rail-track"`（CSS 计数器作用域）；`renderMessage` 的两条返回路径都包进 `className="msg-rail-row"` + `data-role={msg.role}` 的容器（可见分支保留 ref，不可见分支不带 ref）。
- `app/native-theme.css`：`.msg-rail-track { counter-reset: msg-rail }`；`.msg-rail-row { counter-increment: msg-rail; position: relative; padding-left: 56px }`；`::before` 画连线 + 圆点（`data-role` 决定圆点颜色）；`::after` 用 `counter(msg-rail, decimal-leading-zero)` 出序号。首行线段从序号下沿开始、末行在线段末端收尾。
- 深浅两个主题各给一套 token（连线 alpha、序号色、圆点色都走变量）。

## 验收标准

1. `node_modules/.bin/tsc --noEmit` 通过
2. `npm run lint` 通过
3. `node --test scripts/fork-ownership.test.mjs` 通过
4. `app/globals.css`、`app/settings.css` 与上游字节一致（`node --test scripts/upstream-css-baseline.test.mjs`）
5. `npm run dev` 手测：新建会话发一轮带工具调用的 prompt，截图确认轨道序号连续、连线不断、圆点按角色区分、运行中为绿色
6. 浅色主题下同样可读
7. 消息折叠（process group）后序号仍单调递增

## Out-of-scope

- 不做轨道节点点击跳转（`ConversationNavigator` 已覆盖粗糙的轮次跳转，需要时另开）
- 不改会话导航栏、不改 composer、不改侧边栏
- 不做 A/B 两案的 token 重映射（`apply-codex-tokens.mjs` 是独立试验，与本单无关）
- 流式消息那一行（`ChatWindow.tsx` 的 `streamState.streamingMessage`）暂不挂轨道，避免每 chunk 重排
