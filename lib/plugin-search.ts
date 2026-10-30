/**
 * npm registry marketplace search for pi plugin packages.
 *
 * Pi plugins published to npm carry the `pi-package` keyword (the pi SDK's
 * convention). We search `keywords:pi-package` so only real pi packages show
 * up — a plain `pi-plugin` text search returns 300k+ unrelated results.
 */

import type { PluginSearchResult } from "./api-types";

/** npm registry search endpoint. */
const NPM_SEARCH_URL = "https://registry.npmjs.org/-/v1/search";

/** Always require the pi-package keyword so results are real pi plugins. */
const PI_KEYWORD = "keywords:pi-package";

const DEFAULT_LIMIT = 30;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

export function parseSearchLimit(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(num)));
}

/** Build the `text` query parameter: always `keywords:pi-package` plus the user query. */
export function buildSearchText(query: string): string {
  const trimmed = query.trim();
  return trimmed ? `${PI_KEYWORD} ${trimmed}` : PI_KEYWORD;
}

/** Build the full npm registry search URL. */
export function buildSearchUrl(query: string, limit: number): string {
  const text = buildSearchText(query);
  return `${NPM_SEARCH_URL}?text=${encodeURIComponent(text)}&size=${limit}`;
}

interface NpmSearchObject {
  package: {
    name: string;
    version: string;
    description?: string;
    license?: string;
    links?: { npm?: string; homepage?: string; repository?: string };
  };
  downloads?: { weekly?: number; monthly?: number };
  searchScore?: number;
}

interface NpmSearchResponse {
  total: number;
  objects: NpmSearchObject[];
}

/** Format a weekly download count into a compact human-readable string. */
export function formatWeeklyDownloads(weekly?: number): string {
  if (!weekly || weekly <= 0) return "";
  if (weekly >= 1_000_000) return `${(weekly / 1_000_000).toFixed(1).replace(/\.0$/, "")}M/wk`;
  if (weekly >= 1_000) return `${(weekly / 1_000).toFixed(1).replace(/\.0$/, "")}K/wk`;
  return `${weekly}/wk`;
}

/** Convert a raw npm search response object into a `PluginSearchResult`. */
export function toPluginSearchResult(obj: NpmSearchObject): PluginSearchResult | null {
  const pkg = obj.package;
  const name = pkg.name?.trim();
  if (!name) return null;
  const npmUrl = pkg.links?.npm ?? `https://www.npmjs.com/package/${name}`;
  const homepage = pkg.links?.homepage ?? pkg.links?.repository;
  return {
    name,
    version: pkg.version ?? "",
    description: pkg.description?.trim() ?? "",
    weeklyDownloads: formatWeeklyDownloads(obj.downloads?.weekly),
    npmUrl,
    ...(homepage ? { homepage } : {}),
    ...(pkg.license ? { license: pkg.license } : {}),
  };
}

/** Parse a raw npm search JSON response into results. */
export function parseSearchResponse(raw: unknown): PluginSearchResult[] {
  const data = raw as NpmSearchResponse;
  if (!data || !Array.isArray(data.objects)) return [];
  return data.objects
    .map(toPluginSearchResult)
    .filter((r): r is PluginSearchResult => r !== null);
}

/**
 * Search the npm registry for pi plugin packages.
 * Throws on network / HTTP errors; the caller is responsible for fallback.
 */
export async function searchNpmRegistry(
  query: string,
  limit: number,
): Promise<PluginSearchResult[]> {
  const url = buildSearchUrl(query, limit);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`npm registry search failed: HTTP ${res.status}`);
  const data = (await res.json()) as NpmSearchResponse;
  return parseSearchResponse(data);
}
