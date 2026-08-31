/**
 * MCP 管理面板（Agent 模块 → MCP 标签页）：列出仓库级 MCP 服务与已发现
 * 工具，支持添加/移除/连接/断开。自包含组件——state 与 RPC 全在内部，
 * 只依赖 repoPath。变更仅对新会话生效（后端 requiresNewSession）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PlugZap, Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  addMcpService,
  disconnectMcpService,
  connectMcpService,
  listMcpServices,
  listMcpTools,
  parseArgLines,
  parseKeyValueLines,
  removeMcpService,
  type McpServiceInput,
  type McpServiceStatus,
  type McpServiceError,
  type McpToolInfo
} from "../../lib/agentMcpData";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

type AddForm = {
  name: string;
  kind: "stdio" | "http";
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  description: string;
};

const EMPTY_FORM: AddForm = {
  name: "",
  kind: "stdio",
  command: "",
  args: "",
  env: "",
  url: "",
  headers: "",
  description: ""
};

const PHASE_BADGE: Record<string, { label: string; className: string }> = {
  running: { label: "运行中", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  starting: { label: "连接中", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  stopping: { label: "断开中", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  stopped: { label: "已断开", className: "" },
  unknown: { label: "未知", className: "" }
};

function PhaseBadge({ phase }: { phase: string }) {
  const badge = PHASE_BADGE[phase] ?? PHASE_BADGE.unknown;
  return (
    <Badge variant="secondary" className={`shrink-0 normal-case tracking-normal ${badge.className}`}>
      {badge.label}
    </Badge>
  );
}

export function AgentMcpSection({ repoPath }: { repoPath: string }) {
  const [services, setServices] = useState<McpServiceStatus[]>([]);
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [toolErrors, setToolErrors] = useState<McpServiceError[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");

  const refresh = useCallback(async () => {
    if (!repoPath) return;
    setLoading(true);
    setError("");
    try {
      const [nextServices, snapshot] = await Promise.all([
        listMcpServices(repoPath),
        listMcpTools(repoPath)
      ]);
      setServices(nextServices);
      setTools(snapshot.tools);
      setToolErrors(snapshot.serviceErrors);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    void refresh();
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

  const runAction = useCallback(
    async (key: string, action: () => Promise<unknown>, doneNotice: string): Promise<boolean> => {
      if (busy) return false;
      setBusy(key);
      setError("");
      setNotice("");
      try {
        await action();
        setNotice(doneNotice);
        await refresh();
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
      setFormError("stdio 服务需要 command");
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
      args: form.kind === "stdio" ? parseArgLines(form.args) : [],
      env: form.kind === "stdio" ? parseKeyValueLines(form.env) : {},
      headers: form.kind === "http" ? parseKeyValueLines(form.headers) : {},
      description: form.description.trim() || null
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
  }, [form, repoPath, runAction]);

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          仓库级 MCP 服务（mcpstore）；变更仅对新会话生效。
        </p>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="刷新 MCP" title="刷新" disabled={loading || !repoPath} onClick={() => void refresh()}>
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
          </Button>
          <Button size="sm" disabled={!repoPath} onClick={() => { setForm(EMPTY_FORM); setFormError(""); setAddOpen(true); }}>
            <Plus data-icon="inline-start" aria-hidden="true" />添加服务
          </Button>
        </div>
      </div>

      {notice ? (
        <Empty className="min-h-16 flex-none border border-border bg-muted/30 p-3">
          <EmptyHeader>
            <EmptyTitle className="text-sm">{notice}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}
      {error ? (
        <Empty className="min-h-16 flex-none border border-dashed border-destructive/40 bg-destructive/10 p-3">
          <EmptyHeader>
            <EmptyTitle className="text-sm">MCP 操作失败</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {loading && services.length === 0 ? <Empty className="min-h-24"><EmptyHeader><EmptyTitle className="text-sm">正在加载 MCP…</EmptyTitle></EmptyHeader></Empty> : null}
      {!loading && services.length === 0 ? (
        <Empty className="min-h-24">
          <EmptyHeader>
            <EmptyTitle className="text-sm">暂无 MCP 服务</EmptyTitle>
            <EmptyDescription>添加 stdio 或 streamable-http 服务后，新会话即可使用其工具。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {services.map((service) => {
        const key = service.name;
        const isRunning = service.phase === "running";
        const serviceTools = toolsByService.get(service.name) ?? [];
        return (
          <Card key={key} className="rounded-lg shadow-none">
            <CardContent className="grid gap-2 p-3">
              <div className="flex items-center gap-2">
                <strong className="truncate text-sm font-semibold">{service.name}</strong>
                <PhaseBadge phase={service.phase} />
                <Badge variant="outline" className="shrink-0 normal-case tracking-normal">{service.transport}</Badge>
                <span className="ml-auto text-[13px] text-muted-foreground">
                  {service.toolCount > 0 ? `${service.toolCount} tools` : "无工具"}
                </span>
              </div>
              <p className="truncate text-[13px] text-muted-foreground" title={service.url ?? service.command ?? ""}>
                {service.url ?? service.command ?? "—"}
              </p>
              {service.failure ? <p className="text-[13px] text-destructive">{service.failure}</p> : null}
              {serviceTools.length > 0 ? (
                <ul className="grid gap-0.5 text-[13px] text-muted-foreground">
                  {serviceTools.map((tool) => (
                    <li key={tool.exposedName} className="truncate" title={tool.description}>
                      <code className="text-foreground/80">{tool.exposedName}</code>
                      {tool.description ? ` — ${tool.description}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!repoPath || busy !== ""}
                  onClick={() =>
                    void runAction(
                      `connect:${service.name}`,
                      () => connectMcpService(repoPath, service.name),
                      `已连接 ${service.name}`
                    )
                  }
                >
                  {isRunning ? <PlugZap data-icon="inline-start" aria-hidden="true" /> : <Plug data-icon="inline-start" aria-hidden="true" />}
                  {isRunning ? "重连" : "连接"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!repoPath || busy !== "" || !isRunning}
                  onClick={() =>
                    void runAction(
                      `disconnect:${service.name}`,
                      () => disconnectMcpService(repoPath, service.name),
                      `已断开 ${service.name}`
                    )
                  }
                >
                  断开
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive hover:text-destructive"
                  disabled={!repoPath || busy !== ""}
                  onClick={() =>
                    void runAction(
                      `remove:${service.name}`,
                      () => removeMcpService(repoPath, service.name),
                      `已移除 ${service.name}；变更仅对新会话生效`
                    )
                  }
                >
                  <Trash2 data-icon="inline-start" aria-hidden="true" />移除
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {toolErrors.length > 0 ? (
        <div className="grid gap-1 rounded-lg border border-dashed border-destructive/40 bg-destructive/10 p-3 text-[13px] text-destructive">
          {toolErrors.map((entry) => (
            <p key={`${entry.service}:${entry.message}`} className="truncate" title={entry.message}>
              {entry.service}: {entry.message}
            </p>
          ))}
        </div>
      ) : null}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="z-[2701] sm:max-w-lg" overlayClassName="z-[2700]">
          <DialogHeader>
            <DialogTitle>添加 MCP 服务</DialogTitle>
            <DialogDescription>
              写入仓库级 mcpstore 配置；添加后需新建会话才会暴露工具（mcp__服务__工具）。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="mcp-add-name">名称</label>
              <Input id="mcp-add-name" value={form.name} placeholder="如 filesystem" onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </div>
            <ToggleGroup
              type="single"
              value={form.kind}
              onValueChange={(value) => { if (value) setForm({ ...form, kind: value as AddForm["kind"] }); }}
              variant="outline"
              size="sm"
              className="justify-start"
            >
              <ToggleGroupItem value="stdio">stdio（本地命令）</ToggleGroupItem>
              <ToggleGroupItem value="http">streamable-http</ToggleGroupItem>
            </ToggleGroup>
            {form.kind === "stdio" ? (
              <>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="mcp-add-command">command</label>
                  <Input id="mcp-add-command" value={form.command} placeholder="npx" onChange={(event) => setForm({ ...form, command: event.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="mcp-add-args">args（每行一个）</label>
                  <Textarea id="mcp-add-args" rows={3} value={form.args} placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/tmp"} onChange={(event) => setForm({ ...form, args: event.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="mcp-add-env">env（KEY=VALUE，每行一条）</label>
                  <Textarea id="mcp-add-env" rows={2} value={form.env} placeholder="API_TOKEN=xxx" onChange={(event) => setForm({ ...form, env: event.target.value })} />
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="mcp-add-url">URL</label>
                  <Input id="mcp-add-url" value={form.url} placeholder="https://example.com/mcp" onChange={(event) => setForm({ ...form, url: event.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="mcp-add-headers">headers（KEY=VALUE，每行一条）</label>
                  <Textarea id="mcp-add-headers" rows={2} value={form.headers} placeholder="Authorization=Bearer xxx" onChange={(event) => setForm({ ...form, headers: event.target.value })} />
                </div>
              </>
            )}
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="mcp-add-description">描述（可选）</label>
              <Input id="mcp-add-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </div>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy === "add"}>取消</Button>
            </DialogClose>
            <Button disabled={!repoPath || busy === "add"} onClick={submitAdd}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
