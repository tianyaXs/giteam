import type { McpServerMarketData } from "../../lib/mcpMarket";
import { CloseIcon } from "../icons";
import { McpMarketplace } from "../mcp/McpMarketplace";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
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
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";

export type OpencodeMcpPanelRow = {
  name: string;
  sourceLabel: string;
  typeLabel: string;
  toolsCount: number;
};

export type OpencodeMcpParamSpec = {
  key: string;
  required: boolean;
  description: string;
  example: string;
};

function McpModuleEmpty({ title, description, danger = false }: { title: string; description?: string; danger?: boolean }) {
  return (
    <Empty className={cn("min-h-24 flex-none border border-dashed border-border bg-muted/30 p-4 md:p-6", danger && "border-destructive/40 bg-destructive/10")}>
      <EmptyHeader>
        <EmptyTitle className="text-sm">{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}

function InstalledMcpButton({ row, onClick }: { row: OpencodeMcpPanelRow; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      className="h-auto w-full justify-start rounded-lg border border-border bg-card px-3 py-2 text-left shadow-none hover:bg-accent hover:text-accent-foreground"
      onClick={onClick}
      title={`添加 MCP 引用：use the ${row.name} mcp server`}
    >
      <div className="grid min-w-0 gap-1">
        <strong className="truncate text-base font-semibold">{row.name}</strong>
        <small className="truncate text-[14px] text-muted-foreground">{row.sourceLabel} · {row.typeLabel} · {row.toolsCount} tools</small>
      </div>
    </Button>
  );
}

type InstalledMcpGridProps = {
  rows: OpencodeMcpPanelRow[];
  loading: boolean;
  error: string;
  onReferenceMcp: (name: string) => void;
};

export function OpencodeInstalledMcpGrid(props: InstalledMcpGridProps) {
  const { rows, loading, error, onReferenceMcp } = props;

  return (
    <div className="grid gap-2">
      {error ? <McpModuleEmpty title="MCP 加载失败" description={error} danger /> : null}
      {loading ? <McpModuleEmpty title="正在加载 MCP..." /> : null}
      {!loading && rows.length === 0 ? <McpModuleEmpty title="暂无 MCP server" description="从下方市场安装后会显示在这里。" /> : null}
      {rows.map((row) => (
        <InstalledMcpButton key={row.name} row={row} onClick={() => onReferenceMcp(row.name)} />
      ))}
    </div>
  );
}

type SettingsMcpGridProps = {
  rows: OpencodeMcpPanelRow[];
  error: string;
  busyName: string;
  onEditMcp: (name: string) => void;
  onRemoveMcp: (name: string) => void | Promise<void>;
};

export function OpencodeSettingsMcpGrid(props: SettingsMcpGridProps) {
  const { rows, error, busyName, onEditMcp, onRemoveMcp } = props;

  return (
    <div className="flex flex-col gap-3">
      {error ? <McpModuleEmpty title="MCP 加载失败" description={error} danger /> : null}
      <div className="grid gap-2">
        {rows.length === 0 ? <McpModuleEmpty title="暂无已安装 MCP Server。" /> : rows.map((row) => (
          <Card key={row.name} className="rounded-lg shadow-none">
            <CardContent className="flex items-center gap-2 p-2">
              <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start p-2 text-left" onClick={() => onEditMcp(row.name)}>
                <div className="grid min-w-0 gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <strong className="truncate text-base font-semibold">{row.name}</strong>
                    <Badge variant="secondary" className="shrink-0 normal-case tracking-normal">{row.typeLabel}</Badge>
                  </div>
                  <p className="truncate text-[14px] text-muted-foreground">{row.sourceLabel} · {row.toolsCount} tools · use {row.name}</p>
                </div>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`${row.name} actions`} title="Actions">
                    <span aria-hidden="true">...</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => onEditMcp(row.name)}>
                      配置参数
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!!busyName} onClick={() => void onRemoveMcp(row.name)}>
                      {busyName.endsWith(":remove") ? "删除中" : "删除"}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

type CustomMcpDialogProps = {
  name: string;
  json: string;
  paramValues: Record<string, string>;
  busyName: string;
  paramSpecs: OpencodeMcpParamSpec[];
  normalizeConfig: (input: string, fallbackName: string) => { name: string; config: Record<string, unknown> };
  onClose: () => void;
  onNameChange: (value: string) => void;
  onJsonChange: (value: string) => void;
  onParamChange: (key: string, value: string) => void;
  onAdd: () => void | Promise<void>;
};

export function OpencodeCustomMcpDialog(props: CustomMcpDialogProps) {
  const {
    name,
    json,
    paramValues,
    busyName,
    paramSpecs,
    normalizeConfig,
    onClose,
    onNameChange,
    onJsonChange,
    onParamChange,
    onAdd
  } = props;

  const customMcpJsonPlaceholder = `{
  "type": "remote",
  "url": "https://mcp.example.com/mcp",
  "enabled": true
}`;
  const previewText = (() => {
    if (!json.trim()) return "粘贴 JSON 后会在这里预览 MCP 类型和连接信息";
    try {
      const { name: previewName, config } = normalizeConfig(json, name);
      if (config.type === "local") return `${previewName} · local · command: ${Array.isArray(config.command) ? config.command.join(" ") : "缺少 command[]"}`;
      if (config.type === "remote") return `${previewName} · remote · url: ${String(config.url || "缺少 url")}`;
      return `${previewName} · ${String(config.type)}`;
    } catch (error) {
      return `JSON 无效：${String(error instanceof Error ? error.message : error)}`;
    }
  })();

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent className="max-w-3xl">
        <section className="grid gap-4">
          <DialogHeader className="flex-row items-start justify-between gap-3">
            <div className="grid gap-1">
              <Badge variant="outline" className="w-fit normal-case tracking-normal">custom mcp</Badge>
              <DialogTitle>自定义添加 MCP Server</DialogTitle>
              <DialogDescription>支持 OpenCode MCP 配置、mcpServers 包装、直接 server map 或 marketplace JSON。</DialogDescription>
            </div>
            <DialogClose asChild>
              <Button variant="ghost" size="icon" aria-label="关闭自定义添加">
                <CloseIcon />
              </Button>
            </DialogClose>
          </DialogHeader>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="grid gap-3">
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-[14px] text-muted-foreground">
                <span>JSON 会自动识别 name、command/url、env/headers 和必填参数</span>
              </div>
              <label className="grid gap-1.5">
                <span className="text-[14px] font-medium">名称</span>
                <Input className="h-10 rounded-lg" placeholder="名称，例如 context7" value={name} onChange={(event) => onNameChange(event.target.value)} />
              </label>
              <label className="grid gap-1.5">
                <span className="text-[14px] font-medium">JSON 配置</span>
                <Textarea className="min-h-48 rounded-lg font-mono text-[14px]" value={json} placeholder={customMcpJsonPlaceholder} onChange={(event) => onJsonChange(event.target.value)} />
              </label>
            </div>
            <aside className="grid content-start gap-3">
              <Card className="rounded-lg p-3 shadow-none">
                <strong className="text-base font-semibold">预览</strong>
                <code className="mt-2 block whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-[14px] text-muted-foreground">{previewText}</code>
              </Card>
              {paramSpecs.length > 0 ? (
                <Card className="grid gap-3 rounded-lg p-3 shadow-none">
                  <strong className="text-base font-semibold">连接参数</strong>
                  {paramSpecs.map((spec) => (
                    <label key={spec.key} className="grid gap-1.5">
                      <span className="text-[14px] font-medium">{spec.key}{spec.required ? " *" : ""}</span>
                      {spec.description ? <small className="text-[14px] text-muted-foreground">{spec.description}</small> : null}
                      <Input
                        className="h-10 rounded-lg"
                        value={paramValues[spec.key] || ""}
                        placeholder={spec.example || spec.key}
                        onChange={(event) => onParamChange(spec.key, event.target.value)}
                      />
                    </label>
                  ))}
                </Card>
              ) : (
                <McpModuleEmpty title="没有检测到必填参数" description="添加后会写入当前项目的 OpenCode 配置。" />
              )}
            </aside>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
            <Button variant="contrast" size="sm" onClick={() => void onAdd()} disabled={!!busyName || !json.trim()}>
              {busyName ? "添加中..." : "添加 MCP"}
            </Button>
          </DialogFooter>
        </section>
      </DialogContent>
    </Dialog>
  );
}

type EditMcpDialogProps = {
  name: string;
  status: Record<string, unknown> | undefined;
  specs: OpencodeMcpParamSpec[];
  tools: Array<{ name?: string; description?: string }>;
  paramValues: Record<string, string>;
  busyName: string;
  onClose: () => void;
  onParamChange: (key: string, value: string) => void;
  onRemove: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
};

export function OpencodeEditMcpDialog(props: EditMcpDialogProps) {
  const { name, status, specs, tools, paramValues, busyName, onClose, onParamChange, onRemove, onSave } = props;
  const state: any = status || {};
  const paramKind = state.type === "remote" ? "Headers" : "Environment";

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent className="max-w-2xl">
        <div className="grid gap-4">
          <DialogHeader>
            <div className="grid gap-1">
              <Badge variant="outline" className="w-fit normal-case tracking-normal">update mcp params</Badge>
              <DialogTitle>{name}</DialogTitle>
              <DialogDescription className="sr-only">更新该 MCP 的 {paramKind} 参数。保存后会写回当前项目的 OpenCode 配置。</DialogDescription>
            </div>
          </DialogHeader>
          <p className="m-0 text-[15px] text-muted-foreground">更新该 MCP 的 {paramKind} 参数。保存后会写回当前项目的 OpenCode 配置。</p>
          {specs.length === 0 ? <McpModuleEmpty title="这个 MCP 当前没有可编辑参数。" /> : (
            <div className="grid gap-3">
              {specs.map((spec) => (
                <label key={spec.key} className="grid gap-1.5">
                  <span className="text-[14px] font-medium">{spec.key}{spec.required ? " *" : ""}</span>
                  {spec.description ? <small className="text-[14px] text-muted-foreground">{spec.description}</small> : null}
                  <Input
                    className="h-10 rounded-lg"
                    value={paramValues[spec.key] || ""}
                    placeholder={spec.example || spec.key}
                    onChange={(event) => onParamChange(spec.key, event.target.value)}
                  />
                </label>
              ))}
            </div>
          )}
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-base font-semibold">工具列表</strong>
              <Badge variant="secondary" className="normal-case tracking-normal">{tools.length} tools</Badge>
            </div>
            {tools.length === 0 ? (
              <McpModuleEmpty title="暂无工具清单。" />
            ) : (
              <div className="grid max-h-56 gap-2 overflow-auto sm:grid-cols-2">
                {tools.map((tool) => (
                  <Card key={tool.name} className="rounded-lg shadow-none">
                    <CardContent className="grid gap-1 p-3">
                      <code className="truncate text-[14px]">{tool.name}</code>
                      <p className="m-0 text-[14px] text-muted-foreground">{tool.description || "No description"}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
            <Button variant="destructive" size="sm" onClick={() => void onRemove()} disabled={!!busyName}>
              {busyName.endsWith(":remove") ? "删除中..." : "删除"}
            </Button>
            <Button variant="contrast" size="sm" onClick={() => void onSave()} disabled={!!busyName || specs.length === 0}>
              {busyName.endsWith(":update") ? "保存中..." : "保存参数"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type McpMarketPanelProps = {
  rows: OpencodeMcpPanelRow[];
  loading: boolean;
  error: string;
  installedOpen: boolean;
  servers: McpServerMarketData;
  configuredMcpNames: string[];
  onInstalledOpenChange: (open: boolean) => void;
  onShowCustomAdd: () => void;
  onRefresh: () => void | Promise<void>;
  onReferenceMcp: (name: string) => void;
  onAddMcpFromMarket: (name: string, config: Record<string, unknown>) => void | Promise<void>;
};

export function OpencodeMcpMarketPanel(props: McpMarketPanelProps) {
  const {
    rows,
    loading,
    error,
    servers,
    configuredMcpNames,
    onShowCustomAdd,
    onRefresh,
    onReferenceMcp,
    onAddMcpFromMarket
  } = props;

  return (
    <div className="min-h-0">
      <McpMarketplace
        servers={servers}
        configuredMcps={configuredMcpNames}
        installedRows={rows}
        installedLoading={loading}
        installedError={error}
        onReferenceMcp={onReferenceMcp}
        onShowCustomAdd={onShowCustomAdd}
        onRefreshInstalled={onRefresh}
        onAddMcp={onAddMcpFromMarket}
      />
    </div>
  );
}

type McpDialogsProps = {
  showCustomAdd: boolean;
  customName: string;
  customJson: string;
  customParamValues: Record<string, string>;
  busyName: string;
  customParamSpecs: OpencodeMcpParamSpec[];
  normalizeConfig: (input: string, fallbackName: string) => { name: string; config: Record<string, unknown> };
  onCloseCustomAdd: () => void;
  onCustomNameChange: (value: string) => void;
  onCustomJsonChange: (value: string) => void;
  onCustomParamChange: (key: string, value: string) => void;
  onAddCustomMcp: () => void | Promise<void>;
  editingName: string;
  editingStatus: Record<string, unknown> | undefined;
  editingSpecs: OpencodeMcpParamSpec[];
  editingTools: Array<{ name?: string; description?: string }>;
  editingParamValues: Record<string, string>;
  onCloseEditing: () => void;
  onEditingParamChange: (key: string, value: string) => void;
  onRemoveEditingMcp: () => void | Promise<void>;
  onSaveEditingMcp: () => void | Promise<void>;
};

export function OpencodeMcpDialogs(props: McpDialogsProps) {
  const {
    showCustomAdd,
    customName,
    customJson,
    customParamValues,
    busyName,
    customParamSpecs,
    normalizeConfig,
    onCloseCustomAdd,
    onCustomNameChange,
    onCustomJsonChange,
    onCustomParamChange,
    onAddCustomMcp,
    editingName,
    editingStatus,
    editingSpecs,
    editingTools,
    editingParamValues,
    onCloseEditing,
    onEditingParamChange,
    onRemoveEditingMcp,
    onSaveEditingMcp
  } = props;

  return (
    <>
      {showCustomAdd ? (
        <OpencodeCustomMcpDialog
          name={customName}
          json={customJson}
          paramValues={customParamValues}
          busyName={busyName}
          paramSpecs={customParamSpecs}
          normalizeConfig={normalizeConfig}
          onClose={onCloseCustomAdd}
          onNameChange={onCustomNameChange}
          onJsonChange={onCustomJsonChange}
          onParamChange={onCustomParamChange}
          onAdd={onAddCustomMcp}
        />
      ) : null}

      {editingName ? (
        <OpencodeEditMcpDialog
          name={editingName}
          status={editingStatus}
          specs={editingSpecs}
          tools={editingTools}
          paramValues={editingParamValues}
          busyName={busyName}
          onClose={onCloseEditing}
          onParamChange={onEditingParamChange}
          onRemove={onRemoveEditingMcp}
          onSave={onSaveEditingMcp}
        />
      ) : null}
    </>
  );
}
