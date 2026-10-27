// ============================================================================
// ToolPolicy — 工具调用审批/权限规则表
// ============================================================================
//
// PR-4 的存储层：规则表（pattern → allow | deny | ask）。决策语义 = 首个匹配
// 规则获胜，无匹配 = allow（现状行为）。pattern 支持 `*` 通配（如 `mcp__*`、
// `bash`、`edit`），用自写 glob→正则转换，不引依赖。
//
// 范围：只做内存单例（进程内存活），JSON 持久化在后续 PR（见
// .scratch/tickets/0004-tool-approval-policy.md 的 Out-of-scope）。
//
// 单例挂在 globalThis.__piToolPolicyStore（HMR 纪律，与 __piEngine 同构）。
import { randomUUID } from "node:crypto";

export type ToolPolicyAction = "allow" | "deny" | "ask";

export interface ToolPolicyRule {
  id: string;
  /** 工具名或带 `*` 通配的 pattern，如 `bash`、`mcp__*`、`edit`。 */
  pattern: string;
  action: ToolPolicyAction;
  /** 可选说明，随规则展示 / 可用作拦截 reason 后缀。 */
  note?: string;
}

export interface ToolPolicyStore {
  listRules(): ToolPolicyRule[];
  addRule(rule: Omit<ToolPolicyRule, "id">): ToolPolicyRule;
  removeRule(id: string): boolean;
  /**
   * 对一次工具调用做决策。
   * 首个匹配规则（按添加顺序）获胜；无匹配 → `"allow"`。
   */
  decide(toolName: string): ToolPolicyAction;
}

/** 把 `*` 通配 pattern 编译成匹配函数（`*` → `.*`，其余按字面）。 */
function compilePattern(pattern: string): (name: string) => boolean {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const re = new RegExp(`^${escaped}$`);
  return (name) => re.test(name);
}

interface Matcher {
  rule: ToolPolicyRule;
  matches: (name: string) => boolean;
}

export class InMemoryToolPolicyStore implements ToolPolicyStore {
  private matchers: Matcher[] = [];

  listRules(): ToolPolicyRule[] {
    return this.matchers.map((m) => m.rule);
  }

  addRule(rule: Omit<ToolPolicyRule, "id">): ToolPolicyRule {
    const full: ToolPolicyRule = { ...rule, id: randomUUID() };
    this.matchers.push({ rule: full, matches: compilePattern(full.pattern) });
    return full;
  }

  removeRule(id: string): boolean {
    const idx = this.matchers.findIndex((m) => m.rule.id === id);
    if (idx === -1) return false;
    this.matchers.splice(idx, 1);
    return true;
  }

  decide(toolName: string): ToolPolicyAction {
    for (const m of this.matchers) {
      if (m.matches(toolName)) return m.rule.action;
    }
    return "allow";
  }
}

declare global {
  var __piToolPolicyStore: ToolPolicyStore | undefined;
}

let cachedStore: ToolPolicyStore | undefined;

/** 单例。实例常驻 globalThis.__piToolPolicyStore，跨模块热重载存活。 */
export function getToolPolicyStore(): ToolPolicyStore {
  if (!cachedStore) {
    cachedStore = globalThis.__piToolPolicyStore ??= new InMemoryToolPolicyStore();
  }
  return cachedStore;
}