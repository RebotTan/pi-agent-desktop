---
"@agegr/pi-web": patch
---

引入 AgentEngine 接口，把会话运行时状态从四个散落的 `globalThis` 容器收敛成一个显式引擎实例（`InProcessAgentEngine`）。纯重构，行为零变化。
