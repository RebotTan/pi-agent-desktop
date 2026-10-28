import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { getSessionSearchIndex, isSearchIndexEnabled } from "./session-search-index.ts";
import type { SessionInfo } from "./types.ts";

const MAX_FILES = 500;
const MAX_RESULTS = 30;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_LINE_CHARS = 1024 * 1024;
const TIME_BUDGET_MS = 3000;

export interface SessionSearchResult {
  session: SessionInfo;
  entryId?: string;
  blockIndex: number;
  before: string;
  match: string;
  after: string;
}

export interface SessionSearchResponse {
  results: SessionSearchResult[];
  truncated: boolean;
}

/** 一行 JSONL 里可搜索的文本块（索引器和流式扫描共用，保证两边切法一致）。 */
export interface SearchableLine {
  entryId?: string;
  blocks: Array<{ blockIndex: number; text: string }>;
}

/**
 * 从一行 JSONL 抽出 user/assistant 的 text block。非消息行、非 user/assistant
 * 角色、没有 text block 都返回 null。`blockIndex` 是块在原始 content 数组里的
 * 下标（前端按它高亮）。
 */
export function parseSearchableLine(line: string): SearchableLine | null {
  if (!line || line.length > MAX_LINE_CHARS) return null;
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof entry !== "object" || entry === null) return null;
  const record = entry as { type?: unknown; id?: unknown; message?: { role?: unknown; content?: unknown } };
  if (record.type !== "message" || !["user", "assistant"].includes(String(record.message?.role))) return null;
  const content: unknown = record.message?.content;
  const blocks = typeof content === "string"
    ? [{ type: "text", text: content }]
    : Array.isArray(content)
      ? content
      : [];
  const textBlocks = blocks.flatMap((block, blockIndex) => {
    const candidate = block as { type?: unknown; text?: unknown } | null;
    return candidate?.type === "text" && typeof candidate.text === "string"
      ? [{ blockIndex, text: candidate.text }]
      : [];
  });
  if (textBlocks.length === 0) return null;
  return {
    ...(typeof record.id === "string" ? { entryId: record.id } : {}),
    blocks: textBlocks,
  };
}

/** 把一段文本包成结果条目：匹配点前后各 80 字符，超出补省略号（与流式实现一致）。 */
function toResult(
  session: SessionInfo,
  entryId: string | undefined,
  blockIndex: number,
  text: string,
  match: RegExpExecArray,
): SessionSearchResult {
  const start = match.index;
  const end = start + match[0].length;
  return {
    session,
    ...(entryId ? { entryId } : {}),
    blockIndex,
    before: (start > 80 ? "..." : "") + text.slice(Math.max(0, start - 80), start).replace(/\s+/g, " ").trimStart(),
    match: match[0].replace(/\s+/g, " "),
    after: text.slice(end, end + 80).replace(/\s+/g, " ").trimEnd() + (end + 80 < text.length ? "..." : ""),
  };
}

/**
 * 走 SQLite FTS5 索引。返回 null 表示索引不可用（开关关闭 / 打开失败 / 建库
 * 出错），调用方回退流式扫描。
 *
 * 与流式实现的差异只有一处：流式把一条消息的多个 text block 用 "\n" 拼接后
 * 匹配，可能跨越块边界命中；索引按块存储，只在块内命中。跨块命中要求查询词
 * 正好横跨 "\n"，实际不构成可用性差异。
 */
async function searchViaIndex(
  sessions: readonly SessionInfo[],
  needle: string,
  requestSignal?: AbortSignal,
): Promise<SessionSearchResponse | null> {
  const index = getSessionSearchIndex();
  if (!index.isAvailable()) return null;
  if (requestSignal?.aborted) return { results: [], truncated: false };

  const candidates = sessions.filter((session) => !session.transient && session.path);
  await index.sync(candidates);
  if (requestSignal?.aborted) return { results: [], truncated: false };

  const hits = index.search(candidates, needle);
  if (hits === null) return null;

  const byPath = new Map(candidates.map((session) => [session.path, session]));
  const matcher = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const results: SessionSearchResult[] = [];
  for (const hit of hits) {
    const session = byPath.get(hit.path);
    if (!session) continue;
    const match = matcher.exec(hit.body);
    if (!match) continue; // FTS token match without a literal substring (tokenizer false positive)
    results.push(toResult(session, hit.entryId, hit.blockIndex, hit.body, match));
    if (results.length >= MAX_RESULTS) break;
  }
  return { results, truncated: hits.length > results.length };
}

// ponytail: the scan below stays as the fallback for PI_SESSION_SEARCH_INDEX=0
// and for the case where the SQLite index cannot be opened.
export async function searchSessionContents(
  sessions: readonly SessionInfo[],
  query: string,
  requestSignal?: AbortSignal,
): Promise<SessionSearchResponse> {
  const response: SessionSearchResponse = { results: [], truncated: false };
  const needle = query.trim();
  if (!needle) return response;
  if (needle.length > 200) throw new RangeError("Search query exceeds 200 characters");
  // Escape every operator: this is literal search, with offsets in the original text.
  const matcher = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  if (isSearchIndexEnabled()) {
    try {
      const indexed = await searchViaIndex(sessions, needle, requestSignal);
      if (indexed) return indexed;
    } catch {
      // Any index failure falls through to the scan: a search must never fail
      // because building or reading the index did.
    }
  }

  const deadline = Date.now() + TIME_BUDGET_MS;
  const timeout = AbortSignal.timeout(TIME_BUDGET_MS);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
  const candidates = sessions
    .filter((session) => !session.transient && session.path)
    .sort((a, b) => b.modified.localeCompare(a.modified));

  for (const [index, session] of candidates.entries()) {
    if (index >= MAX_FILES || response.results.length >= MAX_RESULTS || signal.aborted || Date.now() >= deadline) {
      response.truncated = true;
      break;
    }
    const stream = createReadStream(session.path, { encoding: "utf8", end: MAX_FILE_BYTES - 1, signal });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let found = false;
    try {
      for await (const line of lines) {
        if (signal.aborted || Date.now() >= deadline) {
          response.truncated = true;
          break;
        }
        if (line.length > MAX_LINE_CHARS) {
          response.truncated = true;
          continue;
        }
        const parsed = parseSearchableLine(line);
        if (!parsed) continue;
        const text = parsed.blocks.map((block) => block.text).join("\n");
        const match = matcher.exec(text);
        if (!match) continue;
        let blockOffset = 0;
        const matchedBlock = parsed.blocks.find((block) => {
          const blockEnd = blockOffset + block.text.length;
          blockOffset = blockEnd + 1;
          return match.index <= blockEnd;
        });
        response.results.push(toResult(session, parsed.entryId, matchedBlock!.blockIndex, text, match));
        found = true;
        break;
      }
    } catch {
      // Missing/unreadable files and interrupted reads must not hide other results.
      response.truncated = true;
    } finally {
      lines.close();
      stream.destroy();
    }
    if (!found && stream.bytesRead >= MAX_FILE_BYTES) response.truncated = true;
  }
  return response;
}
