import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentEventBus } = await jiti.import("./agent-event-bus.ts");

test("订阅收到 emit 事件，取消后不再收到", () => {
  const bus = new AgentEventBus();
  const seen = [];
  const unsub = bus.subscribe((event) => seen.push(event));
  bus.emit({ type: "session_started", sessionId: "a" });
  bus.emit({ type: "running_changed", ids: ["a"] });
  assert.deepEqual(seen.map((e) => e.type), ["session_started", "running_changed"]);
  unsub();
  bus.emit({ type: "session_ended", sessionId: "a" });
  assert.equal(seen.length, 2);
});

test("listenerCount 反映活跃订阅数", () => {
  const bus = new AgentEventBus();
  const a = bus.subscribe(() => {});
  const b = bus.subscribe(() => {});
  assert.equal(bus.listenerCount(), 2);
  a();
  assert.equal(bus.listenerCount(), 1);
  b();
  assert.equal(bus.listenerCount(), 0);
});

test("单个订阅者抛错不影响其余订阅者", () => {
  const bus = new AgentEventBus();
  const seen = [];
  bus.subscribe(() => { throw new Error("bad listener"); });
  bus.subscribe((event) => seen.push(event.type));
  bus.emit({ type: "session_ended", sessionId: "x" });
  assert.deepEqual(seen, ["session_ended"]);
});