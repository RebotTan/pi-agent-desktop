import { getSessionStore } from "./session-store";
export { isFilePathReferencedByEntries } from "./session-file-references-core";
import {
  isBashOutputPathReferencedByEntries,
  isFilePathReferencedByEntries,
  isValidSessionId,
} from "./session-file-references-core";

export async function isFilePathReferencedBySession(filePath: string, sessionId: string | null): Promise<boolean> {
  if (!isValidSessionId(sessionId)) return false;
  try {
    const sessionRef = await getSessionStore().resolveSessionRef(sessionId);
    if (!sessionRef) return false;
    return isFilePathReferencedByEntries(filePath, getSessionStore().getSessionEntries(sessionRef));
  } catch {
    return false;
  }
}

export async function isBashOutputPathReferencedBySession(filePath: string, sessionId: string | null): Promise<boolean> {
  if (!isValidSessionId(sessionId)) return false;
  try {
    const sessionRef = await getSessionStore().resolveSessionRef(sessionId);
    if (!sessionRef) return false;
    return isBashOutputPathReferencedByEntries(filePath, getSessionStore().getSessionEntries(sessionRef));
  } catch {
    return false;
  }
}
