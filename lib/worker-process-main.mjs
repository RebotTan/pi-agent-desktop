// worker-process-main.mjs — SidecarEngine 的 worker 子进程入口
// 由 WorkerProcessHost 通过 spawn(process.execPath, [此文件]) 启动。
// 协议：stdio JSON-RPC（每行一个 JSON 消息）。

import { createInterface } from "node:readline";

const sessions = new Map();

const rl = createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function sendResponse(id, sessionId, result, error) {
  // sessionId 必须有：主进程按它把响应分发给对应的 RpcSessionHandle。
  // 早期版本漏了它，所有 response 都被 host 静默丢弃。
  send({ type: "response", id, sessionId, result, error });
}

function sendEvent(sessionId, event) {
  send({ type: "event", sessionId, event });
}

async function handleRequest(message) {
  const { id, sessionId, method, params } = message;
  try {
    switch (method) {
      case "session.start": {
        // TODO: 在 worker 里 createAgentSessionFromServices（需要 pi SDK）
        // 骨架：先注册会话并回一个 mock sessionId
        sessions.set(sessionId, { id: sessionId, params });
        sendEvent(sessionId, { type: "agent_settled" });
        sendResponse(id, sessionId, { realSessionId: sessionId });
        break;
      }
      case "wait_until_ready": {
        if (!sessions.has(sessionId)) throw new Error("Session not found");
        sendResponse(id, sessionId, { ok: true });
        break;
      }
      case "send": {
        const session = sessions.get(sessionId);
        if (!session) throw new Error("Session not found");
        // TODO: 转发给真实 session。骨架阶段只发一对 start/end，
        // 让主进程的 isRunning() 链路可验证。
        sendEvent(sessionId, { type: "agent_start" });
        sendResponse(id, sessionId, { ok: true });
        sendEvent(sessionId, { type: "agent_end" });
        break;
      }
      case "shutdown": {
        const session = sessions.get(sessionId);
        if (session) {
          sessions.delete(sessionId);
          // TODO: 调用 session.shutdown()
        }
        sendResponse(id, sessionId, { ok: true });
        break;
      }
      case "destroy": {
        sessions.delete(sessionId);
        sendResponse(id, sessionId, { ok: true });
        break;
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  } catch (error) {
    sendResponse(id, sessionId, undefined, { message: error.message });
  }
}

rl.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    if (message.type === "request") {
      void handleRequest(message);
    }
  } catch {}
});

// 启动完成
send({ type: "ready" });
