// ============================================================================
// AgentEventBus — 引擎级事件总线（PR-5）
// ============================================================================
//
// 「一处发出、多订阅」的中间层：引擎/会话生命周期事件在这里发，订阅者
// （running SSE、全局事件 SSE、将来的通知/审计/webhook）各自订阅，互不干扰。
// lib/rpc-manager.ts 是唯一 emit 方；订阅方在 app/api/** 路由。
//
// 事件粒度目前是引擎级（会话启动/销毁/running 变化），消息级事件
// （agent_end/tool_call...）的桥接在后续 PR（见
// .scratch/tickets/0005-agent-event-bus.md 的 Out-of-scope）。
//
// 单例挂在 globalThis.__piAgentEventBus（HMR 纪律，同 __piEngine）。
export type AgentEngineEvent =
  | { type: "running_changed"; ids: string[] }
  | { type: "session_started"; sessionId: string }
  | { type: "session_ended"; sessionId: string };

export type AgentEngineEventListener = (event: AgentEngineEvent) => void;

export class AgentEventBus {
  private listeners = new Set<AgentEngineEventListener>();

  /** 订阅所有引擎事件。返回取消函数。 */
  subscribe(listener: AgentEngineEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 广播一个事件。单个订阅者抛错不影响其余订阅者。 */
  emit(event: AgentEngineEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // 订阅者错误隔离：一个坏的订阅者不炸总线。
      }
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

declare global {
  var __piAgentEventBus: AgentEventBus | undefined;
}

let cached: AgentEventBus | undefined;

/** 单例。实例常驻 globalThis.__piAgentEventBus，跨模块热重载存活。 */
export function getAgentEventBus(): AgentEventBus {
  if (!cached) {
    cached = globalThis.__piAgentEventBus ??= new AgentEventBus();
  }
  return cached;
}