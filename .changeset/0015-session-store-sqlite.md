---
"pid": patch
---

Add SqliteSessionStore as an opt-in SessionStore implementation (PI_SESSION_STORE=sqlite) that mirrors session list metadata into SQLite, so listing avoids enumerating and statting every JSONL file; project info is cached with a 5-minute TTL.
