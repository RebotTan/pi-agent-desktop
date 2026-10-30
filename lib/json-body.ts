/**
 * 请求体解析。
 *
 * `req.json()` 在 body 不是合法 JSON 时会抛错。这个错误如果直接落进 route 的
 * 外层 `catch`，会被当成服务端故障报 500，但真正的原因是客户端发来的不是
 * JSON —— 应该是 400（ticket 0026）。
 *
 * 用法：
 * ```ts
 * const body = await readJsonBody<{ cwd?: string }>(req);
 * if (isJsonBodyError(body)) return body;
 * ```
 * 之所以返回 `Response` 而不是抛错误：各 route 的外层 `catch` 语义不同（有的
 * 记日志、有的在 `finally` 里收尾），提前 `return` 比让错误穿过这些分支更清楚。
 */
export async function readJsonBody<T>(req: Request): Promise<T | Response> {
  try {
    return (await req.json()) as T;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

/**
 * 判断 `readJsonBody` 返回的是错误响应。
 *
 * 用 `.status === 400 && ...` 之类的判断不可靠 —— 合法 body 也可能是任意对象。
 */
export function isJsonBodyError(value: unknown): value is Response {
  return value instanceof Response;
}
