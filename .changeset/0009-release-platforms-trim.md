---
"@agegr/pi-web": patch
---
裁剪发版执行平台：`release.yml` 的 build job 加 `if: matrix.target != 'aarch64-apple-darwin'` 跳过 macOS，Linux 只打 rpm（去掉 deb），homebrew job 加 `if: false` 暂停（依赖 macOS DMG）。macOS matrix entry、SDK 检查、homebrew 配置全部保留在 yml 里，将来恢复只需删两个 `if` 守卫。`release-workflows.test.mjs` 断言同步更新。
