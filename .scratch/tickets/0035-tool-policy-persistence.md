## 目标

审批规则（`pattern → allow | deny | ask`）落盘到 `~/.pi/agent/pi-web/settings.json` 的 `toolPolicyRules`，重启 PiD 后仍在。

原来只有 `InMemoryToolPolicyStore`，用户设的 `bash → ask` 关掉应用就没了 —— 而「工具有没有权限」是安全设置，每次重启都重设一遍等于没有。

## Seam

`lib/tool-policy.ts` 的 `ToolPolicyStore` 接口不变，新增 `FileToolPolicyStore` 实现，`getToolPolicyStore()` 单例换用它。

- `readToolPolicyRules(settingsPath?)` / `writeToolPolicyRules(rules, settingsPath?)` 走既有的 `lib/artifact-settings.ts`（`getPiWebSettingsPath` / `readStored` / `updatePiWebSettings`，后者用 `writePrivateFileAtomicSync` 原子写、保留其他 key）。
- 读写用同一个文件、同一个 key，所以 `artifactsPrompt`、`autoTitle` 等 PiD 自己的设置不会被覆盖。
- `InMemoryToolPolicyStore` 保留：`lib/approval-policy.test.mjs` 等测试用它，不碰磁盘。

## 验收标准

1. `new FileToolPolicyStore(path).addRule(...)` 后，新建实例能读回同样的规则（重启模拟）。
2. 写盘不丢 settings 里的其他 key（`artifactsPrompt` 等）。
3. `removeRule` 落盘；删不存在的 id 返回 `false`。
4. 坏 JSON、非数组、单条非法（缺 id / 缺 pattern / action 不是三值之一）→ 跳过而不是抛错、不让整个面板打不开。
5. 规则顺序保持：先加的规则先匹配（`decide` 语义不变）。
6. 写盘失败时内存回滚，向上抛错（不允许内存与文件分叉）。
7. `tsc --noEmit` 0 错；`npm run lint` 干净；`node --test lib/tool-policy.test.mjs lib/approval-policy.test.mjs` 全绿；fork 护栏 81/81。
8. dev 手测：Settings › Tool approval 加一条 `bash → Ask me` → 重启 dev server → 规则还在。

## Out-of-scope

- **不给规则加项目级作用域**。现在规则是全局的（一份 settings 文件）；按项目分文件需要决定 `cwd` 与 `project-trust` 的交互，留到有真实需求时再做。
- **不做「允许并记住」的会话内快捷操作**：审批卡上的 Allow 只结算当前这一次调用，不自动生成规则。
- **不改 `lib/approval-coordinator.ts`**（pending 表仍是内存态 —— 它是「进行中的请求」，本来就不该持久化）。
- **不迁移 `~/.pi/agent/settings.json`**（pi SDK 的文件），PiD 的设置一直隔离在自己的 `pi-web/settings.json`。
