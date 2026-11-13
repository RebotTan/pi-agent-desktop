import { existsSync } from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "./rpc-manager";
import type { SessionReadView } from "./session-handle";

/**
 * SessionManager to read a session id through.
 *
 * Pi delays the first flush of a new session until an assistant message
 * exists. Opening the file for a run that just started yields an *empty*
 * history rather than an error, so a caller that reads the file blindly shows
 * an empty chat; the entries only exist in the live runtime's manager until
 * the flush happens. Returns null when neither source has the session.
 */
export async function openSessionManagerForRead(
  sessionId: string,
  filePath: string,
): Promise<SessionReadView | null> {
  if (existsSync(filePath)) return SessionManager.open(filePath);
  const live = getRpcSession(sessionId);
  if (!live?.isAlive()) return null;
  return live.readSession();
}
