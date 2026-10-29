// ============================================================================
// WorkerProcessHost — 跨进程 worker 子进程的 spawn / 预热池 / stdio JSON-RPC
// ============================================================================
//
// 每个 worker 是一个独立的 Node 子进程，通过 stdio JSON-RPC 与主进程通信。
// 协议：
//   主进程 → worker: {type:"request",id,sessionId,method,params}
//   worker → 主进程: {type:"response",id,result|error}
//                    {type:"event",sessionId,event}
//                    {type:"ready"}（worker 启动完成）
//
// 预热池：容量 1、TTL 3min（参考 PiDeck standby 池思想）。空闲时提前 spawn 一个
// worker 等下次 startSession；spawn 参数（cwd/扩展根/模型/工具集）作为指纹，
// 指纹变化即丢弃预热 worker。

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_ENTRY = join(__dirname, "worker-process-main.mjs");
const PREWARM_TTL_MS = 3 * 60 * 1000;

export interface WorkerSpawnOptions {
  readonly cwd: string;
  readonly extensionRoots?: string[];
  readonly model?: string;
  readonly toolNames?: string[];
}

export interface WorkerProcess {
  readonly pid: number;
  isAlive(): boolean;
  send(message: Record<string, unknown>): void;
  onMessage(sessionId: string, handler: (message: Record<string, unknown>) => void): void;
  onExit(handler: () => void): void;
  kill(): void;
}

class WorkerProcessImpl implements WorkerProcess {
  readonly pid: number;
  private readonly proc: ChildProcess;
  private readonly messageHandlers = new Map<string, Set<(message: Record<string, unknown>) => void>>();
  private readonly exitHandlers = new Set<() => void>();
  private readyPromise: Promise<void>;
  private alive = true;

  constructor(proc: ChildProcess) {
    this.proc = proc;
    this.pid = proc.pid ?? -1;

    // 只用一个 readline 消费 stdout：」ready」检测与普通消息分发共用同一行缓冲。
    // 曾经额外挂 proc.stdout.on("data") 做 ready 检测，粘包时会漏掉 ready 消息。
    let settleReady: (() => void) | null = null;
    let rejectReady: ((error: Error) => void) | null = null;
    this.readyPromise = new Promise((resolve, reject) => {
      settleReady = resolve;
      rejectReady = reject;
    });
    const readyTimer = setTimeout(() => {
      rejectReady?.(new Error("Worker ready timeout"));
      proc.kill();
    }, 30_000);

    proc.on("exit", () => {
      this.alive = false;
      clearTimeout(readyTimer);
      rejectReady?.(new Error("Worker exited before ready"));
      for (const handler of this.exitHandlers) handler();
    });

    // 主进程读 worker stdout 的 JSON-RPC 消息
    const rl = createInterface({ input: proc.stdout! });
    rl.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.type === "ready") {
          clearTimeout(readyTimer);
          settleReady?.();
          return;
        }
        if (message.sessionId) {
          const handlers = this.messageHandlers.get(message.sessionId);
          if (handlers) for (const handler of handlers) handler(message);
        }
      } catch {}
    });
  }

  isAlive(): boolean {
    return this.alive && this.proc.exitCode === null;
  }

  async waitReady(): Promise<void> {
    return this.readyPromise;
  }

  send(message: Record<string, unknown>): void {
    if (!this.isAlive()) return;
    this.proc.stdin?.write(JSON.stringify(message) + "\n");
  }
  onMessage(sessionId: string, handler: (message: Record<string, unknown>) => void): void {
    let handlers = this.messageHandlers.get(sessionId);
    if (!handlers) {
      handlers = new Set();
      this.messageHandlers.set(sessionId, handlers);
    }
    handlers.add(handler);
  }

  onExit(handler: () => void): void {
    this.exitHandlers.add(handler);
  }

  kill(): void {
    this.alive = false;
    this.proc.kill();
  }
}

export class WorkerProcessHost {
  private prewarmed: { worker: WorkerProcessImpl; fingerprint: string; spawnedAt: number } | null = null;
  private prewarming: Promise<void> | null = null;
  /** 每次丢弃预热池就自增；在飞的预热拿旧代号回来会自己作废并杀进程。 */
  private generation = 0;

  async spawnWorker(options: WorkerSpawnOptions): Promise<WorkerProcess> {
    const fingerprint = JSON.stringify(options);
    const now = Date.now();

    if (
      this.prewarmed &&
      this.prewarmed.fingerprint === fingerprint &&
      now - this.prewarmed.spawnedAt < PREWARM_TTL_MS &&
      this.prewarmed.worker.isAlive()
    ) {
      const worker = this.prewarmed.worker;
      this.prewarmed = null;
      void this.prewarm(options); // 后台补一个预热
      await worker.waitReady();
      return worker;
    }

    this.discardPrewarmed();
    const worker = await this.spawnFresh(options);
    await worker.waitReady();
    void this.prewarm(options); // 启动后立即预热下一个
    return worker;
  }

  private async spawnFresh(options: WorkerSpawnOptions): Promise<WorkerProcessImpl> {
    const proc = spawn(process.execPath, [WORKER_ENTRY], {
      stdio: ["pipe", "pipe", "inherit"],
      cwd: options.cwd,
      env: {
        ...process.env,
        PI_WORKER_MODE: "1",
      },
    });
    return new WorkerProcessImpl(proc);
  }

  private async prewarm(options: WorkerSpawnOptions): Promise<void> {
    if (this.prewarmed || this.prewarming) return;
    const generation = this.generation;
    const task = this.runPrewarm(options, generation);
    this.prewarming = task;
    try {
      await task;
    } finally {
      if (this.prewarming === task) this.prewarming = null;
    }
  }

  private async runPrewarm(options: WorkerSpawnOptions, generation: number): Promise<void> {
    let worker: WorkerProcessImpl | null = null;
    try {
      worker = await this.spawnFresh(options);
      await worker.waitReady();
      // 预热期间被 discardPrewarmed() 作废：杀掉自己，不往池里写。
      if (generation !== this.generation) {
        worker.kill();
        return;
      }
      this.prewarmed = { worker, fingerprint: JSON.stringify(options), spawnedAt: Date.now() };
    } catch {
      // 预热失败不阻塞主流程，但已经 spawn 出来的子进程必须杀掉，否则泄漏。
      worker?.kill();
    }
  }

  /** 测试与关闭用：杀掉预热池里的 worker，让进程能退出。 */
  discardPrewarmed(): void {
    this.generation += 1;
    if (this.prewarmed) {
      this.prewarmed.worker.kill();
      this.prewarmed = null;
    }
  }

  /** 测试与关闭用：等异步预热结束（如果有），让进程能退出。 */
  async settlePrewarm(): Promise<void> {
    while (this.prewarming) await this.prewarming;
    this.discardPrewarmed();
  }
}

declare global {
  var __piWorkerProcessHost: WorkerProcessHost | undefined;
}

let cachedHost: WorkerProcessHost | undefined;

export function getWorkerProcessHost(): WorkerProcessHost {
  if (!cachedHost) {
    cachedHost = globalThis.__piWorkerProcessHost ??= new WorkerProcessHost();
  }
  return cachedHost;
}
