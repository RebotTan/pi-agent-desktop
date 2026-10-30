# 0022 · 插件市场搜索

## 目标

在 Settings › Plugins 的添加面板里加一个搜索框，搜 npm registry 上带 `keywords:pi-package` 标记的 pi 插件包，结果列表展示包名 / 描述 / 版本 / 周下载量 / npm 链接，一键安装（source = `npm:<name>`）。安装走已有的 `POST /api/plugins action=install`，pi SDK 的 `DefaultPackageManager.installAndPersist` 装包后下次会话 `resolve()` 自动发现 extensions/skills/prompts/themes 并挂进会话 —— 「安装 A 插件 → pi-agent 同步可用」这条链路 pi SDK 已内置，本工单只补「搜索发现」这一刀。

## Seam

- 后端：`app/api/plugins/search/route.ts`（新建），POST `{query?, limit?}` → fetch `https://registry.npmjs.org/-/v1/search?text=keywords:pi-package+<query>&size=<limit>`，返回 `{results: PluginSearchResult[]}`
- 前端：`components/PluginsConfig.tsx` 的 `AddPluginPanel` 里加搜索框 + 结果列表，点击结果调 `installPlugin`（source = `npm:<name>`）

## 验收标准

1. `tsc --noEmit` 0 错
2. `npm run lint` 干净
3. 新增 `lib/plugin-search.test.mjs` 测试绿（npm search 响应解析 + 空查询默认 keywords:pi-package + limit 截断）
4. `node --test scripts/fork-ownership.test.mjs components/fork-extractions.test.mjs scripts/upstream-css-baseline.test.mjs scripts/ui-menu-consistency.test.mjs` 全绿
5. 手测：`npm run dev` → Settings › Plugins › Add → 搜索框输入 `mcp` → 结果列表出现 pi-mcp-adapter / pi-mcp-extension 等 → 点 Install → 安装成功 → 包出现在列表
6. PR body 三段 + changeset

## Out-of-scope

- 不做 pi-harness 那种独立 utility-process 插件运行时（pi SDK 的 extension 机制已覆盖）
- 不做远程插件市场后端（npm registry 就是市场）
- 不做插件评分 / 评论 / 截图展示
- 不改 `lib/plugin-registry.ts`（PR-6 的三层注册点骨架不动）
- 不改 `POST /api/plugins` 安装链路（已有且可用）
