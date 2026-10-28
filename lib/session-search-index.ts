// ============================================================================
// 会话搜索索引 —— SQLite FTS5（roadmap #13 第一刀）
// ============================================================================
//
// 现状痛点（实测，见 .scratch/tickets/0005-session-search-index.md）：
// lib/session-search.ts 流式扫「最近 500 个文件 + 3 秒超时 + 30 条截断」，
// 会话数超过 500 后更早的会话永远搜不到，且每次搜索都要把命中文件从头读一遍。
//
// 本模块把 user/assistant 的 text block 增量索引进 SQLite，查询走 FTS5：
// 全库覆盖、毫秒级、无截断。索引不可用（开关关闭 / SQLite 打开失败 / 建库出错）
// 时返回 null，调用方回退原来的流式扫描 —— 见 lib/session-search.ts。
//
// 中文必须 bigram 预分词：FTS5 的 trigram 分词器要求查询 ≥3 字符，中文两字词
// （最常见的搜索形态）全部失效（实测「测试」命中 0）；unicode61 + bigram 两端
// 同函数分词则 2/3/4 字都正确。
//
// 写路径不碰：pi SDK 的 SessionManager 独占 .jsonl，本索引只读文件、只做查询。
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parseSearchableLine } from "./session-search.ts";
import type { SessionInfo } from "./types.ts";

/** 索引库文件（与列表索引 pi-web-session-index.json 并列，互不影响）。 */
const DB_FILE_NAME = "pi-web-session-search.db";

/** 索引库路径；PI_SESSION_SEARCH_INDEX_PATH 可覆盖（测试与诊断用）。 */
function defaultIndexPath(): string {
  const override = process.env.PI_SESSION_SEARCH_INDEX_PATH;
  if (override && override.trim()) return override.trim();
  return join(getAgentDir(), DB_FILE_NAME);
}

/** FTS 候选上限：远高于最终 30 条，留出去重和排序空间。 */
const MAX_CANDIDATES = 500;

/** 最终结果上限，与流式实现保持一致（前端按此渲染）。 */
const MAX_RESULTS = 30;

/** 单个会话文件最大读取量，与流式实现一致。 */
const MAX_FILE_BYTES = 16 * 1024 * 1024;

/** 单行最大字符数，超过视为异常行跳过（与流式实现一致）。 */
const MAX_LINE_CHARS = 1024 * 1024;

export interface IndexedSearchResult {
  path: string;
  entryId?: string;
  blockIndex: number;
  body: string;
}

/**
 * 中文按 2-gram、英文/数字按小写词。
 *
 * 索引端与查询端必须用同一个函数，否则同一个词在两边切法不同就永远匹配不上。
 * 单字中文保留原字（否则一个孤立的「好」无法建 token）。
 */
export function tokenizeForIndex(text: string): string[] {
  const tokens: string[] = [];
  const pattern = /[\u4e00-\u9fff]+|[A-Za-z0-9_]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const run = match[0];
    if (/^[\u4e00-\u9fff]/.test(run)) {
      if (run.length === 1) tokens.push(run);
      for (let index = 0; index < run.length - 1; index += 1) {
        tokens.push(run.slice(index, index + 2));
      }
    } else {
      tokens.push(run.toLowerCase());
    }
  }
  return tokens;
}

/** FTS5 MATCH 表达式：所有 token 都必须出现（AND），每个 token 加引号防止语法注入。 */
export function buildMatchExpression(query: string): string | null {
  const tokens = tokenizeForIndex(query);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" AND ");
}

interface FileRow {
  path: string;
  session_id: string;
  size: number;
  mtime_ms: number;
}

/**
 * SQLite 搜索索引。一个实例持有一条连接，惰性建表。
 *
 * 单例挂在 globalThis.__piSessionSearchIndex，保住 Next.js 热重载下的连接
 * （模块级变量会丢，丢掉的连接不会被回收；与 __piEngine/__piSessionStore 同构）。
 */
export class SessionSearchIndex {
  private db: DatabaseSync | null = null;
  private schemaReady = false;
  private syncChain: Promise<void> = Promise.resolve();
  private readonly dbPath: string;

  // Node 的 type-stripping（测试直接用 node --test 跑 .ts）不支持参数属性，
  // 所以要显式声明字段并在构造函数里赋值。
  constructor(dbPath: string = defaultIndexPath()) {
    this.dbPath = dbPath;
  }

  /** 打开连接并建表；失败时记下 null，后续调用直接走回退路径。 */
  private open(): DatabaseSync | null {
    if (this.db) return this.db;
    try {
      const db = new DatabaseSync(this.dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS files (
          path TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          size INTEGER NOT NULL,
          mtime_ms REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS docs (
          rowid INTEGER PRIMARY KEY,
          path TEXT NOT NULL,
          entry_id TEXT,
          block_index INTEGER NOT NULL,
          body TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS docs_path ON docs(path);
        CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(tok, tokenize='unicode61');
      `);
      this.db = db;
      this.schemaReady = true;
      return db;
    } catch {
      this.db = null;
      this.schemaReady = false;
      return null;
    }
  }

  /** 索引可用？建表成功且库文件父目录存在。 */
  isAvailable(): boolean {
    if (!this.open()) return false;
    return this.schemaReady;
  }

  /**
   * 增量同步：只重读 (size, mtime) 变了的文件，删除已消失的会话。
   *
   * 串行化（syncChain）：Next dev 下多个请求可能同时触发同步，并发写同一个库
   * 会撕裂事务。排队执行，每个调用者都等自己之前的那一批完成。
   */
  async sync(sessions: readonly SessionInfo[]): Promise<void> {
    const run = this.syncChain.then(() => this.syncOnce(sessions)).catch(() => undefined);
    this.syncChain = run;
    return run;
  }

  private async syncOnce(sessions: readonly SessionInfo[]): Promise<void> {
    const db = this.open();
    if (!db) return;

    const known = new Map<string, FileRow>();
    for (const row of db.prepare("SELECT path, session_id, size, mtime_ms FROM files").all() as unknown as FileRow[]) {
      known.set(row.path, row);
    }

    const candidates = sessions.filter((session) => !session.transient && session.path);
    const presentPaths = new Set(candidates.map((session) => session.path));
    const removed = [...known.keys()].filter((path) => !presentPaths.has(path));

    const changed: SessionInfo[] = [];
    for (const session of candidates) {
      let stats;
      try {
        stats = await stat(session.path);
      } catch {
        continue; // vanished between catalogue scan and sync
      }
      const cached = known.get(session.path);
      if (cached && cached.size === stats.size && cached.mtime_ms === stats.mtimeMs) continue;
      changed.push(session);
    }

    if (removed.length === 0 && changed.length === 0) return;

    db.exec("BEGIN");
    try {
      for (const path of removed) this.deleteFile(db, path);
      for (const session of changed) {
        await this.rebuildFile(db, session);
      }
      db.exec("COMMIT");
    } catch {
      try { db.exec("ROLLBACK"); } catch { /* connection already unusable */ }
    }
  }

  private deleteFile(db: DatabaseSync, path: string): void {
    for (const row of db.prepare("SELECT rowid FROM docs WHERE path = ?").all(path) as { rowid: number }[]) {
      db.prepare("DELETE FROM docs_fts WHERE rowid = ?").run(row.rowid);
    }
    db.prepare("DELETE FROM docs WHERE path = ?").run(path);
    db.prepare("DELETE FROM files WHERE path = ?").run(path);
  }

  private async rebuildFile(db: DatabaseSync, session: SessionInfo): Promise<void> {
    this.deleteFile(db, session.path);

    const docs: IndexedSearchResult[] = [];
    const stream = createReadStream(session.path, { encoding: "utf8", end: MAX_FILE_BYTES - 1 });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (line.length > MAX_LINE_CHARS) continue;
        const parsed = parseSearchableLine(line);
        if (!parsed) continue;
        for (const block of parsed.blocks) {
          if (!block.text) continue;
          docs.push({
            path: session.path,
            ...(parsed.entryId ? { entryId: parsed.entryId } : {}),
            blockIndex: block.blockIndex,
            body: block.text,
          });
        }
      }
    } catch {
      // Unreadable file: index what was read, do not fail the whole sync.
    } finally {
      lines.close();
      stream.destroy();
    }

    const insertDoc = db.prepare("INSERT INTO docs(path, entry_id, block_index, body) VALUES (?, ?, ?, ?)");
    const lastId = db.prepare("SELECT last_insert_rowid() AS id");
    const insertFts = db.prepare("INSERT INTO docs_fts(rowid, tok) VALUES (?, ?)");
    for (const doc of docs) {
      insertDoc.run(doc.path, doc.entryId ?? null, doc.blockIndex, doc.body);
      const rowid = (lastId.get() as { id: number }).id;
      insertFts.run(rowid, tokenizeForIndex(doc.body).join(" "));
    }

    let stats;
    try {
      stats = await stat(session.path);
    } catch {
      return;
    }
    db.prepare(
      "INSERT OR REPLACE INTO files(path, session_id, size, mtime_ms) VALUES (?, ?, ?, ?)",
    ).run(session.path, session.id, stats.size, stats.mtimeMs);
  }

  /**
   * FTS 检索。返回每个会话命中的**第一条**（按文件内顺序），按会话 modified
   * 降序 —— 与流式实现「一个会话最多一条结果、最近的会话排前面」一致。
   *
   * 库不可用或查询无 token 时返回 null，调用方回退。
   */
  search(sessions: readonly SessionInfo[], query: string): IndexedSearchResult[] | null {
    const db = this.open();
    if (!db) return null;
    const match = buildMatchExpression(query);
    if (!match) return [];

    let rows: { path: string; entry_id: string | null; block_index: number; body: string }[];
    try {
      rows = db.prepare(`
        SELECT d.path AS path, d.entry_id AS entry_id, d.block_index AS block_index, d.body AS body
        FROM docs_fts f JOIN docs d ON d.rowid = f.rowid
        WHERE docs_fts MATCH ?
        ORDER BY f.rowid
        LIMIT ?
      `).all(match, MAX_CANDIDATES) as typeof rows;
    } catch {
      return null; // malformed MATCH expression or corrupt index
    }

    const byPath = new Map<string, IndexedSearchResult>();
    for (const row of rows) {
      if (byPath.has(row.path)) continue; // first hit per session, like the scan
      byPath.set(row.path, {
        path: row.path,
        ...(row.entry_id ? { entryId: row.entry_id } : {}),
        blockIndex: row.block_index,
        body: row.body,
      });
    }

    const order = new Map(sessions.map((session) => [session.path, session.modified]));
    return [...byPath.values()]
      .sort((a, b) => (order.get(b.path) ?? "").localeCompare(order.get(a.path) ?? ""))
      .slice(0, MAX_RESULTS);
  }

  /** 索引状态（诊断用；不参与搜索路径）。 */
  stats(): { files: number; docs: number } {
    const db = this.open();
    if (!db) return { files: 0, docs: 0 };
    try {
      const files = (db.prepare("SELECT COUNT(*) AS n FROM files").get() as { n: number }).n;
      const docs = (db.prepare("SELECT COUNT(*) AS n FROM docs").get() as { n: number }).n;
      return { files, docs };
    } catch {
      return { files: 0, docs: 0 };
    }
  }

  close(): void {
    try { this.db?.close(); } catch { /* already closed */ }
    this.db = null;
    this.schemaReady = false;
  }
}

declare global {
  var __piSessionSearchIndex: SessionSearchIndex | undefined;
}

/** 开关：PI_SESSION_SEARCH_INDEX=0 关闭索引，走原来的流式扫描。 */
export function isSearchIndexEnabled(): boolean {
  const raw = process.env.PI_SESSION_SEARCH_INDEX;
  if (raw === undefined) return true;
  return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
}

let cachedIndex: SessionSearchIndex | undefined;

/**
 * 单例。**以 globalThis 为准**，不以模块局部变量为准：jiti / Next 热重载下同一
 * 模块可能有多份实例，各自持有局部缓存就会分叉成两个连接、两个库句柄（Windows
 * 上表现为测试清理时 EBUSY）。
 */
export function getSessionSearchIndex(): SessionSearchIndex {
  const fromGlobals = globalThis.__piSessionSearchIndex;
  if (fromGlobals) {
    cachedIndex = fromGlobals;
    return fromGlobals;
  }
  cachedIndex = globalThis.__piSessionSearchIndex = new SessionSearchIndex();
  return cachedIndex;
}

/** 测试用：关掉连接并丢掉单例（连同 globalThis 上的那份）。 */
export function resetSessionSearchIndex(): void {
  const fromGlobals = globalThis.__piSessionSearchIndex;
  const fromModule = cachedIndex;
  fromGlobals?.close();
  if (fromModule && fromModule !== fromGlobals) fromModule.close();
  cachedIndex = undefined;
  globalThis.__piSessionSearchIndex = undefined;
}

/** 索引库文件存在？（诊断用） */
export function searchIndexExists(dbPath: string = defaultIndexPath()): boolean {
  return existsSync(dbPath);
}
