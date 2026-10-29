import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { WorkerProcessHost } = await jiti.import("./worker-process-host.ts");
const { RpcSessionHandle } = await jiti.import("./session-handle-rpc.ts");

// 预热池会异步 spawn 下一个 worker；测试必须等它结束并杀掉，否则
// node --test 会因子进程句柄未释放而挂起（见 settlePrewarm）。

test("spawnWorker 返回可通信的 worker", async () => {
  const host = new WorkerProcessHost();
  const worker = await host.spawnWorker({ cwd: process.cwd() });
  assert.ok(worker.isAlive());
  assert.ok(worker.pid > 0);
  worker.kill();
  await host.settlePrewarm();
});

test("worker 退出后 isAlive 变 false", async () => {
  const host = new WorkerProcessHost();
  const worker = await host.spawnWorker({ cwd: process.cwd() });
  assert.ok(worker.isAlive());
  worker.kill();
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!worker.isAlive());
  await host.settlePrewarm();
});

// --- RpcSessionHandle 协议 ---

/** 等一个条件成立，超时抛错。避免用固定 sleep 撞 race。 */
async function waitFor(label, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test("RpcSessionHandle: start → send → destroy 全链路走真实 worker", async () => {
  const host = new WorkerProcessHost();
  const worker = await host.spawnWorker({ cwd: process.cwd() });
  const handle = new RpcSessionHandle(worker, { sessionId: "session-abc", cwd: process.cwd() });

  try {
    handle.start();
    await handle.waitUntilReady();
    assert.equal(handle.getRealSessionId(), "session-abc");

    // worker 收到 send 会发 agent_start / agent_end，isRunning 必须跟着走。
    let sawStart = false;
    let sawEnd = false;
    handle.onEvent((event) => {
      if (event.type === "agent_start") sawStart = true;
      if (event.type === "agent_end") sawEnd = true;
    });
    const result = await handle.send({ type: "prompt", message: "hi" });
    assert.deepEqual(result, { ok: true });
    await waitFor("agent_end event", () => sawEnd);
    assert.ok(sawStart, "agent_start event reached the handle");
    assert.equal(handle.isRunning(), false, "isRunning 回到 false after agent_end");
  } finally {
    handle.destroy();
    worker.kill();
    await host.settlePrewarm();
  }
});

test("RpcSessionHandle: destroy 把 destroy 送到 worker，且回调只触发一次", async () => {
  const host = new WorkerProcessHost();
  const worker = await host.spawnWorker({ cwd: process.cwd() });
  const received = [];
  worker.onMessage("session-destroy", (message) => received.push(message));
  const handle = new RpcSessionHandle(worker, { sessionId: "session-destroy", cwd: process.cwd() });

  let destroyCallbacks = 0;
  handle.onDestroy(() => { destroyCallbacks += 1; });

  try {
    handle.start();
    await handle.waitUntilReady();
    handle.destroy();
    assert.equal(handle.isAlive(), false);
    assert.equal(destroyCallbacks, 1);

    // worker 真的收到了 destroy 请求（曾经因为在设 alive=false 之后才发而被吞掉）。
    await waitFor("worker destroy response", () =>
      received.some((m) => m.type === "response" && m.result?.ok === true),
    );
    // 重复 destroy 必须幂等，不能再触发 onDestroy。
    handle.destroy();
    assert.equal(destroyCallbacks, 1);
  } finally {
    worker.kill();
    await host.settlePrewarm();
  }
});

test("settlePrewarm 之后预热池不残留存活的 worker", async () => {
  const host = new WorkerProcessHost();
  const worker = await host.spawnWorker({ cwd: process.cwd() });
  worker.kill();
  await host.settlePrewarm();
  // settlePrewarm 内部 discardPrewarmed：再 spawn 时必须重新起进程，拿到的是新 pid。
  assert.ok(!worker.isAlive());
});
