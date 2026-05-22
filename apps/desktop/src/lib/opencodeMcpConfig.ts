import type { McpServerMarketData } from "./mcpMarket";

export type OpencodeMcpParamSpec = {
  key: string;
  required: boolean;
  description: string;
  example: string;
};

export function getMcpMarketDefinition(marketServers: McpServerMarketData, name: string): any | null {
  const target = name.trim().toLowerCase();
  return Object.values(marketServers as Record<string, any>).find((server: any) => {
    const names = [server?.name, server?.display_name, String(server?.display_name || "").toLowerCase().replace(/\s+/g, "-")];
    return names.some((item) => String(item || "").trim().toLowerCase() === target);
  }) || null;
}

export function getInstalledMcpParamSpecs(
  marketServers: McpServerMarketData,
  name: string,
  status: Record<string, unknown> | undefined
): OpencodeMcpParamSpec[] {
  const state: any = status || {};
  const definition = getMcpMarketDefinition(marketServers, name);
  const specs = new Map<string, OpencodeMcpParamSpec>();
  const addSpec = (key: string, required = false, description = "", example = "") => {
    const normalizedKey = key.trim();
    if (!normalizedKey) return;
    const previous = specs.get(normalizedKey);
    specs.set(normalizedKey, {
      key: normalizedKey,
      required: Boolean(previous?.required || required),
      description: previous?.description || description,
      example: previous?.example || example
    });
  };
  Object.entries(definition?.arguments || {}).forEach(([key, arg]: [string, any]) => {
    addSpec(key, Boolean(arg?.required), String(arg?.description || ""), String(arg?.example || ""));
  });
  const scanPlaceholder = (value: unknown) => {
    const match = String(value ?? "").match(/^\$\{([^}]+)\}$/);
    if (match?.[1]) addSpec(match[1], true);
  };
  if (Array.isArray(state.command)) state.command.forEach(scanPlaceholder);
  Object.values(state.environment || {}).forEach(scanPlaceholder);
  Object.values(state.headers || {}).forEach(scanPlaceholder);
  if (specs.size === 0) {
    const params = state.type === "remote" ? state.headers : state.environment;
    Object.keys(params || {}).forEach((key) => addSpec(key, false));
  }
  return Array.from(specs.values());
}

export function getInstalledMcpTools(marketServers: McpServerMarketData, name: string): any[] {
  const definition = getMcpMarketDefinition(marketServers, name);
  return Array.isArray(definition?.tools) ? definition.tools : [];
}

export type OpencodeMcpPanelRow = {
  name: string;
  sourceLabel: string;
  typeLabel: string;
  toolsCount: number;
};

export function buildOpencodeMcpRows(status: Record<string, Record<string, unknown>>, visible: boolean) {
  if (!visible) return [];
  return Object.entries(status).sort(([a], [b]) => a.localeCompare(b));
}

export function buildOpencodeMcpPanelRows(
  rows: Array<[string, Record<string, unknown>]>,
  getTools: (name: string) => unknown[]
): OpencodeMcpPanelRow[] {
  return rows.map(([name, status]) => {
    const state: any = status || {};
    const source = String(state.source || (state.configured ? "project" : "runtime"));
    return {
      name,
      sourceLabel: source === "both" ? "项目+全局" : source === "global" ? "全局" : source === "project" ? "项目" : source,
      typeLabel: String(state.type || "mcp"),
      toolsCount: getTools(name).length
    };
  });
}

export function normalizeCustomMcpJson(input: string, fallbackName: string): { name: string; config: Record<string, unknown> } {
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("config must be an object");
  const root = parsed as Record<string, any>;
  const wrapped = root.mcpServers || root.mcp;
  if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
    const entries = Object.entries(wrapped as Record<string, any>);
    if (entries.length !== 1 && !fallbackName.trim()) throw new Error("mcpServers/mcp 中包含多个 server，请填写名称");
    const [wrappedName, wrappedConfig] = fallbackName.trim()
      ? [fallbackName.trim(), (wrapped as Record<string, any>)[fallbackName.trim()] || entries[0]?.[1]]
      : entries[0];
    if (!wrappedConfig || typeof wrappedConfig !== "object" || Array.isArray(wrappedConfig)) throw new Error("server config must be an object");
    return normalizeCustomMcpConfig(wrappedName, wrappedConfig as Record<string, unknown>);
  }
  const entries = Object.entries(root);
  if (!root.type && !root.command && !root.url && entries.length === 1) {
    const [marketName, marketConfig] = entries[0] as [string, any];
    if (marketConfig && typeof marketConfig === "object" && !Array.isArray(marketConfig) && marketConfig.installations) {
      return normalizeMarketplaceMcpDefinition(fallbackName.trim() || marketName, marketConfig);
    }
  }
  if (root.installations) return normalizeMarketplaceMcpDefinition(fallbackName.trim() || String(root.name || ""), root);
  if (!root.type && !root.command && !root.url && entries.length === 1) {
    const [directName, directConfig] = entries[0] as [string, any];
    if (directConfig && typeof directConfig === "object" && !Array.isArray(directConfig)) {
      return normalizeCustomMcpConfig(fallbackName.trim() || directName, directConfig as Record<string, unknown>);
    }
  }
  return normalizeCustomMcpConfig(fallbackName.trim(), root);
}

export function inferCustomMcpName(input: string): string {
  try {
    const parsed = JSON.parse(input);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    const root = parsed as Record<string, any>;
    if (root.installations && root.name) return String(root.name);
    const wrapped = root.mcpServers || root.mcp;
    const directMap = !wrapped && !root.type && !root.command && !root.url ? root : wrapped;
    if (directMap && typeof directMap === "object" && !Array.isArray(directMap)) {
      const entries = Object.entries(directMap as Record<string, any>);
      if (entries.length === 1) {
        const [key, value] = entries[0];
        if (value?.installations) return String(value.name || key);
      }
    }
    if (!directMap || typeof directMap !== "object" || Array.isArray(directMap)) return "";
    const keys = Object.keys(directMap).filter(Boolean);
    return keys.length === 1 ? keys[0] : "";
  } catch {
    return "";
  }
}

function normalizeCustomMcpConfig(name: string, raw: Record<string, unknown>): { name: string; config: Record<string, unknown> } {
  const config: Record<string, unknown> = { ...raw };
  if (!name) throw new Error("MCP name is required");
  if (!config.type) {
    if (typeof config.url === "string") config.type = "remote";
    else if (typeof config.command === "string" || Array.isArray(config.command)) config.type = "local";
  }
  if (typeof config.command === "string") {
    config.command = [config.command, ...(Array.isArray(config.args) ? config.args.map(String) : [])];
    delete config.args;
  } else if (Array.isArray(config.command) && Array.isArray(config.args)) {
    config.command = [...config.command.map(String), ...config.args.map(String)];
    delete config.args;
  }
  if (config.env && !config.environment) {
    config.environment = config.env;
    delete config.env;
  }
  if (typeof config.enabled === "undefined") config.enabled = true;
  if (config.type !== "local" && config.type !== "remote") throw new Error('必须包含 type: "local" 或 "remote"，或提供 command/url 以自动推断');
  if (config.type === "local" && (!Array.isArray(config.command) || config.command.length === 0)) throw new Error('local MCP 必须包含 command，例如 ["npx", "-y", "server"]');
  if (config.type === "remote" && typeof config.url !== "string") throw new Error('remote MCP 必须包含 url，例如 "https://mcp.example.com/mcp"');
  return { name, config };
}

function normalizeMarketplaceMcpDefinition(name: string, raw: any): { name: string; config: Record<string, unknown> } {
  const serverName = name || String(raw?.name || "").trim();
  if (!serverName) throw new Error("marketplace MCP 缺少名称");
  const installations = raw?.installations && typeof raw.installations === "object" ? raw.installations : null;
  if (!installations) throw new Error("marketplace MCP 缺少 installations");
  const entries = Object.entries(installations) as Array<[string, any]>;
  const [, install] = entries.find(([, item]) => item?.recommended) || entries[0] || [];
  if (!install || typeof install !== "object") throw new Error("marketplace MCP 没有可用安装方式");
  const command = [String(install.command || "").trim(), ...(Array.isArray(install.args) ? install.args.map(String) : [])].filter(Boolean);
  if (command.length === 0) throw new Error("marketplace MCP 安装方式缺少 command");
  const config: Record<string, unknown> = { type: "local", command, enabled: true };
  const env = install.env && typeof install.env === "object" ? { ...install.env } : undefined;
  if (env && Object.keys(env).length > 0) config.environment = env;
  return { name: serverName, config };
}

function readMarketplaceDefinitionFromCustomJson(input: string, fallbackName: string): any | null {
  try {
    const parsed = JSON.parse(input);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const root = parsed as Record<string, any>;
    if (root.installations) return root;
    const wrapped = root.mcpServers || root.mcp;
    const directMap = wrapped && typeof wrapped === "object" && !Array.isArray(wrapped) ? wrapped : root;
    const entries = Object.entries(directMap as Record<string, any>);
    if (entries.length === 1) {
      const [, value] = entries[0];
      if (value && typeof value === "object" && !Array.isArray(value) && value.installations) return value;
    }
    if (fallbackName && directMap?.[fallbackName]?.installations) return directMap[fallbackName];
  } catch {
    return null;
  }
  return null;
}

function collectPlaceholderNames(value: unknown, out: Set<string>) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\$\{([^}]+)\}/g)) {
      if (match[1]) out.add(match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectPlaceholderNames(item, out));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectPlaceholderNames(item, out));
  }
}

export function getCustomMcpParamSpecs(input: string, fallbackName: string): OpencodeMcpParamSpec[] {
  const specs = new Map<string, OpencodeMcpParamSpec>();
  const add = (key: string, required = true, description = "", example = "") => {
    const normalizedKey = key.trim();
    if (!normalizedKey) return;
    const previous = specs.get(normalizedKey);
    specs.set(normalizedKey, {
      key: normalizedKey,
      required: Boolean(previous?.required || required),
      description: previous?.description || description,
      example: previous?.example || example
    });
  };
  const market = readMarketplaceDefinitionFromCustomJson(input, fallbackName);
  Object.entries(market?.arguments || {}).forEach(([key, arg]: [string, any]) => {
    add(key, Boolean(arg?.required), String(arg?.description || ""), String(arg?.example || ""));
  });
  try {
    const { config } = normalizeCustomMcpJson(input, fallbackName);
    const placeholders = new Set<string>();
    collectPlaceholderNames(config, placeholders);
    placeholders.forEach((key) => add(key, true));
  } catch {
    // Invalid JSON/config is already shown in preview; no parameter form needed yet.
  }
  return Array.from(specs.values());
}

export function replaceMcpConfigPlaceholders(value: unknown, values: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/g, (full, key) => {
      const next = String(values[key] || "").trim();
      return next || full;
    });
  }
  if (Array.isArray(value)) return value.map((item) => replaceMcpConfigPlaceholders(item, values));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, replaceMcpConfigPlaceholders(item, values)]));
  }
  return value;
}

export function getEditableMcpParamValues(
  status: Record<string, unknown> | undefined,
  specs: OpencodeMcpParamSpec[]
): Record<string, string> {
  const state: any = status || {};
  const params = (state.type === "remote" ? state.headers : state.environment) || {};
  const values: Record<string, string> = {};
  specs.forEach((spec) => {
    values[spec.key] = params && typeof params === "object" ? String((params as any)[spec.key] ?? "") : "";
  });
  return values;
}

export function getMissingMcpRequiredParams(
  specs: OpencodeMcpParamSpec[],
  values: Record<string, string>
): OpencodeMcpParamSpec[] {
  return specs.filter((spec) => spec.required && !String(values[spec.key] || "").trim());
}

export function buildUpdatedMcpParamConfig(
  status: Record<string, unknown> | undefined,
  values: Record<string, string>
): Record<string, unknown> {
  const state: any = status || {};
  const config: Record<string, unknown> = { ...state };
  for (const key of ["source", "configured", "runtimeKnown", "status", "state", "error", "message", "reason"]) {
    delete config[key];
  }
  const parsed = Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, String(value || "").trim()] as const)
      .filter(([, value]) => value)
  );
  if (state.type === "remote") {
    if (Object.keys(parsed).length > 0) config.headers = parsed;
    else delete config.headers;
  } else {
    if (Object.keys(parsed).length > 0) config.environment = parsed;
    else delete config.environment;
  }
  return config;
}
