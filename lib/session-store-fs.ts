// ============================================================================
// FileSystemSessionStore — 会话存储读取面的 JSONL 实现
// ============================================================================
//
// 薄封装 lib/session-reader.ts 的既有函数，行为零变化。
//
// 为什么单独一个文件：session-store.ts 需要 import SQLite 实现来切换后端，
// 而 SQLite 实现要 extends 这个类。放在同一个文件里会形成循环 import，
// 类声明求值时父类还是 undefined（"Class extends value undefined"）。
// 把实现拆出来，两边都只依赖这个文件，环就断了。

import {
  getSessionEntries,
  invalidateSessionListCache,
  listAllSessions,
  listSessionSummaries,
  resolveSessionPath,
} from "./session-reader";
import type { SessionEntry, SessionInfo } from "./types";

/** 会话存储的读取面契约。语义与 session-reader 对应函数保持一致。 */
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
