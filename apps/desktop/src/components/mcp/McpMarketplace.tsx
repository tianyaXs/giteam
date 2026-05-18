import { useEffect, useMemo, useState } from "react";
import {
  convertToOpencodeMcpConfig,
  filterByCategory,
  getAllCategories,
  getCategoryLabel,
  getInstallationTypeLabel,
  getPrimaryCategory,
  searchMcpServers,
  type McpServerDefinition,
  type McpServerMarketData
} from "../../lib/mcpMarket";

interface McpMarketplaceProps {
  servers: McpServerMarketData;
  configuredMcps?: string[];
  onAddMcp?: (name: string, config: Record<string, unknown>) => void | Promise<void>;
}

function getDefaultInstallKey(server: McpServerDefinition) {
  const entries = Object.entries(server.installations);
  return entries.find(([, install]) => install.recommended)?.[0] || entries[0]?.[0] || "";
}

export function McpMarketplace({ servers, configuredMcps = [], onAddMcp }: McpMarketplaceProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [addingServer, setAddingServer] = useState("");
  const [notice, setNotice] = useState("");
  const [configServer, setConfigServer] = useState<McpServerDefinition | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const categories = useMemo(() => getAllCategories(servers), [servers]);
  const filteredServers = useMemo(() => filterByCategory(searchMcpServers(servers, searchQuery), selectedCategory), [servers, searchQuery, selectedCategory]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function getParamKeys(server: McpServerDefinition) {
    const keys = new Map<string, boolean>();
    Object.entries(server.arguments || {}).forEach(([key, arg]) => keys.set(key, Boolean(arg.required)));
    Object.values(server.installations).forEach((install) => {
      Object.values(install.env || {}).forEach((value) => {
        const match = String(value).match(/^\$\{([^}]+)\}$/);
        if (match?.[1] && !keys.has(match[1])) keys.set(match[1], true);
      });
    });
    return Array.from(keys.entries()).map(([key, required]) => ({ key, required, meta: server.arguments?.[key] }));
  }

  function openConfigure(server: McpServerDefinition) {
    const params = getParamKeys(server);
    if (params.length === 0) {
      void handleAddServer(server, {});
      return;
    }
    setParamValues(Object.fromEntries(params.map((param) => [param.key, ""])));
    setConfigServer(server);
  }

  async function handleAddServer(server: McpServerDefinition, values: Record<string, string>) {
    if (!onAddMcp) return;
    const params = getParamKeys(server);
    const missing = params.filter((param) => param.required && !String(values[param.key] || "").trim());
    if (missing.length > 0) {
      setNotice(`请填写必填参数：${missing.map((item) => item.key).join(", ")}`);
      return;
    }
    const installKey = getDefaultInstallKey(server);
    const config = convertToOpencodeMcpConfig(server, installKey);
    if (!config) {
      setNotice("该 MCP 暂无可转换的安装配置");
      return;
    }
    const env = { ...(config.environment || {}) };
    Object.entries(values).forEach(([key, value]) => {
      const trimmed = value.trim();
      if (trimmed) env[key] = trimmed;
    });
    Object.entries(env).forEach(([key, value]) => {
      const match = String(value).match(/^\$\{([^}]+)\}$/);
      if (match?.[1] && values[match[1]]?.trim()) env[key] = values[match[1]].trim();
    });
    config.environment = Object.keys(env).length > 0 ? env : undefined;

    setAddingServer(server.name);
    try {
      await onAddMcp(server.name, config as unknown as Record<string, unknown>);
      setNotice(`${server.display_name} 已添加`);
      setConfigServer(null);
    } catch (e) {
      setNotice(String(e));
    } finally {
      setAddingServer("");
    }
  }

  return (
    <section className="gt-mcp-market-list">
      <div className="gt-mcp-market-toolbar">
        <div className="gt-skill-searchbox gt-mcp-searchbox">
          <span aria-hidden="true">⌕</span>
          <input
            placeholder="搜索 MCP 服务、标签、分类..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="gt-mcp-market-tabs">
        <button type="button" className={selectedCategory === "all" ? "active" : ""} onClick={() => setSelectedCategory("all")}>全部</button>
        {categories.map((category) => (
          <button key={category} type="button" className={selectedCategory === category ? "active" : ""} onClick={() => setSelectedCategory(category)}>{getCategoryLabel(category)}</button>
        ))}
      </div>
      {notice ? <div className="gt-mcp-market-notice">{notice}</div> : null}
      <div className="gt-mcp-market-meta"><span>{filteredServers.length} servers · 悬浮卡片查看详情</span></div>
      {filteredServers.length === 0 ? (
        <div className="gt-skill-inspector-empty gt-skill-empty-state"><strong>没有找到匹配的 MCP</strong><span>试试清空搜索词或切换分类。</span></div>
      ) : (
        <div className="gt-mcp-market-card-list">
          {filteredServers.map((server) => {
            const isConfigured = configuredMcps.includes(server.name);
            const installKey = getDefaultInstallKey(server);
            const install = installKey ? server.installations[installKey] : null;
            return (
              <article key={server.name} className={`gt-mcp-market-card ${isConfigured ? "configured" : ""}`}>
                <div className="gt-mcp-market-card-top">
                  <strong>{server.display_name}</strong>
                  <span>{getCategoryLabel(getPrimaryCategory(server))}</span>
                </div>
                <p>{server.description}</p>
                <div className="gt-mcp-market-card-tags">
                  {server.is_official ? <span className="official">官方</span> : null}
                  {isConfigured ? <span className="configured">已配置</span> : null}
                  {server.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                <div className="gt-mcp-market-card-foot">
                  <span>{server.tools?.length || 0} tools</span>
                  <span>{install ? getInstallationTypeLabel(install.type) : "no install"}</span>
                  {isConfigured ? (
                    <span className="gt-mcp-installed-badge">Added</span>
                  ) : (
                    <button type="button" className={`gt-skill-get-btn gt-mcp-get-button ${addingServer === server.name ? "is-installing" : ""}`} onClick={() => openConfigure(server)} disabled={addingServer === server.name}>{addingServer === server.name ? "..." : "Get"}</button>
                  )}
                </div>
                <div className="gt-mcp-hover-detail" role="tooltip">
                  <div className="gt-mcp-hover-head">
                    <strong>{server.display_name}</strong>
                    <span>{server.license}</span>
                  </div>
                  <p>{server.description}</p>
                  {server.arguments && Object.keys(server.arguments).length > 0 ? (
                    <div className="gt-mcp-hover-section">
                      <span>配置参数</span>
                      {Object.entries(server.arguments).slice(0, 3).map(([key, arg]) => <code key={key}>{key}{arg.required ? " *" : ""}</code>)}
                    </div>
                  ) : null}
                  {server.tools && server.tools.length > 0 ? (
                    <div className="gt-mcp-hover-section">
                      <span>工具预览</span>
                      {server.tools.slice(0, 4).map((tool) => <code key={tool.name}>{tool.name}</code>)}
                    </div>
                  ) : null}
                  {install ? <code className="gt-mcp-hover-command">{install.command} {install.args.join(" ")}</code> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {configServer ? (
        <div className="gt-mcp-config-popover" role="dialog" aria-modal="true">
          <div className="gt-mcp-config-card">
            <div className="gt-mcp-config-head">
              <div><span className="gt-module-kicker">configure mcp</span><strong>{configServer.display_name}</strong></div>
              <button type="button" className="gt-icon-chip" onClick={() => setConfigServer(null)}>×</button>
            </div>
            <p>填写连接所需参数后再添加到 OpenCode 配置。</p>
            <div className="gt-mcp-config-fields">
              {getParamKeys(configServer).map((param) => (
                <label key={param.key}>
                  <span>{param.key}{param.required ? " *" : ""}</span>
                  <input className="path-input" value={paramValues[param.key] || ""} placeholder={param.meta?.example || param.meta?.description || param.key} onChange={(e) => setParamValues((prev) => ({ ...prev, [param.key]: e.target.value }))} />
                </label>
              ))}
            </div>
            <div className="gt-mcp-config-actions">
              <button type="button" className="chip" onClick={() => setConfigServer(null)}>取消</button>
              <button type="button" className="chip primary" onClick={() => void handleAddServer(configServer, paramValues)} disabled={addingServer === configServer.name}>{addingServer === configServer.name ? "添加中..." : "确认添加"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
