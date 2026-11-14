import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { getApprovalCoordinator } = await jiti.import("./approval-coordinator.ts");
const { RpcSessionHandle } = await jiti.import("./session-handle-rpc.ts");

function fakeWorker() {
  const sent = [];
  return {
    sent,
    pid: 1,
    isAlive: () => true,
    send: (message) => void sent.push(message),
    onMessage: () => {},
    onExit: () => {},
    kill: () => {},
  };
}

test("a worker approval shows up in the parent's pending list and its verdict goes back", async () => {
  const coordinator = getApprovalCoordinator();
  const worker = fakeWorker();
  const handle = new RpcSessionHandle(worker, { sessionId: "approval-bridge", cwd: "/tmp" });

  handle.handleWorkerMessage({
    type: "approval_request",
    approval: { id: "approval-1", toolName: "bash", args: { command: "ls" }, requestedAt: 1, sessionId: "approval-bridge" },
  });

  const pending = coordinator.listPending().find((item) => item.id === "approval-1");
  assert.ok(pending, "the parent's HTTP surface must see the worker's request");
  assert.equal(pending.toolName, "bash");

  assert.equal(coordinator.settle("approval-1", true), true);
  await new Promise((resolve) => setImmediate(resolve));

  const reply = worker.sent.find((message) => message.type === "approval_result");
  assert.deepEqual(
    { approvalId: reply?.approvalId, approved: reply?.approved, sessionId: reply?.sessionId },
    { approvalId: "approval-1", approved: true, sessionId: "approval-bridge" },
  );
});

test("destroying a worker handle clears approvals nobody will ever settle", () => {
  const coordinator = getApprovalCoordinator();
  const worker = fakeWorker();
  const handle = new RpcSessionHandle(worker, { sessionId: "approval-destroy", cwd: "/tmp" });

  handle.handleWorkerMessage({
    type: "approval_request",
    approval: { id: "approval-2", toolName: "bash", args: {}, requestedAt: 1, sessionId: "approval-destroy" },
  });
  assert.ok(coordinator.listPending().some((item) => item.id === "approval-2"));

  handle.destroy();
  assert.equal(coordinator.listPending().some((item) => item.id === "approval-2"), false);
});

test("the worker asks its coordinator for approval through the bridge, not locally", async () => {
  const source = await readFile(new URL("./worker-process-main.mjs", import.meta.url), "utf8");
  assert.match(source, /installApprovalBridge\(sessionId\)/);
  assert.match(source, /getApprovalCoordinator\(\)\.setRemote\(/);
  assert.match(source, /message\.type === "approval_result"/);
  // 审批等待发生在 worker 里，父进程死去时不能留着挂起的 Promise。
  assert.match(source, /failPendingApprovals\(sessionId\)/);
});

test("the coordinator the worker's extensions see is the one the bridge installs on", async () => {
  const { createApprovalPolicyExtension } = await jiti.import("./approval-policy-extension.ts");
  const { getToolPolicyStore } = await jiti.import("./tool-policy.ts");
  const coordinator = getApprovalCoordinator();
  const rule = getToolPolicyStore().addRule({ pattern: "bridge_ask_tool", action: "ask" });
  const seen = [];
  coordinator.setRemote({ request: async (view) => (seen.push(view.toolName), true) });
  try {
    const handlers = [];
    createApprovalPolicyExtension({ sessionId: "bridge-identity" }).factory({
      on: (name, handler) => void handlers.push({ name, handler }),
    });
    const handler = handlers.find((item) => item.name === "tool_call")?.handler;
    assert.equal(await handler({ toolName: "bridge_ask_tool", input: { a: 1 } }), undefined);
    assert.deepEqual(seen, ["bridge_ask_tool"]);
  } finally {
    coordinator.setRemote(null);
    getToolPolicyStore().removeRule(rule.id);
  }
});
