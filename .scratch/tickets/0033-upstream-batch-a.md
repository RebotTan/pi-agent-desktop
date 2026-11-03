# 0033 · 上游批次 A 合并（relay）

## 目标

把上游 `abcwyc/pi-agent-desktop` 的端到端加密中继合进 fork —— 这正是「手机在任何地方发 prompt / 批准工具调用」的核心能力。移植 A 批 15 个 commit。

## Seam

`dev` 分支 + 全套验收（tsc / lint / lib + components + relay 测试 / fork 护栏 / dev 手测）。

## 合并的 commit（15，按时间正序）

| commit | 内容 |
|---|---|
| `05f73559` | 设计文档 `docs/remote-relay.md`（124 行） |
| `95ddbf64` | Noise IK + IKpsk2 跑在 WebCrypto 上（3 文件 588 行） |
| `37a012e6` | relay 服务器 + 隧道帧格式（7 文件 748 行） |
| `7d055fdf` | 桌面 relay connector + 手机 tunnel client（10 文件 1575 行，新依赖 `@radix-ui/react-select` + `qrcode-generator`） |
| `e56c6734` | 接入 server：boot / proxy / guards / routes / push（16 文件） |
| `932803d7` | 手机 shell + tunnel service worker（8 文件） |
| `deb85557` | Settings › General › Remote relay（4 文件 448 行） |
| `9feee1ca` | Chromium + WebKit 端到端验证，修两个 shell bug |
| `3af76a63` | 文档 + 打包 + 护栏（新增 8 项 fork 断言） |
| `b92e4a3b` | 未认证手机改为限流而非锁死 |
| `4ab90f9b` | review 修复：desktop / crypto / relay |
| `16dc9a0c` | review 修复：shell |
| `a4be865b` | 补 2 个 mutation testing 找出的未覆盖检查 |
| `324b1091` | relay-shell 测试进 `npm test` |
| `5c6c9041` | `/api/relay` 返回异常时 Settings 不崩 |

## 冲突与处理

| 文件 | 处理 |
|---|---|
| `package.json` | 保 fork 的 `changeset` / `version` / `release:notes` / `release:verify` / `test:e2e`，并入上游新增的 `relay:shell` 与 `relay/**` `relay-shell/**` 测试路径；dependencies 加 `@radix-ui/react-select@^2.3.8`（上游已按字母序排在首位，冲突块里的重复项已去掉）+ `qrcode-generator@2.0.4` |
| `package-lock.json` | 取上游 + `npm install` 重算 |
| `app/native-theme.css` | 上游 relay/phone CSS 在前、fork 五段在后；补回被 merge 切掉的 `.relay-devices > .settings-option-hint` 的闭合 `}`（花括号 0/0 平衡，11105 行） |
| `lib/i18n/locale-plugins.ts` | 取上游（2477 行，含 `relay.*` 45 个新 key），再把 `connection.offline` 三语换回 fork 的 "PiD server" 文案，并补回上游版本里缺失的 `settings.autoTitle` / `settings.autoTitleHint` / `settings.autoTitleFailed`（`components/ArtifactsSettingRow.tsx:32-34` 在用，只有本文件定义） |

## 验收标准

- [x] `tsc --noEmit` 0 错
- [x] `npm run lint` → `ESLint: No issues found`
- [x] `node --test lib/*.test.mjs` → 1974 tests / 1933 pass / 0 fail
- [x] `node --test components/*.test.mjs` → 826 pass / 0 fail
- [x] `node --test relay/*.test.mjs relay-shell/*.test.mjs` → 17 pass / 0 fail
- [x] fork 护栏 **81/81**（relay 新增 8 项断言，从 73 涨到 81）
- [x] dev 手测：`GET /api/relay` → `{"local":true,"config":null,"status":{"state":"off","agentId":"","phones":0},"devices":[],"pending":[]}`；Settings › General 出现 "Remote relay" 段（标题 + 说明 + "Connect to the relay" + `Relay server (wss://)` + `Relay admin token`），无横向溢出，无 console 错误

## 未验证

- relay 真实连通（需要一个在线的 wss relay server + 手机扫码配对），本地只验证了 UI 与 REST 契约。
- `relay-shell` 构建产物（`npm run relay:shell`）未跑。

## Out-of-scope

- 批次 C：pi SDK 1.4 → 1.5.0（`pi-ai` 不再 re-export TypeBox，需新增 `typebox` 直接依赖 pin 1.3.27）
