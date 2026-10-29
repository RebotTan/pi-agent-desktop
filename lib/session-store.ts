// ============================================================================
// SessionStore — 会话存储读取面的接口与文件系统实现
// ============================================================================
//
// 目的：把「会话读取」从直接调用 lib/session-reader.ts 的函数，收敛到一个显式
// 存储接口后面。JSONL 是现在的唯一实现（FileSystemSessionStore，薄封装
// session-reader 的既有函数，行为零变化）；将来 SQLite 镜像/索引存储可以做
// 一个第二实现替换，调用点不用改（见 .scratch/tickets/0003-session-store.md、
// GLOSSARY.md 的 SessionStore 词条）。
//
// 范围：只覆盖读取面（列表 / 引用解析 / 条目读取 / 缓存失效）。写路径被 pi SDK
// 的 SessionManager 垄断（它直接写 .jsonl），不属于本接口。
//
// 单例挂在 globalThis.__piSessionStore，保住 Next.js 热重载下的存活（HMR 纪律，
// 与 lib/agent-engine.ts 的 __piEngine 同构；模块级变量会丢，globalThis 不会）。

import {
  getSessionEntries,
  invalidateSessionListCache,
  listAllSessions,
  listSessionSummaries,
  resolveSessionPath,
} from "./session-reader";
import { getSqliteSessionStore } from "./session-store-sqlite";
import type { SessionEntry, SessionInfo } from "./types";

/**
 * 会话存储的读取面契约。
 *
 * 语义与 session-reader 对应函数保持一致，见各方法注释。
 */
export interface SessionStore {
  /**
   * 会话列表。
   * - force: 重建列表缓存（新建/删除会话后「下次一定新」时传 true）。
   * - allowStale: 接受旧快照（只关心元数据映射的调用点，如权限根目录计算）。
   */
  listSessions(options?: { force?: boolean; allowStale?: boolean }): Promise<SessionInfo[]>;
  /** 首屏摘要列表：只带 header/stat 元数据，不加载每个会话全文。 */
  listSummaries(): Promise<SessionInfo[]>;
  /** sessionId → 存储引用（当前实现 = .jsonl 文件路径）；不存在返回 null。 */
  resolveSessionRef(sessionId: string): Promise<string | null>;
  /** 按存储引用读完整条目（当前实现 = 读 .jsonl 文件的全部行）；引用无效时返回空数组。 */
  getSessionEntries(ref: string): SessionEntry[];
  /** 列表缓存失效（新建/删除/改名会话后调用，下次 listSessions 重建）。 */
  invalidateListCache(): void;
  /**
   * 释放底层资源（SQLite 连接、文件句柄等）。无资源的实现可以不提供 ——
   * 不提供就必须保证反复重建实例不会累积资源。
   */
  close?(): void;
}

/** 文件系统实现：薄封装 session-reader 的既有函数，行为零变化。 */
export class FileSystemSessionStore implements SessionStore {
  listSessions(options?: { force?: boolean; allowStale?: boolean }): Promise<SessionInfo[]> {
    return listAllSessions(options);
  }
  listSummaries(): Promise<SessionInfo[]> {
    return listSessionSummaries();
  }
  resolveSessionRef(sessionId: string): Promise<string | null> {
    return resolveSessionPath(sessionId);
  }
  getSessionEntries(ref: string): SessionEntry[] {
    return getSessionEntries(ref);
  }
  invalidateListCache(): void {
    invalidateSessionListCache();
  }
}

declare global {
  var __piSessionStore: SessionStore | undefined;
}

let cachedStore: SessionStore | undefined;

/** 单例。实例常驻 globalThis.__piSessionStore，跨模块热重载存活。 */
export function getSessionStore(): SessionStore {
  if (!cachedStore) {
    // PI_SESSION_STORE=sqlite 切 SQLite 列表镜像实现（零风险默认仍 FileSystem）。
    const backend = process.env.PI_SESSION_STORE;
    if (backend === "sqlite") {
      const store: SessionStore = getSqliteSessionStore();
      cachedStore = globalThis.__piSessionStore = store;
      return store;
    }
    cachedStore = globalThis.__piSessionStore ??= new FileSystemSessionStore();
  }
  return cachedStore;
}

/** 测试用：丢掉单例（连同 globalThis 上的那份），下次 get 重新读 env。 */
export function resetSessionStore(): void {
  // 先释放资源再丢引用：SQLite 实现握着连接，只清引用会漏句柄
  // （开发时 HMR 反复重载、测试里反复 reset 都会累积）。
  cachedStore?.close?.();
  globalThis.__piSessionStore?.close?.();
  cachedStore = undefined;
  globalThis.__piSessionStore = undefined;
}