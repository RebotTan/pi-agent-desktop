# 0003 — SessionStore 存储读取面 seam（PR-3）

## 目标

把「会话读取」从直接调用 `lib/session-reader.ts` 的函数，收敛到一个显式存储接口
`SessionStore` 后面，并提供文件系统实现 `FileSystemSessionStore`（薄封装既有函数，
行为零变化）。将来 SQLite 镜像/索引存储做一个第二实现即可替换，调用点不用改。

范围只覆盖**读取面**：列表（listSessions / listSummaries）、引用解析（resolveSessionRef）、
条目读取（getSessionEntries）、缓存失效（invalidateListCache）。**写路径**被 pi SDK
的 SessionManager 垄断（它直接写 .jsonl），不是本 PR 目标。

## 为什么薄封装值得做

- 现在 24 个文件直接 import session-reader，换存储要改所有调用点；有 seam 后换存储只换
  实现类 + getSessionStore() 一行。
- 与 PR-1/2 相同的渐进节奏：先让 seam 就位并迁移首批消费点，行为零变化，
  现有测试全绿 + 手测验证等价。
- 单例挂 globalThis.__piSessionStore（HMR 存活纪律，与 __piEngine 同构）。

## Seam

- 新文件 `lib/session-store.ts`：`SessionStore` 接口 + `FileSystemSessionStore` +
  `getSessionStore()` 单例（globalThis.__piSessionStore）。
- 首批迁移 4 个读路径消费点（行为等价，仅 import/调用换门面）：
  1. `app/api/sessions/route.ts`（listSessionSummaries / listAllSessions）
  2. `app/api/sessions/search/route.ts`（listAllSessions）
  3. `lib/file-access.ts`（listAllSessions）
  4. `lib/session-file-references.ts`（resolveSessionPath / getSessionEntries）
- session-reader.ts 本身不改（store 是它的薄门面，不是重写）。

## 验收标准

1. `tsc --noEmit` 通过。
2. `npm run lint` 通过。
3. 新增 `lib/session-store.test.mjs`（复用 session-reader 测试的 setTestAgentDir /
   PI_CODING_AGENT_DIR 隔离套路）：临时 agent dir 下建会话文件 → listSessions /
   listSummaries / resolveSessionRef / getSessionEntries / invalidateListCache 语义正确。
4. `node --test lib/session-reader.test.mjs lib/session-file-references.test.mjs`（如有）回归通过。
5. `node --test scripts/fork-ownership.test.mjs components/fork-extractions.test.mjs` 通过。
6. 手测：dev 起服，GET /api/sessions 列表正常、搜索正常。

## Out-of-scope

- 不实现 SQLite 存储（只留 seam + JSONL 实现）。
- 不动写路径（SessionManager 直接写 .jsonl 是 SDK 域）。
- 不迁移 rpc-manager / session-reader 内部对自身的调用。
