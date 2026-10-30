import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { fetchRemote, listLocalBranches, listRemoteBranches, partitionBranchList, resolveProject } from "@/lib/worktree";
import { isCwdAllowed } from "@/lib/file-access";
import { isJsonBodyError, readJsonBody } from "@/lib/json-body";

// POST /api/worktrees/fetch  body: { cwd }  →  { branches, remoteBranches }
// Runs `git fetch --prune` and returns the fresh branch lists so the switcher
// shows remote branches that were pushed since the last look.
export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ cwd?: string }>(req);
    if (isJsonBodyError(body)) return body;
    if (!body.cwd || typeof body.cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!(await isCwdAllowed(body.cwd))) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    await fetchRemote(body.cwd);

    const base = existsSync(body.cwd) ? body.cwd : (await resolveProject(body.cwd)).projectRoot;
    const [local, remote] = await Promise.all([listLocalBranches(base), listRemoteBranches(base)]);
    const { local: branches, remoteOnly: remoteBranches } = partitionBranchList(local, remote);
    return NextResponse.json({ success: true, branches, remoteBranches });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
