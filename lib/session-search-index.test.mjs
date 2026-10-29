import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  SessionSearchIndex,
  buildMatchExpression,
  tokenizeForIndex,
  resetSessionSearchIndex,
} = await jiti.import("./session-search-index.ts");
const { parseSearchableLine, searchSessionContents } = await jiti.import("./session-search.ts");

function makeIndex(t, agentDir) {
  const index = new SessionSearchIndex(join(agentDir, "search.db"));
  t.after(() => {
    index.close();
    resetSessionSearchIndex();
    rmSync(agentDir, { recursive: true, force: true });
  });
  return index;
}

/**
 * 走默认路径的两个测试用独立 db 目录：Windows 上 SQLite 关连接后文件句柄释放有
 * 延迟，把 db 和 agentDir 放一起会让 rmSync 撞 EBUSY。
 */
function useIsolatedDb(t) {
  const dbDir = mkdtempSync(join(tmpdir(), "pi-web-search-db-"));
  const previous = process.env.PI_SESSION_SEARCH_INDEX_PATH;
  process.env.PI_SESSION_SEARCH_INDEX_PATH = join(dbDir, "search.db");
  t.after(() => {
    // 先关连接再删文件：Windows 上 SQLite 句柄未释放会 EBUSY，跟测试自己的
    // after 谁先跑都不依赖（close 是幂等的）。
    resetSessionSearchIndex();
    if (previous === undefined) delete process.env.PI_SESSION_SEARCH_INDEX_PATH;
    else process.env.PI_SESSION_SEARCH_INDEX_PATH = previous;
    rmSync(dbDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
}

/** 写一个 v3 会话文件；`turns` 是 [{ role, text }]。 */
function makeSessionFile(agentDir, id, turns, options = {}) {
  const folder = options.folder ?? "proj";
  const sessionsDir = join(agentDir, "sessions", folder);
  mkdirSync(sessionsDir, { recursive: true });
  const filePath = join(sessionsDir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
  const header = { type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: agentDir };
  const lines = [JSON.stringify(header)];
  turns.forEach((turn, i) => {
    lines.push(JSON.stringify({
      type: "message",
      id: `${id}-m${i}`,
      parentId: i === 0 ? null : `${id}-m${i - 1}`,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: turn.role, content: [{ type: "text", text: turn.text }] },
    }));
  });
  writeFileSync(filePath, `${lines.join("\n")}\n`);
  return filePath;
}

/** 只够 search 用的 SessionInfo 形状。 */
function info(path, id, modified = "2026-01-01T00:00:00.000Z") {
  return { path, id, cwd: "/x", created: modified, modified, messageCount: 1, firstMessage: "" };
}

test("tokenizeForIndex：中文 2-gram、英文小写、中英混合", () => {
  assert.deepEqual(tokenizeForIndex("测试"), ["测试"]);
  assert.deepEqual(tokenizeForIndex("测试会话"), ["测试", "试会", "会话"]);
  assert.deepEqual(tokenizeForIndex("Hello World"), ["hello", "world"]);
  assert.deepEqual(tokenizeForIndex("token刷新"), ["token", "刷新"]);
  // 单字中文保留，否则孤立字无法建 token
  assert.deepEqual(tokenizeForIndex("好"), ["好"]);
  assert.deepEqual(tokenizeForIndex(""), []);
});

test("buildMatchExpression：所有 token 以 AND 连接并加引号", () => {
  assert.equal(buildMatchExpression("测试"), '"测试"');
  assert.equal(buildMatchExpression("token 刷新"), '"token" AND "刷新"');
  // 空查询没有 token，返回 null（调用方据此返回空结果而不是 MATCH ''）
  assert.equal(buildMatchExpression("   "), null);
  // 引号不是 word 字符，会被分词器切开；含引号的 token 不可能产生
  assert.equal(buildMatchExpression('a"b'), '"a" AND "b"');
});

test("parseSearchableLine：只抽 user/assistant 的 text block，blockIndex 是原始下标", () => {
  const userLine = JSON.stringify({
    type: "message",
    id: "m1",
    message: { role: "user", content: [{ type: "text", text: "你好" }, { type: "image", source: {} }, { type: "text", text: "第二块" }] },
  });
  const parsed = parseSearchableLine(userLine);
  assert.equal(parsed.entryId, "m1");
  assert.deepEqual(parsed.blocks, [
    { blockIndex: 0, text: "你好" },
    { blockIndex: 2, text: "第二块" },
  ]);

  // 字符串 content 视作单个 text block
  const stringLine = JSON.stringify({ type: "message", id: "m2", message: { role: "assistant", content: "纯文本" } });
  assert.deepEqual(parseSearchableLine(stringLine).blocks, [{ blockIndex: 0, text: "纯文本" }]);

  // 工具结果 / 其它角色不索引
  assert.equal(parseSearchableLine(JSON.stringify({ type: "message", message: { role: "toolResult", content: [{ type: "text", text: "x" }] } })), null);
  // 只有 thinking 的消息没有 text block
  assert.equal(parseSearchableLine(JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "x" }] } })), null);
  // 会话头不是消息
  assert.equal(parseSearchableLine(JSON.stringify({ type: "session", id: "s" })), null);
  // 坏行不抛
  assert.equal(parseSearchableLine("{not json"), null);
});

test("索引搜索：中文两字词命中（trigram 做不到的那一档）", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-search-index-"));
  const index = makeIndex(t, agentDir);
  const a = makeSessionFile(agentDir, "sess-a", [{ role: "user", text: "这是一个测试会话" }]);
  const b = makeSessionFile(agentDir, "sess-b", [{ role: "user", text: "完全无关的内容" }]);
  const sessions = [info(a, "sess-a"), info(b, "sess-b")];

  await index.sync(sessions);
  const hits = index.search(sessions, "测试");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, a);
  assert.equal(hits[0].body, "这是一个测试会话");
  assert.equal(hits[0].blockIndex, 0);
});

test("索引搜索：英文与中英混合查询", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-search-index-"));
  const index = makeIndex(t, agentDir);
  const path = makeSessionFile(agentDir, "sess-mixed", [{ role: "assistant", text: "修复 token 刷新的 bug" }]);
  const sessions = [info(path, "sess-mixed")];

  await index.sync(sessions);
  assert.equal(index.search(sessions, "token").length, 1);
  assert.equal(index.search(sessions, "刷新").length, 1);
  assert.equal(index.search(sessions, "token 刷新").length, 1);
  // AND 语义：两个词必须都在
  assert.equal(index.search(sessions, "token 不存在").length, 0);
});

test("索引搜索：一个会话只出一条结果，按 modified 降序", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-search-index-"));
  const index = makeIndex(t, agentDir);
  const oldPath = makeSessionFile(agentDir, "old", [
    { role: "user", text: "关键词 第一条" },
    { role: "assistant", text: "关键词 第二条" },
  ], { folder: "old" });
  const newPath = makeSessionFile(agentDir, "new", [{ role: "user", text: "关键词 新会话" }], { folder: "new" });
  const sessions = [
    info(oldPath, "old", "2026-01-01T00:00:00.000Z"),
    info(newPath, "new", "2026-02-01T00:00:00.000Z"),
  ];

  await index.sync(sessions);
  const hits = index.search(sessions, "关键词");
  assert.equal(hits.length, 2);
  assert.equal(hits[0].path, newPath, "较新的会话必须排前面");
  assert.equal(hits[1].path, oldPath);
  assert.equal(hits[1].body, "关键词 第一条", "同会话取文件内第一条命中");
});

test("同步：文件内容变化后新内容可搜到，旧内容搜不到", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-search-index-"));
  const index = makeIndex(t, agentDir);
  const path = makeSessionFile(agentDir, "sess", [{ role: "user", text: "第一版内容" }]);
  const sessions = [info(path, "sess")];

  await index.sync(sessions);
  assert.equal(index.search(sessions, "第一版").length, 1);

  // 内容变短，保证 size 一定变化（mtime 精度在部分文件系统上不可靠）
  makeSessionFile(agentDir, "sess", [{ role: "user", text: "第二版" }]);
  await index.sync(sessions);
  assert.equal(index.search(sessions, "第一版").length, 0, "旧内容必须被清掉");
  assert.equal(index.search(sessions, "第二版").length, 1);
});

test("同步：文件删除后从索引移除", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-search-index-"));
  const index = makeIndex(t, agentDir);
  const keep = makeSessionFile(agentDir, "keep", [{ role: "user", text: "保留的会话" }]);
  const gone = makeSessionFile(agentDir, "gone", [{ role: "user", text: "要删的会话" }], { folder: "other" });

  await index.sync([info(keep, "keep"), info(gone, "gone")]);
  assert.equal(index.search([info(keep, "keep"), info(gone, "gone")], "要删").length, 1);

  unlinkSync(gone);
  await index.sync([info(keep, "keep")]);
  assert.equal(index.search([info(keep, "keep")], "要删").length, 0);
  assert.equal(index.stats().files, 1);
});

test("全库覆盖：第 600 个会话仍能搜到（流式实现对 500 以后必然漏）", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-search-index-"));
  const index = makeIndex(t, agentDir);
  const sessions = [];
  for (let i = 0; i < 600; i += 1) {
    const id = `s${String(i).padStart(3, "0")}`;
    const path = makeSessionFile(
      agentDir,
      id,
      [{ role: "user", text: i === 599 ? "独一无二的目标字符串 zzzmarker" : `批量会话 ${i}` }],
      { folder: `p${i}` },
    );
    // 越靠后越新，保证流式实现的 500 文件上限会先扫完前 500 个
    sessions.push(info(path, id, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()));
  }

  await index.sync(sessions);
  const hits = index.search(sessions, "zzzmarker");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].body, "独一无二的目标字符串 zzzmarker");
});

test("searchSessionContents 走索引：结果结构与流式实现一致", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-search-index-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousFlag = process.env.PI_SESSION_SEARCH_INDEX;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.PI_SESSION_SEARCH_INDEX;
  useIsolatedDb(t);
  resetSessionSearchIndex();
  t.after(() => {
    resetSessionSearchIndex();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousFlag === undefined) delete process.env.PI_SESSION_SEARCH_INDEX;
    else process.env.PI_SESSION_SEARCH_INDEX = previousFlag;
    rmSync(agentDir, { recursive: true, force: true });
  });

  const path = makeSessionFile(agentDir, "sess", [{ role: "user", text: "前面一些字 目标词 后面一些字" }]);
  const session = info(path, "sess");
  const response = await searchSessionContents([session], "目标词");

  assert.equal(response.truncated, false);
  assert.equal(response.results.length, 1);
  const result = response.results[0];
  assert.equal(result.session.id, "sess");
  assert.equal(result.entryId, "sess-m0");
  assert.equal(result.blockIndex, 0);
  assert.equal(result.match, "目标词");
  // 与流式实现一致：before 只 trimStart，故保留匹配前的空格
  assert.equal(result.before, "前面一些字 ");
  // after 只 trimEnd，同理保留匹配后的空格
  assert.equal(result.after, " 后面一些字");
});

test("searchSessionContents 回退：PI_SESSION_SEARCH_INDEX=0 时不建索引仍能搜到", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-search-index-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousFlag = process.env.PI_SESSION_SEARCH_INDEX;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_SESSION_SEARCH_INDEX = "0";
  useIsolatedDb(t);
  resetSessionSearchIndex();
  t.after(() => {
    resetSessionSearchIndex();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousFlag === undefined) delete process.env.PI_SESSION_SEARCH_INDEX;
    else process.env.PI_SESSION_SEARCH_INDEX = previousFlag;
    rmSync(agentDir, { recursive: true, force: true });
  });

  const path = makeSessionFile(agentDir, "sess", [{ role: "user", text: "回退路径也要能搜到 目标" }]);
  const response = await searchSessionContents([info(path, "sess")], "目标");
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].match, "目标");
});

test("候选集按会话新旧截断：冷门词命中最新会话时不被 500 上限挤掉", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-search-index-cand-"));
  const index = makeIndex(t, agentDir);
  const sessions = [];
  for (let i = 0; i < 600; i += 1) {
    const id = `c${String(i).padStart(3, "0")}`;
    // 每个会话都命中同一个词：候选集必然被 MAX_CANDIDATES 截断。
    const text = i === 599 ? "共有词 commonword 最新的那个" : `共有词 commonword 旧的 ${i}`;
    const path = makeSessionFile(agentDir, id, [{ role: "user", text }], { folder: `q${i}` });
    // 越靠后越新
    sessions.push(info(path, id, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()));
  }

  await index.sync(sessions);
  const hits = index.search(sessions, "commonword");
  assert.ok(hits.length > 0, "expected hits for a common word");
  assert.equal(hits[0].body, "共有词 commonword 最新的那个", "the newest session must sort first");
  assert.ok(
    hits.some((hit) => hit.body === "共有词 commonword 最新的那个"),
    "the newest session must survive candidate truncation",
  );
});

test("查询没有可索引 token 时返回 null（交给流式实现），而不是空数组", (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-search-index-punct-"));
  const index = makeIndex(t, agentDir);
  assert.equal(index.search([], "()"), null);
  assert.equal(index.search([], "…"), null);
});

test("老库的 files 表带 session_id 列时重建迁移，保留 size/mtime", async (t) => {
  const dbDir = mkdtempSync(join(tmpdir(), "pi-web-search-migrate-"));
  const dbPath = join(dbDir, "search.db");
  // node:test 的 t.after 按注册顺序（FIFO）执行，所以清理只注册一次、
  // 在里面先 close 再删目录 —— 分开注册会让删目录跑在 close 之前。
  let index;
  t.after(() => {
    index?.close();
    // 这个 fixture 额外开过一条连接，Windows 上 SQLite 释放句柄有滞后，
    // 删目录仍可能 EBUSY。断言已经跑完，别用偶发的清理失败把测试判红。
    try {
      rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* Windows: handle release lags the close */
    }
  });

  // 造一个 0.10.7 之前的索引库：files 表多一个没人读的 session_id 列。
  const { DatabaseSync } = await import("node:sqlite");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, session_id TEXT NOT NULL, size INTEGER NOT NULL, mtime_ms REAL NOT NULL);
    CREATE TABLE docs (rowid INTEGER PRIMARY KEY, path TEXT NOT NULL, entry_id TEXT, block_index INTEGER NOT NULL, body TEXT NOT NULL);
    CREATE INDEX docs_path ON docs(path);
    CREATE VIRTUAL TABLE docs_fts USING fts5(tok, tokenize='unicode61');
  `);
  legacy.prepare("INSERT INTO files(path, session_id, size, mtime_ms) VALUES (?, ?, ?, ?)")
    .run("/sessions/old.jsonl", "old-session", 4096, 1700000000000);
  const beforeColumns = legacy.prepare("PRAGMA table_info(files)").all().map((c) => c.name);
  legacy.close();
  assert.ok(beforeColumns.includes("session_id"), "the fixture really has the legacy column");

  index = new SessionSearchIndex(dbPath);
  assert.equal(index.isAvailable(), true);
  // 先放掉索引自己的连接再开检查用的那条：Windows 上同一文件同时开两条
  // SQLite 连接、后关的一条仍会占住文件。
  index.close();

  const inspector = new DatabaseSync(dbPath);
  const afterColumns = inspector.prepare("PRAGMA table_info(files)").all().map((c) => c.name);
  const row = inspector.prepare("SELECT * FROM files WHERE path = ?").get("/sessions/old.jsonl");
  inspector.close();

  assert.ok(!afterColumns.includes("session_id"), "the dead column is gone");
  // 迁移不能丢增量同步的依据：size/mtime 原样保留，不需要重解析任何 .jsonl。
  assert.equal(row.size, 4096);
  assert.equal(row.mtime_ms, 1700000000000);
});
