# 0016 · 代码审查第 1–4 条修复

## 目标

修掉 `docs/fork-roadmap.md` 已交付功能两轴审查里最严重的四条：两条会造成可见的数据错乱（fork 树塌平），两条会造成资源泄漏（子进程 / 永久挂起的审批）。第 5 条及之后的发现不在本工单内。

## Seam

`lib/session-store-sqlite.ts` 的 `listSessions()`、`lib/session-handle-rpc.ts` 的 `destroy()`、`lib/worker-process-host.ts` 的预热池、`lib/rpc-manager.ts` 的 `notifyRunningChange()`。四条都能只靠公开行为断言，不依赖内部字段。

## 修的四条

1. **SQLite 丢 fork/subagent 关系** — `toSessionInfo` 把 `parentSessionPath`（路径）直接当 `parentSessionId`（应为会话 id），且从不生成 `relation`。修法：把关系构造收敛到 `lib/session-reader.ts` 新增的导出 `buildSessionRelation()`，文件系统实现与 SQLite 实现共用，`listSessions` 先建 `pathToId` 再映射。
2. **`RpcSessionHandle.destroy()` 的 destroy 永远送不到 worker** — 原实现先 `this.alive = false` 再 `send()`，被 `send()` 的活体守卫拦下。顺带修三处协议不一致：`start()` 发的是 `method:"send"` 而非 `session.start`、worker 的 `response` 消息缺 `sessionId` 导致全被 host 丢弃、`emitDestroy()` 未幂等。
3. **预热池泄漏 worker 进程** — `prewarm()` 的 catch 不杀已 spawn 的子进程；`discardPrewarmed()` 只清标志，在飞的预热完成后仍会写回池子。修法：失败时 `worker.kill()`，并用 `generation` 令牌让在飞预热自我作废。顺带把 stdout 的 ready 检测与消息分发统一到一个 `readline`（原实现两者各挂一个监听，粘包时漏 ready）。
4. **`running_changed` 两个方向都错** — 无 running 订阅者时无条件 emit（洪泛），有订阅者时快照未变就 `return`（连事件总线一起吞掉）。修法：总线用自己的去重游标 `lastBusSnapshot`，与 running listener 的 `lastRunningSnapshot` 解耦。

## 验收

1. `tsc --noEmit` 0 错
2. `npm run lint` 干净
3. `node --test` 11 个相关测试文件 117 项（116 pass / 1 skip / 0 fail），新增 6 项：SQLite fork 关系 ×2、RpcSessionHandle 全链路 ×2、预热池清理 ×1、总线去重 ×2
4. fork 护栏 61/61（`scripts/fork-ownership` + `components/fork-extractions` + `scripts/upstream-css-baseline`）
5. 手测 dev：`PI_SESSION_STORE=sqlite` 下侧边栏 fork 树仍有层级；`/api/events` 收到 `running_changed`

## Out-of-scope

- 审查第 5–11 条（审批取消路径、contributions 的 `force-dynamic`、`sync()` 并发保护与 catch 删行、SSE `cancel()`、索引候选截断、`allowStale` 语义与 changeset 文案）
- `compactionCount` 在 SQLite 实现里仍然缺失（schema 无该列，需要迁移）
- SidecarEngine 接入真实 pi SDK（worker 仍是骨架，只回 agent_start/agent_end 占位事件）
