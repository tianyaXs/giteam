/**
 * MCP 管理面板：仓库级 MCP 服务列表（对齐 Codex 插件页「服务器」列表样式）。
 * 自包含 state/RPC；可由设置页托管搜索与「添加」入口。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { MoreHorizontal, Plus, Plug, PlugZap, Trash2 } from "lucide-react";
import {
  addMcpService,
  disconnectMcpService,
  connectMcpService,
  listMcpServices,
  listMcpTools,
  removeMcpService,
  type McpServiceInput,
  type McpServiceStatus,
  type McpServiceError,
  type McpToolInfo
} from "../../lib/agentMcpData";
import { cn } from "../../lib/utils";
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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { SegmentedControl } from "../ui/segmented";
import { Switch } from "../ui/switch";

type KvPair = { key: string; value: string };

type AddForm = {
  name: string;
  kind: "stdio" | "http";
  command: string;
  args: string[];
  env: KvPair[];
  url: string;
  headers: KvPair[];
};

const EMPTY_FORM: AddForm = {
  name: "",
  kind: "stdio",
  command: "",
  args: [],
  env: [],
  url: "",
  headers: []
};

function FormSection({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-3 rounded-[14px] border border-border/50 bg-muted/35 p-4", className)}>
      {children}
    </div>
  );
}

function FieldLabel({ htmlFor, children, className }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("mb-1.5 block text-[13px] font-normal text-muted-foreground", className)}>
      {children}
    </label>
  );
}

function SoftInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn(
        "h-9 w-full rounded-lg border-border/60 bg-background px-3 text-[13px] shadow-none placeholder:text-muted-foreground/55 focus-visible:border-ring/50",
        className
      )}
      {...props}
    />
  );
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center justify-center gap-1 rounded-lg border border-transparent bg-muted/55 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
      {label}
    </button>
  );
}

function IconRemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden />
    </button>
  );
}

function pairsToRecord(pairs: KvPair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (!key) continue;
    out[key] = pair.value;
  }
  return out;
}

function sameMcpServices(a: McpServiceStatus[], b: McpServiceStatus[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.name !== right.name
      || left.transport !== right.transport
      || left.url !== right.url
      || left.command !== right.command
      || left.phase !== right.phase
      || left.toolCount !== right.toolCount
      || left.failure !== right.failure
    ) {
      return false;
    }
  }
  return true;
}

function sameMcpTools(a: McpToolInfo[], b: McpToolInfo[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.exposedName !== right.exposedName
      || left.serviceName !== right.serviceName
      || left.toolName !== right.toolName
      || left.description !== right.description
    ) {
      return false;
    }
  }
  return true;
}

function sameMcpErrors(a: McpServiceError[], b: McpServiceError[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].service !== b[i].service || a[i].message !== b[i].message) return false;
  }
  return true;
}

export type AgentMcpSectionProps = {
  repoPath: string;
  /** 外部搜索过滤（设置页托管） */
  searchQuery?: string;
  /** 受控打开添加对话框；不传则内部自管 */
  addOpen?: boolean;
  onAddOpenChange?: (open: boolean) => void;
  /** 服务数量变化时回调（用于标签计数） */
  onServiceCountChange?: (count: number) => void;
};

export function AgentMcpSection({
  repoPath,
  searchQuery = "",
  addOpen: addOpenProp,
  onAddOpenChange,
  onServiceCountChange
}: AgentMcpSectionProps) {
  const [services, setServices] = useState<McpServiceStatus[]>([]);
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [toolErrors, setToolErrors] = useState<McpServiceError[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [addOpenInternal, setAddOpenInternal] = useState(false);
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");

  const addOpen = addOpenProp ?? addOpenInternal;
  const setAddOpen = onAddOpenChange ?? setAddOpenInternal;
  const onServiceCountChangeRef = useRef(onServiceCountChange);
  onServiceCountChangeRef.current = onServiceCountChange;
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!repoPath) return;
    const silent = opts?.silent === true || hasLoadedRef.current;
    if (!silent) setLoading(true);
    setError("");
    try {
      const [nextServices, snapshot] = await Promise.all([
        listMcpServices(repoPath),
        listMcpTools(repoPath)
      ]);
      hasLoadedRef.current = true;
      setServices((prev) => (sameMcpServices(prev, nextServices) ? prev : nextServices));
      setTools((prev) => (sameMcpTools(prev, snapshot.tools) ? prev : snapshot.tools));
      setToolErrors((prev) => (sameMcpErrors(prev, snapshot.serviceErrors) ? prev : snapshot.serviceErrors));
      onServiceCountChangeRef.current?.(nextServices.length);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    hasLoadedRef.current = false;
    void refresh({ silent: false });
  }, [refresh]);

  const toolsByService = useMemo(() => {
    const map = new Map<string, McpToolInfo[]>();
    tools.forEach((tool) => {
      const list = map.get(tool.serviceName) ?? [];
      list.push(tool);
      map.set(tool.serviceName, list);
    });
    return map;
  }, [tools]);

  const filteredServices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return services;
    return services.filter((service) => {
      const hay = [
        service.name,
        service.transport,
        service.url || "",
        service.command || "",
        service.failure || ""
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [services, searchQuery]);

  const runAction = useCallback(
    async (key: string, action: () => Promise<unknown>, doneNotice: string): Promise<boolean> => {
      if (busy) return false;
      setBusy(key);
      setError("");
      setNotice("");
      try {
        await action();
        setNotice(doneNotice);
        await refresh({ silent: true });
        return true;
      } catch (cause) {
        setError(String(cause));
        return false;
      } finally {
        setBusy("");
      }
    },
    [busy, refresh]
  );

  const submitAdd = useCallback(() => {
    const name = form.name.trim();
    if (!name) {
      setFormError("名称必填");
      return;
    }
    if (form.kind === "stdio" && !form.command.trim()) {
      setFormError("stdio 服务需要启动命令");
      return;
    }
    if (form.kind === "http" && !form.url.trim()) {
      setFormError("HTTP 服务需要 URL");
      return;
    }
    const input: McpServiceInput = {
      name,
      enabled: true,
      url: form.kind === "http" ? form.url.trim() : null,
      command: form.kind === "stdio" ? form.command.trim() : null,
      args: form.kind === "stdio" ? form.args.map((arg) => arg.trim()).filter(Boolean) : [],
      env: form.kind === "stdio" ? pairsToRecord(form.env) : {},
      headers: form.kind === "http" ? pairsToRecord(form.headers) : {},
      description: null
    };
    void runAction(
      "add",
      () => addMcpService(repoPath, input),
      `已添加 ${name}；变更仅对新会话生效`
    ).then((ok) => {
      if (!ok) return;
      setAddOpen(false);
      setForm(EMPTY_FORM);
      setFormError("");
    });
  }, [form, repoPath, runAction, setAddOpen]);

  const toggleService = (service: McpServiceStatus, next: boolean) => {
    if (next) {
      void runAction(
        `connect:${service.name}`,
        () => connectMcpService(repoPath, service.name),
        ""
      );
    } else {
      void runAction(
        `disconnect:${service.name}`,
        () => disconnectMcpService(repoPath, service.name),
        ""
      );
    }
  };

  return (
    <div className="grid gap-3">
      {notice ? (
        <p className="text-[13px] text-muted-foreground">{notice}</p>
      ) : null}
      {error ? (
        <Empty className="min-h-16 flex-none border border-dashed border-destructive/40 bg-destructive/10 p-3">
          <EmptyHeader>
            <EmptyTitle className="text-sm">MCP 操作失败</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {loading && services.length === 0 ? (
        <Empty className="min-h-24">
          <EmptyHeader>
            <EmptyTitle className="text-sm">正在加载 MCP…</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}

      {!loading && services.length === 0 ? (
        <Empty className="min-h-24">
          <EmptyHeader>
            <EmptyTitle className="text-sm">暂无 MCP 服务</EmptyTitle>
            <EmptyDescription>添加 stdio 或 streamable-http 服务后，新会话即可使用其工具。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {!loading && services.length > 0 && filteredServices.length === 0 ? (
        <Empty className="min-h-24">
          <EmptyHeader>
            <EmptyTitle className="text-sm">无匹配服务</EmptyTitle>
            <EmptyDescription>试试其他关键词。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {filteredServices.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-border/80 bg-card">
          <ul className="divide-y divide-border/60">
            {filteredServices.map((service) => {
              const isRunning = service.phase === "running";
              const starting = service.phase === "starting" || service.phase === "stopping";
              const serviceTools = toolsByService.get(service.name) ?? [];
              const actionDisabled = !repoPath || busy !== "";
              const subtitle =
                service.failure
                || (serviceTools.length > 0
                  ? `${service.toolCount || serviceTools.length} 个工具 · ${service.transport}`
                  : service.url || service.command || service.transport);
              return (
                <li key={service.name} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-semibold text-foreground">{service.name}</strong>
                    <p className="mt-0.5 truncate text-[13px] text-muted-foreground" title={subtitle}>
                      {subtitle}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                        disabled={actionDisabled}
                        aria-label={`${service.name} 更多操作`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="min-w-[8.75rem] rounded-lg p-1 shadow-[0_8px_24px_rgba(15,23,42,0.1)]"
                    >
                      <DropdownMenuItem
                        className="gap-2 rounded-md px-2 py-1.5 text-[13px] [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:stroke-[1.5] [&_svg]:text-muted-foreground"
                        disabled={actionDisabled}
                        onClick={() =>
                          void runAction(
                            `connect:${service.name}`,
                            () => connectMcpService(repoPath, service.name),
                            ""
                          )
                        }
                      >
                        {isRunning ? <PlugZap /> : <Plug />}
                        {isRunning ? "重连" : "连接"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="gap-2 rounded-md px-2 py-1.5 text-[13px] text-destructive focus:text-destructive data-[highlighted]:text-destructive [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]"
                        disabled={actionDisabled}
                        onClick={() =>
                          void runAction(
                            `remove:${service.name}`,
                            () => removeMcpService(repoPath, service.name),
                            `已移除 ${service.name}；变更仅对新会话生效`
                          )
                        }
                      >
                        <Trash2 />
                        移除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Switch
                    checked={isRunning}
                    disabled={actionDisabled || starting}
                    onCheckedChange={(checked) => toggleService(service, checked)}
                    aria-label={isRunning ? `断开 ${service.name}` : `连接 ${service.name}`}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {toolErrors.length > 0 ? (
        <div className="grid gap-1 rounded-2xl border border-dashed border-destructive/40 bg-destructive/10 p-3 text-[13px] text-destructive">
          {toolErrors.map((entry) => (
            <p key={`${entry.service}:${entry.message}`} className="truncate" title={entry.message}>
              {entry.service}: {entry.message}
            </p>
          ))}
        </div>
      ) : null}

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) {
            setForm(EMPTY_FORM);
            setFormError("");
          }
        }}
      >
        <DialogContent
          className="z-[2701] flex w-[min(92vw,560px)] flex-col gap-5 overflow-hidden rounded-2xl border-border/60 bg-background p-6 shadow-[0_16px_48px_rgba(15,23,42,0.12)] sm:max-w-none"
          overlayClassName="z-[2700]"
        >
          <DialogHeader className="gap-1 pr-8">
            <DialogTitle className="text-[17px] font-semibold tracking-tight text-foreground">
              连接至自定义 MCP
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-5 text-muted-foreground/90">
              写入仓库配置；新建会话后生效
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3.5">
            <FormSection>
              <div>
                <FieldLabel htmlFor="mcp-add-name">名称</FieldLabel>
                <SoftInput
                  id="mcp-add-name"
                  value={form.name}
                  placeholder="MCP server name"
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </div>
              <div className="flex items-center justify-between gap-3 pt-0.5">
                <span className="text-[13px] text-muted-foreground">类型</span>
                <SegmentedControl
                  group="mcp-add-kind"
                  value={form.kind}
                  onChange={(kind) => setForm({ ...form, kind })}
                  options={[
                    { value: "stdio", label: "STDIO" },
                    { value: "http", label: "流式 HTTP" }
                  ]}
                />
              </div>
            </FormSection>

            <FormSection>
              {/* 两套表单叠放同格，切换类型时高度不变，避免弹窗垂直跳动带偏分段滑块 */}
              <div className="grid">
                <div
                  className={cn(
                    "col-start-1 row-start-1 space-y-3",
                    form.kind !== "stdio" && "invisible pointer-events-none"
                  )}
                  aria-hidden={form.kind !== "stdio"}
                >
                  <div>
                    <FieldLabel htmlFor="mcp-add-command">启动命令</FieldLabel>
                    <SoftInput
                      id="mcp-add-command"
                      value={form.command}
                      placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp"
                      tabIndex={form.kind === "stdio" ? undefined : -1}
                      onChange={(event) => setForm({ ...form, command: event.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <FieldLabel className="mb-0">参数</FieldLabel>
                    {form.args.map((arg, index) => (
                      <div key={`arg-${index}`} className="flex items-center gap-2">
                        <SoftInput
                          value={arg}
                          placeholder="参数"
                          tabIndex={form.kind === "stdio" ? undefined : -1}
                          onChange={(event) => {
                            const args = [...form.args];
                            args[index] = event.target.value;
                            setForm({ ...form, args });
                          }}
                        />
                        <IconRemoveButton
                          label="移除参数"
                          onClick={() => setForm({ ...form, args: form.args.filter((_, i) => i !== index) })}
                        />
                      </div>
                    ))}
                    <AddRowButton
                      label="添加参数"
                      onClick={() => setForm({ ...form, args: [...form.args, ""] })}
                    />
                  </div>

                  <div className="space-y-2">
                    <FieldLabel className="mb-0">环境变量</FieldLabel>
                    {form.env.map((pair, index) => (
                      <div key={`env-${index}`} className="flex items-center gap-2">
                        <SoftInput
                          className="min-w-0 flex-1"
                          value={pair.key}
                          placeholder="键"
                          tabIndex={form.kind === "stdio" ? undefined : -1}
                          onChange={(event) => {
                            const env = [...form.env];
                            env[index] = { ...env[index], key: event.target.value };
                            setForm({ ...form, env });
                          }}
                        />
                        <SoftInput
                          className="min-w-0 flex-1"
                          value={pair.value}
                          placeholder="值"
                          tabIndex={form.kind === "stdio" ? undefined : -1}
                          onChange={(event) => {
                            const env = [...form.env];
                            env[index] = { ...env[index], value: event.target.value };
                            setForm({ ...form, env });
                          }}
                        />
                        <IconRemoveButton
                          label="移除环境变量"
                          onClick={() => setForm({ ...form, env: form.env.filter((_, i) => i !== index) })}
                        />
                      </div>
                    ))}
                    <AddRowButton
                      label="添加环境变量"
                      onClick={() => setForm({ ...form, env: [...form.env, { key: "", value: "" }] })}
                    />
                  </div>
                </div>

                <div
                  className={cn(
                    "col-start-1 row-start-1 space-y-3",
                    form.kind !== "http" && "invisible pointer-events-none"
                  )}
                  aria-hidden={form.kind !== "http"}
                >
                  <div>
                    <FieldLabel htmlFor="mcp-add-url">URL</FieldLabel>
                    <SoftInput
                      id="mcp-add-url"
                      value={form.url}
                      placeholder="https://example.com/mcp"
                      tabIndex={form.kind === "http" ? undefined : -1}
                      onChange={(event) => setForm({ ...form, url: event.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <FieldLabel className="mb-0">请求头</FieldLabel>
                    {form.headers.map((pair, index) => (
                      <div key={`header-${index}`} className="flex items-center gap-2">
                        <SoftInput
                          className="min-w-0 flex-1"
                          value={pair.key}
                          placeholder="键"
                          tabIndex={form.kind === "http" ? undefined : -1}
                          onChange={(event) => {
                            const headers = [...form.headers];
                            headers[index] = { ...headers[index], key: event.target.value };
                            setForm({ ...form, headers });
                          }}
                        />
                        <SoftInput
                          className="min-w-0 flex-1"
                          value={pair.value}
                          placeholder="值"
                          tabIndex={form.kind === "http" ? undefined : -1}
                          onChange={(event) => {
                            const headers = [...form.headers];
                            headers[index] = { ...headers[index], value: event.target.value };
                            setForm({ ...form, headers });
                          }}
                        />
                        <IconRemoveButton
                          label="移除请求头"
                          onClick={() => setForm({ ...form, headers: form.headers.filter((_, i) => i !== index) })}
                        />
                      </div>
                    ))}
                    <AddRowButton
                      label="添加请求头"
                      onClick={() => setForm({ ...form, headers: [...form.headers, { key: "", value: "" }] })}
                    />
                  </div>
                </div>
              </div>
            </FormSection>

            {formError ? <p className="text-[13px] text-destructive">{formError}</p> : null}
          </div>

          <DialogFooter className="gap-2 pt-1 sm:justify-end">
            <DialogClose asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-lg border-border/70 px-3.5 text-[13px] font-normal"
                disabled={busy === "add"}
              >
                取消
              </Button>
            </DialogClose>
            <Button
              variant="secondary"
              size="sm"
              className="h-8 rounded-lg px-4 text-[13px]"
              disabled={!repoPath || busy === "add"}
              onClick={submitAdd}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
