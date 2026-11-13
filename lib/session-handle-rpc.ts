// ============================================================================
// RpcSessionHandle — 跨进程 worker 会话的 JSON-RPC 桩
// ============================================================================
//
// 实现 SessionHandle，把 send/onEvent/shutdown/destroy 等调用通过 stdio JSON-RPC
// 转发给 worker 子进程。事件由子进程推流，主进程在这里分发给本地 listener。
//
// 与主进程包装器的差异：
// - isChat* / hasSuppressedCompletionNotifications / getPendingPromptPreview 等
//   策略谓词在跨进程侧是静态属性（启动时由 assembler 传入），不是每次 RPC 查询。
// - waitUntilReady 等 start 的 RPC 回来再问 worker（worker 侧要跑一遍真装配，
//   不是毫秒级）；beginExtensionBinding / evictIfDiskAhead 是主进程本地的扩展绑定
//   与磁盘检查，worker 侧不需要，保持 no-op。

import type { AgentEvent } from "./rpc-manager";
import type { EventListener, SessionHandle, SessionModelLookup, SessionReadView } from "./session-handle";
import type { WorkerProcess } from "./worker-process-host";

/** 跨进程侧尚未实现的方法：抛错，绝不返回假值让调用方当作「功能已支持」。 */
function notYetAvailable(method: string): Error {
  return new Error(`RpcSessionHandle.${method}() is not available until the worker snapshot channel lands (P2)`);
}

let nextRequestId = 1;

export interface RpcSessionHandleOptions {
  readonly sessionId: string;
  readonly cwd: string;
  readonly chatOnly?: boolean;
  readonly chatWorkspace?: boolean;
  readonly chatUnlocked?: boolean;
  readonly suppressCompletionNotifications?: boolean;
  /** 原样转发给 worker 的 session.start 参数（sessionFile / toolNames / initialModel…）。 */
  readonly startParams?: Record<string, unknown>;
}

export class RpcSessionHandle implements SessionHandle {
  readonly sessionId: string;
  readonly cwd: string;
  private readonly worker: WorkerProcess;
  private readonly listeners = new Set<EventListener>();
  private readonly destroyCallbacks = new Set<() => void>();
  private readonly pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private alive = true;
  private running = false;
  private destroyEmitted = false;
  private realSessionId: string | null = null;
  private startPromise: Promise<unknown> = Promise.resolve();
  private readonly policy: {
    chatOnly: boolean;
    chatWorkspace: boolean;
    chatUnlocked: boolean;
    suppressCompletionNotifications: boolean;
  };
  private readonly startParams: Record<string, unknown>;

  constructor(worker: WorkerProcess, options: RpcSessionHandleOptions) {
    this.worker = worker;
    this.sessionId = options.sessionId;
    this.cwd = options.cwd;
    this.policy = {
      chatOnly: options.chatOnly ?? false,
      chatWorkspace: options.chatWorkspace ?? false,
      chatUnlocked: options.chatUnlocked ?? false,
      suppressCompletionNotifications: options.suppressCompletionNotifications ?? false,
    };
    this.startParams = { ...options.startParams };
    worker.onMessage(this.sessionId, (message) => this.handleWorkerMessage(message as { type: string; id?: number; event?: AgentEvent; result?: unknown; error?: { message: string } }));
    worker.onExit(() => this.handleWorkerExit());
  }

  // --- SessionHandle ---

  isAlive(): boolean {
    return this.alive && this.worker.isAlive();
  }

  isRunning(): boolean {
    return this.running;
  }

  /** 当前会话在 worker 里的真实 id（start 之前等于本地 id）。 */
  getRealSessionId(): string {
    return this.realSessionId ?? this.sessionId;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    return this.request("send", command);
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    if (!this.isAlive()) return Promise.reject(new Error("Session is not alive"));
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker.send({
        type: "request",
        id,
        sessionId: this.sessionId,
        method,
        params,
      });
    });
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onDestroy(cb: () => void): void {
    this.destroyCallbacks.add(cb);
  }

  start(): void {
    const startRequest = this.request("session.start", {
      cwd: this.cwd,
      ...this.startParams,
      chatOnly: this.policy.chatOnly,
      chatWorkspace: this.policy.chatWorkspace,
      chatUnlocked: this.policy.chatUnlocked,
    }).then((result) => {
      const realSessionId = (result as { realSessionId?: unknown } | undefined)?.realSessionId;
      if (typeof realSessionId === "string" && realSessionId) this.realSessionId = realSessionId;
    });
    // 记日志但不吞错：start 失败时 waitUntilReady 要把它抛给调用方，而不是去问一个不存在的会话。
    startRequest.catch((error) => {
      console.error(`[sidecar] start failed for ${this.sessionId}:`, error);
    });
    this.startPromise = startRequest;
  }

  async shutdown(): Promise<void> {
    await this.request("shutdown");
  }

  destroy(): void {
    if (this.destroyEmitted) return;
    // 必须在 alive 置 false 之前发：request() 的活体守卫会把关闭后的调用拦住。
    // 且不能走 pendingRequests —— 下面要立刻把挂起的请求全部 reject。
    if (this.alive && this.worker.isAlive()) {
      this.worker.send({
        type: "request",
        id: nextRequestId++,
        sessionId: this.sessionId,
        method: "destroy",
        params: { type: "destroy" },
      });
    }
    this.alive = false;
    this.failPending(new Error("Session destroyed"));
    this.emitDestroy();
  }

  async waitUntilDisposed(_timeoutMs: number): Promise<boolean> {
    // RPC 桩的 dispose 由 worker 进程退出或 destroy 命令完成；
    // 这里轮询 isAlive 直到超时（简单实现，避免给 worker 加 dispose 事件）。
    const deadline = Date.now() + _timeoutMs;
    while (Date.now() < deadline) {
      if (!this.isAlive()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return !this.isAlive();
  }

  async waitUntilReady(): Promise<void> {
    await this.startPromise;
    await this.request("wait_until_ready");
  }

  beginExtensionBinding(): void {
    // 主进程本地扩展绑定，worker 侧由 worker 自己处理。
  }

  evictIfDiskAhead(): boolean {
    return false;
  }

  // --- 策略谓词（启动时传入的静态值）---

  isChatOnly(): boolean {
    return this.policy.chatOnly;
  }

  isChatWorkspace(): boolean {
    return this.policy.chatWorkspace;
  }

  isChat(): boolean {
    return this.policy.chatOnly || this.policy.chatWorkspace;
  }

  isChatUnlocked(): boolean {
    return this.policy.chatUnlocked;
  }

  hasSuppressedCompletionNotifications(): boolean {
    return this.policy.suppressCompletionNotifications;
  }

  getPendingPromptPreview(): { text: string; timestamp: number } | null {
    return null;
  }

  // P1 阶段不提供服务端快照通道：抛错而不是返回空 manager/空标题，误用会立刻
  // 暴露，而不是让 HTTP 读到一个假的空会话。P2 的 IPC 快照回执实现这三个方法。
  readSession(): SessionReadView {
    throw notYetAvailable("readSession");
  }

  generateTitle(): Promise<{ title: string; usage?: unknown }> {
    return Promise.reject(notYetAvailable("generateTitle"));
  }

  modelLookup(): SessionModelLookup | undefined {
    throw notYetAvailable("modelLookup");
  }

  // --- 内部 ---

  private handleWorkerMessage(message: { type: string; id?: number; event?: AgentEvent; result?: unknown; error?: { message: string } }): void {
    if (message.type === "event" && message.event) {
      if (message.event.type === "agent_start") this.running = true;
      if (message.event.type === "agent_end" || message.event.type === "agent_settled") this.running = false;
      for (const listener of this.listeners) listener(message.event);
      return;
    }
    if (message.type === "response" && message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) return;
      this.pendingRequests.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    }
  }

  private handleWorkerExit(): void {
    this.alive = false;
    this.failPending(new Error("Worker process exited"));
    this.emitDestroy();
  }

  private failPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) pending.reject(error);
    this.pendingRequests.clear();
  }

  private emitDestroy(): void {
    if (this.destroyEmitted) return;
    this.destroyEmitted = true;
    for (const cb of this.destroyCallbacks) cb();
  }
}
