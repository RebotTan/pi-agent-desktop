import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { summarizeReleaseHighlights } = await jiti.import("./app-update-summary.ts");

test("the Chinese summary stays within 20 characters and says 等 when items are left out", () => {
  const highlights = {
    en: ["Network proxy", "Side chats", "Sidebar", "Files and right panel", "Models"],
    zh: ["网络代理", "侧聊", "侧栏", "文件与右侧面板", "模型"],
  };
  const zh = summarizeReleaseHighlights(highlights, "zh-CN");
  assert.equal(zh, "网络代理、侧聊、侧栏、文件与右侧面板等");
  assert.ok(zh.length <= 20);
  assert.equal(summarizeReleaseHighlights(highlights, "zh-TW"), zh);
  const en = summarizeReleaseHighlights(highlights, "en");
  assert.ok(en.length <= 48);
  assert.match(en, /^Network proxy, Side chats, Sidebar/);
});

test("summaries fall back across languages and cut a single long title", () => {
  assert.equal(summarizeReleaseHighlights({ en: ["Proxy"], zh: [] }, "zh-CN"), "Proxy");
  assert.equal(summarizeReleaseHighlights({ en: [], zh: [] }, "en"), null);
  assert.equal(summarizeReleaseHighlights(undefined, "en"), null);
  const long = summarizeReleaseHighlights({ en: [], zh: ["一二三四五六七八九十一二三四五六七八九十一二"] }, "zh-CN");
  assert.equal(long.length, 20);
  assert.ok(long.endsWith("…"));
});
