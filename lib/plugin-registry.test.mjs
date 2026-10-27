// PluginRegistry 三层注册点骨架测试（PR-6）。
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  InMemoryPluginRegistry,
  registerBuiltinServices,
} = await jiti.import("./plugin-registry.ts");

test("registerService/getService round-trips and overrides by id", () => {
  const reg = new InMemoryPluginRegistry();
  assert.equal(reg.getService("x"), undefined);
  reg.registerService("x", 42);
  assert.equal(reg.getService("x"), 42);
  reg.registerService("x", 43);
  assert.equal(reg.getService("x"), 43);
  assert.deepEqual(reg.listServiceIds(), ["x"]);
});

test("registerAgentExtension collects extensions and returns copies", () => {
  const reg = new InMemoryPluginRegistry();
  const ext = { name: "plugin-tools", match: (n) => (n === "x" ? {} : undefined) };
  reg.registerAgentExtension(ext);
  const got = reg.getAgentExtensions();
  assert.equal(got.length, 1);
  assert.equal(got[0], ext);
  // getter 返回副本，外部改动不影响注册表
  got.push({ name: "foreign", match: () => ({}) });
  assert.equal(reg.getAgentExtensions().length, 1);
});

test("registerUiContribution lists contributions in order", () => {
  const reg = new InMemoryPluginRegistry();
  reg.registerUiContribution({ id: "a", kind: "panel", title: "A" });
  reg.registerUiContribution({ id: "b", kind: "command", payload: { cmd: "x" } });
  assert.equal(reg.listUiContributions().length, 2);
  assert.equal(reg.listUiContributions()[0].id, "a");
  assert.deepEqual(reg.listUiContributions()[1], {
    id: "b",
    kind: "command",
    payload: { cmd: "x" },
  });
});

test("registerBuiltinServices registers the four built-in singletons", () => {
  const reg = new InMemoryPluginRegistry();
  registerBuiltinServices(reg);
  assert.ok(reg.getService("agent-engine"));
  assert.ok(reg.getService("session-store"));
  assert.ok(reg.getService("agent-event-bus"));
  assert.ok(reg.getService("tool-policy"));
  assert.deepEqual(reg.listServiceIds(), [
    "agent-engine",
    "agent-event-bus",
    "session-store",
    "tool-policy",
  ]);
});