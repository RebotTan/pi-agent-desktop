import { NextResponse } from "next/server";
import { getPluginRegistry } from "@/lib/plugin-registry";

// 注册表是进程内可变状态，必须每次请求现算；静态化会把构建时的快照发出去。
export const dynamic = "force-dynamic";

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