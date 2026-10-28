import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { WorkerProcessHost } = await jiti.import("./worker-process-host.ts");

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
