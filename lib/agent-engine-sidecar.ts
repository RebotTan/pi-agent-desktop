// ============================================================================
// SidecarEngine — 多 Agent 隔离的骨架（同进程、跨会话槽）
// ============================================================================
//
// 目的：实现 AgentEngine 的完整接口，作为将来「真跨进程隔离」的接缝验证。
//
// 骨架版不做 spawn、不做 RPC、不做审批回传；它把语义方法委托给传入的目标引擎
// （默认 InProcessAgentEngine），在协议层面（startSession 的 existing/inflight/
// closing-wait/锁生命周期）与 InProcess 完全一致。将来把「委托目标引擎」换成
// 「spawn 子进程 + stdio JSON-RPC」，上层调用方零改动。
//
// 为什么是骨架而不是真隔离：真隔离要先证明「AgentEngine 接口足以承载第二个
// 实现」。这一步如果接口不行，说明 PR-1/PR-2 的抽象层漏了洞，要先补接口再谈
// spawn；如果够用，后续真隔离就是「同接口的第二实现」而非「大重构」。
//
// 生命周期：单例挂 globalThis.__piSidecarEngine（HMR 纪律同 __piEngine）。
// 模块多实例时以 globalThis 为准（与 search index 同款），模块局部缓存只是
// 加速路径。

import type {
  AgentEngine,
  RunningSessionIdsListener,
  SessionStartResult,
  StartLock,
} from "./agent-engine";
import { getEngine } from "./agent-engine";
import type { AgentSessionWrapper } from "./rpc-manager";

/**
 * 同进程、跨会话槽的 SidecarEngine。
 *
 * 所有 AgentEngine 语义方法直接委托给 `target`（默认 `getEngine()` 的
 * InProcessAgentEngine）；`startSession` 的协调协议通过调用目标引擎的
 * `startSession` 获得（目标引擎已经实现完整协议，骨架不复制、不覆盖）。
 */
export class SidecarEngine implements AgentEngine {
  constructor(private readonly target: AgentEngine) {}

  // --- session registry ---
  getSession(sessionId: string): AgentSessionWrapper | undefined {
    return this.target.getSession(sessionId);
  }
  setSession(sessionId: string, wrapper: AgentSessionWrapper): void {
    this.target.setSession(sessionId, wrapper);
  }
  deleteSession(sessionId: string): void {
    this.target.deleteSession(sessionId);
  }
  sessionCount(): number {
    return this.target.sessionCount();
  }
  allSessions(): AgentSessionWrapper[] {
    return this.target.allSessions();
  }
  allEntries(): Array<[string, AgentSessionWrapper]> {
    return this.target.allEntries();
  }

  // --- start locks ---
  getStartLock(sessionId: string): StartLock | undefined {
    return this.target.getStartLock(sessionId);
  }
  setStartLock(sessionId: string, lock: StartLock): void {
    this.target.setStartLock(sessionId, lock);
  }
  deleteStartLock(sessionId: string): void {
    this.target.deleteStartLock(sessionId);
  }

  // --- starting cwds ---
  hasStartingCwd(cwd: string): boolean {
    return this.target.hasStartingCwd(cwd);
  }
  trackStartingCwd(cwd: string, delta: 1 | -1): void {
    this.target.trackStartingCwd(cwd, delta);
  }

  // --- running listeners ---
  addRunningListener(listener: RunningSessionIdsListener): void {
    this.target.addRunningListener(listener);
  }
  removeRunningListener(listener: RunningSessionIdsListener): void {
    this.target.removeRunningListener(listener);
  }
  runningListenerCount(): number {
    return this.target.runningListenerCount();
  }
  allRunningListeners(): RunningSessionIdsListener[] {
    return this.target.allRunningListeners();
  }

  // --- 会话启动协调 ---
  startSession(
    sessionId: string,
    assembler: () => Promise<SessionStartResult>,
    options?: { shutdownDeadlineMs?: number },
  ): Promise<SessionStartResult> {
    return this.target.startSession(sessionId, assembler, options);
  }
  closingSessionWait(sessionId: string, deadlineMs: number): Promise<void> | null {
    return this.target.closingSessionWait(sessionId, deadlineMs);
  }

  // --- raw 注册表 ---
  registry(): Map<string, AgentSessionWrapper> {
    return this.target.registry();
  }
  startLocks(): Map<string, StartLock> {
    return this.target.startLocks();
  }
  startingCwds(): Map<string, number> {
    return this.target.startingCwds();
  }
  runningListeners(): Set<RunningSessionIdsListener> {
    return this.target.runningListeners();
  }
}

declare global {
  var __piSidecarEngine: AgentEngine | undefined;
}

let cachedSidecar: AgentEngine | undefined;

/**
 * 单例。target 缺省 getEngine()（InProcess）。
 *
 * 单例纪律与 __piEngine / __piSessionSearchIndex 相同：以 globalThis 为准
 * （HMR 与 jiti moduleCache:false 下同一模块可能多份实例），模块局部缓存只是
 * 加速路径。
 */
export function getSidecarEngine(target?: AgentEngine): AgentEngine {
  const fromGlobals = globalThis.__piSidecarEngine;
  if (fromGlobals) {
    cachedSidecar = fromGlobals;
    return fromGlobals;
  }
  cachedSidecar = globalThis.__piSidecarEngine = new SidecarEngine(target ?? getEngine());
  return cachedSidecar;
}

/** 测试用：丢掉单例（连同 globalThis 上的那份），不触碰目标引擎的状态。 */
export function resetSidecarEngine(): void {
  cachedSidecar = undefined;
  globalThis.__piSidecarEngine = undefined;
}
