# 0023-plugin-ui-cards — 声明式 UI 贡献（插件在 PiD 界面里露出一行卡片）

## 目标

把 PR-6 留下的第三层注册点（UI 层，目前只有 `registerUiContribution` 一个空壳，全仓库无人调用）落成**声明式**的一刀：

已安装的 pi package 可以在 `package.json` 的 `pi.ui` 数组里声明卡片，PiD 的 Plugins 设置页在该包详情里把卡片渲染出来。

```json
{
  "pi": {
    "ui": [
      {
        "id": "my-plugin.usage",
        "kind": "status-card",
        "title": "Usage dashboard",
        "body": "Open the plugin's own usage page.",
        "href": "https://example.com/usage"
      }
    ]
  }
}
```

为什么选声明式而不是「插件跑代码往 UI 注册组件」：跨进程 React 组件、iframe 沙箱、样式隔离、生命周期四件高危事项，任何一件做砸都会推翻方向（与 roadmap #15 真隔离同一个判断）。声明式卡片零代码执行、零安全面，先证明「插件能往界面里加东西」这条链走得通。

## Seam

`lib/plugin-ui.ts` 的 `parsePluginUiCards(raw)` / `readPluginUiCards(packageJsonPath)`，被 `app/api/plugins/route.ts` 消费，结果进 `PluginPackageInfo.uiCards`。

## 契约

- `kind` 只有 `"status-card"` 一种；其余 kind 一律忽略（不报错，向前兼容）。
- `id` 与 `title` 必填且非空；`body` / `href` 可选。
- `href` 只接受 `http:` 与 `https:` —— `javascript:`、`data:`、相对路径一律丢弃该卡片（`href` 本身被丢掉，卡片保留）。
- 同一 package 内重复 `id` 只保留第一条。
- 单包卡片上限 12 条，超出忽略（防止一个包把详情页撑爆）。
- 不做 HTML 渲染：`title` / `body` 只当纯文本。

## 验收标准

1. `tsc --noEmit` 通过
2. `npm run lint` 干净
3. `node --test lib/plugin-ui.test.mjs` 全绿（解析/校验/去重/上限/kind 过滤/href 白名单/坏 JSON）
4. `GET /api/plugins` 里已安装包带上 `uiCards`（无声明时为 `[]`）
5. dev 手测：本地装一个带 `pi.ui` 的包，Plugins 页详情里出现卡片，链接正确
6. fork 护栏（fork-ownership + fork-extractions + upstream-css-baseline + ui-menu-consistency）全绿

## Out-of-scope

- 插件跑代码注册 React 组件（跨进程组件 / iframe 沙箱）
- `panel` / `command` / `tool-card` 等其它 kind
- 卡片交互（按钮点击触发命令）
- 内存 registry 里 `registerUiContribution` 的渲染（保持只读 API 暴露）
- 卡片的市场预览（安装前显示）

## 手测记录

**API 层**（`npm run dev`，端口 30141）：造 fixture 包 `C:/Users/YLYC/ego/pid-ui-card-fixture`（4 条声明：正常卡 / 无链接卡 / `kind: "panel"` 应丢弃 / `href: "javascript:alert(1)"` 应只丢 href），`POST /api/plugins {action:"install", source:"<绝对路径>"}` 装入后
`GET /api/plugins?cwd=...` 返回该包 `uiCards` 恰好 3 条：

- `fixture.usage` 带 `href: "https://example.com/usage"`
- `fixture.no-link`（只有 id/kind/title）
- `fixture.rejected-href`（`javascript:` 被丢，卡片保留）
- `fixture.rejected-kind`（`kind: "panel"`）不在结果里

**浏览器层**（ego-browser，Settings › Plugins › 选中 fixture 包）：`.plugin-ui-card` 数量 = 3，"Declared UI" 标题存在，链接文案 "Open ↗" 且 `href` 正确；断言 `strayPanelCard: false`、`strayJavascriptHref: false`。

## 已知问题（不在本工单范围）

`POST /api/plugins {action:"remove"}` 对**绝对路径安装的包**返回 500：`installAndPersist` 会把绝对路径规范化成相对路径（`..\..\ego\pid-ui-card-fixture`）写进 `settings.json`，而 `removeAndPersist` 不认这个相对形式。这是 pi SDK `DefaultPackageManager` 的行为，本工单不改；手测后手工从 `~/.pi/agent/settings.json` 的 `packages` 数组移除该条完成清理。需要修的话另开一张工单（在 route 的 remove 分支里把配置的 source 原样传回，或安装时拒绝绝对路径）。
