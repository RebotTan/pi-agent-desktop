---
"@agegr/pi-web": patch
---
发版说明改为从 `CHANGELOG.md` 生成：新增 `scripts/release-notes.mjs`（`npm run release:notes`），按版本号提取 changesets 写的段落并追加内置组件版本行。`release.yml` 的 `releaseBody` 从写死的 0.7.7 中英文公告改成占位符，真实说明由 manifest job 在发布前用 `gh release edit --notes-file` 写入，从此发版说明自动跟随版本。
