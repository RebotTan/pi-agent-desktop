---
"@agegr/pi-web": patch
---
裁剪发版平台：`release.yml` 删 macOS（aarch64-apple-darwin）和 deb bundle，只保留 Windows nsis 和 Linux rpm；同步删依赖 macOS DMG 的 homebrew cask job 和 `Require the macOS 26 SDK` 步骤；`release-workflows.test.mjs` 断言同步更新。
