import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});

const {
  parseSearchLimit,
  buildSearchText,
  buildSearchUrl,
  formatWeeklyDownloads,
  toPluginSearchResult,
  parseSearchResponse,
} = await jiti.import("./plugin-search.ts");

test("parseSearchLimit: defaults to 30 for invalid input", () => {
  assert.equal(parseSearchLimit(undefined), 30);
  assert.equal(parseSearchLimit(NaN), 30);
  assert.equal(parseSearchLimit("abc"), 30);
});

test("parseSearchLimit: clamps to 1–50", () => {
  assert.equal(parseSearchLimit(0), 1);
  assert.equal(parseSearchLimit(100), 50);
  assert.equal(parseSearchLimit(25), 25);
});

test("buildSearchText: always includes keywords:pi-package", () => {
  assert.equal(buildSearchText(""), "keywords:pi-package");
  assert.equal(buildSearchText("  "), "keywords:pi-package");
  assert.equal(buildSearchText("mcp"), "keywords:pi-package mcp");
});

test("buildSearchUrl: encodes the text parameter", () => {
  const url = buildSearchUrl("web search", 10);
  assert.ok(url.includes("text=keywords%3Api-package%20web%20search"));
  assert.ok(url.endsWith("&size=10"));
});

test("formatWeeklyDownloads: compact human-readable", () => {
  assert.equal(formatWeeklyDownloads(0), "");
  assert.equal(formatWeeklyDownloads(undefined), "");
  assert.equal(formatWeeklyDownloads(42), "42/wk");
  assert.equal(formatWeeklyDownloads(1234), "1.2K/wk");
  assert.equal(formatWeeklyDownloads(1_000_000), "1M/wk");
  assert.equal(formatWeeklyDownloads(2_500_000), "2.5M/wk");
});

test("toPluginSearchResult: maps npm object to PluginSearchResult", () => {
  const result = toPluginSearchResult({
    package: {
      name: "pi-mcp-extension",
      version: "1.11.10",
      description: "  MCP extension for Pi  ",
      license: "MIT",
      links: { npm: "https://www.npmjs.com/package/pi-mcp-extension" },
    },
    downloads: { weekly: 50000 },
    searchScore: 42.1,
  });
  assert.deepEqual(result, {
    name: "pi-mcp-extension",
    version: "1.11.10",
    description: "MCP extension for Pi",
    weeklyDownloads: "50K/wk",
    npmUrl: "https://www.npmjs.com/package/pi-mcp-extension",
    license: "MIT",
  });
});

test("toPluginSearchResult: returns null when name is missing", () => {
  assert.equal(
    toPluginSearchResult({ package: { version: "1.0.0" } }),
    null,
  );
});

test("toPluginSearchResult: falls back to constructed npm URL", () => {
  const result = toPluginSearchResult({
    package: { name: "@scope/pkg", version: "0.1.0" },
  });
  assert.equal(result?.npmUrl, "https://www.npmjs.com/package/@scope/pkg");
});

test("parseSearchResponse: extracts results from npm search response", () => {
  const results = parseSearchResponse({
    total: 2,
    objects: [
      {
        package: { name: "pi-subagents", version: "0.84.0", description: "subagents" },
        downloads: { weekly: 1000 },
      },
      {
        package: { name: "bad-pkg", version: "0.0.1" },
      },
    ],
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].name, "pi-subagents");
  assert.equal(results[0].weeklyDownloads, "1K/wk");
  assert.equal(results[1].name, "bad-pkg");
  assert.equal(results[1].weeklyDownloads, "");
});

test("parseSearchResponse: returns empty array for invalid input", () => {
  assert.deepEqual(parseSearchResponse(null), []);
  assert.deepEqual(parseSearchResponse({}), []);
  assert.deepEqual(parseSearchResponse({ objects: "not-array" }), []);
});
