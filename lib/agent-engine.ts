// ============================================================================
// AgentEngine — 会话运行时引擎的显式接口与进程内实现
// ============================================================================
//
// 目的：把会话运行时状态从散落在 lib/rpc-manager.ts 的四个 globalThis 容器
// （__piSessions / __piStartLocks / __piStartingSessionCwds / __piRunningListeners）
// 收敛成一个显式引擎实例（AgentEngine）。
//
// - 实例仍然挂在 globalThis.__piEngine，保住 Next.js 热重载下的会话存活
//   （AGENTS.md 硬规则；模块级 Map 会丢，globalThis 不会）。
// - 换实现有了接缝：SidecarEngine（每 worker 一个子进程）、RemoteEngine（SSH）
//   可实现同一接口后替换，上层零改动。
//
// 见 .agents/adr/0001-agent-engine-seam.md、GLOSSARY.md。
// 状态持有（私有字段）+ 生命周期（process 信号）都在这里，不再藏在 getter 副作用里。

import type { SessionHandle } from "./session-handle";
import type { AgentSessionWrapper } from "./rpc-manager";

/** closingSessionWait 无 options.shutdownDeadlineMs 时的兜底（与 pi-web 默认一致）。 */
const DEFAULT_SHUTDOWN_DEADLINE_MS = 5_000;

/** 运行中会话 id 集合变化的监听器。 */
export type RunningSessionIdsListener = (ids: string[]) => void;

/** 一次会话启动的结果：wrapper + 真实会话 id（可能因复用/去重与请求 id 不同）。 */
export type SessionStartResult<H extends SessionHandle = AgentSessionWrapper> = { session: H; realSessionId: string };

/** 单次捕获的 startRpcSession 在途 promise（inflight 去重用）。 */
export type StartLock<H extends SessionHandle = AgentSessionWrapper> = Promise<SessionStartResult<H>>;

/**
 * 会话运行时引擎的契约。
 *
 * 面向未来的语义方法（getSession/setSession/...）给新代码用；
 * 四个 raw 注册表方法（registry/startLocks/...）给 rpc-manager 的既有内部
 * 访问函数过渡用（它们的调用点仍按 Map/Set 操作，见各 getter 的注释）。
 * 会话启动的并发协调协议（startRpcSession）已收进 startSession；
 * 后续 PR 再把剩余调用点逐步收敛到语义方法上。
 */
export interface AgentEngine<H extends SessionHandle = AgentSessionWrapper> {
  // --- session registry ---
  getSession(sessionId: string): H | undefined;
  setSession(sessionId: string, wrapper: H): void;
  deleteSession(sessionId: string): void;
  sessionCount(): number;
  allSessions(): H[];
  allEntries(): Array<[string, H]>;

  // --- start locks（startRpcSession 的 inflight 去重）---
  getStartLock(sessionId: string): StartLock<H> | undefined;
  setStartLock(sessionId: string, lock: StartLock<H>): void;
  deleteStartLock(sessionId: string): void;

  // --- starting cwds（新会话热路径的去重/忙检测）---
  hasStartingCwd(cwd: string): boolean;
  trackStartingCwd(cwd: string, delta: 1 | -1): void;

  // --- running listeners（运行状态变化广播）---
  addRunningListener(listener: RunningSessionIdsListener): void;
  removeRunningListener(listener: RunningSessionIdsListener): void;
  runningListenerCount(): number;
  allRunningListeners(): RunningSessionIdsListener[];

  // --- 会话启动协调（startRpcSession 的并发协议）---
  /**
   * 启动一个会话：existing 复用 / inflight 合并 / closing-wait 排队 / 锁生命周期。
   * 只调用一次 assembler（会话装配是 rpc-manager 域知识，作为回调传入）。
   * Sidecar/Remote 引擎将来用同一协议 spawn 子进程 / SSH 远程。
   */
  startSession(
    sessionId: string,
    assembler: () => Promise<SessionStartResult<H>>,
    options?: { shutdownDeadlineMs?: number },
  ): Promise<SessionStartResult<H>>;
  /**
   * 等待 `sessionId` 正在关闭的 wrapper 释放，或 null（无关闭中 wrapper）。
   * deadlineMs 由调用方给（rpc-manager 的 SESSION_SHUTDOWN_DEADLINE_MS），
   * 避免引擎依赖 rpc-manager 的域常量。
   */
  closingSessionWait(sessionId: string, deadlineMs: number): Promise<void> | null;

  // --- raw 注册表（rpc-manager 内部访问函数过渡用，逐步收敛）---
  /** rpc-manager 的 getRegistry() 委托目标。 */
  registry(): Map<string, H>;
  /** rpc-manager 的 getLocks() 委托目标。 */
  startLocks(): Map<string, StartLock<H>>;
  /** rpc-manager 的 getStartingSessionCwds() 委托目标。 */
  startingCwds(): Map<string, number>;
  /** rpc-manager 的 getRunningListeners() 委托目标。 */
  runningListeners(): Set<RunningSessionIdsListener>;
}

/**
 * 进程内实现：四个 Map/Set 收为私有字段，process 信号处理在构造时注册一次。
 *
 * exit → 同步 destroy（Node 无法在 exit handler 里 await，直接销毁
 * 扩展清理是最后的尽力而为）；
 * SIGINT/SIGTERM → allSettled shutdown。
 */
export class InProcessAgentEngine implements AgentEngine<AgentSessionWrapper> {
  private readonly sessions = new Map<string, AgentSessionWrapper>();
  private readonly startLockMap = new Map<string, StartLock>();
  private readonly startingCwdMap = new Map<string, number>();
  private readonly runningListenerSet = new Set<RunningSessionIdsListener>();
  /** 关闭中 wrapper 的 waitUntilDisposed 缓存（bounded，见 closingSessionWait）。 */
  private readonly closingWaits = new WeakMap<
    AgentSessionWrapper,
    { done: boolean; promise: Promise<void> }
  >();

  constructor() {
    const destroy = () => this.sessions.forEach((session) => session.destroy());
    const shutdown = () => {
      const all = Array.from(this.sessions.values());
      void Promise.allSettled(all.map((session) => session.shutdown()));
    };
    // Node cannot await work from an exit handler; direct destruction starts
    // extension cleanup synchronously as a final best effort.
    process.once("exit", destroy);
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }

  // --- session registry ---
  getSession(sessionId: string): AgentSessionWrapper | undefined {
    return this.sessions.get(sessionId);
  }
  setSession(sessionId: string, wrapper: AgentSessionWrapper): void {
    this.sessions.set(sessionId, wrapper);
  }
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
  sessionCount(): number {
    return this.sessions.size;
  }
  allSessions(): AgentSessionWrapper[] {
    return Array.from(this.sessions.values());
  }
  allEntries(): Array<[string, AgentSessionWrapper]> {
    return Array.from(this.sessions.entries());
  }

  // --- start locks ---
  getStartLock(sessionId: string): StartLock | undefined {
    return this.startLockMap.get(sessionId);
  }
  setStartLock(sessionId: string, lock: StartLock): void {
    this.startLockMap.set(sessionId, lock);
  }
  deleteStartLock(sessionId: string): void {
    this.startLockMap.delete(sessionId);
  }

  // --- starting cwds ---
  hasStartingCwd(cwd: string): boolean {
    return this.startingCwdMap.has(cwd);
  }
  trackStartingCwd(cwd: string, delta: 1 | -1): void {
    const remaining = (this.startingCwdMap.get(cwd) ?? 0) + delta;
    if (remaining <= 0) this.startingCwdMap.delete(cwd);
    else this.startingCwdMap.set(cwd, remaining);
  }

  // --- 会话启动协调 ---
  async startSession(
    sessionId: string,
    assembler: () => Promise<SessionStartResult>,
    options?: { shutdownDeadlineMs?: number },
  ): Promise<SessionStartResult> {
    const existing = this.sessions.get(sessionId);
    if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

    const inflight = this.startLockMap.get(sessionId);
    if (inflight) return inflight;

    const closingWait = this.closingSessionWait(sessionId, options?.shutdownDeadlineMs ?? DEFAULT_SHUTDOWN_DEADLINE_MS);
    if (closingWait) {
      // Concurrent starts share this lock, then the one start that follows it.
      const waiting: Promise<SessionStartResult> = closingWait.then(() => {
        if (this.startLockMap.get(sessionId) === waiting) this.startLockMap.delete(sessionId);
        return this.startSession(sessionId, assembler, options);
      });
      this.startLockMap.set(sessionId, waiting);
      return waiting;
    }

    const starting = (async () => assembler())().finally(() => {
      this.startLockMap.delete(sessionId);
    });
    this.startLockMap.set(sessionId, starting);
    return starting;
  }

  closingSessionWait(sessionId: string, deadlineMs: number): Promise<void> | null {
    const closing = this.sessions.get(sessionId);
    // A wrapper from before a hot reload may lack waitUntilDisposed.
    if (!closing || closing.isAlive() || typeof closing.waitUntilDisposed !== "function") return null;
    let wait = this.closingWaits.get(closing);
    if (!wait) {
      const entry = { done: false, promise: Promise.resolve() };
      entry.promise = closing
        .waitUntilDisposed(deadlineMs)
        .then((disposed) => {
          if (!disposed) {
            console.warn(`[pi-web] session ${sessionId} is still shutting down; starting it again anyway`);
          }
        })
        .finally(() => {
          entry.done = true;
        });
      this.closingWaits.set(closing, entry);
      wait = entry;
    }
    return wait.done ? null : wait.promise;
  }

  // --- running listeners ---
  addRunningListener(listener: RunningSessionIdsListener): void {
    this.runningListenerSet.add(listener);
  }
  removeRunningListener(listener: RunningSessionIdsListener): void {
    this.runningListenerSet.delete(listener);
  }
  runningListenerCount(): number {
    return this.runningListenerSet.size;
  }
  allRunningListeners(): RunningSessionIdsListener[] {
    return Array.from(this.runningListenerSet);
  }

  // --- raw 注册表 ---
  registry(): Map<string, AgentSessionWrapper> {
    return this.sessions;
  }
  startLocks(): Map<string, StartLock> {
    return this.startLockMap;
  }
  startingCwds(): Map<string, number> {
    return this.startingCwdMap;
  }
  runningListeners(): Set<RunningSessionIdsListener> {
    return this.runningListenerSet;
  }
}

declare global {
  var __piEngine: AgentEngine | undefined;
}

let cachedEngine: AgentEngine | undefined;

/** 单例。实例常驻 globalThis.__piEngine，跨模块热重载存活。 */
export function getEngine(): AgentEngine {
  if (!cachedEngine) {
    cachedEngine = globalThis.__piEngine ??= new InProcessAgentEngine();
  }
  return cachedEngine;
}