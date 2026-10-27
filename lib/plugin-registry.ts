// ============================================================================
// PluginRegistry — 插件三层注册点骨架（PR-6）
// ============================================================================
//
// 为将来的自建插件系统留的三层接缝（见 pideck capability catalog 的
// 「插件三层注册点」，grill 决策 + .scratch/tickets/0006-plugin-registry.md）：
//
// 1. service 层：任意服务实例按 id 注册/取用（getService/registerService）。
//    内建服务（agent-engine / session-store / agent-event-bus / tool-policy）
//    在单例创建时自动登记，插件拿到的是同一个 globalThis 实例。
// 2. agent 层：registerAgentExtension 收集 InlineExtension，rpc-manager 装配
//    extensionFactories 时把它们 append 进会话（普通项目分支 + chatWorkspace
//    分支），与 builtins 扩展并用 pi 的原生扩展能力。
// 3. UI 层：registerUiContribution 存 UI 贡献（kind + 宽松 payload），只读
//    GET /api/plugins/contributions 暴露给前端；渲染契约后续 PR 定义。
//
// 单例挂在 globalThis.__piPluginRegistry（HMR 纪律，同 __piEngine）。
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { getAgentEventBus } from "./agent-event-bus";
import { getEngine } from "./agent-engine";
import { getSessionStore } from "./session-store";
import { getToolPolicyStore } from "./tool-policy";

/** UI 层贡献（宽松契约，后续 PR 细化 kind/payload）。 */
export interface UiContribution {
  id: string;
  /** 如 "panel" | "command" | "tool-card"（骨架只存储，不解释）。 */
  kind: string;
  title?: string;
  payload: unknown;
}

export interface PluginRegistry {
  /** agent 层：会话装配时要 append 的扩展。 */
  getAgentExtensions(): InlineExtension[];
  registerAgentExtension(ext: InlineExtension): void;
  /** service 层：任意服务实例。 */
  getService<T>(id: string): T | undefined;
  registerService<T>(id: string, instance: T): void;
  listServiceIds(): string[];
  /** UI 层：贡献清单。 */
  listUiContributions(): UiContribution[];
  registerUiContribution(contrib: UiContribution): void;
}

export class InMemoryPluginRegistry implements PluginRegistry {
  private agentExtensions: InlineExtension[] = [];
  private services = new Map<string, unknown>();
  private uiContributions: UiContribution[] = [];

  getAgentExtensions(): InlineExtension[] {
    return [...this.agentExtensions];
  }

  registerAgentExtension(ext: InlineExtension): void {
    this.agentExtensions.push(ext);
  }

  getService<T>(id: string): T | undefined {
    return this.services.get(id) as T | undefined;
  }

  registerService<T>(id: string, instance: T): void {
    this.services.set(id, instance);
  }

  listServiceIds(): string[] {
    return [...this.services.keys()].sort();
  }

  listUiContributions(): UiContribution[] {
    return [...this.uiContributions];
  }

  registerUiContribution(contrib: UiContribution): void {
    this.uiContributions.push(contrib);
  }
}

/** 把本 fork 的内建单例登记进注册表，插件可经 getService 拿到。 */
export function registerBuiltinServices(registry: PluginRegistry): void {
  registry.registerService("agent-engine", getEngine());
  registry.registerService("session-store", getSessionStore());
  registry.registerService("agent-event-bus", getAgentEventBus());
  registry.registerService("tool-policy", getToolPolicyStore());
}

declare global {
  var __piPluginRegistry: PluginRegistry | undefined;
}

let cached: PluginRegistry | undefined;

/** 单例。实例常驻 globalThis.__piPluginRegistry，首次创建时预注册内建服务。 */
export function getPluginRegistry(): PluginRegistry {
  if (!cached) {
    cached = globalThis.__piPluginRegistry ??= new InMemoryPluginRegistry();
    registerBuiltinServices(cached);
  }
  return cached;
}