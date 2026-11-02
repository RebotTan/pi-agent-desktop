# 0031 · 更新检测改读 release manifest

## 目标

`/api/updates` 不再请求 `https://api.github.com/repos/<repo>/releases/latest`，改读同一个发布里的
`latest.json`（`https://github.com/<repo>/releases/latest/download/latest.json`）。同时修掉前端把
「检查失败」当成功的静默行为。

## 背景

用户装 0.10.9，0.10.11 发布后界面一直显示 0.10.10。两条原因：

1. `api.github.com` 匿名上限 60 请求/小时，这台机器出口 IP 被共用，实测返回
   `API rate limit exceeded for 157.254.23.2`。
2. `Promise.allSettled` 让失败的项目不 reject，`/api/updates` 返回 200 + `errors[]`，
   `components` 填的是上次成功的缓存；`AppUpdatesSection` 只看 `response.ok`，忽略 `errors`。

`latest.json` 是 release asset，不走 REST 配额，也正是 `tauri-plugin-updater` 读的同一份文件，
所以两套机制从此同源。

## Seam

`lib/app-updates.ts` 的 `getLatestAppRelease(project, { fetcher })`。测试注入 `fetcher` 断言 URL 与解析。

## 验收标准

- [x] 请求 URL 是 `https://github.com/<repo>/releases/latest/download/latest.json`
- [x] `version` 缺失或非法 → 抛 `The updater manifest has an invalid version.`
- [x] 404 → `releaseStatus: "unpublished"`（与改造前一致）
- [x] `releaseUrl` 由 `v<version>` 推导，不再依赖 `html_url`
- [x] `AppUpdatesSection` 在 `errors` 非空时显示 `appSettings.checkFailed`
- [x] `node --test lib/app-updates.test.mjs` 6/6
- [x] 真机：`getLatestAppRelease` 返回 `latestVersion: "0.10.11"`、`updateAvailable: false`（本地已是 0.10.11）
- [x] `tsc --noEmit` / `npm run lint` / fork 护栏 65/65

## Out-of-scope

- 不改成按钮主动检查（仍是打开 Settings 时 `?refresh=1` 强制刷新）
- 不改 `tauri-plugin-updater` 的端点和签名校验
- 不给 GitHub API 加 token（改造后已不需要 REST）
