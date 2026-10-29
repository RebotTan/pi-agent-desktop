---
"pid": patch
---

Drop the unused `files.session_id` column from the search index (migrating an existing cache in place), prepare the FTS delete statement once per file, and let `SqliteSessionStore` inherit the three read methods it only ever forwarded to the filesystem store.
