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
}
