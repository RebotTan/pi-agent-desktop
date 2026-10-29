import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { SqliteSessionStore, resetSqliteSessionStore } = await jiti.import("./session-store-sqlite.ts");

function makeSessionFile(agentDir, folder, id, entries) {
  const dir = join(agentDir, "sessions", folder);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
  const header = JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: folder });
  const lines = [header, ...entries.map((e) => JSON.stringify(e))];
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

function message(role, text) {
  return { type: "message", id: `m-${Math.random()}`, message: { role, content: [{ type: "text", text }], timestamp: "2026-01-01T00:00:01.000Z" } };
}

function makeStore(t) {
  const dbDir = mkdtempSync(join(tmpdir(), "pi-web-sqlite-store-"));
  const store = new SqliteSessionStore(join(dbDir, "sessions.db"));
  t.after(() => {
    // 先关连接再删文件：Windows 上 SQLite 句柄未释放会 EBUSY
    store.close();
    rmSync(dbDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  return store;
}

test("sync 增量：新增/修改/删除 .jsonl 后 SQLite 正确反映", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-sqlite-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  resetSqliteSessionStore();
  t.after(() => {
    resetSqliteSessionStore();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  const store = makeStore(t);

  // 空库
  let sessions = await store.listSessions();
  assert.equal(sessions.length, 0);

  // 新增两个会话
  makeSessionFile(agentDir, "p1", "s1", [message("user", "hello")]);
  makeSessionFile(agentDir, "p2", "s2", [message("user", "world"), message("assistant", "hi")]);
  sessions = await store.listSessions();
  assert.equal(sessions.length, 2);
  assert.ok(sessions.find((s) => s.id === "s1"));
  assert.ok(sessions.find((s) => s.id === "s2"));

  // 修改一个（加消息）
  const path1 = join(agentDir, "sessions", "p1", "2026-01-01T00-00-00-000Z_s1.jsonl");
  const header = JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "p1" });
  writeFileSync(path1, [header, JSON.stringify(message("user", "hello")), JSON.stringify(message("assistant", "updated"))].join("\n") + "\n");
  sessions = await store.listSessions();
  const s1 = sessions.find((s) => s.id === "s1");
  assert.equal(s1?.messageCount, 2);

  // 删除一个
  rmSync(join(agentDir, "sessions", "p2", "2026-01-01T00-00-00-000Z_s2.jsonl"));
  sessions = await store.listSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, "s1");
});

test("listSessions 返回与 FileSystemSessionStore 一致的字段", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-sqlite-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  resetSqliteSessionStore();
  t.after(() => {
    resetSqliteSessionStore();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  makeSessionFile(agentDir, "p1", "s1", [message("user", "test message")]);
  const sqlite = makeStore(t);

  const sqliteSessions = await sqlite.listSessions();
  assert.equal(sqliteSessions.length, 1);

  const s = sqliteSessions[0];
  assert.equal(s.id, "s1");
  assert.equal(s.cwd, "p1");
  assert.equal(s.messageCount, 1);
  assert.equal(s.firstMessage, "test message");
  assert.ok(s.path.endsWith("s1.jsonl"));
});

test("PI_SESSION_STORE=sqlite 时 getSessionStore 返回 SqliteSessionStore", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-sqlite-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousStore = process.env.PI_SESSION_STORE;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_SESSION_STORE = "sqlite";
  resetSqliteSessionStore();
  t.after(() => {
    resetSqliteSessionStore();
    resetSessionStore();
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    if (previousStore === undefined) delete process.env.PI_SESSION_STORE;
    else process.env.PI_SESSION_STORE = previousStore;
    rmSync(agentDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  const { getSessionStore, resetSessionStore } = await jiti.import("./session-store.ts");
  resetSessionStore();
  const store = getSessionStore();
  // jiti moduleCache:false 下同一模块可能有多份实例，instanceof 不可靠；
  // 用行为判断：SqliteSessionStore 有 close()，FileSystemSessionStore 没有。
  assert.ok(typeof store.close === "function", "expected SqliteSessionStore (has close())");
});

function makeForkedSessionFile(agentDir, folder, id, entries, parentPath) {
  const dir = join(agentDir, "sessions", folder);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
  const header = JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: folder,
    parentSession: parentPath,
  });
  const lines = [header, ...entries.map((e) => JSON.stringify(e))];
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

test("fork 会话的 parentSessionId 解析成会话 id，并带上 relation", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-sqlite-fork-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  resetSqliteSessionStore();
  t.after(() => {
    resetSqliteSessionStore();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  const parentPath = makeSessionFile(agentDir, "p1", "parent-1", [message("user", "root")]);
  makeForkedSessionFile(agentDir, "p1", "child-1", [message("user", "branch")], parentPath);

  const store = makeStore(t);
  const sessions = await store.listSessions();
  const child = sessions.find((s) => s.id === "child-1");
  assert.ok(child, "fork session listed");
  // 必须是会话 id，不是 .jsonl 路径 —— 存路径会让侧边栏 fork 树塔平。
  assert.equal(child.parentSessionId, "parent-1");
  assert.equal(child.relation?.kind, "fork");
  assert.equal(child.relation?.originSessionId, "parent-1");
});

test("无 parentSession 的会话不带 relation", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-sqlite-norel-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  resetSqliteSessionStore();
  t.after(() => {
    resetSqliteSessionStore();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  makeSessionFile(agentDir, "p1", "solo", [message("user", "alone")]);
  const store = makeStore(t);
  const sessions = await store.listSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].parentSessionId, undefined);
  assert.equal(sessions[0].relation, undefined);
});
