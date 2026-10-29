// ============================================================================
// SessionStore — 会话存储读取面的门面与单例
// ============================================================================
//
// 目的：把「会话读取」从直接调用 lib/session-reader.ts 的函数，收敛到一个显式
// 存储接口后面。JSONL 是默认实现（FileSystemSessionStore，薄封装 session-reader
// 的既有函数，行为零变化）；PI_SESSION_STORE=sqlite 切到 SQLite 列表镜像
// （SqliteSessionStore）。调用点不用改（见 .scratch/tickets/0003-session-store.md、
// GLOSSARY.md 的 SessionStore 词条）。
//
// 范围：只覆盖读取面（列表 / 引用解析 / 条目读取 / 缓存失效）。写路径被 pi SDK
// 的 SessionManager 垄断（它直接写 .jsonl），不属于本接口。
//
// 单例挂在 globalThis.__piSessionStore，保住 Next.js 热重载下的存活（HMR 纪律，
// 与 lib/agent-engine.ts 的 __piEngine 同构；模块级变量会丢，globalThis 不会）。
//
// 接口与文件系统实现住在 lib/session-store-fs.ts：SQLite 实现要 extends 它，
// 而这里要 import SQLite 实现，同文件会形成循环 import。

import { FileSystemSessionStore } from "./session-store-fs";
import type { SessionStore } from "./session-store-fs";
import { getSqliteSessionStore } from "./session-store-sqlite";

export { FileSystemSessionStore } from "./session-store-fs";
export type { SessionStore } from "./session-store-fs";

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
