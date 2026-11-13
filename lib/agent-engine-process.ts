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

import { DEFAULT_SHUTDOWN_DEADLINE_MS, InProcessAgentEngine } from "./agent-engine";
import type { SessionStartResult } from "./agent-engine";
import { RpcSessionHandle } from "./session-handle-rpc";
import { getWorkerProcessHost } from "./worker-process-host";
import type { WorkerSpawnOptions } from "./worker-process-host";

export type SpawnOptionsResolver = (sessionId: string) => WorkerSpawnOptions;

export class ProcessAgentEngine extends InProcessAgentEngine<RpcSessionHandle> {
  private readonly resolveSpawnOptions: SpawnOptionsResolver;

  constructor(resolveSpawnOptions: SpawnOptionsResolver = () => ({ cwd: process.cwd() })) {
    super();
    this.resolveSpawnOptions = resolveSpawnOptions;
  }

  override async startSession(
    sessionId: string,
    assembler: () => Promise<SessionStartResult<RpcSessionHandle>>,
    options?: {
      shutdownDeadlineMs?: number;
      startParams?: Record<string, unknown>;
    },
  ): Promise<SessionStartResult<RpcSessionHandle>> {
    const existing = this.getSession(sessionId);
    if (existing?.isAlive()) {
      return { session: existing, realSessionId: existing.getRealSessionId() };
    }

    const inflight = this.getStartLock(sessionId);
    if (inflight) return inflight;

    const closingWait = this.closingSessionWait(
      sessionId,
      options?.shutdownDeadlineMs ?? DEFAULT_SHUTDOWN_DEADLINE_MS,
    );
    if (closingWait) {
      const waiting: Promise<SessionStartResult<RpcSessionHandle>> = closingWait.then(() => {
        if (this.getStartLock(sessionId) === waiting) this.deleteStartLock(sessionId);
        return this.startSession(sessionId, assembler, options);
      });
      this.setStartLock(sessionId, waiting);
      return waiting;
    }

    const starting = (async () => {
      const spawnOptions = this.resolveSpawnOptions(sessionId);
      const worker = await getWorkerProcessHost().spawnWorker(spawnOptions);
      const handle = new RpcSessionHandle(worker, {
        sessionId,
        cwd: spawnOptions.cwd,
        startParams: options?.startParams,
      });
      this.setSession(sessionId, handle);
      handle.start();
      await handle.waitUntilReady();
      return { session: handle, realSessionId: handle.getRealSessionId() };
    })().finally(() => {
      this.deleteStartLock(sessionId);
    });
    this.setStartLock(sessionId, starting);
    return starting;
  }
}

export function getProcessEngine(): ProcessAgentEngine {
  const store = globalThis as typeof globalThis & { __piProcessEngine?: ProcessAgentEngine };
  return (store.__piProcessEngine ??= new ProcessAgentEngine());
}

export function resetProcessEngine(): void {
  delete (globalThis as { __piProcessEngine?: ProcessAgentEngine }).__piProcessEngine;
}
