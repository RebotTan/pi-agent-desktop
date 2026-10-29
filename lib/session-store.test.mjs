import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { getSessionStore, resetSessionStore, FileSystemSessionStore } = await jiti.import("./session-store.ts");
const { resetSqliteSessionStore } = await jiti.import("./session-store-sqlite.ts");

test("默认实现是文件系统", async (t) => {
  const previous = process.env.PI_SESSION_STORE;
  delete process.env.PI_SESSION_STORE;
  resetSessionStore();
  t.after(() => {
    resetSessionStore();
    if (previous !== undefined) process.env.PI_SESSION_STORE = previous;
  });

  assert.ok(getSessionStore() instanceof FileSystemSessionStore);
});

test("PI_SESSION_STORE=sqlite 切到 SQLite 实现", async (t) => {
  const previous = process.env.PI_SESSION_STORE;
  process.env.PI_SESSION_STORE = "sqlite";
  resetSessionStore();
  resetSqliteSessionStore();
  t.after(() => {
    resetSessionStore();
    resetSqliteSessionStore();
    if (previous === undefined) delete process.env.PI_SESSION_STORE;
    else process.env.PI_SESSION_STORE = previous;
  });

  const store = getSessionStore();
  assert.equal(store.constructor.name, "SqliteSessionStore");
  // 单例纪律：同一个 globalThis 实例，热重载后不重建。
  assert.equal(getSessionStore(), store);
});

test("resetSessionStore 释放 SQLite 连接，不只是丢引用", async (t) => {
  const dbDir = mkdtempSync(join(tmpdir(), "pi-web-sqlite-reset-"));
  const dbPath = join(dbDir, "sessions.db");
  const previousStore = process.env.PI_SESSION_STORE;
  const previousDb = process.env.PI_SESSION_SEARCH_INDEX_PATH;
  process.env.PI_SESSION_STORE = "sqlite";
  process.env.PI_SESSION_SEARCH_INDEX_PATH = dbPath;
  resetSessionStore();
  resetSqliteSessionStore();
  t.after(() => {
    resetSessionStore();
    resetSqliteSessionStore();
    if (previousStore === undefined) delete process.env.PI_SESSION_STORE;
    else process.env.PI_SESSION_STORE = previousStore;
    if (previousDb === undefined) delete process.env.PI_SESSION_SEARCH_INDEX_PATH;
    else process.env.PI_SESSION_SEARCH_INDEX_PATH = previousDb;
    rmSync(dbDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  const store = getSessionStore();
  // 触发一次真实访问，让连接和库文件被建出来。
  await store.listSessions({ allowStale: true }).catch(() => []);

  resetSessionStore();

  // 关键的断言不是「文件删掉了」，而是「句柄没了」：Windows 上打开的
  // SQLite 文件删不掉，close 漏了就会在这里现形。
  const dbFile = join(process.env.PI_CODING_AGENT_DIR ?? "", "pi-web-session-list.db");
  if (existsSync(dbFile)) rmSync(dbFile, { force: true });
  assert.equal(existsSync(dbFile), false);
});
