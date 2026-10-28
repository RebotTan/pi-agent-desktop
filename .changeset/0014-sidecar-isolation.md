---
"pid": patch
---

Add SessionHandle interface and cross-process worker scaffolding (RpcSessionHandle, WorkerProcessHost, worker entry) so SidecarEngine can later spawn real worker processes; the skeleton already proves the AgentEngine interface carries a second implementation.
