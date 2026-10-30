import { NextResponse } from "next/server";
import { searchNpmRegistry, parseSearchLimit } from "@/lib/plugin-search";
import { isJsonBodyError, readJsonBody } from "@/lib/json-body";

export const dynamic = "force-dynamic";

// POST /api/plugins/search  body: { query?: string, limit?: number }
export async function POST(req: Request) {
  try {
    const parsedBody = await readJsonBody<{
      query?: string;
      limit?: unknown;
    }>(req);
    if (isJsonBodyError(parsedBody)) return parsedBody;
    const { query, limit: rawLimit } = parsedBody;
    const limit = parseSearchLimit(rawLimit);
    const results = await searchNpmRegistry(query ?? "", limit);
    return NextResponse.json({ results });
  } catch (e: unknown) {
    const err = e as { message?: string };
    return NextResponse.json(
      { error: err.message ?? String(e) },
      { status: 502 },
    );
  }
}
