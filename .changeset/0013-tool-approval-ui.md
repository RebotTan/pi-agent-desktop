---
"@agegr/pi-web": patch
---

Add the tool approval UI: a card above the composer appears when a policy rule holds a tool call for approval (allow / deny), and Settings › Tool approval edits the rule table (`pattern` → allow, ask, deny with `*` wildcards). The approval backend from the previous release is now reachable without curl.
