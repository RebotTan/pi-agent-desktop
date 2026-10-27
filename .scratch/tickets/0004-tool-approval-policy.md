# 0004-tool-approval-policy.md — 审批/权限管道（tool call 前可中断钩子 + 规则表）

## 目标

在 SDK 的 tool call 执行前插入一层审批/权限管道，让项目会话可以：
1. 按规则表（工具名/通配 pattern → allow | deny | ask）对每次工具调用决策；
2. `deny` 直接拦截（返回 `{block, reason}`，模型侧看到"调用被阻止"）;
3. `ask` 挂起等待人工批准/拒绝（等待期间 agent 阻塞，不执行也不继续)；
4. 对外暴露极简 API（列规则/加规则/删规则/看待审批/批准/拒绝），UI 面板后续 PR 做。

## Seam

- `pi.on("tool_call")` 事件（Extensions API，`ToolCallEventResult = {block?, reason?, terminate?}`，
  处理器可 async——等待期间 agent 阻塞）。既有参照：`lib/mcp-read-only-policy.ts`
  `createReadOnlyMcpPolicyExtension`（只读会话拦非只读 MCP 工具，返回 block+reason）。
- 注册点：`lib/rpc-manager.ts` 普通项目分支 `extensionFactories`（2738 起），与
  `createReadOnlyMcpPolicyExtension()` 并列。
- 单例纪律（HMR）：规则表挂 `globalThis.__piToolPolicyStore`、审批协调器挂
  `globalThis.__piApprovalCoordinator`，与 `__piEngine`/`__piSessionStore` 同构。

## 验收标准

1. `lib/tool-policy.ts`：ToolPolicyStore（listRules/addRule/removeRule/decide），
   decide 语义 = 首个匹配规则获胜，无匹配 → allow；pattern 支持 `*` 通配（转正则，不引依赖）。
2. `lib/approval-coordinator.ts`：requestApproval→挂起 Promise；listPending；settle(id, approved)。
3. `lib/approval-policy-extension.ts`：`createApprovalPolicyExtension()`——deny→block+reason；
   ask→await settle；拒绝→block+reason；允许/无匹配→放行（return undefined）。
4. `app/api/tool-policy/`：GET 规则+待审批 / POST 加规则 / DELETE 删规则 / POST settle {id, approved}。
5. rpc-manager 普通分支注册；chat / chatWorkspace / subagent 分支**不加**（后续 PR，工单说明）。
6. 新增测试（tool-policy + approval-coordinator 纯逻辑）全绿；tsc / lint / 既有回归 / fork 护栏 / dev 手测。

## Out-of-scope

- 审批 UI 面板（web 交互远期做，本 PR 只有 API 层）。
- 规则表 JSON 持久化（内存单例，进程重启丢失；后续 PR）。
- 会话级/按参数条件的规则（pattern 只有工具名粒度）。
- chat 分支注册、subagent 分支注册、通知（toast/推送）管线。