import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { getPackageSourceString, removePackageSource } = await jiti.import("./plugin-settings.ts");

test("getPackageSourceString reads both settings entry shapes", () => {
  assert.equal(getPackageSourceString("npm:pi-mcp-extension"), "npm:pi-mcp-extension");
  assert.equal(getPackageSourceString({ source: "..\\..\\ego\\pkg" }), "..\\..\\ego\\pkg");
  assert.equal(
    getPackageSourceString({ source: "git:https://example.com/a.git", skills: [] }),
    "git:https://example.com/a.git",
  );
});

test("removePackageSource drops the exact entry", () => {
  const packages = ["npm:a", "..\\..\\ego\\pkg", "npm:c"];
  assert.deepEqual(removePackageSource(packages, "..\\..\\ego\\pkg"), ["npm:a", "npm:c"]);
});

test("removePackageSource returns null when nothing matches", () => {
  assert.equal(removePackageSource(["npm:a", "npm:b"], "npm:missing"), null);
  assert.equal(removePackageSource([], "npm:a"), null);
});

test("removePackageSource drops object entries holding entry settings", () => {
  const packages = [
    { source: "..\\..\\ego\\pkg", extensions: ["ext/a.ts"] },
    "npm:keep",
  ];
  assert.deepEqual(removePackageSource(packages, "..\\..\\ego\\pkg"), ["npm:keep"]);
});

test("removePackageSource keeps look-alike sources", () => {
  // 相对路径删错一条会连带把别的包弄丢，所以按整串比较。
  const packages = ["..\\..\\ego\\pkg", "..\\..\\ego\\pkg2", "..\\..\\ego\\pkg\\nested"];
  assert.deepEqual(removePackageSource(packages, "..\\..\\ego\\pkg"), [
    "..\\..\\ego\\pkg2",
    "..\\..\\ego\\pkg\\nested",
  ]);
});

test("removePackageSource removes every duplicate of the same source", () => {
  assert.deepEqual(
    removePackageSource(["npm:a", "npm:a", "npm:b"], "npm:a"),
    ["npm:b"],
  );
});
