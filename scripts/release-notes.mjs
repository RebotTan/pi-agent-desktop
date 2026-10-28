import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rootDir } from "./release-components.mjs";

/**
 * Pulls the notes for one released version out of CHANGELOG.md.
 *
 * CHANGELOG.md is written by `changeset version`, so each released version is a
 * `## <version>` heading followed by its change bullets, up to the next `##`.
 * A version that never reached main has no heading; the caller falls back to a
 * generic body rather than publishing an empty release.
 *
 * @param {string} changelog
 * @param {string} version
 * @returns {string} the section body, trimmed, or "" when absent
 */
export function extractVersionNotes(changelog, version) {
  const lines = changelog.split("\n");
  const heading = `## ${version}`;
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return "";

  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    body.push(line);
  }
  // Changesets writes an `### Patch Changes` subheading; it reads as noise on
  // a release page where the whole page is one version.
  return body
    .join("\n")
    .replace(/^### (Patch|Minor|Major) Changes\s*$/gm, "")
    .trim();
}

/**
 * One line naming the bundled component releases, from the manifest that
 * `npm run release:manifest` writes next to the installers.
 *
 * @param {{ components?: Array<{ id: string, version: string }> }} manifest
 * @returns {string}
 */
export function formatBundledComponents(manifest) {
  const parts = (manifest.components ?? [])
    .filter((component) => component && component.id && component.version)
    .map((component) => `${component.id} ${component.version}`);
  return parts.length === 0 ? "" : `Bundled components: ${parts.join(", ")}.`;
}

/**
 * The full release body: CHANGELOG notes for `version`, then the bundled
 * component line. Both halves degrade to something publishable when their
 * source is missing.
 *
 * @param {{ changelog: string, manifest: unknown, version: string }} input
 * @returns {string}
 */
export function buildReleaseBody({ changelog, manifest, version }) {
  const notes = extractVersionNotes(changelog, version);
  const components = formatBundledComponents(
    /** @type {{ components?: Array<{ id: string, version: string }> }} */ (manifest),
  );
  const heading = notes || `Release ${version}.`;
  return components ? `${heading}\n\n${components}` : heading;
}

async function readOptional(path, fallback) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return fallback;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const versionIndex = args.indexOf("--version");
  const outIndex = args.indexOf("--out");

  const packageJson = JSON.parse(
    await readFile(join(rootDir, "src-tauri", "pi-agent-desktop-package.json"), "utf8"),
  );
  const version = versionIndex === -1 ? packageJson.version : args[versionIndex + 1];
  if (!version) {
    console.error("release-notes: no version to write notes for");
    process.exit(1);
  }

  const changelog = await readOptional(join(rootDir, "CHANGELOG.md"), "");
  const manifest = JSON.parse(
    await readOptional(
      join(rootDir, "src-tauri", "resources", "component-versions.json"),
      '{"components":[]}',
    ),
  );

  const body = buildReleaseBody({ changelog, manifest, version });
  const destination = outIndex === -1 ? undefined : args[outIndex + 1];

  if (destination) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, `${body}\n`);
    console.log(`Wrote release notes for ${version} to ${destination}`);
    return;
  }
  process.stdout.write(`${body}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
