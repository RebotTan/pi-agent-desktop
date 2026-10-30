# 0025 · 本地路径插件的 update 不再 500

## 目标

`POST /api/plugins {action:"update", source}` 对本地路径包返回 500「No matching package found」。改成按 settings 原文确认存在就当作已是最新。

## 症状（stash 前实测）

```
install source=C:/Users/YLYC/ego/pid-update-fixture → 200
stored source: "..\..\ego\pid-update-fixture"
update  source=..\..\ego\pid-update-fixture        → 500 No matching package found for ..\..\ego\pid-update-fixture
```

## 根因

`DefaultPackageManager.update(source)` 先算 `identity = this.getPackageIdentity(source)`（**不传 scope** → 相对路径按 `cwd` 解析），循环里再用 `this.getPackageIdentity(sourceStr, "user")`（**传 scope** → 按 agentDir 解析）逐条比对。同一个 `..\..\ego\x` 得到两个不同绝对路径 → 全部跳过 → `matched` 保持 false → 抛 `buildNoMatchingPackageMessage`。

与 0024 是同一个「写入用 agentDir、匹配用 cwd」的基准分裂，只是 remove 静默失败、update 直接抛错。

## Seam

`lib/plugin-settings.ts` 新增 `hasPackageSource(packages, source): boolean`。

`app/api/plugins/route.ts` 新增 `updatePackage()`：`packageManager.update(source)` 抛错时，若 settings 里确实存在这条 source 就吞掉（本地包没有远端可拉），否则原样抛。

## 验收

1. `tsc --noEmit` 通过
2. `npm run lint` 无问题
3. `node --test lib/plugin-settings.test.mjs` 7 项绿（新增 hasPackageSource）
4. fork 护栏 63/63
5. 前后对比实测：BEFORE local update → 500；AFTER → 200
6. 未知 source 仍 500（`No matching package found for ..\definitely-not-installed`），不掩盖真错误

## Out-of-scope

- 不改 pi SDK 源码。
- `update` 无 source 的全量更新路径未变。
- 坏 JSON body 仍返回 500 而非 400，另开。
