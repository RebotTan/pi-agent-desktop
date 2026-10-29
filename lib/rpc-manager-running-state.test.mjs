import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const rpc = await jiti.import("./rpc-manager.ts");
const { AgentSessionWrapper, subscribeRunningSessions, getRunningRpcSessionIds } = rpc;
const { getEngine } = await jiti.import("./agent-engine.ts");

/**
 * Mimics the pi ≥ 0.86 AgentSession event/ordering contract: `agent_end`
 * fires while the run is still active (post-run pipeline pending), and the
 * `prompt()` promise resolves only after `agent_settled` — where
 * `_isAgentRunActive` was already cleared.
 */
function makeInner() {
  const listeners = new Set();
  const state = { active: false };
  const inner = {
    sessionId: "sid-1",
    sessionFile: "/tmp/sid-1.jsonl",
    get isStreaming() { return state.active; },
    get isIdle() { return !state.active; },
    isCompacting: false,
    get isBashRunning() { return false; },
    sessionManager: { getCwd: () => "/tmp" },
    agent: { state: {} },
    settingsManager: { getDefaultTools: () => [] },
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    dispose() { /* no-op */ },
    emit: (event) => { for (const l of listeners) l(event); },
    state,
    async prompt(_text, options) {
      state.active = true;
      inner.emit({ type: "agent_start" });
      if (options?.streamingBehavior) {
        // Steered/followUp submissions resolve at queue time; the run they
        // joined keeps going.
        return;
      }
      inner.emit({ type: "agent_end", messages: [] });
      state.active = false;
      inner.emit({ type: "agent_settled" });
    },
    abort: async () => {
      inner.emit({ type: "agent_end", messages: [] });
      state.active = false;
      inner.emit({ type: "agent_settled" });
    },
    /** Finishes the run a steered submission joined. */
    finishJoinedRun() {
      inner.emit({ type: "agent_end", messages: [] });
      state.active = false;
      inner.emit({ type: "agent_settled" });
    },
  };
  return inner;
}

function startWrapperInRegistry(inner) {
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  const registry = getEngine().registry();
  registry.clear();
  registry.set(inner.sessionId, wrapper);
  return {
    wrapper,
    dispose() {
      wrapper.destroy();
      registry.clear();
    },
  };
}

async function settle() {
  await new Promise((r) => setTimeout(r, 20));
}

test("a completed prompt pushes a final running frame without the session id", async () => {
  const frames = [];
  const unsubscribe = subscribeRunningSessions((ids) => frames.push([...ids]));

  const guard = startWrapperInRegistry(makeInner());
  try {
    await guard.wrapper.send({ type: "prompt", message: "hi" });
    await settle();

    const lastFrame = frames[frames.length - 1] ?? [];
    assert.deepEqual(getRunningRpcSessionIds(), [], "server still reports the finished session as running");
    assert.deepEqual(
      lastFrame,
      [],
      `last SSE frame still contains the finished session — sidebar spinner would spin forever: ${JSON.stringify(frames)}`,
    );
    // The run must have been advertised while it was active, too.
    assert.ok(frames.some((ids) => ids.includes("sid-1")), `running phase was never broadcast: ${JSON.stringify(frames)}`);
  } finally {
    unsubscribe();
    guard.dispose();
  }
});

test("a steered submission stays running until the joined run settles", async () => {
  const frames = [];
  const unsubscribe = subscribeRunningSessions((ids) => frames.push([...ids]));

  const inner = makeInner();
  const guard = startWrapperInRegistry(inner);
  try {
    await guard.wrapper.send({ type: "prompt", message: "hi", streamingBehavior: "steer" });
    await settle();
    // Queue-time settle must NOT clear the run the message joined.
    assert.ok(getRunningRpcSessionIds().includes("sid-1"), "steered submission dropped the running id at queue time");

    inner.finishJoinedRun();
    await settle();
    assert.deepEqual(getRunningRpcSessionIds(), [], "joined run settle left the session in the running set");
    assert.deepEqual(frames[frames.length - 1], [], `no settle frame pushed: ${JSON.stringify(frames)}`);
  } finally {
    unsubscribe();
    guard.dispose();
  }
});

test("aborting a run pushes a final frame without the session id", async () => {
  const frames = [];
  const unsubscribe = subscribeRunningSessions((ids) => frames.push([...ids]));

  // A prompt whose promise never settles on its own; abort() must unblock it
  // exactly like the SDK's waitForIdle-gated abort does.
  const inner = makeInner();
  let resolvePrompt;
  inner.prompt = () => {
    inner.state.active = true;
    inner.emit({ type: "agent_start" });
    return new Promise((resolve) => { resolvePrompt = resolve; });
  };
  const realAbort = inner.abort;
  inner.abort = async () => {
    await realAbort.call(inner);
    resolvePrompt?.();
  };
  const guard = startWrapperInRegistry(inner);
  try {
    const sending = guard.wrapper.send({ type: "prompt", message: "hi" });
    await settle();
    assert.ok(getRunningRpcSessionIds().includes("sid-1"), "run was never advertised as running");

    await guard.wrapper.send({ type: "abort" });
    await sending;
    await settle();

    assert.deepEqual(getRunningRpcSessionIds(), [], "aborted session still reported as running");
    assert.deepEqual(frames[frames.length - 1], [], `no post-abort frame pushed: ${JSON.stringify(frames)}`);
  } finally {
    unsubscribe();
    guard.dispose();
  }
});

test("the event bus keeps emitting running_changed even when no running listener is subscribed", async () => {
  const { getAgentEventBus } = await jiti.import("./agent-event-bus.ts");
  const bus = getAgentEventBus();
  const events = [];
  const unsubscribe = bus.subscribe((event) => {
    if (event.type === "running_changed") events.push([...event.ids]);
  });

  const inner = makeInner();
  const guard = startWrapperInRegistry(inner);
  try {
    // 没有 subscribeRunningSessions 订阅者：SSE 全局流仍必须收到帧。
    await guard.wrapper.send({ type: "prompt", message: "hi" });
    await settle();

    assert.ok(events.length > 0, "no running_changed reached the bus without a running listener");
    assert.deepEqual(events[events.length - 1], [], "the final frame should report an empty running set");
  } finally {
    unsubscribe();
    guard.dispose();
  }
});

test("running_changed is deduplicated on the bus, not emitted per event", async () => {
  const { getAgentEventBus } = await jiti.import("./agent-event-bus.ts");
  const bus = getAgentEventBus();
  let count = 0;
  const unsubscribe = bus.subscribe((event) => {
    if (event.type === "running_changed") count += 1;
  });

  const inner = makeInner();
  const guard = startWrapperInRegistry(inner);
  try {
    await guard.wrapper.send({ type: "prompt", message: "hi" });
    await settle();
    const afterFirst = count;
    assert.ok(afterFirst > 0, "expected a running_changed frame");

    // 没有状态变化时再触发一次通知，不应产生新帧（否则 web 客户端会被洪泛）。
    rpc.notifyRunningChange();
    rpc.notifyRunningChange();
    await settle();
    assert.equal(count, afterFirst, `duplicate frames emitted: ${count} vs ${afterFirst}`);
  } finally {
    unsubscribe();
    guard.dispose();
  }
});
