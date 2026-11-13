// ============================================================================
// SessionHandle — AgentEngine 语义方法所操作的最小会话接口
// ============================================================================
//
// 背景：AgentEngine 的方法签名直接引用具体类 AgentSessionWrapper（rpc-manager），
// 跨进程 worker 只有一个 JSON-RPC 桩，无法构造真实实例。本接口抽出调用方实际
// 需要的最小方法集；主进程包装器（AgentSessionWrapper）与 RPC 桩（RpcSessionHandle）
// 都实现它。
//
// 为什么最小：SessionHandle 是「跨进程能支持」与「InProcess 已使用」的交集。
// 像 setActiveToolSelection 这类需要本进程 SDK 状态的方法，跨进程 worker 通过
// send({type:"set_tools",...}) 命令完成，不暴露在 handle 上。

import type { AgentEvent } from "./rpc-manager";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

/**
 * 只读会话视图：HTTP 读路径需要的全部读取方法。
 *
 * SDK 内部有同形状的 `ReadonlySessionManager`，但包没有 re-export 它；这里用
 * `Pick` 拿到同一份方法签名，跨进程侧的缓存快照也只需实现这几个方法。
 */
export type SessionReadView = Pick<
  SessionManager,
  "getCwd" | "getSessionId" | "getSessionFile" | "getLeafId" | "getEntry" | "getHeader" | "getEntries" | "getTree" | "getSessionName"
>;

/**
 * 计价用的模型查找（`NoticeModelLookup` 的结构等价物）。
 *
 * 只读 `cost.cacheRead`：缓存命中/miss 通知要按当时价格折算金额。本地实现返回
 * 运行时的 modelRuntime；跨进程侧由 worker 提供同一查询。
 */
export interface SessionModelLookup {
  getModel(provider: string, modelId: string): { cost?: { cacheRead?: number } } | undefined;
}

export type EventListener = (event: AgentEvent) => void;

export interface SessionHandle {
  // --- 身份 ---
  readonly sessionId: string;
  readonly cwd: string;

  // --- 生命周期 ---
  start(): void;
  shutdown(): Promise<void>;
  destroy(): void;
  waitUntilDisposed(timeoutMs: number): Promise<boolean>;
  waitUntilReady(): Promise<void>;
  beginExtensionBinding(): void;
  evictIfDiskAhead(): boolean;
  isAlive(): boolean;
  isRunning(): boolean;

  // --- 通信 ---
  send(command: Record<string, unknown>): Promise<unknown>;
  onEvent(listener: EventListener): () => void;
  onDestroy(cb: () => void): void;

  // --- 策略谓词 ---
  // 本地实现是权威值。RPC 桩必须给出与本地一致的结果；尚未实现时返回的固定值
  // 只服务于开发期测试，出现在生产路径上即为缺陷，不能当作「功能已支持」。
  isChatOnly(): boolean;
  isChatWorkspace(): boolean;
  isChat(): boolean;
  isChatUnlocked(): boolean;
  hasSuppressedCompletionNotifications(): boolean;
  getPendingPromptPreview(): { text: string; timestamp: number } | null;

  // --- 只读会话内容 ---
  // HTTP 读路径（GET 会话、分页上下文、fork 的 leaf、统计、引用）必须看见
  // 未落盘的内存状态：pi 直到第一条 assistant 消息才首次 flush，盲读磁盘会
  // 得到空会话。因此由会话自己给出视图，父进程不再直接拿 SessionManager。
  // 本地实现返回运行中的 manager；跨进程侧返回缓存的最近快照（P2）。
  readSession(): SessionReadView;

  // --- 需要在会话内完成的动作 ---
  // 生成标题要用该会话自己的模型与凭证，调用方不持有 SDK 会话。
  generateTitle(): Promise<{ title: string; usage?: unknown }>;
  /** 计价用的模型查找；没有运行时（纯磁盘视图）时为 undefined。 */
  modelLookup(): SessionModelLookup | undefined;
}
