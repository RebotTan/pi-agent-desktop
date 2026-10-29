# 0015 — SessionStore SQLite 列表镜像

## 目标

新增 `SqliteSessionStore` 实现 `SessionStore` 接口：JSONL 写入时同步镜像到 SQLite
（写路径仍走 SDK，SQLite 只做读索引），`getSessionStore()` 按配置切实现。

搜索索引（#11）已交付，解决「超过 500 个会话搜不到」；列表仍有
`lib/session-list-scanner.ts` 的增量 JSON 索引（`pi-web-session-index.json`，按
size+mtime 命中缓存），但**每次列表仍要 enumerate + stat 全部文件**，且
`attachSessionProjectInfo` 每 unique cwd 跑一次 `resolveProject`（git）。

本票把列表读路径的元数据镜像到 SQLite：`SessionInfo` 的 header/stat 字段
（id/cwd/created/modified/messageCount/firstMessage/parentSession）入库，
`listSessions`/`listSummaries` 直接读 SQLite（毫秒级，无文件系统遍历），
`attachSessionProjectInfo` 的 git 调用结果也缓存进 SQLite（带 TTL，过期重算）。

## 前置勘察结论（已核实）

- `SessionStore` 接口（lib/session-store.ts）已定型：listSessions/listSummaries/
  resolveSessionRef/getSessionEntries/invalidateListCache。
- `listAllSessions`（session-reader.ts:273）内部走 `loadAllSessions()` →
  `listSessionsIncremental()`（session-list-scanner.ts:375）→
  `attachSessionProjectInfo()`（session-reader.ts:158，每 unique cwd 一次 git）。
- `listSessionsIncremental` 已有 JSON 索引（`pi-web-session-index.json`），按
  `size+mtimeMs` 指纹命中缓存；但仍要 `enumerateSessionFiles` + `stat` 全部文件。
- `SessionInfo` 字段（types.ts:388）：id/path/cwd/created/modified/messageCount/
  firstMessage/parentSession/transient/sessionName 等。
- node:sqlite 可用（Node 22.23.4，#11 已验证）。

## Seam

- `lib/session-store-sqlite.ts`（新）：`SqliteSessionStore implements SessionStore`。
  - 表结构：`sessions(path PK, id, cwd, created, modified, messageCount, firstMessage,
    parentSession, sessionName, fingerprint, updatedAt)`；
    `project_info(cwd PK, projectName, worktreeName, resolvedAt)`。
  - `sync()`：enumerate + stat → 对比 fingerprint → 变化则解析 .jsonl header/stat
    更新 SQLite（与 `listSessionsIncremental` 同款逻辑，但结果存 SQLite 不存 JSON）。
  - `listSessions()` / `listSummaries()`：先 `sync()`，再 `SELECT` 读 SQLite；
    `attachSessionProjectInfo` 的结果按 cwd 缓存进 `project_info` 表（TTL 可配，
    默认 5min）。
  - `resolveSessionRef()` / `getSessionEntries()` / `invalidateListCache()`：
    委托给 FileSystemSessionStore（这两类读取不走索引，直接读文件）。
- `lib/session-store.ts`：`getSessionStore()` 按 env `PI_SESSION_STORE=sqlite`
  切实现（缺省仍 `FileSystemSessionStore`，零风险默认）。
- `lib/session-list-scanner.ts`：不动（JSON 索引保留，作为 SQLite 不可用时的回退）。

## 关键设计点

### 为什么列表也要 SQLite
搜索索引解决「内容搜不到」；列表镜像解决「列表慢」。当前列表：
1. enumerate 全部 .jsonl（O(n) 文件系统调用）
2. stat 全部文件（O(n) syscall）
3. 未命中缓存的重新解析 header/stat（O(changed)）
4. 每 unique cwd 一次 git（O(uniqueCwd) 子进程）

会话数上千时，1+2 本身就要几百毫秒。SQLite 把 1+2+3 变成一次 `SELECT`（毫秒级），
4 变成缓存命中（TTL 内零 git 调用）。

### 写路径不同步
pi SDK 的 `SessionManager` 直接写 .jsonl，不经过 SessionStore。SQLite 镜像
**只读不同步写**：每次 `listSessions`/`listSummaries` 时先 `sync()`（增量），
与现有 JSON 索引的「读时重建」语义一致。将来如需写时同步，在 SDK 写钩子处
加镜像调用，不影响本票接口。

## 验收标准

1. `tsc --noEmit` 通过；`npm run lint` 通过。
2. 新测试 `lib/session-store-sqlite.test.mjs`：
   - `sync()` 增量：新增/修改/删除 .jsonl 后 SQLite 正确反映
   - `listSessions()` / `listSummaries()` 返回与 FileSystemSessionStore 一致的
     SessionInfo（按 path 排序对比字段）
   - `attachSessionProjectInfo` 缓存：同一 cwd 两次调用只算一次 git（mock
     resolveProject 计数）
   - `PI_SESSION_STORE=sqlite` 时 `getSessionStore()` 返回 SqliteSessionStore
3. 现有测试全绿：session-store.test.mjs（FileSystem）、session-search 系列、
   fork 护栏。
4. dev 手测：`PI_SESSION_STORE=sqlite npm run dev`，GET /api/sessions 返回
   与默认实现一致；会话数 53 时列表响应 < 10ms（对比 FileSystem 的 ~100ms）。
5. 文档：`.agents/adr/0003-session-store-sqlite.md`（记录「读时同步」决策、
   project_info TTL、为什么列表也要 SQLite）。

## Out-of-scope

- 不改写路径（SDK 写 .jsonl 不经过 SessionStore）。
- 不做用量统计查询（#17）。
- 不删 JSON 索引（保留作回退）。
- 不做 SQLite 全文搜索（#11 已交付，独立表）。
