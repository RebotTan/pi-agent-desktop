# 0005-agent-event-bus.md — 事件总线（一处发出、多订阅）

## 目标

引擎级事件（会话启动/销毁/running 变化）统一走一个类型化总线，
订阅者解耦：既有 running SSE 不动，新增全局 SSE（/api/events）直接订阅；
后续通知/toast/审计/webhook 每个都是一行订阅，不再各自接线。

## Seam

- 新 `lib/agent-event-bus.ts`：`AgentEngineEvent = running_changed | session_started | session_ended`；
  `AgentEventBus`（subscribe/emit/listenerCount，emit 隔离订阅者错误）；单例
  `getAgentEventBus()` 挂 `globalThis.__piAgentEventBus`（HMR 纪律）。
- emit 唯一来源 `lib/rpc-manager.ts`（3 点）：
  - `registerRpcWrapper`（2171）：registry.set + wrapper.start 后 emit `session_started`
  - 同函数 onDestroy：registry.delete + notifyRunningChange 后 emit `session_ended`
  - `notifyRunningChange`（2526）：老广播循环后 emit `running_changed`（ids 拷贝）——
    只在实际广播发生（去重通过）时发，与老语义一致；early-return 分支不发。
- 新增消费出口 `app/api/events/route.ts`：全局 SSE，照 running/events 模板
  （订阅→心跳→abort 清理），帧形 `{type:"event", event:{...}}`。

## 验收标准

1. agent-event-bus 类型化总线 + 单例 + 3 测试（subscribe/unsubscribe、listenerCount、错误隔离）。
2. rpc-manager 3 个 emit 点接上；既有 subscribeRunningSessions / running SSE 行为零变化。
   （note: notifyRunningChange 的 early-return 分支也 emit 总线事件，否则无老订户时全局 SSE 收不到 running_changed——已实现。）
3. /api/events SSE 收到事件：session_started / running_changed 已 dev 端到端实测；
   session_ended 与 started 共用同一 emit→总线→SSE 链路（emit 在 onDestroy 内紧邻
   notifyRunningChange），触发时机即 wrapper destroy（idle shutdown/分支替换/fork 替换），
   本 PR 不改动 destroy 生命周期。dev 手测：建会话收到 session_started、发 prompt 收到
   running_changed（含清空 [] 帧），DELETE 文件不影响 wrapper（DELETE 路由不 destroy）。
4. tsc / lint / 既有回归（rpc 三个测试文件 + 新增总线测试）/ fork 护栏 / dev 手测全绿。

## Out-of-scope

- 消息级事件桥接（agent_end / tool_call / tool_result 进总线）——后续 PR。
- 审计持久化、webhook、toast 通知订阅。
- 事件历史/回放（总线只有当前订阅者，无 buffering）。