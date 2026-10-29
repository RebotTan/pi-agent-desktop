# 0019 · SQLite 列表镜像补齐 compactionCount 与连接释放

## 目标

收掉 0017 遗留的 A 组两条。两条都只在 `PI_SESSION_STORE=sqlite`（opt-in）时可见，但都会让实现与文件系统版本行为不一致或漏资源。

## Seam

`lib/session-store-sqlite.ts` 的 schema/`scanSessionFileInfo`/`toSessionInfo`，`lib/session-store.ts` 的 `SessionStore.close?()` 与 `resetSessionStore()`。

## 改了什么

1. **`compactionCount` 缺失** — `scanSessionFileInfo` 现在数 `entry.type === "compaction"` 并写进 `sessions.compactionCount`（`INTEGER NOT NULL DEFAULT 0`）；`toSessionInfo` 只在 `> 0` 时带上该字段，与文件系统实现一致（`lib/session-reader.ts:269` 也是 `...(scanned.compactionCount ? …)`）。
2. **老库迁移** — `ensureSchema` 用 `PRAGMA table_info(sessions)` 检查列；缺列则 `ALTER TABLE ... ADD COLUMN` 后 `DELETE FROM sessions` 强制全量重解析。不清空的话旧行 fingerprint 没变，`sync()` 会直接跳过，`compactionCount` 永远是 0。这张表只是 `.jsonl` 的镜像缓存，重建无害。
3. **`resetSessionStore()` 漏连接** — `SessionStore` 接口加可选 `close?()`；`resetSessionStore()` 先 `close?.()` 再清引用。原实现只把 `cachedStore` 和 `globalThis.__piSessionStore` 置空，SQLite 连接随实例一起变成孤儿（HMR 反复重载会累积，Windows 上表现为库文件删不掉）。

## 验收

1. `tsc --noEmit` 0 错
2. `npm run lint` 干净
3. 12 个测试文件 126 pass / 0 fail / 1 skip（新增 `lib/session-store.test.mjs` 3 项 + `session-store-sqlite.test.mjs` 2 项：compaction 统计、老库迁移）
4. fork 护栏 63/63
5. 手测 dev（`PI_SESSION_STORE=sqlite`，真实 52 会话库）：库文件被就地迁移，`PRAGMA table_info` 出现 `compactionCount`，52 行全部重建；`/api/sessions` 200 / 1.87s；本机 `.jsonl` 里 0 个 compaction 条目，SQLite 侧 `max(compactionCount) = 0`，与文件系统实现一致

## Out-of-scope

- `files.session_id` 死列、`deleteFile`/`rebuildFile` 循环内 `db.prepare`（Standards 观察项，不影响行为）
- `rpc-manager.ts` assembler 缩进（PR-2 技术债，重排 280 行风险大于收益）
