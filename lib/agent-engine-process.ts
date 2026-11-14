// ============================================================================
// ProcessAgentEngine — 一个 worker 子进程承载一个会话
// ============================================================================
//
// InProcessAgentEngine 的启动协调协议（existing / inflight / closing-wait /
// start lock）原样复用，只把「装配」换成「spawn worker + 造 RPC 桩」。
//
// 与 InProcessAgentEngine 的差异：
// - assembler 不在本进程执行。它捕获的是主进程装配逻辑（lib/rpc-manager.ts
//   的 280 行装配体），跨进程跑不了，启动参数改由 resolveSpawnOptions 决定。
// - registry 里存 RpcSessionHandle。registry / startLocks / running listeners
//   仍是本进程自己的容器，不委托给任何目标引擎。

import { InProcessAgentEngine } from "./agent-engine";
import type { SessionStartResult } from "./agent-engine";
import { RpcSessionHandle } from "./session-handle-rpc";
import { getWorkerProcessHost } from "./worker-process-host";
import type { WorkerSpawnOptions } from "./worker-process-host";

export type SpawnOptionsResolver = (
  sessionId: string,
  startParams?: Record<string, unknown>,
) => WorkerSpawnOptions;

/** worker 的 cwd 决定它的相对路径与文件工具根，所以必须跟着会话走，不是主进程 cwd。 */
function defaultSpawnOptions(_sessionId: string, startParams?: Record<string, unknown>): WorkerSpawnOptions {
  const cwd = typeof startParams?.cwd === "string" && startParams.cwd ? startParams.cwd : process.cwd();
  return { cwd };
}

export class ProcessAgentEngine extends InProcessAgentEngine<RpcSessionHandle> {
  private readonly resolveSpawnOptions: SpawnOptionsResolver;

  constructor(resolveSpawnOptions: SpawnOptionsResolver = defaultSpawnOptions) {
    super();
    this.resolveSpawnOptions = resolveSpawnOptions;
  }

  /** 只决定「会话从哪来」：起一个 worker 并造 RPC 桩。启动协调在基类。 */
  protected override openSession(request: {
    sessionId: string;
    assembler: () => Promise<SessionStartResult<RpcSessionHandle>>;
    options?: { shutdownDeadlineMs?: number; startParams?: Record<string, unknown> };
  }): Promise<SessionStartResult<RpcSessionHandle>> {
    const { sessionId, options } = request;
    return (async () => {
      const spawnOptions = this.resolveSpawnOptions(sessionId, options?.startParams);
      const worker = await getWorkerProcessHost().spawnWorker(spawnOptions);
      const handle = new RpcSessionHandle(worker, {
        sessionId,
        cwd: spawnOptions.cwd,
        startParams: options?.startParams,
      });
      // worker 崩了、被 kill 或正常 destroy，都得把死桩从 registry 摘掉：
      // 留着它，running 视图和后续 startSession 都会把这个已经不通的会话当真。
      // 审批取消 / session_ended 广播在 P3 的桥接里接上，这里只管父侧身份。
      handle.onDestroy(() => {
        if (this.getSession(sessionId) === handle) this.deleteSession(sessionId);
      });
      this.setSession(sessionId, handle);
      handle.start();
      await handle.waitUntilReady();
      return { session: handle, realSessionId: handle.getRealSessionId() };
    })();
  }

}

export function getProcessEngine(): ProcessAgentEngine {
  const store = globalThis as typeof globalThis & { __piProcessEngine?: ProcessAgentEngine };
  return (store.__piProcessEngine ??= new ProcessAgentEngine());
}

export function resetProcessEngine(): void {
  delete (globalThis as { __piProcessEngine?: ProcessAgentEngine }).__piProcessEngine;
}
