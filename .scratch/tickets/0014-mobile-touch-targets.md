# 0014 · 移动端触摸目标（LAN / 手机访问）

## 目标

让手机在局域网连上后，拇指能稳定点中「批准 / 拒绝工具调用」和「登录」。

前提是勘误：roadmap 里原写的「#10 Web 鉴权层」不存在待做项 —— pi-web 上游
已经具备完整的密码鉴权（`lib/web-auth.ts` + `proxy.ts` middleware + `/login`
页面 + `lib/auth-throttle.ts` 限速 + `bin/network-exposure-warning.js` 无密码时
拒绝监听非 loopback）。真正的缺口是**控件尺寸**：桌面尺寸的按钮在 390px 宽的
手机上低于 44px 可点范围。

## Seam

`app/native-theme.css` 末尾的 `@media (max-width: 640px)` 块。

断点与 `hooks/useIsMobile.ts` / `app/globals.css` 保持一致。样式只加不覆盖
桌面端（桌面上这些规则全部不生效），`app/globals.css` 与 `app/settings.css`
仍与上游字节一致。

## 实测基线（390×844 mobile emulation，改动前）

| 目标 | 改动前 | 改动后 |
|---|---|---|
| 审批卡「拒绝 / 允许」 | 约 26px 高 | 162×44，两按钮等宽铺满 |
| 登录页密码框 | 232×30 | 232×40 |
| 登录页登录按钮 | 89×34 | 89×40 |
| 规则编辑器输入 / 按钮 | 30px 高 | 40px 高 |

已合格的项（不动）：textarea 16px（iOS 不触发缩放）、`.msg-rail-row` 34px
（900px 断点）、`viewport-fit=cover` + `interactive-widget=resizes-content`、
无横向溢出、侧边栏抽屉 `translateX(-292px)` 正常滑出。

## 验收标准

1. `node_modules/.bin/tsc --noEmit` 通过
2. `npm run lint` 通过
3. `node --test scripts/upstream-css-baseline.test.mjs` 通过（globals.css 未被改动）
4. `node --test scripts/fork-ownership.test.mjs components/fork-extractions.test.mjs` 通过
5. `node --test scripts/ui-menu-consistency.test.mjs` 通过（未新增原生 select）
6. 390×844 实测：审批卡按钮 ≥44px 高、登录页控件 ≥40px 高、无横向溢出
7. 桌面宽度（≥641px）实测：以上规则的尺寸与改动前一致

## Out-of-scope

- 侧边栏 22–28px 图标按钮（`sidebar-chrome-button` 等）：数量多、改动面大，
  且不是手机端核心路径，留后续
- composer 的 Send / Add files（36px）：接近阈值，上游尺寸，暂不动
- 审批超时自动拒绝、允许并记住该工具
- 按 `sessionId` 过滤 pending（code-review 记的前置风险，等多端并发真正出现再做）
- 真机 iOS Safari 验证（本工单只做 Chrome mobile emulation）
