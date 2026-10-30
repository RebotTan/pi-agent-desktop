// ============================================================================
// 声明式 UI 贡献（ticket 0023）
// ============================================================================
//
// 已安装的 pi package 在 package.json 的 `pi.ui` 里声明卡片，PiD 的 Plugins
// 设置页把卡片渲染出来。只做 status-card 一种 kind，且只当纯文本 + 外链处理：
//
//   "pi": { "ui": [{ "id": "x.usage", "kind": "status-card",
//                    "title": "Usage", "body": "...", "href": "https://..." }] }
//
// 为什么不支持「插件跑代码往 UI 注册 React 组件」：跨进程组件、iframe 沙箱、
// 样式隔离、生命周期四件高危事项（与 roadmap #15 真隔离同一判断）。先证明
// 「插件能往界面里加东西」这条链走得通，再谈交互。
//
// 校验规则见 .scratch/tickets/0023-plugin-ui-cards.md 的「契约」节。
import { existsSync, readFileSync } from "node:fs";
import type { PluginUiCard } from "./api-types";

export type { PluginUiCard };

/** 单包卡片上限，超出忽略。 */
export const MAX_UI_CARDS_PER_PACKAGE = 12;

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 400;
const MAX_ID_LENGTH = 120;

/** 只认 http/https；其它协议（javascript:、data:）返回 undefined。 */
export function sanitizeHref(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function readText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * 把 package.json 里的 `pi.ui` 值解析成卡片列表。
 *
 * 宽松失败：任何不合法条目被丢弃而不是抛错——一个写错声明的插件不该让
 * `/api/plugins` 整个 500（那是设置页的全部数据）。
 */
export function parsePluginUiCards(raw: unknown): PluginUiCard[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const cards: PluginUiCard[] = [];
  for (const entry of raw) {
    if (cards.length >= MAX_UI_CARDS_PER_PACKAGE) break;
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    if (item.kind !== "status-card") continue;
    const id = readText(item.id, MAX_ID_LENGTH);
    const title = readText(item.title, MAX_TITLE_LENGTH);
    if (!id || !title) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const card: PluginUiCard = { id, kind: "status-card", title };
    const body = readText(item.body, MAX_BODY_LENGTH);
    if (body) card.body = body;
    const href = sanitizeHref(item.href);
    if (href) card.href = href;
    cards.push(card);
  }
  return cards;
}

/**
 * 从已安装包的 package.json 读卡片。
 *
 * 读不到、不是 JSON、没有 `pi.ui` → 空数组。调用方不需要 try/catch。
 */
export function readPluginUiCards(packageJsonPath: string): PluginUiCard[] {
  try {
    if (!existsSync(packageJsonPath)) return [];
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      pi?: { ui?: unknown };
    };
    return parsePluginUiCards(parsed?.pi?.ui);
  } catch {
    return [];
  }
}
