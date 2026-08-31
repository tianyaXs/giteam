/**
 * MCP 管理面板数据层：`agent_mcp_*` RPC 的类型与调用薄壳。
 * 后端为 giteam-core 的 `pi_agent::mcp::admin`（每仓库 mcpstore 配置）。
 */

import { invoke } from "./platform";

export type McpServiceStatus = {
  name: string;
  transport: string;
  url: string | null;
  command: string | null;
  phase: string;
  toolCount: number;
  failure: string | null;
};

export type McpToolInfo = {
  exposedName: string;
  serviceName: string;
  toolName: string;
  description: string;
  inputSchema: unknown;
};

export type McpServiceError = {
  service: string;
  message: string;
};

export type McpToolsSnapshot = {
  tools: McpToolInfo[];
  serviceErrors: McpServiceError[];
};

export type McpMutationResult = {
  requiresNewSession: boolean;
};

/** 面板提交的服务定义（对应 Rust `McpServiceInput`，camelCase）。 */
export type McpServiceInput = {
  name: string;
  enabled: boolean;
  url: string | null;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
  description: string | null;
};

export function listMcpServices(repoPath: string): Promise<McpServiceStatus[]> {
  return invoke<McpServiceStatus[]>("agent_mcp_list_services", { repoPath });
}

export function listMcpTools(repoPath: string): Promise<McpToolsSnapshot> {
  return invoke<McpToolsSnapshot>("agent_mcp_list_tools", { repoPath });
}

export function addMcpService(repoPath: string, input: McpServiceInput): Promise<McpMutationResult> {
  return invoke<McpMutationResult>("agent_mcp_add_service", { repoPath, input });
}

export function removeMcpService(repoPath: string, name: string): Promise<McpMutationResult> {
  return invoke<McpMutationResult>("agent_mcp_remove_service", { repoPath, name });
}

export function connectMcpService(repoPath: string, name: string): Promise<McpServiceStatus> {
  return invoke<McpServiceStatus>("agent_mcp_connect_service", { repoPath, name });
}

export function disconnectMcpService(repoPath: string, name: string): Promise<McpServiceStatus> {
  return invoke<McpServiceStatus>("agent_mcp_disconnect_service", { repoPath, name });
}

/** 逐行文本 → argv（去掉空行与首尾空白）。 */
export function parseArgLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** `KEY=VALUE` 逐行文本 → 记录（非法行忽略；重复键后者覆盖）。 */
export function parseKeyValueLines(text: string): Record<string, string> {
  const record: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    record[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return record;
}
