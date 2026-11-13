---
"pid": patch
---

会话运行时的跨进程层落地：`InProcessAgentEngine` 参数化后，`ProcessAgentEngine` 在 worker 子进程里起会话，主进程只保留 `RpcSessionHandle` 桩，启动协调协议（复用 / 并发合并 / closing-wait）与进程内实现共用。worker 侧仍是 mock，真 pi 会话在下一轮接入。
