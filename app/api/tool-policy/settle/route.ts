import { NextResponse } from "next/server";
import { getApprovalCoordinator } from "@/lib/approval-coordinator";

export const dynamic = "force-dynamic";

/** POST {id, approved}：结算一次待审批（批准或拒绝）。 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { id?: unknown; approved?: unknown }
    | null;
  if (!body || typeof body.id !== "string" || body.id === "") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (typeof body.approved !== "boolean") {
    return NextResponse.json({ error: "approved must be a boolean" }, { status: 400 });
  }
  const ok = getApprovalCoordinator().settle(body.id, body.approved);
  return NextResponse.json({ ok, ...(!ok ? { error: "no such pending approval" } : {}) });
}