/**
 * MCP Server Marketplace Types
 *
 * 定义 MCP 服务器市场模块的类型，与 servers.json 数据结构对应
 */

export interface McpServerRepository {
  type: string;
  url: string;
}

export interface McpServerAuthor {
  name: string;
}

export interface McpServerExample {
  title: string;
  description: string;
  prompt: string;
}

export interface McpServerInstallation {
  type: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  package?: string;
  description?: string;
  recommended?: boolean;
}

export interface McpServerArgument {
  description: string;
  required: boolean;
  example: string;
}

export interface McpServerToolInputSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface McpServerTool {
  name: string;
  description: string;
  inputSchema: McpServerToolInputSchema;
}

export interface McpServerDefinition {
  name: string;
  display_name: string;
  description: string;
  repository: McpServerRepository;
  homepage: string;
  author: McpServerAuthor;
  license: string;
  categories: string[];
  tags: string[];
  examples: McpServerExample[];
  installations: Record<string, McpServerInstallation>;
  arguments?: Record<string, McpServerArgument>;
  tools?: McpServerTool[];
  prompts?: unknown[];
  resources?: unknown[];
  is_official?: boolean;
  [key: string]: unknown;
}

export interface McpServerMarketData {
  [key: string]: McpServerDefinition;
}

function inferInstallationType(command: string, explicitType?: string) {
  const type = String(explicitType || "").trim().toLowerCase();
  if (type) return type;
  const cmd = command.trim().toLowerCase();
  if (cmd === "npx") return "npx";
  if (cmd === "npm") return "npm";
  if (cmd === "uvx") return "uvx";
  if (cmd === "uv") return "uv";
  if (cmd === "python" || cmd === "python3") return "python";
  if (cmd === "docker") return "docker";
  return "custom";
}

function normalizeDirectInstallation(value: Record<string, any>): Record<string, McpServerInstallation> | null {
  if (value.installations && typeof value.installations === "object") return value.installations;

  if (typeof value.url === "string" && value.url.trim()) {
    return {
      remote: {
        type: "remote",
        command: "",
        args: [],
        recommended: true
      }
    };
  }

  const rawCommand = value.command;
  if (typeof rawCommand === "string" && rawCommand.trim()) {
    const command = rawCommand.trim();
    const args = Array.isArray(value.args) ? value.args.map(String) : [];
    const type = inferInstallationType(command, value.type);
    return {
      [type]: {
        type,
        command,
        args,
        env: value.env && typeof value.env === "object" ? value.env : value.environment,
        recommended: true
      }
    };
  }

  if (Array.isArray(rawCommand) && rawCommand.length > 0) {
    const command = String(rawCommand[0] || "").trim();
    if (!command) return null;
    const args = rawCommand.slice(1).map(String);
    const type = inferInstallationType(command, value.type);
    return {
      [type]: {
        type,
        command,
        args,
        env: value.env && typeof value.env === "object" ? value.env : value.environment,
        recommended: true
      }
    };
  }

  return null;
}

export function normalizeMcpMarketData(raw: unknown): McpServerMarketData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: McpServerMarketData = {};
  Object.entries(raw as Record<string, any>).forEach(([key, value]) => {
    if (!value || typeof value !== "object") return;
    const name = String(value.name || key).trim();
    if (!name) return;
    const installations = normalizeDirectInstallation(value) || {};
    out[key] = {
      name,
      display_name: String(value.display_name || value.displayName || name),
      description: String(value.description || "暂无描述。"),
      repository: {
        type: String(value.repository?.type || "git"),
        url: String(value.repository?.url || value.homepage || "")
      },
      url: typeof value.url === "string" ? value.url : undefined,
      homepage: String(value.homepage || value.repository?.url || ""),
      author: { name: String(value.author?.name || value.author || "Unknown") },
      license: String(value.license || "Unknown"),
      categories: Array.isArray(value.categories) ? value.categories.map(String).filter(Boolean) : ["Other"],
      tags: Array.isArray(value.tags) ? value.tags.map(String).filter(Boolean) : [],
      examples: Array.isArray(value.examples) ? value.examples.map((item: any) => ({
        title: String(item?.title || "Example"),
        description: String(item?.description || ""),
        prompt: String(item?.prompt || "")
      })) : [],
      installations,
      arguments: value.arguments && typeof value.arguments === "object" ? value.arguments : undefined,
      tools: Array.isArray(value.tools) ? value.tools : [],
      prompts: Array.isArray(value.prompts) ? value.prompts : [],
      resources: Array.isArray(value.resources) ? value.resources : [],
      is_official: Boolean(value.is_official)
    };
  });
  return out;
}

/**
 * 将 MCP Server 定义转换为 OpenCode 配置格式
 */
export interface OpencodeMcpConfig {
  type: "local" | "remote";
  command?: string[];
  url?: string;
  headers?: Record<string, string>;
  environment?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
}

/**
 * 转换 servers.json 中的安装配置为 OpenCode MCP 配置
 */
export function convertToOpencodeMcpConfig(
  serverDef: McpServerDefinition,
  installationKey: string = "npm"
): OpencodeMcpConfig | null {
  const installation = serverDef.installations[installationKey];
  if (!installation) {
    // 尝试找到第一个可用的安装方式
    const firstKey = Object.keys(serverDef.installations)[0];
    if (!firstKey) return null;
    return convertToOpencodeMcpConfig(serverDef, firstKey);
  }

  if (installation.type === "npm" || installation.type === "npx") {
    return {
      type: "local",
      command: [installation.command, ...installation.args],
      environment: installation.env,
      enabled: true
    };
  }

  if (installation.type === "uvx" || installation.type === "uv") {
    return {
      type: "local",
      command: [installation.command, ...installation.args],
      environment: installation.env,
      enabled: true
    };
  }

  if (installation.type === "python") {
    return {
      type: "local",
      command: [installation.command, ...installation.args],
      environment: installation.env,
      enabled: true
    };
  }

  if (installation.type === "docker") {
    return {
      type: "local",
      command: [installation.command, ...installation.args],
      environment: installation.env,
      enabled: true
    };
  }

  if (installation.type === "custom") {
    return {
      type: "local",
      command: [installation.command, ...installation.args],
      environment: installation.env,
      enabled: true
    };
  }

  if (installation.type === "remote" || installation.type === "http" || installation.type === "sse") {
    const url = String(serverDef.url || serverDef.homepage || "").trim();
    if (!url) return null;
    return {
      type: "remote",
      url,
      enabled: true
    };
  }

  return null;
}

/**
 * 获取服务器的主分类
 */
export function getPrimaryCategory(server: McpServerDefinition): string {
  return server.categories[0] || "Other";
}

/**
 * 获取所有唯一的分类
 */
export function getAllCategories(servers: McpServerMarketData): string[] {
  const categories = new Set<string>();
  Object.values(servers).forEach((server) => {
    server.categories.forEach((cat) => categories.add(cat));
  });
  return Array.from(categories).sort();
}

/**
 * 搜索服务器
 */
export function searchMcpServers(
  servers: McpServerMarketData,
  query: string
): McpServerDefinition[] {
  const q = query.toLowerCase().trim();
  if (!q) return Object.values(servers);

  return Object.values(servers).filter(
    (server) =>
      server.name.toLowerCase().includes(q) ||
      server.display_name.toLowerCase().includes(q) ||
      server.description.toLowerCase().includes(q) ||
      server.tags.some((tag) => tag.toLowerCase().includes(q)) ||
      server.categories.some((cat) => cat.toLowerCase().includes(q))
  );
}

/**
 * 按分类过滤服务器
 */
export function filterByCategory(
  servers: McpServerDefinition[],
  category: string
): McpServerDefinition[] {
  if (!category || category === "all") return servers;
  return servers.filter((server) => server.categories.includes(category));
}

/**
 * 获取安装方式显示名称
 */
export function getInstallationTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    npm: "NPM",
    npx: "NPX",
    uvx: "UVX",
    uv: "UV",
    python: "Python",
    docker: "Docker",
    custom: "Custom"
  };
  return labels[type] || type.toUpperCase();
}

/**
 * 获取分类显示名称
 */
export function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    "Web Services": "Web 服务",
    Messaging: "消息队列",
    Analytics: "数据分析",
    Databases: "数据库",
    "Dev Tools": "开发工具",
    "System Tools": "系统工具"
  };
  return labels[category] || category;
}
