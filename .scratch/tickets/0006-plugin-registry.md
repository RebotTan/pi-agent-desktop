# 0006-plugin-registry — 插件三层注册点骨架

## 目标

为将来的自建插件系统落地三层注册接缝（能力目录「插件三层注册点」预留点）：

1. **service 层**：任意服务实例按 id 注册/取用；内建单例
   （agent-engine / session-store / agent-event-bus / tool-policy）首次创建注册表时预注册，
   插件与内置拿到同一个 globalThis 实例。
2. **agent 层**：`registerAgentExtension(InlineExtension)` 收集扩展，
   rpc-manager 装配 extensionFactories 时 append（普通项目分支 + chatWorkspace 分支），
   与 builtins 扩展并用 pi 原生扩展能力。
3. **UI 层**：`registerUiContribution` 存贡献（kind + 宽松 payload），
   只读 `GET /api/plugins/contributions` 暴露给前端。渲染契约后续 PR 定义。

## Seam

`lib/plugin-registry.ts` 的 `getPluginRegistry()` / `InMemoryPluginRegistry` / `registerBuiltinServices`。

## 验收标准

1. `tsc --noEmit` 通过
2. `npm run lint` 干净
3. `node --test lib/plugin-registry.test.mjs` 全绿（service 覆盖/agent 收集/UI 列表/内建预注册）
4. rpc 测试回归（lifecycle/running-state/session-info + agent-event-bus）全绿
5. fork 护栏（fork-ownership + components/fork-extractions）全绿
6. dev 手测：`GET /api/plugins/contributions` 返回 services 含 4 个内建 id、
   agentExtensionNames 为空、uiContributions 为 []

## Out-of-scope

- UI 渲染契约（panel/command 组件如何挂载）——后续 PR
- 插件发现/加载（从磁盘/npm 安装插件）——后续 PR
- agent 扩展的生命周期管理（卸载/热替换）——后续 PR
- service 层权限/沙箱

## 手测记录

（dev 手测已完成：GET /api/plugins/contributions 返回 {"services":["agent-engine","agent-event-bus","session-store","tool-policy"],"agentExtensions":0,"agentExtensionNames":[],"uiContributions":[]}，4 个内建服务均在列）
`{"services":["agent-engine","agent-event-bus","session-store","tool-policy"],"agentExtensions":0,...}`）