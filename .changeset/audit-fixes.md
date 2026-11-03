---
"pid": patch
---

修复审计发现的 4 个问题：AgentEngine 接口泄漏内部注册表、SQLite 会话扫描单行损坏丢整条会话、relay forgetSession 重复触发 onChange、relay 测试未等 connector 清理 idle session 导致间歇失败。
