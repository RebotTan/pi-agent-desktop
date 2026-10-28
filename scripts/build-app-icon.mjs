#!/usr/bin/env node
/**
 * Builds the PiD app icon: a light tile with the dark pi glyph and a hairline
 * edge, then hands the 1024px master to `tauri icon` for every platform size.
 *
 * The glyph outline is not redrawn. It is taken from the upstream icon by
 * reading each pixel's luma as glyph coverage, so the stroke weight, the tile
 * radius and the anti-aliasing stay exactly what the upstream artwork has and
 * only the colours swap.
 *
 * Usage: node scripts/build-app-icon.mjs <source-png-256x256>
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Tile colour: very light grey, so the tile still reads on a white surface. */
const TILE = [245, 245, 247];
/** Glyph colour: the upstream tile colour, kept as the app's dark ink. */
const GLYPH = [19, 21, 27];
/** Upstream luma of the tile and the glyph, measured on the source artwork. */
const LUMA_TILE = 22;
const LUMA_GLYPH = 245;
/** Hairline width in the 1024px master, which is 1px at a 128px tile. */
const EDGE_WIDTH = 8;
/** Hairline ink mixed into the tile, as an alpha over TILE. */
const EDGE_ALPHA = 0.18;

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("usage: node scripts/build-app-icon.mjs <source-png>");
  process.exit(1);
}

const master = 1024;
const { data, info } = await sharp(resolve(sourcePath))
  .resize(256, 256, { kernel: "lanczos3" })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const size = info.width;

// Pass 1: swap the glyph ink for the tile colour, keeping the artwork's alpha.
const swapped = Buffer.alloc(size * size * 4);
for (let i = 0; i < size * size; i += 1) {
  const r = data[i * 4];
  const g = data[i * 4 + 1];
  const b = data[i * 4 + 2];
  const a = data[i * 4 + 3];
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const coverage = Math.max(0, Math.min(1, (luma - LUMA_TILE) / (LUMA_GLYPH - LUMA_TILE)));
  for (let c = 0; c < 3; c += 1) {
    swapped[i * 4 + c] = Math.round(TILE[c] - (TILE[c] - GLYPH[c]) * coverage);
  }
  swapped[i * 4 + 3] = a;
}

const tile = await sharp(swapped, { raw: { width: size, height: size, channels: 4 } })
  .resize(master, master, { kernel: "lanczos3" })
  .raw()
  .toBuffer({ resolveWithObject: true });

// Pass 2: a hairline inside the tile edge. Eroding the alpha by EDGE_WIDTH and
// subtracting it from the original alpha yields exactly the edge band, so the
// stroke follows the artwork's own corner radius instead of a guessed one.
const alpha = new Uint8Array(master * master);
for (let i = 0; i < master * master; i += 1) alpha[i] = tile.data[i * 4 + 3];

const horizontal = new Uint8Array(master * master);
for (let y = 0; y < master; y += 1) {
  const row = y * master;
  for (let x = 0; x < master; x += 1) {
    let low = 255;
    const from = Math.max(0, x - EDGE_WIDTH);
    const to = Math.min(master - 1, x + EDGE_WIDTH);
    for (let sx = from; sx <= to; sx += 1) {
      const v = alpha[row + sx];
      if (v < low) low = v;
    }
    horizontal[row + x] = low;
  }
}
const band = new Uint8Array(master * master);
for (let x = 0; x < master; x += 1) {
  for (let y = 0; y < master; y += 1) {
    const row = y * master;
    let low = 255;
    const from = Math.max(0, y - EDGE_WIDTH);
    const to = Math.min(master - 1, y + EDGE_WIDTH);
    for (let sy = from; sy <= to; sy += 1) {
      const v = horizontal[sy * master + x];
      if (v < low) low = v;
    }
    band[row + x] = alpha[row + x] - low;
  }
}

const out = Buffer.from(tile.data);
for (let i = 0; i < master * master; i += 1) {
  const edge = (band[i] / 255) * EDGE_ALPHA;
  if (edge <= 0) continue;
  for (let c = 0; c < 3; c += 1) {
    out[i * 4 + c] = Math.round(out[i * 4 + c] * (1 - edge));
  }
}

const workDir = join(tmpdir(), "pid-app-icon");
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
const masterPath = join(workDir, "icon-1024.png");
await sharp(out, { raw: { width: master, height: master, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(masterPath);

// Run the project-local CLI through the Node binary that runs this script.
// Spawning `npx` directly breaks on Windows (npx.cmd) and on machines whose
// shell PATH differs from the one Node sees.
const tauriCli = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
execFileSync(process.execPath, [tauriCli, "icon", masterPath], { cwd: root, stdio: "inherit" });

// `tauri icon` also emits Android, iOS and Windows Store sizes that a desktop
// build never reads; drop them so the tracked icon set stays exactly what the
// Tauri configs reference.
for (const extra of ["android", "ios"]) {
  rmSync(join(root, "src-tauri", "icons", extra), { recursive: true, force: true });
}
const storeSizes = [
  "Square30x30Logo.png",
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square89x89Logo.png",
  "Square107x107Logo.png",
  "Square142x142Logo.png",
  "Square150x150Logo.png",
  "Square284x284Logo.png",
  "Square310x310Logo.png",
  "StoreLogo.png",
  "64x64.png",
];
for (const name of storeSizes) {
  rmSync(join(root, "src-tauri", "icons", name), { force: true });
}

console.log(`PiD app icon written from ${masterPath}`);
