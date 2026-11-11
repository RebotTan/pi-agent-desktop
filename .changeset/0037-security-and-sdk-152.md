---
"pid": patch
---

Close the remote-access password bypass through the shipped `previewModeId`, and upgrade the bundled pi SDK to 1.5.2. Next skipped `proxy.ts` for any request whose `x-prerender-revalidate` header matched the build's previewModeId — a value every installer ships and anyone can read — so with Tailscale or LAN mode on the password gate and Host/Origin checks could be skipped. The desktop launcher now strips that header and rewrites the three preview secrets on every start. The SDK upgrade pins all eight `@earendil-works/pi-*` packages at 1.5.2 (upstream does the same; 1.5.x does not hold across minors) and follows 1.5.1's move of `McpSignInCancelledError` into `pi-mcp` plus sign-in's new per-server refresh lock.