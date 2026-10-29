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
test("approval: 会话销毁时 cancel 掉该会话的待审批，Promise 按「未批准」结算", async () => {
  const coordinator = new ApprovalCoordinator();
  const mine = coordinator.requestApproval("bash", { command: "rm -rf /" }, "session-a");
  const other = coordinator.requestApproval("bash", { command: "ls" }, "session-b");
  assert.equal(coordinator.count(), 2);

  const reasons = [];
  coordinator.onCancel((id, reason) => reasons.push(reason));

  assert.equal(coordinator.cancel({ sessionId: "session-a" }, "session_destroyed"), 1);
  // 关键：宁可拒绝也不能默认放行。
  assert.equal(await mine, false);
  assert.equal(coordinator.count(), 1, "other session's approval must survive");
  assert.deepEqual(reasons, ["session_destroyed"]);
  assert.equal(coordinator.listPending()[0].sessionId, "session-b");

  // 别的会话不受影响，仍可正常结算。
  assert.equal(coordinator.settle(coordinator.listPending()[0].id, true), true);
  assert.equal(await other, true);
});

test("approval: listPending 带 sessionId，便于 UI 按会话过滤", () => {
  const coordinator = new ApprovalCoordinator();
  coordinator.requestApproval("bash", {}, "session-x");
  coordinator.requestApproval("read", {});
  const [first, second] = coordinator.listPending();
  assert.equal(first.sessionId, "session-x");
  assert.equal(second.sessionId, undefined, "unsourced approvals omit the field");
});
