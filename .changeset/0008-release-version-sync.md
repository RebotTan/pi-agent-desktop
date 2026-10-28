---
"@agegr/pi-web": patch
---
修复发版阻塞：`pi-agent-desktop-package.json` 与 `src-tauri/Cargo.toml` 的 version 从上游遗留的 0.7.7 同步到 0.10.1（避免 tag 撞上游 v0.7.7）；`release-component-pins.json` 的 pi-web pin 从 0.10.0 升到 0.10.1（fork 自有版本线，落后上游 agegr/pi-web 0.12.2 是有意选择）。`release:verify` 现通过。
