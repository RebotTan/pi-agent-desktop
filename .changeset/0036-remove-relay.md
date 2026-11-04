---
"pid": patch
---

Remove the end-to-end encrypted relay: the feature was a design error (Tailscale Remote access already covers the same need). Deletes relay/, relay-shell/, lib/relay/, app/api/relay/, components/RelaySection.tsx, docs/remote-relay*.md, e2e/relay.mjs, scripts/build-relay-shell.mjs, and strips relay wiring from proxy.ts, instrumentation-node.ts, lib/remote-access.ts, lib/desktop-api-auth.ts, lib/web-push.ts, app/api/push/subscribe/route.ts, components/SettingsPanel.tsx, components/PwaRegistration.tsx, lib/i18n/locale-plugins.ts, app/native-theme.css, package.json, eslint.config.mjs, scripts/fork-ownership.json, scripts/release-workflows.test.mjs, components/fork-extractions.test.mjs, lib/web-push.test.mjs, lib/remote-access.test.mjs, AGENTS.md, docs/fork-roadmap.md. Tailscale Remote access is unaffected.
