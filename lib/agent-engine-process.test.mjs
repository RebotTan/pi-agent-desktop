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
