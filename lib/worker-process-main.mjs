// worker-process-main.mjs — SidecarEngine 的 worker 子进程入口
// worker-process-main.mjs — SidecarEngine 的 worker 子进程入口
// 由 WorkerProcessHost 用 spawn(process.execPath, [此文件], {stdio:[...,'ipc']}) 启动，
// 协议走 Node 的 ipc 通道（不是 stdout，SDK/扩展随时可能往 stdout 打印）：
//   主进程 → worker: {protocol:1,type:"request",id,sessionId,method,params}
//   worker → 主进程: {protocol:1,type:"response",id,result|error}
//                    {protocol:1,type:"event",sessionId,event}
//                    {protocol:1,type:"ready"}（进程起来就发，不等任何加载）
//   主进程 → worker: {type:"request",id,sessionId,method,params}
//   worker → 主进程: {type:"response",id,result|error} / {type:"event",sessionId,event}
//                    {type:"ready"}（进程起来就发，不等任何加载）
//
// 会话本体复用 lib/rpc-manager.ts 的 startRpcSession：worker 自己跑一遍装配，
// 主进程只持有 RpcSessionHandle 桩。不复制装配，是为了让 worker 会话与进程内会话
// 共用同一份 chat / side / 工具选择逻辑。jiti 转译只在第一次 session.start 触发；
// ready 握手早于这次加载，所以预热只表示进程已起，不代表 SDK 已就绪，不能用来
// 承诺转译或启动耗时。


/** 必须与 lib/worker-process-host.ts 的 PROTOCOL_VERSION 相同；host 会核对。 */
const PROTOCOL_VERSION = 1;
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
let rpcManagerPromise = null;
function loadRpcManager() {
  rpcManagerPromise ??= jiti.import("./rpc-manager.ts");
  return rpcManagerPromise;
}
/**
 * 会话里出现过的每个 (provider, model) 的 cacheRead 单价。
 * 父进程只能用同步的 modelLookup()，所以价格表必须在启动时一次带回去。
 */
async function collectModelCosts(wrapper) {
  const lookup = typeof wrapper.modelLookup === "function" ? wrapper.modelLookup() : undefined;
  if (!lookup) return undefined;
  const view = await wrapper.readSession();
  const costs = {};
  for (const entry of view.getEntries()) {
    const provider = entry?.message?.provider ?? entry?.provider;
    const modelId = entry?.message?.model ?? entry?.modelId;
    if (typeof provider !== "string" || typeof modelId !== "string") continue;
    const cacheRead = lookup.getModel(provider, modelId)?.cost?.cacheRead;
    if (typeof cacheRead === "number") costs[provider + "/" + modelId] = cacheRead;
  }
  return costs;
}
/** sessionId → { wrapper }；一个 worker 通常只承载一个会话。 */
const sessions = new Map();

function send(message, callback) {
  // 通道只在 host 用 stdio 第 4 位 ipc 时才存在；不存在说明是被单独跑起来调试。
  if (typeof process.send !== "function") return;
  process.send({ protocol: PROTOCOL_VERSION, ...message }, callback);
}

function sendResponse(id, sessionId, result, callback) {
  send({ type: "response", id, sessionId, result }, callback);
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
        wrapper.onEvent((event) => sendEvent(sessionId, event));
        sendResponse(id, sessionId, {
          realSessionId: result.realSessionId,
          // 价格表跟启动一起回去：父进程无法同步问 modelRuntime，缓存命中金额会退化成 0。
          modelCosts: await collectModelCosts(wrapper),
        });
        return;
      }
      case "session.snapshot": {
        const entry = sessions.get(sessionId);
        if (!entry) throw new Error(`no session ${sessionId}`);
        const view = await entry.wrapper.readSession();
        // 整段历史过一次 IPC。长会话会有增量快照/revision 的需要，但先保证
        // 父进程看到的是真状态，而不是磁盘上的空文件。
        sendResponse(id, sessionId, {
          sessionId: view.getSessionId(),
          sessionFile: view.getSessionFile() ?? "",
          cwd: view.getCwd(),
          entries: view.getEntries(),
          leafId: view.getLeafId(),
          tree: view.getTree(),
          header: view.getHeader(),
          sessionName: view.getSessionName(),
        });
        return;
      }
      case "generate_title": {
        const entry = sessions.get(sessionId);
        if (!entry) throw new Error(`no session ${sessionId}`);
        sendResponse(id, sessionId, await entry.wrapper.generateTitle());
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
        // 一个 worker 只承载一个会话，销毁后留进程就是孤儿。等 ipc 把回包写出去再退，
        // 否则 process.exit 会连同缓冲区里的 response 一起丢掉，父进程只能等到超时。
        sendResponse(id, sessionId, { ok: true }, () => setImmediate(() => process.exit(0)));
        return;
      }
      default:
        throw new Error(`unknown method ${method}`);
    }
  } catch (error) {
    sendError(id, sessionId, error);
  }
}

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  // 版本不符的消息不猜：host 那边一发现我方 ready 版本不同就会杀掉重建。
  if (message.protocol !== PROTOCOL_VERSION) return;
  if (message.type !== "request") return;
  void handleRequest(message);
});

send({ type: "ready" });
