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
// - waitUntilReady / beginExtensionBinding / evictIfDiskAhead 对 RPC 桩是 no-op
//   （这些是主进程本地的扩展绑定与磁盘检查，worker 侧不需要）。

import type { AgentEvent } from "./rpc-manager";
import type { EventListener, SessionHandle } from "./session-handle";
import type { WorkerProcess } from "./worker-process-host";

let nextRequestId = 1;

export interface RpcSessionHandleOptions {
  readonly sessionId: string;
  readonly cwd: string;
  readonly chatOnly?: boolean;
  readonly chatWorkspace?: boolean;
  readonly chatUnlocked?: boolean;
  readonly suppressCompletionNotifications?: boolean;
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
  private readonly policy: Required<Omit<RpcSessionHandleOptions, "sessionId" | "cwd">>;

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
    void this.request("session.start", {
      cwd: this.cwd,
      chatOnly: this.policy.chatOnly,
      chatWorkspace: this.policy.chatWorkspace,
      chatUnlocked: this.policy.chatUnlocked,
    })
      .then((result) => {
        const realSessionId = (result as { realSessionId?: unknown } | undefined)?.realSessionId;
        if (typeof realSessionId === "string" && realSessionId) this.realSessionId = realSessionId;
      })
      .catch((error) => {
        console.error(`[sidecar] start failed for ${this.sessionId}:`, error);
      });
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
