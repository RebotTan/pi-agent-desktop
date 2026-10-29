---
"pid": patch
---

Mirror `compactionCount` in the SQLite session store (with an in-place schema migration that rebuilds the cache) and make `resetSessionStore()` close the store it held so the SQLite connection is released instead of leaking on every hot reload.
