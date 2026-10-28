---
"@agegr/pi-web": patch
---
补 PR-5 事件总线的 `session_ended` 端到端测试（code-review 留的 partial）：注册 wrapper 时 emit `session_started`，destroy 时 emit `session_ended`。
