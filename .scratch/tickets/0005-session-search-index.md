# 0005 · 会话搜索 SQLite 索引（roadmap #13 第一刀）

## 目标

把会话全文搜索从「流式扫最近 500 个文件 / 3 秒超时 / 30 条截断」换成 SQLite FTS5 索引，实现**全库覆盖 + 毫秒级**，并正确处理中文。

## 现状与痛点（实测）

`lib/session-search.ts` 的实现带注释自认：

```
// ponytail: scan recent files without an index; add indexing if measured latency warrants it.
```

- `MAX_FILES = 500`：超过 500 个会话，更早的会话**永远搜不到**。
- `TIME_BUDGET_MS = 3000`：3 秒一到就 `truncated`。
- 每次搜索都要把命中的会话文件从头流式读到尾。

实测本机：53 个会话 / 61MB，最大单文件 11MB。会话数增长后上限问题必然暴露。

`lib/session-list-scanner.ts` 已有持久化 **列表**索引（`pi-web-session-index.json`，size/mtime 指纹），但只缓存元数据，不含正文，不能用于搜索。

## Seam

新建 `lib/session-search-index.ts`，导出：

```ts
export function searchIndexedSessions(sessions: SessionInfo[], query: string): Promise<SessionSearchResponse | null>
```

- 返回 `null` 表示索引不可用（`PI_SESSION_SEARCH_INDEX=0` 或 SQLite 打开失败），调用方回退现有流式扫描。
- 返回结果时格式与 `SessionSearchResponse` **完全一致**，前端零改动。

`lib/session-search.ts` 的 `searchSessionContents` 内部先调它，`null` 再走原路径。

## 关键决策

### 1. SQLite 引擎用 `node:sqlite`，不引第三方依赖

- Node 22 内置（`package.json` engines 要求 `>=22.19.0`），零新增依赖、零原生编译。
- 打包时 `scripts/prepare-desktop.mjs` 的 `bundleNodeRuntime()` 直接 `copyFile(process.execPath, ...)`，运行时就是构建机的 Node 22 → `node:sqlite` 一定可用。
- 实测（Node 22.23.4）：`sqlite_version 3.53.4`，FTS5 可用。
- 代价：启动时多一行 `ExperimentalWarning`。用 `--no-warnings` 之外无解，接受（只在 stderr）。

### 2. 中文必须走 bigram 预分词，不能用 FTS5 trigram

实测对比（同一批样本）：

| tokenizer | 中文「测试」 | 中文「测试会」 | 英文 world |
|---|---|---|---|
| `trigram` | ❌ 0 命中 | ✅ | ✅ |
| `unicode61` + bigram 预处理 | ✅ | ✅ | ✅ |

`trigram` 要求查询 ≥3 字符，中文两字词（最常见的搜索形态）全部失效。故：

```ts
function tokenizeForIndex(text: string): string[] {
  const re = /[\u4e00-\u9fff]+|[A-Za-z0-9_]+/g;
  // 中文连续段 → 2-gram（单字段保留原字）；英文/数字 → 小写词
}
```

索引入库和查询两端用同一函数，查询词以 `AND` 连接。

### 3. 索引只收 user/assistant 的 text block

与现有搜索语义一致（跳过 toolResult / thinking / 图片）。避免把 11MB 会话的大块工具输出灌进索引。

### 4. 增量同步靠 size/mtime 指纹

复用列表扫描器已验证的思路，不重复读没变的文件。首次建库要读全部会话（本机 61MB ≈ 数秒），之后每次搜索只 `stat`。

## 表结构

```sql
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL
);
CREATE TABLE docs (
  rowid INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  entry_id TEXT,
  block_index INTEGER NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX docs_path ON docs(path);
CREATE VIRTUAL TABLE docs_fts USING fts5(tok, tokenize='unicode61');
```

`docs_fts.rowid` 与 `docs.rowid` 手工对齐。搜索结果先由 FTS 出候选 `rowid`，再 join `docs` 拿 `body`，最后在 JS 里用现有正则定位 `before`/`match`/`after`（输出格式保持逐字节一致）。

索引库路径：`join(getAgentDir(), "pi-web-session-search.db")`。

## 验收标准

1. 中文 2 字（「测试」）、3 字（「测试会」）、英文（`hello`）、中英混合（`token 刷新`）都能命中正确会话。
2. 用 `PI_CODING_AGENT_DIR` 造 600+ 个合成会话，查询只存在于**第 600 个**的独特字符串能命中 —— 现实现（`MAX_FILES=500`）必然漏。
3. 返回结构与 `SessionSearchResponse` 一致（`session`/`entryId`/`blockIndex`/`before`/`match`/`after`），`/api/sessions/search` 前端零改动。
4. `PI_SESSION_SEARCH_INDEX=0` 时行为等同改动前（回退流式），可随时关。
5. 会话文件被修改 / 删除后，索引同步反映（改的内容能搜到，删的搜不到）。
6. `tsc --noEmit` 通过、`npm run lint` 通过、`node --test lib/session-search*.test.mjs` + 既有 `session-search.test.mjs` 全绿。
7. `node --test scripts/fork-ownership.test.mjs` 与 `components/fork-extractions.test.mjs` 不变红。
8. 手测：`npm run dev` → 在侧边栏搜索一个中文词，结果正确且无 `truncated`。

## Out-of-scope

- 不改 `SessionStore` 接口的列表读路径（`listSessions`/`listSummaries`/`resolveSessionRef`/`getSessionEntries` 仍走文件系统实现）—— 那是 #13 的第二刀。
- 不碰写路径（pi SDK `SessionManager` 独占）。
- 不做用量统计聚合（roadmap #16）。
- 不做搜索结果排序调优（沿用现有 `modified` 降序 + 30 条上限）。
- 不删除现有的流式实现（保留作为回退路径）。
