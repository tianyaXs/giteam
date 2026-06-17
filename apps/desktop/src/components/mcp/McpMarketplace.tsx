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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { cn } from "../../lib/utils";

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

function McpEmpty({ title, description, danger = false }: { title: string; description?: string; danger?: boolean }) {
  return (
    <Empty className={cn("min-h-28 flex-none border border-dashed border-border bg-muted/30 p-4 md:p-6", danger && "border-destructive/40 bg-destructive/10")}>
      <EmptyHeader>
        <EmptyTitle className="text-sm">{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
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
    <section className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3">
          <span className="text-[15px] text-muted-foreground" aria-hidden="true">⌕</span>
          <Input
            className="h-9 border-0 bg-transparent shadow-none focus-visible:border-transparent focus-visible:ring-0"
            placeholder="搜索 MCP 服务、标签、分类..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="shrink-0">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="MCP 分类筛选">
                  <span>{selectedCategoryLabel}</span>
                  <ChevronDown data-icon="inline-end" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="end" sideOffset={6} collisionPadding={12}>
                <DropdownMenuGroup>
                  <DropdownMenuRadioGroup value={selectedCategory} onValueChange={setSelectedCategory}>
                    <DropdownMenuRadioItem value="all">
                      <span>全部</span>
                    </DropdownMenuRadioItem>
                    {categories.map((category) => (
                      <DropdownMenuRadioItem key={category} value={category}>
                        <span>{getCategoryLabel(category)}</span>
                      </DropdownMenuRadioItem>
                    ))}
                    <DropdownMenuRadioItem value="installed">
                      <span>已安装 ({installedRows.length})</span>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      {notice ? <div className="rounded-lg border border-border bg-muted/40 p-3 text-[15px] text-muted-foreground">{notice}</div> : null}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <span className="text-[14px] text-muted-foreground">{browsingInstalled ? `${installedRows.length} installed servers` : `${filteredServers.length} servers · 点击详情查看完整配置`}</span>
        {browsingInstalled ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={onShowCustomAdd}>
              <Plus data-icon="inline-start" />
              自定义添加
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void onRefreshInstalled?.()} disabled={installedLoading}>
              <RefreshCw data-icon="inline-start" />
              刷新
            </Button>
          </div>
        ) : null}
      </div>
      {browsingInstalled ? (
        <div className="grid gap-2 md:grid-cols-2">
          {installedError ? <McpEmpty title="MCP 加载失败" description={installedError} danger /> : null}
          {installedLoading ? <McpEmpty title="正在加载 MCP..." /> : null}
          {!installedLoading && installedRows.length === 0 ? <McpEmpty title="暂无 MCP server" description="从市场安装或自定义添加后会显示在这里。" /> : null}
          {installedRows.map((row) => (
            <Card key={row.name} className="grid min-w-0 gap-2 rounded-lg p-2 shadow-none transition-colors hover:border-primary/30 hover:bg-accent/40">
              <CardHeader className="p-0">
                <Button
                  variant="ghost"
                  className="h-auto min-w-0 justify-start gap-3 p-2 text-left"
                  onClick={() => onReferenceMcp?.(row.name)}
                  title={`添加 MCP 引用：use the ${row.name} mcp server`}
                >
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <CardTitle className="truncate text-base">{row.name}</CardTitle>
                      <Badge variant="secondary" className="shrink-0 normal-case tracking-normal">{row.typeLabel}</Badge>
                    </div>
                    <CardDescription className="truncate text-[14px]">{row.sourceLabel}</CardDescription>
                  </div>
                </Button>
              </CardHeader>
              <CardFooter className="justify-between p-2 pt-0">
                <Badge variant="outline" className="normal-case tracking-normal">{row.toolsCount} tools</Badge>
                <Button variant="outline" size="sm" onClick={() => onReferenceMcp?.(row.name)}>
                  引用
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : filteredServers.length === 0 ? (
        <McpEmpty title="没有找到匹配的 MCP" description="试试清空搜索词或切换分类。" />
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {filteredServers.map((server) => {
            const isConfigured = configuredMcps.includes(server.name);
            const installKey = getDefaultInstallKey(server);
            const install = installKey ? server.installations[installKey] : null;
            const visibleTags = server.tags.slice(0, 4);
            const hiddenTagCount = Math.max(0, server.tags.length - visibleTags.length);
            return (
              <Card
                key={server.name}
                className={cn(
                  "grid min-w-0 gap-2 rounded-lg p-2 shadow-none transition-colors hover:border-primary/35 hover:bg-accent/35",
                  isConfigured && "border-primary/40 bg-primary/5"
                )}
              >
                <CardHeader className="p-0">
                  <Button
                    variant="ghost"
                    className="h-auto min-w-0 justify-start gap-3 p-2 text-left"
                    onClick={() => setDetailServer(server)}
                  >
                    <div className="grid min-w-0 flex-1 gap-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <CardTitle className="truncate text-base">{server.display_name}</CardTitle>
                        <Badge variant="outline" className="shrink-0 normal-case tracking-normal">
                          {getCategoryLabel(getPrimaryCategory(server))}
                        </Badge>
                      </div>
                      <CardDescription className="line-clamp-2 text-[14px] leading-5">{server.description}</CardDescription>
                    </div>
                  </Button>
                </CardHeader>
                <CardContent className="grid gap-2 p-2 pt-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-hidden">
                    {server.is_official ? <Badge variant="default" className="shrink-0 normal-case tracking-normal">官方</Badge> : null}
                    {isConfigured ? <Badge variant="success" className="shrink-0 normal-case tracking-normal">已添加</Badge> : null}
                    {visibleTags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="max-w-32 truncate normal-case tracking-normal">
                        {tag}
                      </Badge>
                    ))}
                    {hiddenTagCount > 0 ? <Badge variant="outline" className="normal-case tracking-normal">+{hiddenTagCount}</Badge> : null}
                  </div>
                </CardContent>
                <Separator className="mx-2 w-auto" />
                <CardFooter className="justify-between p-2 pt-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="normal-case tracking-normal">{server.tools?.length || 0} tools</Badge>
                    <Badge variant="outline" className="normal-case tracking-normal">{install ? getInstallationTypeLabel(install.type) : "No install"}</Badge>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setDetailServer(server)}>
                      详情
                    </Button>
                    {isConfigured ? (
                      <Button variant="secondary" size="sm" disabled>
                        已添加
                      </Button>
                    ) : (
                      <Button
                        variant="contrast"
                        size="sm"
                        onClick={() => openConfigure(server)}
                        disabled={addingServer === server.name}
                      >
                        {addingServer === server.name ? "添加中" : "添加"}
                      </Button>
                    )}
                  </div>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
      {detailServer ? (
        <Dialog open onOpenChange={(open) => {
          if (!open) setDetailServer(null);
        }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader className="flex-row items-start justify-between gap-3">
              <div className="grid gap-1">
                <Badge variant="outline" className="w-fit normal-case tracking-normal">mcp server</Badge>
                <DialogTitle>{detailServer.display_name}</DialogTitle>
                <DialogDescription>{detailServer.description}</DialogDescription>
              </div>
              <DialogClose asChild>
                <Button variant="ghost" size="icon" aria-label="关闭详情">
                  <X data-icon="inline-start" />
                </Button>
              </DialogClose>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Card className="rounded-lg p-3 shadow-none">
                  <span className="text-[14px] text-muted-foreground">分类</span>
                  <strong className="mt-1 block text-base font-semibold">{getCategoryLabel(getPrimaryCategory(detailServer))}</strong>
                </Card>
                <Card className="rounded-lg p-3 shadow-none">
                  <span className="text-[14px] text-muted-foreground">协议</span>
                  <strong className="mt-1 block text-base font-semibold">{detailServer.license || "未知"}</strong>
                </Card>
              </div>
              {detailServer.tags.length > 0 ? (
                <Card className="rounded-lg p-3 shadow-none">
                  <span className="text-[14px] font-medium text-muted-foreground">标签</span>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {detailServer.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                </Card>
              ) : null}
              {detailServer.arguments && Object.keys(detailServer.arguments).length > 0 ? (
                <Card className="rounded-lg p-3 shadow-none">
                  <span className="text-[14px] font-medium text-muted-foreground">配置参数</span>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(detailServer.arguments).map(([key, arg]) => <Badge key={key} variant="outline" className="normal-case tracking-normal">{key}{arg.required ? " *" : ""}</Badge>)}
                  </div>
                </Card>
              ) : null}
              {detailServer.tools && detailServer.tools.length > 0 ? (
                <Card className="rounded-lg p-3 shadow-none">
                  <span className="text-[14px] font-medium text-muted-foreground">工具预览</span>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {detailServer.tools.slice(0, 12).map((tool) => <Badge key={tool.name} variant="outline" className="normal-case tracking-normal">{tool.name}</Badge>)}
                  </div>
                </Card>
              ) : null}
              {getDefaultInstallKey(detailServer) ? (
                <Card className="rounded-lg p-3 shadow-none">
                  <span className="text-[14px] font-medium text-muted-foreground">安装命令</span>
                  <code className="mt-2 block overflow-auto rounded-md bg-muted/40 p-2 text-[14px]">
                    {detailServer.installations[getDefaultInstallKey(detailServer)]?.command} {detailServer.installations[getDefaultInstallKey(detailServer)]?.args.join(" ")}
                  </code>
                </Card>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
      {configServer ? (
        <Dialog open onOpenChange={(open) => {
          if (!open) setConfigServer(null);
        }}>
          <DialogContent className="max-w-xl">
            <DialogHeader className="flex-row items-start justify-between gap-3">
              <div className="grid gap-1">
                <Badge variant="outline" className="w-fit normal-case tracking-normal">configure mcp</Badge>
                <DialogTitle>{configServer.display_name}</DialogTitle>
                <DialogDescription>填写连接所需参数后再添加到 OpenCode 配置。</DialogDescription>
              </div>
              <DialogClose asChild>
                <Button variant="ghost" size="icon" aria-label="关闭配置">
                  <X data-icon="inline-start" />
                </Button>
              </DialogClose>
            </DialogHeader>
            <div className="grid gap-3">
              {getParamKeys(configServer).map((param) => (
                <label key={param.key} className="grid gap-1.5">
                  <span className="text-[14px] font-medium">{param.key}{param.required ? " *" : ""}</span>
                  <Input className="h-10 rounded-lg" value={paramValues[param.key] || ""} placeholder={param.meta?.example || param.meta?.description || param.key} onChange={(e) => setParamValues((prev) => ({ ...prev, [param.key]: e.target.value }))} />
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setConfigServer(null)}>取消</Button>
              <Button variant="contrast" size="sm" onClick={() => void handleAddServer(configServer, paramValues)} disabled={addingServer === configServer.name}>{addingServer === configServer.name ? "添加中..." : "确认添加"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
