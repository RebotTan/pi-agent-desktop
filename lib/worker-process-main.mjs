// worker-process-main.mjs — SidecarEngine 的 worker 子进程入口
// 由 WorkerProcessHost 用 spawn(process.execPath, [此文件]) 启动，stdio 上跑行式 JSON-RPC：
//   主进程 → worker: {type:"request",id,sessionId,method,params}
//   worker → 主进程: {type:"response",id,result|error} / {type:"event",sessionId,event}
//                    {type:"ready"}（进程起来就发，不等任何加载）
//
// 会话本体复用 lib/rpc-manager.ts 的 startRpcSession：worker 自己跑一遍装配，
// 主进程只持有 RpcSessionHandle 桩。不复制装配，是为了让 worker 会话与进程内会话
// 共用同一份 chat / side / 工具选择逻辑。jiti 转译只在第一次 session.start 触发
// （约 5s），预热池会把它藏起来；ready 握手不等它。

import { createInterface } from "node:readline";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
let rpcManagerPromise = null;
function loadRpcManager() {
  rpcManagerPromise ??= jiti.import("./rpc-manager.ts");
  return rpcManagerPromise;
}

/** sessionId → { wrapper }；一个 worker 通常只承载一个会话。 */
const sessions = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResponse(id, sessionId, result) {
  send({ type: "response", id, sessionId, result });
}

function sendError(id, sessionId, error) {
  send({ type: "response", id, sessionId, error: { message: error?.message ?? String(error) } });
}

function sendEvent(sessionId, event) {
  send({ type: "event", sessionId, event });
}

async function handleRequest(message) {
  const { id, sessionId, method } = message;
  const params = message.params ?? {};
  try {
    switch (method) {
      case "session.start": {
        const { startRpcSession } = await loadRpcManager();
        const { cwd, ...rest } = params;
        const result = await startRpcSession(sessionId, rest.sessionFile ?? "", cwd ?? process.cwd(), rest);
        const wrapper = result.session;
        sessions.set(sessionId, { wrapper });
        wrapper.onEvent((event) => sendEvent(sessionId, event));
        sendResponse(id, sessionId, { realSessionId: result.realSessionId });
        return;
      }
      case "wait_until_ready": {
        const entry = sessions.get(sessionId);
        if (!entry) throw new Error(`no session ${sessionId}`);
        if (typeof entry.wrapper.waitUntilReady === "function") await entry.wrapper.waitUntilReady();
        sendResponse(id, sessionId, { ok: true });
        return;
      }
      case "send": {
        const entry = sessions.get(sessionId);
        if (!entry) throw new Error(`no session ${sessionId}`);
        const result = await entry.wrapper.send(params);
        sendResponse(id, sessionId, result ?? { ok: true });
        return;
      }
      case "shutdown": {
        const entry = sessions.get(sessionId);
        if (entry) {
          sessions.delete(sessionId);
          await entry.wrapper.shutdown();
        }
        sendResponse(id, sessionId, { ok: true });
        return;
      }
      case "destroy": {
        const entry = sessions.get(sessionId);
        if (entry) {
          sessions.delete(sessionId);
          entry.wrapper.destroy();
        }
        sendResponse(id, sessionId, { ok: true });
        // 一个 worker 只承载一个会话，销毁后留进程就是孤儿。
        setImmediate(() => process.exit(0));
        return;
      }
      default:
        throw new Error(`unknown method ${method}`);
    }
  } catch (error) {
    sendError(id, sessionId, error);
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (message?.type !== "request") return;
  void handleRequest(message);
});

send({ type: "ready" });
