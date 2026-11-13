// ============================================================================
// collectSessionStartParams — startRpcSession 的「决策段」
// ============================================================================
//
// 这一段只读会话文件与进程状态，产出一个可跨进程序列化的参数对象。
// 主进程装配段靠它拿参数；worker 侧只取 params，自己重新 open SessionManager
// （句柄跨不过进程）。
//
// 搬出来的原因见 ADR 0002：ProcessAgentEngine 需要「父进程决策、子进程装配」
// 的来源，否则 worker 里要重写一遍 chat 判定 / policy 推导 / tool 取舍，两边
// 必然漂移。决策段本来几乎是纯函数，只有 SessionManager.open 是 I/O。

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { isNetworkExposedServer } from "./chat-file-access";
import { readChatUnlocked } from "./chat-unlock";
import {
  createChatFolder,
  ensureChatCwd,
  isChatFolderPath,
  isChatRootPath,
  isChatWorkspacePath,
} from "./chat-workspace";
import { deriveSessionPolicy } from "./session-policy";
import { appendSessionToolSelection, readSessionToolSelection } from "./session-tool-selection";
import { hasSideMetadata, readSideRelation, sideToolNames } from "./side-session";
import { hasSubagentResourceSnapshot, readSubagentSessionResources } from "./subagents";
import type { SessionEntry } from "./types";

export interface SessionStartParams {
  readonly sessionCwd: string;
  readonly chatWorkspace: boolean;
  readonly chatFolder: boolean;
  readonly chatUnlocked: boolean;
  readonly subagentResources: ReturnType<typeof readSubagentSessionResources>;
  readonly subagentLoadsResources: boolean;
  /** `deriveSessionPolicy` 的结果里唯一被装配段用到的就是 chat-only。 */
  readonly chatOnly: boolean;
  readonly isSideChat: boolean;
  readonly sideChatTools: boolean;
  readonly selectedToolNames: string[] | undefined;
}

export interface CollectSessionStartInput {
  readonly sessionFile: string;
  readonly cwd: string | undefined;
  readonly parentSession: string | undefined;
  readonly requestedToolNames: string[] | undefined;
}

export interface CollectedSessionStart {
  /** 父进程装配段继续用它（工具选择要追加在同一个 manager 上）。跨进程侧不用。 */
  readonly sessionManager: SessionManager;
  readonly params: SessionStartParams;
}

export async function collectSessionStartParams(
  input: CollectSessionStartInput,
): Promise<CollectedSessionStart> {
  const { sessionFile, cwd, parentSession, requestedToolNames } = input;
  let sessionManager: SessionManager;
  if (sessionFile) {
    sessionManager = SessionManager.open(sessionFile, undefined);
  } else {
    if (!cwd) throw new Error("cwd is required for a new session");
    // A new chat is requested with the chat root; it gets a folder of its own.
    sessionManager = SessionManager.create(
      isChatRootPath(cwd) ? await createChatFolder() : cwd,
      undefined,
      parentSession ? { parentSession: parentSession } : undefined,
    );
  }
  const sessionCwd = sessionManager.getCwd();
  const sessionEntries = sessionManager.getEntries() as unknown as SessionEntry[];
  const chatWorkspace = isChatWorkspacePath(sessionCwd);
  const chatFolder = isChatFolderPath(sessionCwd);
  if (chatWorkspace) await ensureChatCwd(sessionCwd);
  // Unlocking lets a chat use the computer, so it is a local choice: a server that other
  // machines can reach never honours it.
  const chatUnlocked = chatFolder
    && !isNetworkExposedServer()
    && readChatUnlocked(sessionEntries);
  const hasPersistedSubagentSnapshot = sessionFile && !chatWorkspace
    && hasSubagentResourceSnapshot(sessionEntries);
  const subagentResources = sessionFile && !chatWorkspace
    ? readSubagentSessionResources(sessionEntries)
    : null;
  if (hasPersistedSubagentSnapshot && !subagentResources) {
    throw new Error("Invalid subagent resource snapshot");
  }
  const persistedToolNames = subagentResources
    ? undefined
    : readSessionToolSelection(sessionEntries);
  // A chat has no tool preset to pick: it loads what a project session loads, and the
  // chat policy extension withholds the coding tools (lib/chat-workspace-policy.ts).
  const pinnedToolNames = chatWorkspace
    ? undefined
    : subagentResources?.tools ?? persistedToolNames ?? requestedToolNames;
  if (!chatWorkspace && !subagentResources && persistedToolNames === undefined && requestedToolNames !== undefined) {
    appendSessionToolSelection(sessionManager, requestedToolNames);
  }
  const subagentLoadsResources = Boolean(
    subagentResources?.loadExtensions || subagentResources?.loadSkills
    || subagentResources?.codemode || subagentResources?.mcp,
  );
  const sessionPolicy = deriveSessionPolicy({
    chatWorkspace,
    chatUnlocked,
    chatOnly: pinnedToolNames?.length === 0 && !subagentLoadsResources,
  });
  const chatOnly = sessionPolicy.kind === "chat-only";
  // A side chat (ADR 0007) starts as a normal session, or as Chat only, with fewer tools.
  // A chat folder never holds one.
  const isSideChat = !chatWorkspace && hasSideMetadata(sessionEntries);
  if (isSideChat && !readSideRelation(sessionEntries)) throw new Error("Invalid side chat metadata");
  const sideChatTools = isSideChat && !chatOnly;
  const selectedToolNames = sideChatTools
    ? sideToolNames(pinnedToolNames, sessionManager.getBranch().flatMap((entry) => (
        entry.type === "message" && entry.message.role === "system" ? [entry.message] : []
      )))
    : pinnedToolNames;

  return {
    sessionManager,
    params: {
      sessionCwd,
      chatWorkspace,
      chatFolder,
      chatUnlocked,
      subagentResources,
      subagentLoadsResources,
      chatOnly,
      isSideChat,
      sideChatTools,
      selectedToolNames,
    },
  };
}
