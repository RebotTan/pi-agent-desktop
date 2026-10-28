import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildReleaseBody,
  extractVersionNotes,
  formatBundledComponents,
} from "./release-notes.mjs";

const run = promisify(execFile);

const CHANGELOG = `# @agegr/pi-web

## 0.10.2

### Patch Changes

- Fixed the thing.
- Also this.

## 0.10.1

### Patch Changes

- Introduced the AgentEngine.
`;

test("extracts only the requested version section", () => {
  assert.equal(extractVersionNotes(CHANGELOG, "0.10.2"), "- Fixed the thing.\n- Also this.");
  assert.equal(extractVersionNotes(CHANGELOG, "0.10.1"), "- Introduced the AgentEngine.");
});

test("a version with no changelog heading yields an empty section", () => {
  assert.equal(extractVersionNotes(CHANGELOG, "9.9.9"), "");
});

test("strips the changesets Patch/Minor/Major subheadings", () => {
  const notes = extractVersionNotes(CHANGELOG, "0.10.2");
  assert.doesNotMatch(notes, /###/);
});

test("formats the bundled component versions", () => {
  const manifest = {
    components: [
      { id: "pid", version: "0.10.2" },
      { id: "pi", version: "1.4.0" },
      { id: "pi-web", version: "0.10.2" },
    ],
  };
  assert.equal(
    formatBundledComponents(manifest),
    "Bundled components: pid 0.10.2, pi 1.4.0, pi-web 0.10.2.",
  );
  assert.equal(formatBundledComponents({ components: [] }), "");
  assert.equal(formatBundledComponents({}), "");
});

test("the body is the notes plus the component line", () => {
  const body = buildReleaseBody({
    changelog: CHANGELOG,
    manifest: { components: [{ id: "pi", version: "1.4.0" }] },
    version: "0.10.2",
  });
  assert.equal(body, "- Fixed the thing.\n- Also this.\n\nBundled components: pi 1.4.0.");
});

test("a version without notes still publishes a non-empty body", () => {
  assert.equal(
    buildReleaseBody({ changelog: CHANGELOG, manifest: {}, version: "9.9.9" }),
    "Release 9.9.9.",
  );
});

test("the CLI writes the body for the requested version", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-notes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = join(dir, "notes.md");

  const { stdout } = await run(
    process.execPath,
    ["scripts/release-notes.mjs", "--version", "0.10.1", "--out", out],
    { cwd: fileURLToPath(new URL("..", import.meta.url)) },
  );

  assert.match(stdout, /Wrote release notes for 0\.10\.1/);
  const written = await readFile(out, "utf8");
  // The real CHANGELOG entry for 0.10.1 names the AgentEngine PR.
  assert.match(written, /AgentEngine/);
  assert.match(written, /Bundled components:/);
});
