---
"pid": patch
---

修复代码审查发现的四个真实缺陷：SQLite 存储解析 fork 关系、sidecar 句柄把 destroy/响应送达 worker、预热池失败时杀进程、running_changed 在事件总线上独立去重。
