---
"pid": patch
---

Add SqliteSessionStore as an opt-in SessionStore implementation (PI_SESSION_STORE=sqlite) that mirrors session list metadata into SQLite, so listing skips re-parsing changed JSONL headers and with `allowStale` skips the directory scan entirely; project info is cached with a 5-minute TTL.
