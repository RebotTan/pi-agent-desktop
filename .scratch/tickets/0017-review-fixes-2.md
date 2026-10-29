# 0017 · 代码审查第 5–11 条修复

## 目标

收掉 0016 之外的 7 条两轴审查发现。这 7 条合起来是「资源泄漏 + 静默数据丢失 + 契约与实现不符」三类，单条都小，但都影响可信度。

## Seam

`lib/approval-coordinator.ts` 的 `cancel()`、`app/api/events/route.ts` 的 stream `cancel()`、`app/api/plugins/contributions/route.ts` 的响应、`lib/session-store-sqlite.ts` 的 `listSessions({allowStale})` 与 `sync()`、`lib/session-search-index.ts` 的 `search()`。

## 修的七条

5. **审批没有取消路径** — `ApprovalCoordinator` 新增 `cancel(filter, reason)` 与 `onCancel()`；`PendingApprovalView` 增加可选 `sessionId`；`createApprovalPolicyExtension({ sessionId })` 把会话 id 写进每条审批；`registerRpcWrapper` 的 `onDestroy` 里调 `cancel({ sessionId }, "session_destroyed")`。被取消的审批一律 resolve 为 `false` —— 宁可不执行，不能默认放行。
6. **`/api/plugins/contributions` 缺 `force-dynamic`** — 加一行，附注释说明注册表是进程内可变状态。
7. **`sync()` 把读失败当删除** — `scanSessionFileInfo` 返回 null 时原本 `deleteStmt.run(filePath)`，任何异常也 `deleteStmt.run`。改成 `continue`：文件还在、只是这轮读不出内容，旧行保留，下一轮再对齐。
8. **`sync()` 无并发保护** — 加 `syncChain` 串行化（与 `SessionSearchIndex` 一致），并发 `/api/sessions` 不再各跑一遍 readdir + stat。
9. **SSE `ReadableStream` 没有 `cancel()`** — 把 `cleanup` 提升到 `start` 外，新增 `cancel() { cleanup(); }`，消费端 cancel 时退订总线并清掉 30s heartbeat。
10. **索引候选集按插入顺序截断** — `ORDER BY f.rowid` 改成 `ORDER BY fl.mtime_ms DESC, f.rowid`（JOIN `files`），最新的会话优先进入候选集；`buildMatchExpression` 返回 null 时原本返回 `[]`（纯标点查询在有索引时返回空），改成返回 `null` 交给流式实现。
11. **`allowStale` 被静默忽略** — SQLite 实现现在 `allowStale: true` 时直接读库、不跑 `sync()`，库里没数据才回退；`.changeset/0015-*.md` 的文案同步改成「省掉重新解析与目录扫描」而不是含糊的「avoids enumerating and statting」。

## 验收

1. `tsc --noEmit` 0 错
2. `npm run lint` 干净
3. `node --test` 7 个相关文件 62 项全绿 + `rpc-manager-lifecycle` 16 项（含新增审批取消项），新增 8 项测试
4. fork 护栏 61/61
5. 手测 dev（`PI_SESSION_STORE=sqlite`）：`/api/plugins/contributions` 返回四个预注册 service；`/api/sessions/search?q=（` 返回结果（证明标点回退生效）；`/api/sessions` 200

## Out-of-scope

- `compactionCount` 仍缺（schema 需迁移）
- `files.session_id` 列写入但从不读（Standards 观察项，不影响行为）
- `deleteFile` / `rebuildFile` 循环内 `db.prepare`（性能微优化）
- `SessionStore` 接口没有 `close()`，`resetSessionStore()` 不关 SQLite 连接
