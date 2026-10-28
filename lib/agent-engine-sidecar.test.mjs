import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// 测试通过 jiti 加载 TS 源（与 lib/rpc-manager-lifecycle.test.mjs 同款）。
// jiti moduleCache:false 下同一模块可能多份实例，所以单例纪律必须挂 globalThis。
const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { getSidecarEngine, resetSidecarEngine, SidecarEngine } = await jiti.import("./agent-engine-sidecar.ts");
const { InProcessAgentEngine } = await jiti.import("./agent-engine.ts");

function makeWrapper() {
  let alive = true;
  return {
    isAlive: () => alive,
    isRunning: () => false,
    waitUntilDisposed: async () => true,
    destroy: () => { alive = false; },
    shutdown: async () => { alive = false; },
    onDestroy: (cb) => { void cb; },
    onEvent: (cb) => { void cb; return () => {}; },
  };
}

// 造一个独立的 InProcessAgentEngine 当「目标引擎」：协议行为与默认
// （getEngine()）一致，但状态互不污染，测试之间不需要清全局引擎。
function makeTarget() {
  return new InProcessAgentEngine();
}

// --- 单例纪律 ---

test("getSidecarEngine 两次返回同一实例，且 globalThis 可读", () => {
  resetSidecarEngine();
  const a = getSidecarEngine();
  const b = getSidecarEngine();
  assert.strictEqual(a, b);
  assert.strictEqual(globalThis.__piSidecarEngine, a);
  resetSidecarEngine();
});

test("getSidecarEngine(customEngine)：显式传目标引擎时使用之", () => {
  resetSidecarEngine();
  const custom = makeTarget();
  const sidecar = getSidecarEngine(custom);
  assert.ok(sidecar instanceof SidecarEngine);
  // 私有的 target 不暴露，但可通过行为验证：注册表与目标引擎是同一份
  custom.setSession("x", makeWrapper());
  assert.ok(sidecar.getSession("x"));
  resetSidecarEngine();
});

// --- 协议等价（与 InProcessAgentEngine 的 startSession 完全一致）---

test("startSession：existing 复用，不重复调用 assembler", async () => {
  const target = makeTarget();
  const sidecar = new SidecarEngine(target);
  const wrapper = makeWrapper();
  target.setSession("s1", wrapper);
  let calls = 0;
  const result = await sidecar.startSession("s1", async () => {
    calls += 1;
    return { session: wrapper, realSessionId: "s1" };
  });
  assert.strictEqual(calls, 0);
  assert.strictEqual(result.session, wrapper);
  assert.strictEqual(result.realSessionId, "s1");
});

test("startSession：inflight 合并，两个并发 start 只跑一个 assembler", async () => {
  const target = makeTarget();
  const sidecar = new SidecarEngine(target);
  let calls = 0;
  const wrapper = makeWrapper();
  const p1 = sidecar.startSession("s2", async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 30));
    return { session: wrapper, realSessionId: "s2" };
  });
  const p2 = sidecar.startSession("s2", async () => {
    calls += 1;
    return { session: wrapper, realSessionId: "s2" };
  });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.strictEqual(calls, 1);
  assert.strictEqual(r1.realSessionId, "s2");
  assert.strictEqual(r2.realSessionId, "s2");
});

test("startSession：closing-wait 排队，destroy 后会等前一个释放再启动", async () => {
  const target = makeTarget();
  const sidecar = new SidecarEngine(target);
  const order = [];

  // 先启动一次（s3 注册完成）。
  const w1 = makeWrapper();
  const r1 = await sidecar.startSession("s3", async () => {
    order.push("first");
    return { session: w1, realSessionId: "s3" };
  });
  assert.strictEqual(r1.session, w1);

  // 模拟「正在关闭」：注册表换上一个 isAlive=false 的 wrapper，
  // 让下一次 startSession 走 closing-wait 分支。
  const closing = makeWrapper();
  closing.destroy(); // isAlive=false，但注册表里仍是它
  target.setSession("s3", closing);

  // 再次启动：先等 closing-wait（waitUntilDisposed 立即 resolve），
  // 然后才调用 assembler。
  const w2 = makeWrapper();
  const r2 = await sidecar.startSession("s3", async () => {
    order.push("second");
    target.setSession("s3", w2);
    return { session: w2, realSessionId: "s3" };
  });

  assert.deepStrictEqual(order, ["first", "second"]);
  assert.strictEqual(r2.session, w2);
});

test("startSession：assembler 抛错后锁被释放，可再次启动", async () => {
  const target = makeTarget();
  const sidecar = new SidecarEngine(target);
  const wrapper = makeWrapper();
  await assert.rejects(
    sidecar.startSession("s4", async () => { throw new Error("boom"); }),
    /boom/,
  );
  // 锁已释放：同 id 能再次启动
  const result = await sidecar.startSession("s4", async () => ({ session: wrapper, realSessionId: "s4" }));
  assert.strictEqual(result.realSessionId, "s4");
});

// --- raw 注册表委托 ---

test("registry / startLocks / startingCwds / runningListeners 直接是目标引擎的 Map/Set", () => {
  const target = makeTarget();
  const sidecar = new SidecarEngine(target);
  assert.strictEqual(sidecar.registry(), target.registry());
  assert.strictEqual(sidecar.startLocks(), target.startLocks());
  assert.strictEqual(sidecar.startingCwds(), target.startingCwds());
  assert.strictEqual(sidecar.runningListeners(), target.runningListeners());
});

// --- 语义方法委托 ---

test("语义方法（会话注册表/锁/cwd/监听器）全部委托给目标引擎", () => {
  const target = makeTarget();
  const sidecar = new SidecarEngine(target);
  const wrapper = makeWrapper();
  const listener = (ids) => { void ids; };

  sidecar.setSession("a", wrapper);
  assert.ok(target.getSession("a"));
  assert.strictEqual(sidecar.getSession("a"), wrapper);
  assert.strictEqual(sidecar.sessionCount(), 1);
  assert.deepStrictEqual(sidecar.allSessions(), [wrapper]);
  assert.deepStrictEqual(sidecar.allEntries(), [["a", wrapper]]);

  const lock = Promise.resolve({ session: wrapper, realSessionId: "a" });
  sidecar.setStartLock("a", lock);
  assert.strictEqual(target.getStartLock("a"), lock);
  sidecar.deleteStartLock("a");
  assert.strictEqual(target.getStartLock("a"), undefined);

  sidecar.trackStartingCwd("/x", 1);
  assert.ok(target.hasStartingCwd("/x"));
  sidecar.trackStartingCwd("/x", -1);
  assert.ok(!target.hasStartingCwd("/x"));

  sidecar.addRunningListener(listener);
  assert.strictEqual(target.runningListenerCount(), 1);
  assert.deepStrictEqual(sidecar.allRunningListeners(), [listener]);
  sidecar.removeRunningListener(listener);
  assert.strictEqual(target.runningListenerCount(), 0);

  sidecar.deleteSession("a");
  assert.strictEqual(target.getSession("a"), undefined);
});
