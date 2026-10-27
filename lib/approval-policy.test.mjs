import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { InMemoryToolPolicyStore } = await jiti.import("./tool-policy.ts");
const { ApprovalCoordinator } = await jiti.import("./approval-coordinator.ts");

test("空规则表全部放行", () => {
  const store = new InMemoryToolPolicyStore();
  assert.equal(store.decide("bash"), "allow");
  assert.equal(store.decide("mcp__server__tool"), "allow");
});

test("精确 pattern 首个匹配获胜", () => {
  const store = new InMemoryToolPolicyStore();
  store.addRule({ pattern: "bash", action: "ask" });
  store.addRule({ pattern: "bash", action: "deny" });
  assert.equal(store.decide("bash"), "ask");
  assert.equal(store.decide("edit"), "allow");
});

test("通配 pattern 匹配所有子串工具", () => {
  const store = new InMemoryToolPolicyStore();
  store.addRule({ pattern: "mcp__*", action: "deny" });
  assert.equal(store.decide("mcp__x__y"), "deny");
  assert.equal(store.decide("bash"), "allow");
});

test("listRules/addRule/removeRule 往返", () => {
  const store = new InMemoryToolPolicyStore();
  const a = store.addRule({ pattern: "write", action: "ask", note: "写文件需确认" });
  const b = store.addRule({ pattern: "bash", action: "deny" });
  assert.deepEqual(store.listRules().map((r) => r.id), [a.id, b.id]);
  assert.equal(a.note, "写文件需确认");
  assert.equal(store.removeRule(a.id), true);
  assert.deepEqual(store.listRules().map((r) => r.pattern), ["bash"]);
  assert.equal(store.removeRule("不存在"), false);
});

test("approval: 挂起→放行→Promise 为 true", async () => {
  const coordinator = new ApprovalCoordinator();
  const promise = coordinator.requestApproval("bash", { command: "ls" });
  assert.equal(coordinator.count(), 1);
  const views = coordinator.listPending();
  assert.equal(views[0].toolName, "bash");
  assert.deepEqual(views[0].args, { command: "ls" });
  assert.equal(coordinator.settle(views[0].id, true), true);
  assert.equal(await promise, true);
  assert.equal(coordinator.count(), 0);
});

test("approval: 拒绝→Promise 为 false；重复结算返回 false", async () => {
  const coordinator = new ApprovalCoordinator();
  const promise = coordinator.requestApproval("edit", { path: "/x" });
  const id = coordinator.listPending()[0].id;
  assert.equal(coordinator.settle(id, false), true);
  assert.equal(await promise, false);
  assert.equal(coordinator.settle(id, true), false);
});