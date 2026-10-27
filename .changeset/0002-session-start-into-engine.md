---
"@agegr/pi-web": patch
---

把 `startRpcSession` 的并发协调协议（existing 复用 / inflight 合并 / closing-wait 排队 / start lock 管理）收进 `AgentEngine.startSession`，会话装配留在 rpc-manager 作为 assembler 回调。纯重构，行为零变化；SidecarEngine / RemoteEngine 将来可复用同一启动协议。
