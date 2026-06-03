import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, RefreshCw, X } from "lucide-react";
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
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";

interface McpMarketplaceProps {
  servers: McpServerMarketData;
  configuredMcps?: string[];
  installedRows?: Array<{ name: string; sourceLabel: string; typeLabel: string; toolsCount: number }>;
  installedLoading?: boolean;
  installedError?: string;
  onReferenceMcp?: (name: string) => void;
  onShowCustomAdd?: () => void;
  onRefreshInstalled?: () => void | Promise<void>;
  onAddMcp?: (name: string, config: Record<string, unknown>) => void | Promise<void>;
}

function getDefaultInstallKey(server: McpServerDefinition) {
  const entries = Object.entries(server.installations);
  return entries.find(([, install]) => install.recommended)?.[0] || entries[0]?.[0] || "";
}

export function McpMarketplace({
  servers,
  configuredMcps = [],
  installedRows = [],
  installedLoading = false,
  installedError = "",
  onReferenceMcp,
  onShowCustomAdd,
  onRefreshInstalled,
  onAddMcp
}: McpMarketplaceProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [addingServer, setAddingServer] = useState("");
  const [notice, setNotice] = useState("");
  const [configServer, setConfigServer] = useState<McpServerDefinition | null>(null);
  const [detailServer, setDetailServer] = useState<McpServerDefinition | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const categories = useMemo(() => getAllCategories(servers).filter((category) => category !== "all" && category !== "installed"), [servers]);
  const browsingInstalled = selectedCategory === "installed";
  const filteredServers = useMemo(() => {
    const category = selectedCategory === "installed" ? "all" : selectedCategory;
    return filterByCategory(searchMcpServers(servers, searchQuery), category);
  }, [servers, searchQuery, selectedCategory]);
  const selectedCategoryLabel = selectedCategory === "installed"
    ? `已安装 (${installedRows.length})`
    : selectedCategory === "all"
      ? "全部"
      : getCategoryLabel(selectedCategory);

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
        <div className="gt-mcp-searchbox">
          <span aria-hidden="true">⌕</span>
          <Input
            placeholder="搜索 MCP 服务、标签、分类..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="gt-mcp-filter-select">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gt-mcp-filter-trigger" aria-label="MCP 分类筛选">
                  <span>{selectedCategoryLabel}</span>
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="end" sideOffset={6} collisionPadding={12} className="gt-mcp-filter-menu">
                <DropdownMenuGroup>
                  <DropdownMenuRadioGroup value={selectedCategory} onValueChange={setSelectedCategory}>
                    <DropdownMenuRadioItem value="all" className="gt-mcp-filter-option">
                      <span>全部</span>
                    </DropdownMenuRadioItem>
                    {categories.map((category) => (
                      <DropdownMenuRadioItem key={category} value={category} className="gt-mcp-filter-option">
                        <span>{getCategoryLabel(category)}</span>
                      </DropdownMenuRadioItem>
                    ))}
                    <DropdownMenuRadioItem value="installed" className="gt-mcp-filter-option">
                      <span>已安装 ({installedRows.length})</span>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      {notice ? <div className="gt-mcp-market-notice">{notice}</div> : null}
      <div className="gt-mcp-market-meta">
        <span>{browsingInstalled ? `${installedRows.length} installed servers` : `${filteredServers.length} servers · 点击详情查看完整配置`}</span>
        {browsingInstalled ? (
          <div className="gt-mcp-installed-inline-actions">
            <Button variant="ghost" size="sm" onClick={onShowCustomAdd}>
              <Plus />
              自定义添加
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void onRefreshInstalled?.()} disabled={installedLoading}>
              <RefreshCw />
              刷新
            </Button>
          </div>
        ) : null}
      </div>
      {browsingInstalled ? (
        <div className="gt-installed-mcp-grid gt-mcp-market-installed-grid">
          {installedError ? <div className="gt-module-empty danger">{installedError}</div> : null}
          {installedLoading ? <div className="gt-module-empty">正在加载 MCP...</div> : null}
          {!installedLoading && installedRows.length === 0 ? <div className="gt-module-empty">暂无 MCP server。从市场安装或自定义添加后会显示在这里。</div> : null}
          {installedRows.map((row) => (
            <Button
              key={row.name}
              variant="ghost"
              className="gt-mcp-installed-chip gt-mcp-installed-chip-use"
              onClick={() => onReferenceMcp?.(row.name)}
              title={`添加 MCP 引用：use the ${row.name} mcp server`}
            >
              <div className="gt-mcp-installed-main">
                <strong>{row.name}</strong>
                <small>{row.sourceLabel} · {row.typeLabel} · {row.toolsCount} tools</small>
              </div>
            </Button>
          ))}
        </div>
      ) : filteredServers.length === 0 ? (
        <div className="gt-mcp-empty-state"><strong>没有找到匹配的 MCP</strong><span>试试清空搜索词或切换分类。</span></div>
      ) : (
        <div className="gt-mcp-resource-grid">
          {filteredServers.map((server) => {
            const isConfigured = configuredMcps.includes(server.name);
            const installKey = getDefaultInstallKey(server);
            const install = installKey ? server.installations[installKey] : null;
            return (
              <article key={server.name} className={`gt-mcp-resource-card ${isConfigured ? "configured" : ""}`}>
                <div className="gt-mcp-resource-main">
                  <div className="gt-mcp-resource-title">
                    <strong>{server.display_name}</strong>
                    <span>{getCategoryLabel(getPrimaryCategory(server))}</span>
                  </div>
                  <p>{server.description}</p>
                  <div className="gt-mcp-resource-tags">
                    {server.is_official ? <Badge variant="default" className="official">官方</Badge> : null}
                    {server.tags.slice(0, 3).map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                </div>
                <div className="gt-mcp-resource-actions">
                  <span>{server.tools?.length || 0} tools</span>
                  <span>{install ? getInstallationTypeLabel(install.type) : "no install"}</span>
                  <Button variant="ghost" size="sm" className="gt-mcp-detail-button" onClick={() => setDetailServer(server)}>
                    详情
                  </Button>
                  {isConfigured ? (
                    <span className="gt-mcp-installed-badge">Added</span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className={`gt-mcp-get-button ${addingServer === server.name ? "is-installing" : ""}`}
                      onClick={() => openConfigure(server)}
                      disabled={addingServer === server.name}
                    >
                      {addingServer === server.name ? "..." : "Get"}
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {detailServer ? (
        <Dialog open onOpenChange={(open) => {
          if (!open) setDetailServer(null);
        }}>
          <DialogContent className="gt-settings-dialog-content gt-mcp-market-detail-dialog">
            <DialogHeader className="gt-mcp-detail-head">
              <div>
                <span className="gt-module-kicker">mcp server</span>
                <DialogTitle>{detailServer.display_name}</DialogTitle>
                <DialogDescription>{detailServer.description}</DialogDescription>
              </div>
              <DialogClose asChild>
                <Button variant="ghost" size="icon" className="gt-icon-chip" aria-label="关闭详情">
                  <X />
                </Button>
              </DialogClose>
            </DialogHeader>
            <div className="gt-mcp-detail-body">
              <div className="gt-mcp-detail-row">
                <span>分类</span>
                <strong>{getCategoryLabel(getPrimaryCategory(detailServer))}</strong>
              </div>
              <div className="gt-mcp-detail-row">
                <span>协议</span>
                <strong>{detailServer.license || "未知"}</strong>
              </div>
              {detailServer.tags.length > 0 ? (
                <div className="gt-mcp-detail-section">
                  <span>标签</span>
                  <div className="gt-mcp-detail-tags">
                    {detailServer.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                </div>
              ) : null}
              {detailServer.arguments && Object.keys(detailServer.arguments).length > 0 ? (
                <div className="gt-mcp-detail-section">
                  <span>配置参数</span>
                  <div className="gt-mcp-detail-code-list">
                    {Object.entries(detailServer.arguments).map(([key, arg]) => <code key={key}>{key}{arg.required ? " *" : ""}</code>)}
                  </div>
                </div>
              ) : null}
              {detailServer.tools && detailServer.tools.length > 0 ? (
                <div className="gt-mcp-detail-section">
                  <span>工具预览</span>
                  <div className="gt-mcp-detail-code-list">
                    {detailServer.tools.slice(0, 12).map((tool) => <code key={tool.name}>{tool.name}</code>)}
                  </div>
                </div>
              ) : null}
              {getDefaultInstallKey(detailServer) ? (
                <div className="gt-mcp-detail-section">
                  <span>安装命令</span>
                  <code className="gt-mcp-detail-command">
                    {detailServer.installations[getDefaultInstallKey(detailServer)]?.command} {detailServer.installations[getDefaultInstallKey(detailServer)]?.args.join(" ")}
                  </code>
                </div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
      {configServer ? (
        <Dialog open onOpenChange={(open) => {
          if (!open) setConfigServer(null);
        }}>
          <DialogContent className="gt-mcp-market-config-dialog">
            <DialogHeader className="gt-mcp-config-head">
              <div>
                <span className="gt-module-kicker">configure mcp</span>
                <DialogTitle>{configServer.display_name}</DialogTitle>
                <DialogDescription>填写连接所需参数后再添加到 OpenCode 配置。</DialogDescription>
              </div>
              <DialogClose asChild>
                <Button variant="ghost" size="icon" className="gt-icon-chip" aria-label="关闭配置">
                  <X />
                </Button>
              </DialogClose>
            </DialogHeader>
            <div className="gt-mcp-config-fields">
              {getParamKeys(configServer).map((param) => (
                <label key={param.key}>
                  <span>{param.key}{param.required ? " *" : ""}</span>
                  <Input className="path-input" value={paramValues[param.key] || ""} placeholder={param.meta?.example || param.meta?.description || param.key} onChange={(e) => setParamValues((prev) => ({ ...prev, [param.key]: e.target.value }))} />
                </label>
              ))}
            </div>
            <DialogFooter className="gt-mcp-config-actions">
              <Button variant="ghost" size="sm" onClick={() => setConfigServer(null)}>取消</Button>
              <Button variant="contrast" size="sm" onClick={() => void handleAddServer(configServer, paramValues)} disabled={addingServer === configServer.name}>{addingServer === configServer.name ? "添加中..." : "确认添加"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
