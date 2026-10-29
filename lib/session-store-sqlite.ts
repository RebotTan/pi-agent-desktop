// ============================================================================
// SqliteSessionStore — SessionStore 的 SQLite 列表镜像实现
// ============================================================================
//
// 目的：把列表读路径的元数据镜像到 SQLite，listSessions/listSummaries 直接读
// SQLite（毫秒级，无文件系统遍历），attachSessionProjectInfo 的 git 调用结果
// 缓存进 project_info 表（带 TTL）。
//
// 写路径不同步：pi SDK 的 SessionManager 直接写 .jsonl，不经过 SessionStore。
// 每次 listSessions/listSummaries 时先 sync()（增量：enumerate + stat + 对比
// fingerprint → 变化则解析 header/stat 更新 SQLite），与现有 JSON 索引的
// 「读时重建」语义一致。
//
// 表结构：
//   sessions(path PK, id, cwd, created, modified, messageCount, firstMessage,
//            parentSessionPath, sessionName, fingerprint, updatedAt)
//   project_info(cwd PK, projectRoot, branch, isWorktree, resolvedAt)
//
// 单例纪律：挂 globalThis.__piSqliteSessionStore（HMR 与 __piSessionStore 同构）。

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SessionInfo } from "./types";
import type { SessionStore } from "./session-store";
import { FileSystemSessionStore } from "./session-store";
import { buildSessionRelation } from "./session-reader";
import { sessionPathKey } from "./session-path";
import { resolveProject } from "./worktree";
import { projectIdentityKey } from "./project-identity";
import { isChatWorkspacePath, isChatFolderPath } from "./chat-workspace";

const DB_FILE_NAME = "pi-web-session-list.db";
const PROJECT_INFO_TTL_MS = 5 * 60 * 1000; // 5min

interface Fingerprint {
  size: number;
  mtimeMs: number;
}

interface SessionRow {
  path: string;
  id: string;
  cwd: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  parentSessionPath: string | null;
  sessionName: string | null;
  fingerprintSize: number;
  fingerprintMtimeMs: number;
}

interface ProjectInfoRow {
  cwd: string;
  projectRoot: string;
  branch: string | null;
  isWorktree: number; // SQLite boolean as 0/1
  resolvedAt: number;
}

function fingerprint(fp: Fingerprint): string {
  return `${fp.size}:${fp.mtimeMs}`;
}

/** 解析 .jsonl 的 header/stat 元数据（与 listSessionsIncremental 同款逻辑）。 */
async function scanSessionFileInfo(filePath: string): Promise<{
  id: string;
  cwd: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
  parentSessionPath?: string;
  sessionName?: string;
} | null> {
  try {
    const stats = await stat(filePath);
    let header: Record<string, unknown> | null = null;
    let sessionName: string | undefined;
    let messageCount = 0;
    let firstMessage = "";
    let lastActivityTime: number | undefined;

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const entry = JSON.parse(line);
      if (!header) {
        if (entry.type !== "session") return null;
        header = entry;
        continue;
      }
      if (entry.type === "session_info" && typeof entry.name === "string" && entry.name.trim()) {
        sessionName = entry.name.trim();
      }
      if (entry.type !== "message") continue;
      messageCount++;
      const activityTime = entry.message?.timestamp ? new Date(entry.message.timestamp).getTime() : undefined;
      if (typeof activityTime === "number") lastActivityTime = activityTime;
      if (!firstMessage && entry.message?.role === "user") {
        const content = entry.message.content;
        if (typeof content === "string") firstMessage = content.slice(0, 100);
        else if (Array.isArray(content)) {
          const textBlock = content.find((b: { type?: string; text?: string }) => b?.type === "text" && typeof b.text === "string");
          if (textBlock?.text) firstMessage = textBlock.text.slice(0, 100);
        }
      }
    }

    if (!header) return null;
    return {
      id: String(header.id),
      cwd: String(header.cwd),
      created: new Date(String(header.timestamp)),
      modified: new Date(lastActivityTime ?? stats.mtimeMs),
      messageCount,
      firstMessage: firstMessage || "(no messages)",
      parentSessionPath: typeof header.parentSession === "string" ? header.parentSession : undefined,
      sessionName,
    };
  } catch {
    return null;
  }
}

export class SqliteSessionStore implements SessionStore {
  private db: DatabaseSync | null = null;
  private schemaReady = false;
  /** 串行化 sync：并发请求排队，不重复 readdir + stat。 */
  private syncChain: Promise<void> = Promise.resolve();
  private readonly fallback = new FileSystemSessionStore();

  constructor(private readonly dbPath: string = join(getAgentDir(), DB_FILE_NAME)) {}

  /** 测试与关闭用：关闭连接，让 Windows 释放文件句柄。 */
  close(): void {
    this.db?.close();
    this.db = null;
    this.schemaReady = false;
  }

  private open(): DatabaseSync | null {
    if (this.db) return this.db;
    try {
      this.db = new DatabaseSync(this.dbPath);
      return this.db;
    } catch {
      return null;
    }
  }

  private ensureSchema(db: DatabaseSync): boolean {
    if (this.schemaReady) return true;
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          path TEXT PRIMARY KEY,
          id TEXT NOT NULL,
          cwd TEXT NOT NULL,
          created TEXT NOT NULL,
          modified TEXT NOT NULL,
          messageCount INTEGER NOT NULL,
          firstMessage TEXT NOT NULL,
          parentSessionPath TEXT,
          sessionName TEXT,
          fingerprint TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_modified ON sessions(modified DESC);
        CREATE TABLE IF NOT EXISTS project_info (
          cwd TEXT PRIMARY KEY,
          projectRoot TEXT NOT NULL,
          branch TEXT,
          isWorktree INTEGER NOT NULL,
          resolvedAt INTEGER NOT NULL
        );
      `);
      this.schemaReady = true;
      return true;
    } catch {
      return false;
    }
  }

  /** 增量同步：enumerate + stat + 对比 fingerprint → 变化则解析更新 SQLite。 */
  private async sync(): Promise<boolean> {
    // 串行化：并发的 /api/sessions 请求不能各自跑一遍 readdir + stat。
    const previous = this.syncChain;
    let release: () => void = () => {};
    this.syncChain = new Promise<void>((resolve) => { release = resolve; });
    try {
      await previous;
      return await this.syncOnce();
    } finally {
      release();
    }
  }

  private async syncOnce(): Promise<boolean> {
    const db = this.open();
    if (!db || !this.ensureSchema(db)) return false;

    const sessionsDir = join(getAgentDir(), "sessions");
    let files: string[] = [];
    try {
      const entries = await readdir(sessionsDir, { recursive: true });
      files = entries
        .filter((e): e is string => typeof e === "string" && e.endsWith(".jsonl"))
        .map((e) => join(sessionsDir, e));
    } catch {
      return false;
    }

    // 删除 SQLite 里已不存在的文件
    const present = new Set(files);
    const stale = db.prepare("SELECT path FROM sessions").all() as Array<{ path: string }>;
    const deleteStmt = db.prepare("DELETE FROM sessions WHERE path = ?");
    for (const row of stale) {
      if (!present.has(row.path)) deleteStmt.run(row.path);
    }

    // 对比 fingerprint，只解析变化的
    const selectStmt = db.prepare("SELECT fingerprint FROM sessions WHERE path = ?");
    const upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO sessions
      (path, id, cwd, created, modified, messageCount, firstMessage, parentSessionPath, sessionName, fingerprint, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    for (const filePath of files) {
      try {
        const s = await stat(filePath);
        const fp = fingerprint({ size: s.size, mtimeMs: s.mtimeMs });
        const existing = selectStmt.get(filePath) as { fingerprint: string } | undefined;
        if (existing?.fingerprint === fp) continue;

        const info = await scanSessionFileInfo(filePath);
        if (!info) {
          // 文件还在、只是这轮读不出内容（半写/权限抖动）。删行会让会话
          // 从列表里静默消失，下一次 sync 再试。
          continue;
        }
        upsertStmt.run(
          filePath,
          info.id,
          info.cwd,
          info.created.toISOString(),
          info.modified.toISOString(),
          info.messageCount,
          info.firstMessage,
          info.parentSessionPath ?? null,
          info.sessionName ?? null,
          fp,
          now,
        );
      } catch {
        // 同上：任何单文件异常（SQLITE_BUSY / 只读库 / stat 竞态）都不能
        // 当成「会话已删除」处理。旧行保留，下一轮再对齐。
        continue;
      }
    }
    return true;
  }

  /** 缓存 project_info（TTL 内不重算 git）。 */
  private async attachProjectInfo(sessions: SessionInfo[]): Promise<SessionInfo[]> {
    const db = this.open();
    if (!db || !this.ensureSchema(db)) return sessions;

    const uniqueCwds = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))];
    const selectStmt = db.prepare("SELECT * FROM project_info WHERE cwd = ?");
    const upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO project_info (cwd, projectRoot, branch, isWorktree, resolvedAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    const projectByCwd = new Map<string, { projectRoot: string; branch?: string; isWorktree?: boolean }>();

    await Promise.all(uniqueCwds.map(async (cwd) => {
      if (isChatWorkspacePath(cwd)) return;
      const cached = selectStmt.get(cwd) as ProjectInfoRow | undefined;
      if (cached && now - cached.resolvedAt < PROJECT_INFO_TTL_MS) {
        projectByCwd.set(cwd, {
          projectRoot: cached.projectRoot,
          branch: cached.branch ?? undefined,
          isWorktree: cached.isWorktree === 1,
        });
        return;
      }
      const project = await resolveProject(cwd);
      projectByCwd.set(cwd, {
        projectRoot: project.projectRoot,
        branch: project.branch ?? undefined,
        isWorktree: project.isWorktree,
      });
      upsertStmt.run(cwd, project.projectRoot, project.branch ?? null, project.isWorktree ? 1 : 0, now);
    }));

    return sessions.map((session) => {
      if (isChatWorkspacePath(session.cwd)) {
        return {
          ...session,
          workspaceKind: "chat" as const,
          ...(isChatFolderPath(session.cwd) ? { chatFolder: true } : {}),
          projectRoot: undefined,
          projectKey: undefined,
          branch: undefined,
          isWorktree: undefined,
        };
      }
      const project = session.cwd ? projectByCwd.get(session.cwd) : undefined;
      const projectRoot = project?.projectRoot ?? session.cwd;
      return {
        ...session,
        workspaceKind: "project" as const,
        projectRoot,
        projectKey: projectIdentityKey(projectRoot),
        ...(project?.branch ? { branch: project.branch } : {}),
        ...(project?.isWorktree ? { isWorktree: true } : {}),
      };
    });
  }

  private toSessionInfo(row: SessionRow, pathToId: Map<string, string>): SessionInfo {
    return {
      path: row.path,
      id: row.id,
      cwd: row.cwd,
      name: row.sessionName ?? undefined,
      created: row.created,
      modified: row.modified,
      messageCount: row.messageCount,
      firstMessage: row.firstMessage,
      // fork / subagent 关系必须走与文件系统实现同一个构造点，否则
      // parentSessionId 会是路径而不是 id，侧边栏的 fork 树会塔平。
      ...buildSessionRelation(
        { path: row.path, id: row.id, parentSessionPath: row.parentSessionPath ?? undefined },
        pathToId,
      ),
      transient: false,
    };
  }

  async listSessions(options?: { force?: boolean; allowStale?: boolean }): Promise<SessionInfo[]> {
    if (options?.force) this.fallback.invalidateListCache();

    // allowStale 的语义是「允许旧数据、但要便宜读」：直接发库里的行，
    // 不跑 readdir + stat。库还没写开时（首次访问）才回退到全量 sync。
    if (options?.allowStale) {
      const rows = this.readRows();
      if (rows.length === 0) return this.fallback.listSessions(options);
      return this.attachProjectInfo(this.mapRows(rows));
    }

    const synced = await this.sync();
    if (!synced) return this.fallback.listSessions(options);
    const rows = this.readRows();
    if (rows.length === 0) return this.fallback.listSessions(options);
    return this.attachProjectInfo(this.mapRows(rows));
  }

  private readRows(): SessionRow[] {
    const db = this.open();
    if (!db || !this.ensureSchema(db)) return [];
    try {
      return db.prepare("SELECT * FROM sessions ORDER BY modified DESC").all() as unknown as SessionRow[];
    } catch {
      return [];
    }
  }

  private mapRows(rows: SessionRow[]): SessionInfo[] {
    const pathToId = new Map<string, string>();
    for (const row of rows) pathToId.set(sessionPathKey(row.path), row.id);
    return rows.map((row) => this.toSessionInfo(row, pathToId));
  }

  async listSummaries(): Promise<SessionInfo[]> {
    return this.listSessions();
  }

  async resolveSessionRef(sessionId: string): Promise<string | null> {
    return this.fallback.resolveSessionRef(sessionId);
  }

  getSessionEntries(ref: string) {
    return this.fallback.getSessionEntries(ref);
  }

  invalidateListCache(): void {
    this.fallback.invalidateListCache();
  }
}

declare global {
  var __piSqliteSessionStore: SessionStore | undefined;
}

let cachedSqliteStore: SessionStore | undefined;

/** 单例。实例常驻 globalThis.__piSqliteSessionStore，跨模块热重载存活。 */
export function getSqliteSessionStore(): SessionStore {
  if (!cachedSqliteStore) {
    cachedSqliteStore = globalThis.__piSqliteSessionStore ??= new SqliteSessionStore();
  }
  return cachedSqliteStore;
}

/** 测试用：丢掉单例（连同 globalThis 上的那份）。 */
export function resetSqliteSessionStore(): void {
  if (cachedSqliteStore instanceof SqliteSessionStore) cachedSqliteStore.close();
  if (globalThis.__piSqliteSessionStore instanceof SqliteSessionStore) globalThis.__piSqliteSessionStore.close();
  cachedSqliteStore = undefined;
  globalThis.__piSqliteSessionStore = undefined;
}
