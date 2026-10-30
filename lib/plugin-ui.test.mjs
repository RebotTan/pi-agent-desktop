import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { parsePluginUiCards, readPluginUiCards, sanitizeHref, MAX_UI_CARDS_PER_PACKAGE } =
  await jiti.import("./plugin-ui.ts");

test("解析合法的 status-card", () => {
  const cards = parsePluginUiCards([
    {
      id: "demo.usage",
      kind: "status-card",
      title: "  Usage dashboard  ",
      body: "Open the plugin's own page.",
      href: "https://example.com/usage",
    },
  ]);
  assert.deepEqual(cards, [
    {
      id: "demo.usage",
      kind: "status-card",
      title: "Usage dashboard",
      body: "Open the plugin's own page.",
      href: "https://example.com/usage",
    },
  ]);
});

test("非数组或空值返回空数组", () => {
  assert.deepEqual(parsePluginUiCards(undefined), []);
  assert.deepEqual(parsePluginUiCards(null), []);
  assert.deepEqual(parsePluginUiCards({}), []);
  assert.deepEqual(parsePluginUiCards([]), []);
});

test("只认 status-card，其它 kind 静默忽略", () => {
  const cards = parsePluginUiCards([
    { id: "a", kind: "panel", title: "Panel" },
    { id: "b", kind: "tool-card", title: "Tool" },
    { id: "c", kind: "status-card", title: "Kept" },
  ]);
  assert.deepEqual(cards.map((c) => c.id), ["c"]);
});

test("缺 id 或 title 的条目被丢弃", () => {
  const cards = parsePluginUiCards([
    { kind: "status-card", title: "No id" },
    { id: "x", kind: "status-card" },
    { id: "  ", kind: "status-card", title: "Blank id" },
    { id: "y", kind: "status-card", title: "   " },
    { id: "ok", kind: "status-card", title: "Fine" },
  ]);
  assert.deepEqual(cards.map((c) => c.id), ["ok"]);
});

test("重复 id 只保留第一条", () => {
  const cards = parsePluginUiCards([
    { id: "dup", kind: "status-card", title: "First" },
    { id: "dup", kind: "status-card", title: "Second" },
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, "First");
});

test("卡片数量上限", () => {
  const many = Array.from({ length: MAX_UI_CARDS_PER_PACKAGE + 5 }, (_, i) => ({
    id: `card-${i}`,
    kind: "status-card",
    title: `Card ${i}`,
  }));
  assert.equal(parsePluginUiCards(many).length, MAX_UI_CARDS_PER_PACKAGE);
});

test("href 白名单只放行 http/https，卡片本身保留", () => {
  const cards = parsePluginUiCards([
    { id: "js", kind: "status-card", title: "JS", href: "javascript:alert(1)" },
    { id: "data", kind: "status-card", title: "Data", href: "data:text/html,<b>x</b>" },
    { id: "rel", kind: "status-card", title: "Relative", href: "/settings" },
    { id: "http", kind: "status-card", title: "HTTP", href: "http://example.com/a" },
  ]);
  assert.equal(cards.length, 4);
  assert.equal(cards[0].href, undefined);
  assert.equal(cards[1].href, undefined);
  assert.equal(cards[2].href, undefined);
  assert.equal(cards[3].href, "http://example.com/a");
});

test("sanitizeHref 边界", () => {
  assert.equal(sanitizeHref(undefined), undefined);
  assert.equal(sanitizeHref(""), undefined);
  assert.equal(sanitizeHref("   "), undefined);
  assert.equal(sanitizeHref("ftp://example.com"), undefined);
  assert.equal(sanitizeHref("https://example.com/x?y=1"), "https://example.com/x?y=1");
});

test("超长 title / body 被截断", () => {
  const cards = parsePluginUiCards([
    { id: "long", kind: "status-card", title: "T".repeat(500), body: "B".repeat(2000) },
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title.length, 120);
  assert.equal(cards[0].body.length, 400);
});

test("readPluginUiCards：正常文件 / 缺文件 / 坏 JSON / 无 pi.ui", () => {
  const dir = mkdtempSync(join(tmpdir(), "pid-plugin-ui-"));
  try {
    const good = join(dir, "good.json");
    writeFileSync(
      good,
      JSON.stringify({
        name: "demo",
        pi: { ui: [{ id: "a", kind: "status-card", title: "A" }] },
      }),
    );
    assert.deepEqual(readPluginUiCards(good).map((c) => c.id), ["a"]);

    const noPi = join(dir, "no-pi.json");
    writeFileSync(noPi, JSON.stringify({ name: "plain" }));
    assert.deepEqual(readPluginUiCards(noPi), []);

    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{ not json");
    assert.deepEqual(readPluginUiCards(broken), []);

    assert.deepEqual(readPluginUiCards(join(dir, "missing.json")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
