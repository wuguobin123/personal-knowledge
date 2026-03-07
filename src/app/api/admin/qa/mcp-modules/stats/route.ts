/**
 * MCP 连接状态统计 API
 */

import { getAdminSession } from "@/lib/auth";
import { getGlobalConnectionManager } from "@/lib/mcp/runtime";
import { listEnabledQaMcpModules } from "@/lib/qa/mcp-modules";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const manager = getGlobalConnectionManager();
    const modules = await listEnabledQaMcpModules();
    
    // 获取统计信息
    const stats = manager.getStats();
    
    // 获取每个模块的状态
    const moduleStatuses = modules.map(module => {
      const client = manager.getClient(module.moduleKey);
      const state = client?.getState();
      
      return {
        moduleKey: module.moduleKey,
        label: module.label,
        transport: module.transport,
        isConnected: state?.status === "connected",
        status: state?.status || "disconnected",
        error: state?.error,
        lastConnectedAt: state?.lastConnectedAt,
        retryCount: state?.retryCount || 0,
      };
    });

    return Response.json({
      stats,
      modules: moduleStatuses,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get MCP stats.";
    return Response.json({ error: message }, { status: 500 });
  }
}
