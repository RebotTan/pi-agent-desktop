// ============================================================================
// ApprovalCoordinator — 待审批工具调用注册表
// ============================================================================
//
// PR-4 的挂起层：`ask` 命中的工具调用来到这里挂起（等待人工批准/拒绝），
// settle 结算后放行或拦截。agent 侧阻塞在 requestApproval 的 Promise 上。
// 审批结果由外部（HTTP API → 后续 UI）通过 settle(id, approved) 注入。
import { randomUUID } from "node:crypto";

export interface PendingApprovalView {
  id: string;
  toolName: string;
  /** 工具参数只读快照（调用方传入的浅拷贝）。 */
  args: unknown;
  requestedAt: number;
}

interface PendingApproval extends PendingApprovalView {
  resolve: (approved: boolean) => void;
}

export class ApprovalCoordinator {
  private pending = new Map<string, PendingApproval>();

  /** 挂起一次待审批，返回解析为 `approved` 的 Promise（settle 前不 resolve）。 */
  requestApproval(toolName: string, args: unknown): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const id = randomUUID();
      this.pending.set(id, {
        id,
        toolName,
        args,
        requestedAt: Date.now(),
        resolve,
      });
    });
  }

  /** 当前所有待审批项（按挂起顺序）。 */
  listPending(): PendingApprovalView[] {
    return [...this.pending.values()].map(({ id, toolName, args, requestedAt }) => ({
      id,
      toolName,
      args,
      requestedAt,
    }));
  }

  /** 结算一次待审批。返回 false 表示 id 不存在（已被结算或从未挂起）。 */
  settle(id: string, approved: boolean): boolean {
    const item = this.pending.get(id);
    if (!item) return false;
    this.pending.delete(id);
    item.resolve(approved);
    return true;
  }

  /** 待审批数量（供轮询/去重用）。 */
  count(): number {
    return this.pending.size;
  }
}

declare global {
  var __piApprovalCoordinator: ApprovalCoordinator | undefined;
}

let cached: ApprovalCoordinator | undefined;

/** 单例。实例常驻 globalThis.__piApprovalCoordinator，跨模块热重载存活。 */
export function getApprovalCoordinator(): ApprovalCoordinator {
  if (!cached) {
    cached = globalThis.__piApprovalCoordinator ??= new ApprovalCoordinator();
  }
  return cached;
}