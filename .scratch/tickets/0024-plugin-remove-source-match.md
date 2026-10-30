# 0024 · 插件移除按 settings 原文匹配

## 目标

装过本地路径插件后，`remove` 返回 200 但包仍在列表里（静默失效）。修掉。

## 症状（0.10.9 手测复现）

```
install source=C:/Users/YLYC/ego/pid-ui-card-fixture  → HTTP 200
settings.json: "packages": [..., "..\\..\\ego\\pid-ui-card-fixture"]
remove  source=..\..\ego\pid-ui-card-fixture          → HTTP 200, changed=false
GET /api/plugins: fixture 仍在，10 个包一个没少
```

## 根因

pi SDK `DefaultPackageManager` 写和读用了**不同的基准目录**：

- 写入 `addSourceToSettings` → `normalizePackageSourceForSettings` → `relative(getBaseDirForScope(scope), resolved)`，全局 scope 的基准是 **agentDir**（`~/.pi/agent`）。
- 匹配 `getSourceMatchKeyForInput(source)` → `local:${resolvePath(parsed.path)}`，基准是 **cwd**。

于是 `..\..\ego\x` 在写入侧解析成 `C:\Users\YLYC\ego\x`（agentDir 往上两级），在匹配侧解析成 `E:\ego\x`（cwd 往上两级）—— 两个 key 不等，`removeSourceFromSettings` 返回 `false`，route 原样回 200，用户看到「删了但没删」。

只有 cwd 与 agentDir 处于同一层目录时才会碰巧匹配（这也是我本地纯 SDK 探测脚本全部通过的原因）。

## Seam

`lib/plugin-settings.ts`：
- `getPackageSourceString(entry)` —— settings 条目可能是字符串或对象。
- `removePackageSource(packages, source): PackageSource[] | null` —— 按**原文**精确过滤，无匹配返回 `null`。

`app/api/plugins/route.ts` 的 `remove` 分支在 `removeAndPersist` 之后调 `dropConfiguredPackageSource()` 补一刀：读当前 scope 的 packages、按原文删、有变化才写回并 `flush()`。不参与路径解析，删除对象就是 UI 上看到的那串 source。

## 验收

1. `tsc --noEmit` 通过
2. `npm run lint` 无问题
3. `node --test lib/plugin-settings.test.mjs` 6 项绿
4. fork 护栏 63/63
5. 端到端：install（本地路径）→ remove → settings 10 → 9，fixture 消失；再装再删仍正确
6. `removePackageSource` 不误删相似 source（`..\..\ego\pkg` vs `..\..\ego\pkg2`）

## Out-of-scope

- `update` 走 `getPackageIdentity` 有同类基准不一致问题，未改（需要单独确认 npm/git 的 identity 语义）。
- 不改 pi SDK 源码：`node_modules` 会被覆盖，且上游该函数被多处调用。
- `disable`/`enable` 不受影响 —— route 自己实现，本来就是按原文比较。
- 客户端失败时返回 400 而非 500（坏 JSON body 目前报 500），另开。
