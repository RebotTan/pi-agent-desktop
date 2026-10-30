# 0026 · 插件接口的坏请求体返回 400

## 目标

`POST /api/plugins` 收到非法 JSON 时返回 500「服务端错误」，应返回 400。

## 症状（stash 前实测）

```
body='{"action":"install",'  → 500 {"error":"Expected double-quoted property name in JSON at position 20"}
body=''                      → 500 {"error":"Unexpected end of JSON input"}
```

## 根因

`req.json()` 在 route 的大 `try` 里，解析错误直接落到外层 `catch`，那个 catch 一律返回 500。

## Seam

`app/api/plugins/route.ts` 的 POST：请求体解析挪进独立小 `try`，失败返回 `{ error: "Invalid JSON body" }` + 400。

## 验收

1. `tsc --noEmit` 通过
2. `npm run lint` 无问题
3. 前后对比：BEFORE 两种坏请求体都是 500；AFTER 都是 400
4. 合法 JSON 缺字段仍是 400 `cwd required`（不受影响）
5. fork 护栏 63/63

## Out-of-scope

`app/api/` 下还有 40 个 route 有同样的「`req.json()` 错误被当成 500」模式（`grep -rl "await req.json()" app/api/ | wc -l` = 41，含本文件）。它们的 catch 语义各不相同，逐个改需要单独确认哪些异常该 400、哪些该 500，另开工单统一处理（可抽一个 `readJsonBody` helper）。
