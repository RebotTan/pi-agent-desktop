import { NextResponse } from "next/server";
import { getPluginRegistry } from "@/lib/plugin-registry";

/** 只读列出三层注册点当前状态（服务 id 清单 / agent 扩展数 / UI 贡献）。 */
export async function GET() {
  const registry = getPluginRegistry();
  return NextResponse.json({
    services: registry.listServiceIds(),
    agentExtensions: registry.getAgentExtensions().length,
    agentExtensionNames: registry.getAgentExtensions().map((ext) => ext.name),
    uiContributions: registry.listUiContributions(),
  });
}