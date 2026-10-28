// worker-process-main.mjs — SidecarEngine 的 worker 子进程入口
// 由 WorkerProcessHost 通过 spawn(process.execPath, [此文件]) 启动。
// 协议：stdio JSON-RPC（每行一个 JSON 消息）。

import { createInterface } from "node:readline";

const sessions = new Map();

const rl = createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function sendResponse(id, result, error) {
  send({ type: "response", id, result, error });
}

async function handleRequest(message) {
  const { id, sessionId, method, params } = message;
  try {
    switch (method) {
      case "session.start": {
        // TODO: 在 worker 里 createAgentSessionFromServices（需要 pi SDK）
        // 骨架：先注册会话并回一个 mock sessionId
        sessions.set(sessionId, { id: sessionId, params });
        sendResponse(id, { realSessionId: sessionId });
        break;
      }
      case "send": {
        const session = sessions.get(sessionId);
        if (!session) throw new Error("Session not found");
        // TODO: 转发给真实 session
        sendResponse(id, { ok: true });
        break;
      }
      case "shutdown": {
        const session = sessions.get(sessionId);
        if (session) {
          sessions.delete(sessionId);
          // TODO: 调用 session.shutdown()
        }
        sendResponse(id, { ok: true });
        break;
      }
      case "destroy": {
        sessions.delete(sessionId);
        sendResponse(id, { ok: true });
        break;
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  } catch (error) {
    sendResponse(id, undefined, { message: error.message });
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
