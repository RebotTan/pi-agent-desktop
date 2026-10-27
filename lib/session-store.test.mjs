import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { getSessionStore } = await jiti.import("./session-store.ts");

function resetSessionListState() {
  globalThis.__piSessionListCache = undefined;
  globalThis.__piSessionListPromise = undefined;
  globalThis.__piSessionListPromiseGeneration = undefined;
  globalThis.__piSessionListGeneration = 0;
}

function resetSessionPathState() {
  globalThis.__piSessionPathCache = undefined;
  globalThis.__piPathToSessionIdCache = undefined;
}

function setTestAgentDir(t, agentDir) {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  resetSessionListState();
  resetSessionPathState();
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    resetSessionListState();
    resetSessionPathState();
    rmSync(agentDir, { recursive: true, force: true });
  });
}

function makeSessionFile(agentDir, id, folder, text) {
  const sessionsDir = join(agentDir, "sessions", folder);
  mkdirSync(sessionsDir, { recursive: true });
  const filePath = join(sessionsDir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
  const header = { type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: agentDir };
  const entry = { type: "message", id: "u1", parentId: null, message: { role: "user", content: [{ type: "text", text }] } };
  writeFileSync(filePath, `${JSON.stringify(header)}\n${JSON.stringify(entry)}\n`);
  return filePath;
}

test("listSessions 返回 agent 目录下扫描到的会话", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-session-store-"));
  setTestAgentDir(t, agentDir);
  makeSessionFile(agentDir, "sess-a", "proj", "first");
  makeSessionFile(agentDir, "sess-b", "proj", "second");

  const store = getSessionStore();
  const sessions = await store.listSessions({ force: true });

  assert.ok(Array.isArray(sessions), "listSessions 返回数组");
  const ids = sessions.map((s) => s.id);
  assert.ok(ids.includes("sess-a"), `应包含 sess-a，实际 ${JSON.stringify(ids)}`);
  assert.ok(ids.includes("sess-b"), `应包含 sess-b，实际 ${JSON.stringify(ids)}`);
});

test("listSummaries 返回摘要元数据", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-session-store-"));
  setTestAgentDir(t, agentDir);
  makeSessionFile(agentDir, "sess-sum", "proj", "hi");

  const store = getSessionStore();
  const summaries = await store.listSummaries();

  const hit = summaries.find((s) => s.id === "sess-sum");
  assert.ok(hit, `应包含 sess-sum，实际 ${JSON.stringify(summaries.map((s) => s.id))}`);
  assert.equal(hit.cwd, agentDir);
});

test("resolveSessionRef 与 getSessionEntries 往返读回条目", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-session-store-"));
  setTestAgentDir(t, agentDir);
  const filePath = makeSessionFile(agentDir, "sess-rw", "proj", "hello world");

  const store = getSessionStore();
  await store.listSessions({ force: true });

  const ref = await store.resolveSessionRef("sess-rw");
  assert.equal(ref, filePath, "ref 应解析为 .jsonl 文件路径");

  const entries = store.getSessionEntries(ref);
  assert.ok(entries.length >= 1, "应读回至少 1 条 entry");
  const userMsg = entries.find((e) => e.type === "message" && e.message?.role === "user");
  assert.ok(userMsg, "应能读回 user 消息");
  assert.match(JSON.stringify(userMsg.message?.content ?? ""), /hello world/);
});

test("invalidateListCache 使新写入的会话立即可见", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-session-store-"));
  setTestAgentDir(t, agentDir);
  makeSessionFile(agentDir, "sess-old", "proj", "old");

  const store = getSessionStore();
  const before = await store.listSessions({ force: true });
  assert.equal(before.length, 1, "初始 1 个会话");

  // 30s TTL 窗口内新增会话；不 invalidate 时列表停留旧快照
  makeSessionFile(agentDir, "sess-new", "proj", "new");
  const stale = await store.listSessions();
  assert.equal(stale.length, 1, "TTL 内的列表应仍是旧快照");

  store.invalidateListCache();
  const after = await store.listSessions();
  const ids = after.map((s) => s.id);
  assert.ok(ids.includes("sess-new"), `invalidate 后应见 sess-new，实际 ${JSON.stringify(ids)}`);
});