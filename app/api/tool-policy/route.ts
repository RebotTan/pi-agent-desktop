import { NextResponse } from "next/server";
import { getApprovalCoordinator } from "@/lib/approval-coordinator";
import { getToolPolicyStore } from "@/lib/tool-policy";

export const dynamic = "force-dynamic";

/** GET：规则表 + 待审批列表。POST：添加规则。DELETE：按 id 删规则。 */
export async function GET() {
  const store = getToolPolicyStore();
  return NextResponse.json({
    rules: store.listRules(),
    pending: getApprovalCoordinator().listPending(),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { pattern?: unknown; action?: unknown; note?: unknown }
    | null;
  if (!body || typeof body.pattern !== "string" || body.pattern.trim() === "") {
    return NextResponse.json({ error: "pattern is required" }, { status: 400 });
  }
  if (body.action !== "allow" && body.action !== "deny" && body.action !== "ask") {
    return NextResponse.json({ error: "action must be allow | deny | ask" }, { status: 400 });
  }
  const rule = getToolPolicyStore().addRule({
    pattern: body.pattern.trim(),
    action: body.action,
    ...(typeof body.note === "string" && body.note !== "" ? { note: body.note } : {}),
  });
  return NextResponse.json({ rule });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const removed = getToolPolicyStore().removeRule(id);
  return NextResponse.json({ removed });
}