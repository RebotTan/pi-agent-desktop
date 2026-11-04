// ============================================================================
// ToolPolicy — 工具调用审批/权限规则表
// ============================================================================
//
// 两层实现：InMemoryToolPolicyStore（进程内，测试用）与 FileToolPolicyStore
// （生产用，落 ~/.pi/agent/pi-web/settings.json 的 `toolPolicyRules`，重启后仍在）。
//
// 单例挂在 globalThis.__piToolPolicyStore（HMR 纪律，与 __piEngine 同构）。
import { randomUUID } from "node:crypto";

import { getPiWebSettingsPath, readStored, updatePiWebSettings } from "./artifact-settings";

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

  /** 用给定规则整体替换；数组顺序即匹配优先级。供持久化实现复用。 */
  protected replaceAll(rules: readonly ToolPolicyRule[]): void {
    this.matchers = rules.map((rule) => ({ rule, matches: compilePattern(rule.pattern) }));
  }
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

/**
 * 从 Pi Web 的设置文件读规则。读不到、坏 JSON、条目非法一律当「没有这条规则」——
 * 与 `decide` 的无匹配即 allow 保持同一取向：宁可少一条限制，也不要整个面板打不开。
 */
export function readToolPolicyRules(settingsPath = getPiWebSettingsPath()): ToolPolicyRule[] {
  let raw: unknown;
  try {
    raw = readStored(settingsPath).toolPolicyRules;
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const rule = toToolPolicyRule(entry);
    return rule ? [rule] : [];
  });
}

export function writeToolPolicyRules(rules: readonly ToolPolicyRule[], settingsPath = getPiWebSettingsPath()): void {
  updatePiWebSettings({ toolPolicyRules: rules }, settingsPath);
}

function toToolPolicyRule(value: unknown): ToolPolicyRule | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const { id, pattern, action, note } = entry;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof pattern !== "string" || pattern.length === 0) return null;
  if (action !== "allow" && action !== "deny" && action !== "ask") return null;
  return {
    id,
    pattern,
    action,
    ...(typeof note === "string" && note.length > 0 ? { note } : {}),
  };
}

/**
 * 生产实现：每次改动先落内存再写盘，写盘失败整体回滚并向上抛，
 * 避免内存与文件分叉（否则重启后规则会「自己变回去」）。
 */
export class FileToolPolicyStore extends InMemoryToolPolicyStore {
  private readonly settingsPath: string;

  constructor(settingsPath = getPiWebSettingsPath()) {
    super();
    this.settingsPath = settingsPath;
    this.replaceAll(readToolPolicyRules(settingsPath));
  }

  override addRule(rule: Omit<ToolPolicyRule, "id">): ToolPolicyRule {
    const full: ToolPolicyRule = { ...rule, id: randomUUID() };
    this.commit([...this.listRules(), full]);
    return full;
  }

  override removeRule(id: string): boolean {
    const current = this.listRules();
    const remaining = current.filter((rule) => rule.id !== id);
    if (remaining.length === current.length) return false;
    this.commit(remaining);
    return true;
  }

  private commit(next: readonly ToolPolicyRule[]): void {
    const previous = this.listRules();
    this.replaceAll(next);
    try {
      writeToolPolicyRules(next, this.settingsPath);
    } catch (error) {
      this.replaceAll(previous);
      throw error;
    }
  }
}
declare global {
  var __piToolPolicyStore: ToolPolicyStore | undefined;
}

let cachedStore: ToolPolicyStore | undefined;

/** 单例。实例常驻 globalThis.__piToolPolicyStore，跨模块热重载存活。 */
export function getToolPolicyStore(): ToolPolicyStore {
  if (!cachedStore) {
    cachedStore = globalThis.__piToolPolicyStore ??= new FileToolPolicyStore();
  }
  return cachedStore;
}