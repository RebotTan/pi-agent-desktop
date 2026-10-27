# Changesets

每个 PR 必须带一个 changeset 文件。漏了不合并。

## 加一个 changeset

```bash
npx changeset
```

或手写 `.changeset/NNNN-kebab-name.md`：

```md
---
"@agegr/pi-web": patch
---

一句话描述这个改动对用户可见的影响。
```

包名以 `package.json` 的 `name` 为准（当前 `@agegr/pi-web`）。

## bump 级别怎么选

| 级别 | 什么时候 |
|---|---|
| `patch` | 修 bug、重构、内部改进，用户行为不变 |
| `minor` | 新功能，向后兼容 |
| `major` | 破坏性变更（公开 API 移除、数据格式不兼容、会话文件迁移） |

二开阶段的内部重构（如 AgentEngine 接口）一律 `patch`。

## 发版

`dev` 合并到 `main` 后，`.github/workflows/release.yml` 自动开一个 "chore: version" PR：
它跑 `changeset version`，升 `package.json` 版本号并写 `CHANGELOG.md`。人工确认后合并，
再手动 `npm run dist:win`（或对应平台）出安装包并打 tag。

详见 `AGENTS.md` 的「开发流程」节。
