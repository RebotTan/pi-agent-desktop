import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { FileToolPolicyStore, InMemoryToolPolicyStore, readToolPolicyRules } = await jiti.import("./tool-policy.ts");

function makeSettingsFile(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-tool-policy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, settingsPath: join(dir, "pi-web", "settings.json") };
}

test("rules survive a new store instance (restart simulation)", (t) => {
  const { settingsPath } = makeSettingsFile(t);

  const first = new FileToolPolicyStore(settingsPath);
  const added = first.addRule({ pattern: "bash", action: "ask", note: "shell needs a look" });
  first.addRule({ pattern: "mcp__*", action: "deny" });

  const second = new FileToolPolicyStore(settingsPath);
  const rules = second.listRules();
  assert.deepEqual(
    rules.map((rule) => [rule.id, rule.pattern, rule.action, rule.note]),
    [
      [added.id, "bash", "ask", "shell needs a look"],
      [rules[1].id, "mcp__*", "deny", undefined],
    ],
  );
  assert.equal(second.decide("bash"), "ask");
  assert.equal(second.decide("mcp__github_search"), "deny");
  assert.equal(second.decide("read"), "allow");
});

test("addRule writes the rules into the settings file without dropping other keys", (t) => {
  const { dir, settingsPath } = makeSettingsFile(t);
  mkdirSync(join(dir, "pi-web"), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify({ version: 1, artifactsPrompt: false }), "utf8");

  new FileToolPolicyStore(settingsPath).addRule({ pattern: "edit", action: "ask" });

  const stored = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(stored.artifactsPrompt, false);
  assert.equal(stored.toolPolicyRules.length, 1);
  assert.equal(stored.toolPolicyRules[0].pattern, "edit");
  assert.equal(stored.toolPolicyRules[0].action, "ask");
});

test("removeRule persists and reports whether anything was removed", (t) => {
  const { settingsPath } = makeSettingsFile(t);
  const store = new FileToolPolicyStore(settingsPath);
  const rule = store.addRule({ pattern: "bash", action: "deny" });

  assert.equal(store.removeRule(rule.id), true);
  assert.equal(store.removeRule(rule.id), false);
  assert.deepEqual(new FileToolPolicyStore(settingsPath).listRules(), []);
});

test("an unreadable or malformed settings file yields no rules and no throw", (t) => {
  const { dir, settingsPath } = makeSettingsFile(t);
  mkdirSync(join(dir, "pi-web"), { recursive: true });
  writeFileSync(settingsPath, "{ not json", "utf8");

  assert.deepEqual(readToolPolicyRules(settingsPath), []);
  assert.deepEqual(new FileToolPolicyStore(settingsPath).listRules(), []);
});

test("invalid stored entries are skipped instead of breaking the list", (t) => {
  const { dir, settingsPath } = makeSettingsFile(t);
  mkdirSync(join(dir, "pi-web"), { recursive: true });
  writeFileSync(
    settingsPath,
    JSON.stringify({
      version: 1,
      toolPolicyRules: [
        { id: "keep", pattern: "bash", action: "ask" },
        { id: "no-pattern", action: "ask" },
        { pattern: "no-id", action: "ask" },
        { id: "bad-action", pattern: "edit", action: "maybe" },
        "not an object",
        null,
      ],
    }),
    "utf8",
  );

  assert.deepEqual(
    readToolPolicyRules(settingsPath).map((rule) => rule.id),
    ["keep"],
  );
});

test("new rules keep their position, so the first match still wins", (t) => {
  const { settingsPath } = makeSettingsFile(t);
  const store = new FileToolPolicyStore(settingsPath);
  store.addRule({ pattern: "bash", action: "ask" });
  store.addRule({ pattern: "bash", action: "deny" });

  assert.equal(store.decide("bash"), "ask");
  assert.equal(new FileToolPolicyStore(settingsPath).decide("bash"), "ask");
});

test("the in-memory store stays usable for tests and does not touch disk", () => {
  const store = new InMemoryToolPolicyStore();
  store.addRule({ pattern: "bash", action: "ask" });
  assert.equal(store.decide("bash"), "ask");
  assert.equal(existsSync(join(tmpdir(), "pi-web", "settings.json")), false);
});
