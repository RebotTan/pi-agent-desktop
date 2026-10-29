# 0021 · fork 关系的端到端验证（无代码改动）

## 目标

0016 修了「SQLite 存储把 `parentSessionPath` 直接当 `parentSessionId` 返回」的缺陷，但当时只有单测 —— 这台机器 52 个会话里没有一个 fork 出来的，所以侧边栏的 fork 树塌平这个真实故障从未端到端复现过。

## 怎么验的

`PI_SESSION_STORE=sqlite` 起 dev（端口 30141），然后：

1. `POST /api/agent/new` 建一个会话，发一条 prompt 让它落盘
2. `GET /api/sessions/<id>` 读 `context.messages` / `context.entryIds`，取第一条 user 消息的 entry id
3. `POST /api/agent/<id>` body `{ type: "fork", entryId }` → 返回 `{ cancelled: false, newSessionId }`
4. `GET /api/sessions`（此时走 SQLite 列表镜像）找子会话

## 结果（2026-10-29，v0.10.7 + dc2bed9）

API 返回：

```json
{
  "id": "01a186ab-51a0-70a4-a335-2cbacc848832",
  "parentSessionId": "01a186a6-cc6e-70a4-a335-2cb952fe83f1",
  "relation": { "kind": "fork", "originSessionId": "01a186a6-cc6e-70a4-a335-2cb952fe83f1" }
}
```

同时直接查 SQLite 库，那一行存的是**路径**：

```
C:\Users\YLYC\.pi\agent\sessions\--E--teach-pi-agent-desktop--\2026-10-29T07-54-00-688Z_01a186a6-...jsonl
```

两条对得上 —— 库里是路径、API 出来是 id，说明 `buildSessionRelation`（`lib/session-reader.ts`）的转换真的在跑，不是碰巧。

## 结论

`parentSessionId` 是会话 id、`relation.kind === "fork"`、`originSessionId` 指向父会话 —— 三条全过。侧边栏 fork 树在 SQLite 后端下不会再塌平。

测试用的两个会话已通过 `DELETE /api/sessions/<id>` 清除，dev 服务已停。

## 遗留

- 这次没验 `subagent` 分支的 relation（`kind: "subagent"` 带 profile/description/status），它走同一个 `buildSessionRelation` 的另一个分支，单测覆盖
- 没验多级 fork（fork 的 fork）
