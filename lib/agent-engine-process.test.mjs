import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// worker 起的是真会话，会写 sessions 目录：用临时 agentDir，别污染 ~/.pi/agent。
const agentDir = mkdtempSync(join(tmpdir(), "pid-process-engine-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.on("exit", () => {
  try {
    rmSync(agentDir, { recursive: true, force: true });
  } catch {
    // Windows 上子进程还可能占着目录，留给系统清理。
  }
});

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { ProcessAgentEngine } = await jiti.import("./agent-engine-process.ts");
const { getWorkerProcessHost } = await jiti.import("./worker-process-host.ts");

// 父进程绝不该执行 assembler：它捕获的是主进程装配逻辑。
const parentAssemblerMustNotRun = async () => {
  throw new Error("assembler must not run in the parent process");
};

/** 销毁全部会话并收掉预热池的子进程，否则 node --test 因句柄未释放而挂起。 */
async function cleanup(engine) {
  for (const session of engine.allSessions()) session.destroy();
  await getWorkerProcessHost().settlePrewarm();
}

test("startSession 起一个 worker 会话并登记 RPC 桩", async (t) => {
  const engine = new ProcessAgentEngine();
  t.after(() => cleanup(engine));

  const { session, realSessionId } = await engine.startSession("proc-1", parentAssemblerMustNotRun);

  // worker 真的跑了 startRpcSession，realSessionId 是 SDK 生成的 uuid。
  assert.match(realSessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(engine.getSession("proc-1"), session);
  assert.equal(engine.sessionCount(), 1);
  assert.ok(session.isAlive());
  assert.equal(session.isRunning(), false);
  assert.deepEqual(engine.allStartLocks(), []);
});

test("父进程通过快照通道读到 worker 里的真会话", async (t) => {
  const engine = new ProcessAgentEngine();
  t.after(() => cleanup(engine));

  const { session, realSessionId } = await engine.startSession("proc-snapshot", parentAssemblerMustNotRun);
  const view = await session.readSession();

  // 刚起的会话还没落盘；快照必须是 worker 内存里的 manager，而不是空文件。
  assert.equal(view.getSessionId(), realSessionId);
  assert.ok(Array.isArray(view.getEntries()));
  assert.equal(typeof view.getLeafId(), "string");
  // 价格表随 start 一起回传；没出现过的模型查出来是 undefined（调用方回落到 entries 自带价格）。
  assert.equal(session.modelLookup()?.getModel("nope", "nope-model"), undefined);
});

test("同一 id 并发启动只起一个 worker", async (t) => {
  const engine = new ProcessAgentEngine();
  t.after(() => cleanup(engine));

  const [first, second] = await Promise.all([
    engine.startSession("proc-2", parentAssemblerMustNotRun),
    engine.startSession("proc-2", parentAssemblerMustNotRun),
  ]);

  assert.equal(first.session, second.session);
  assert.equal(engine.sessionCount(), 1);
});

test("存活会话直接复用，不再 spawn", async (t) => {
  const engine = new ProcessAgentEngine();
  t.after(() => cleanup(engine));

  const first = await engine.startSession("proc-3", parentAssemblerMustNotRun);
  const second = await engine.startSession("proc-3", parentAssemblerMustNotRun);

  assert.equal(first.session, second.session);
  assert.equal(engine.sessionCount(), 1);
});

test("销毁后可以重建，得到新的 RPC 桩", async (t) => {
  const engine = new ProcessAgentEngine();
  t.after(() => cleanup(engine));

  const first = await engine.startSession("proc-4", parentAssemblerMustNotRun);
  first.session.destroy();
  assert.equal(first.session.isAlive(), false);

  const second = await engine.startSession("proc-4", parentAssemblerMustNotRun);

  assert.notEqual(second.session, first.session);
  assert.ok(second.session.isAlive());
  assert.equal(engine.getSession("proc-4"), second.session);
});

test("startSession 按 sessionId 解析 spawn 参数", async (t) => {
  const seen = [];
  const engine = new ProcessAgentEngine((sessionId) => {
    seen.push(sessionId);
    return { cwd: process.cwd() };
  });
  t.after(() => cleanup(engine));

  await engine.startSession("proc-5", parentAssemblerMustNotRun);

  assert.deepEqual(seen, ["proc-5"]);
});

test("startParams 原样交给 worker：非法 toolNames 在 worker 侧被拒绝", async (t) => {
  const engine = new ProcessAgentEngine();
  t.after(() => cleanup(engine));

  await assert.rejects(
    () =>
      engine.startSession("proc-params", parentAssemblerMustNotRun, {
        startParams: { sessionFile: "", toolNames: ["definitely-not-a-tool"] },
      }),
    /toolNames must contain only built-in tool names/,
  );
});

test("销毁会话后 registry 不再持有死桩", async (t) => {
  const engine = new ProcessAgentEngine();
  t.after(() => cleanup(engine));

  const { session } = await engine.startSession("proc-drop", parentAssemblerMustNotRun);
  assert.equal(engine.getSession("proc-drop"), session);

  session.destroy();
  // worker 侧的 destroy 是异步的，但父侧身份必须立刻撤掉：同一个 id 上留着
  // 一个已死的桩，running 视图会一直把它算作在跑的会话。
  assert.equal(engine.getSession("proc-drop"), undefined);
  assert.equal(engine.sessionCount(), 0);
});

test("worker 被强杀后只摘掉自己的桩，在途请求失败而不是挂住", async (t) => {
  const engine = new ProcessAgentEngine();
  t.after(() => cleanup(engine));

  const a = await engine.startSession("proc-crash-a", parentAssemblerMustNotRun);
  const b = await engine.startSession("proc-crash-b", parentAssemblerMustNotRun);
  assert.equal(engine.sessionCount(), 2);

  // private 字段在 JS 里可达：拿到 a 的 worker 进程直接杀掉，模拟崩溃而不是优雅 destroy。
  a.session["worker"].kill();

  // 崩溃后新请求必须立刻拒绝；挂住会让 HTTP 请求一直等。
  await assert.rejects(a.session.readSession(), /not alive|exited/);

  // 进程真的退出是异步的；registry 的清理挂在 exit 事件上，所以要等它到。
  for (let i = 0; i < 50 && engine.getSession("proc-crash-a"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(engine.getSession("proc-crash-a"), undefined);

  // b 在另一个进程里，不受影响。
  assert.equal(engine.getSession("proc-crash-b"), b.session);
  assert.ok(b.session.isAlive());
  const view = await b.session.readSession();
  assert.equal(view.getSessionId(), b.realSessionId);
});

test("默认 spawn 参数跟着会话的 cwd 走，而不是主进程 cwd", async (t) => {
  const seen = [];
  const engine = new ProcessAgentEngine((sessionId, startParams) => {
    seen.push([sessionId, startParams?.cwd ?? null]);
    return { cwd: process.cwd() };
  });
  t.after(() => cleanup(engine));

  await engine.startSession("proc-cwd", parentAssemblerMustNotRun, {
    startParams: { sessionFile: "", cwd: "/work/project-alpha" },
  });

  assert.deepEqual(seen, [["proc-cwd", "/work/project-alpha"]]);
});
