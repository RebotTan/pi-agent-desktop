---
"pid": patch
---

Add SidecarEngine as a second AgentEngine implementation that delegates to the in-process engine by default, proving the interface can carry a second implementation before any cross-process isolation work starts.
