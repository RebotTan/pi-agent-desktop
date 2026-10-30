# 0027 · 全部 route 的坏请求体返回 400

## 目标

`req.json()` 解析失败时，错误被 route 外层 `catch` 吞成 500。统一改成 400。

## 症状

```
POST /api/skills/search  body='{"broken":'  → 500
POST /api/cwd/validate   body='{"broken":'  → 500
（共 30 个 route 同样）
```

## Seam

新增 `lib/json-body.ts`：
- `readJsonBody<T>(req): Promise<T | Response>` —— 解析失败返回 400 响应而不是抛错
- `isJsonBodyError(value): value is Response` —— 类型守卫

返回 `Response` 而不是抛错误，是为了让各 route 在外层 `catch`/`finally` 之前提前 `return`，不改变它们原有的收尾逻辑。

## 改法的两个形态

```ts
// 普通形态
const body = await readJsonBody<{ cwd?: unknown }>(req);
if (isJsonBodyError(body)) return body;

// 解构形态（多一个中转变量，避免和已有 `body` 撞名）
const parsedBody = await readJsonBody<{ name?: string }>(req);
if (isJsonBodyError(parsedBody)) return parsedBody;
const { name } = parsedBody;
```

## 验收

1. `tsc --noEmit` 通过
2. `npm run lint` 无问题
3. 10 个代表性接口的坏 body 全部 400（`plugins` / `skills/search` / `skills/install` / `cwd/validate` / `models-config/discover` / `scheduled-tasks/preview` / `plugins/search` / `worktrees` / `subagents/profiles` / `agent/new`）
4. **合法请求未回归**：`cwd/validate` 200、`plugins/search` 200（返回 2 条）、`scheduled-tasks/preview` 200、`agent/new` 200
5. fork 护栏 63/63

## Out-of-scope

11 个 route 保留原样，它们本来就是对的，统一到 helper 只为「写法一致」而增加风险：
- `appearance/fonts`、`terminal/settings` —— 消息是 `Invalid JSON` 且有独立的 415 content-type 检查
- `mcp/route`、`mcp/sign-in/[flowId]`、`tools/settings` —— 走 `refusal()`，响应结构不同
- `models/default`、`models/enabled`、`push/subscribe` —— 已是内层 try + 400
- `plugins/route` —— ticket 0026 已手工改
- `chat-settings` —— 已有内层 try，且 `validateChatSettingsPatch` 自己抛错给 400
- `project-trust` —— 有意把坏 body 当作「没给 cwd」（`.catch(() => null)`），语义不同
