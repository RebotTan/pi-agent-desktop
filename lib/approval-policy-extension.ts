// ============================================================================
// ApprovalPolicyExtension — 工具调用审批/权限管道（PR-4）
// ============================================================================
//
// 在 tool call 执行前按规则表决策：deny 直接拦截、ask 挂起等人工批准/拒绝。
// 挂到 `pi.on("tool_call")`（可 async，等待期间 agent 阻塞），与
// createReadOnlyMcpPolicyExtension（lib/mcp-read-only-policy.ts）同一个 seam，
// 只处理本项目会话分支（见 .scratch/tickets/0004-tool-approval-policy.md）。
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { getApprovalCoordinator } from "./approval-coordinator";
import { getToolPolicyStore } from "./tool-policy";

export const APPROVAL_POLICY_EXTENSION_NAME = "pi-web-tool-approval";

export function approvalBlockReason(toolName: string): string {
  return `工具调用 "${toolName}" 被权限规则拦截。`;
}

export function approvalRejectedReason(toolName: string): string {
  return `工具调用 "${toolName}" 未获批准（用户拒绝）。`;
}

export function createApprovalPolicyExtension(): InlineExtension {
  return {
    name: APPROVAL_POLICY_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.on("tool_call", async (event) => {
        const action = getToolPolicyStore().decide(event.toolName);
        if (action === "deny") {
          return { block: true, reason: approvalBlockReason(event.toolName) };
        }
        if (action === "ask") {
          const approved = await getApprovalCoordinator().requestApproval(
            event.toolName,
            { ...(event.input ?? {}) },
          );
          if (!approved) {
            return { block: true, reason: approvalRejectedReason(event.toolName) };
          }
        }
        return undefined;
      });
    },
  };
}