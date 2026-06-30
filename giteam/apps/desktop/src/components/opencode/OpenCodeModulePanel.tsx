import type { ReactNode } from "react";
import { X } from "lucide-react";
import {
  INSTALLED_VIA_SKILLS_DESCRIPTION,
  type OpencodeInstalledSkillGroup,
  type OpencodeSkillInfo
} from "../../lib/opencodeSkillData";
import type { OpencodeAgentInfo } from "../../lib/opencodeAgents";
import type { OpencodePermissionReply, OpencodePermissionRequest } from "../../lib/opencodePermissions";
import { OPENCODE_RECOMMENDED_SKILLS, type OpencodeSkillSearchResult } from "../../lib/opencodeSkillMarketplace";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { cn } from "../../lib/utils";

export type OpencodeModuleTab = "agents" | "permissions" | "mcp" | "skills";

type OpenCodeModulePanelProps = {
  open: boolean;
  activeTab: OpencodeModuleTab;
  agentSearch: string;
  agentsLoading: boolean;
  agentsError: string;
  visibleAgents: OpencodeAgentInfo[];
  activeAgent: string;
  autoAcceptPermissions: boolean;
  permissionLoading: boolean;
  activePermissions: OpencodePermissionRequest[];
  mcpLoading: boolean;
  mcpError: string;
  mcpBusyName: string;
  mcpRows: Array<[string, Record<string, any>]>;
  mcpAddForm: {
    name: string;
    type: "remote" | "local";
    url: string;
    headers: string;
    command: string;
    env: string;
    setName: (value: string) => void;
    setType: (value: "remote" | "local") => void;
    setUrl: (value: string) => void;
    setHeaders: (value: string) => void;
    setCommand: (value: string) => void;
    setEnv: (value: string) => void;
  };
  skillsLoading: boolean;
  skillsError: string;
  skills: OpencodeSkillInfo[];
  filteredSkills: OpencodeSkillInfo[];
  groupedSkills: OpencodeInstalledSkillGroup[];
  skillSearchResults: OpencodeSkillSearchResult[];
  skillInstallScope: "project" | "global";
  skillBusy: boolean;
  skillInstallingSpec: string;
  skillInstallLog: string;
  skillInstallSpec: string;
  skillSearchQuery: string;
  skillSourceKind: "url" | "path";
  skillSourceInput: string;
  skillListFilter: "all" | "global" | "project" | "source";
  skillListQuery: string;
  skillRemovingKey: string;
  onClose: () => void;
  onTabChange: (tab: OpencodeModuleTab) => void;
  onAgentSearchChange: (value: string) => void;
  onRefreshAgents: () => void;
  onApplyAgent: (name: string) => void;
  onToggleAutoAccept: () => void;
  onRefreshPermissions: () => void;
  onSendPermissionReply: (requestId: string, reply: OpencodePermissionReply) => void;
  onRefreshMcp: () => void;
  onRefreshSkills: () => void;
  onAddMcp: () => void;
  onRunMcpAction: (name: string, action: "connect" | "disconnect" | "auth" | "logout") => void;
  onSkillInstallScopeChange: (scope: "project" | "global") => void;
  onSkillInstallSpecChange: (value: string) => void;
  onSkillSearchQueryChange: (value: string) => void;
  onSearchSkillRegistry: () => void;
  onInstallSkill: (spec?: string, scope?: "project" | "global") => void;
  onSkillSourceKindChange: (kind: "url" | "path") => void;
  onSkillSourceInputChange: (value: string) => void;
  onAddSkillSource: () => void;
  onSkillListFilterChange: (value: "all" | "global" | "project" | "source") => void;
  onSkillListQueryChange: (value: string) => void;
  onReferenceSkill: (skill: OpencodeSkillInfo) => void;
  onRemoveSkill: (skill: OpencodeSkillInfo) => void;
  onRemoveSkillGroup: (group: OpencodeInstalledSkillGroup) => void;
};

export function OpenCodeModulePanel(props: OpenCodeModulePanelProps) {
  if (!props.open) return null;

  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent className="flex max-h-[min(760px,calc(100vh-32px))] w-[min(920px,calc(100vw-32px))] flex-col overflow-hidden p-0">
        <DialogHeader className="flex-row items-start justify-between gap-4 border-b border-border p-4">
          <div className="grid min-w-0 gap-1">
            <Badge variant="outline" className="w-fit normal-case tracking-normal">OpenCode Modules</Badge>
            <DialogTitle>Agent / 权限 / MCP / Skills</DialogTitle>
            <DialogDescription className="sr-only">管理 OpenCode 的 agent、权限、MCP 与 skills。</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="关闭 OpenCode 模块">
              <X data-icon="inline-start" aria-hidden="true" />
            </Button>
          </DialogClose>
        </DialogHeader>
        <div className="border-b border-border p-3">
          <ToggleGroup
            type="single"
            value={props.activeTab}
            onValueChange={(value) => {
              if (value) props.onTabChange(value as OpencodeModuleTab);
            }}
            variant="outline"
            size="sm"
            className="justify-start overflow-x-auto"
          >
            {([
              ["agents", "Agents"],
              ["permissions", `权限${props.activePermissions.length ? ` (${props.activePermissions.length})` : ""}`],
              ["mcp", "MCP"],
              ["skills", "Skills"]
            ] as Array<[OpencodeModuleTab, string]>).map(([tab, label]) => (
              <ToggleGroupItem key={tab} value={tab}>{label}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {props.activeTab === "agents" ? <AgentsSection {...props} /> : null}
          {props.activeTab === "permissions" ? <PermissionsSection {...props} /> : null}
          {props.activeTab === "mcp" ? <McpSection {...props} /> : null}
          {props.activeTab === "skills" ? <SkillsSection {...props} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModuleEmpty({ title, description, danger = false }: { title: string; description?: string; danger?: boolean }) {
  return (
    <Empty className={cn("min-h-24 flex-none border border-dashed border-border bg-muted/30 p-4 md:p-6", danger && "border-destructive/40 bg-destructive/10")}>
      <EmptyHeader>
        <EmptyTitle className="text-sm">{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}

function SkillScopeBadge({ scope, children }: { scope?: string; children?: ReactNode }) {
  const normalized = scope || "source";
  return (
    <Badge
      variant={normalized === "global" ? "default" : normalized === "project" ? "secondary" : "outline"}
      className="shrink-0 normal-case tracking-normal"
    >
      {children || (normalized === "global" ? "Global" : normalized === "project" ? "Repo" : "Source")}
    </Badge>
  );
}

function AgentsSection(props: OpenCodeModulePanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <Input className="h-10 rounded-lg" placeholder="搜索 agent" value={props.agentSearch} onChange={(event) => props.onAgentSearchChange(event.target.value)} />
        <Button variant="outline" size="sm" onClick={props.onRefreshAgents} disabled={props.agentsLoading}>刷新</Button>
      </div>
      {props.agentsError ? <ModuleEmpty title="Agent 加载失败" description={props.agentsError} danger /> : null}
      {props.visibleAgents.length === 0 ? <ModuleEmpty title="没有匹配的 Agent" description="试试清空搜索词或刷新 OpenCode agent 列表。" /> : null}
      <div className="grid gap-2">
        {props.visibleAgents.map((agent) => (
          <Card key={agent.name} className={cn("rounded-lg shadow-none transition-colors", agent.name === props.activeAgent && "border-primary/40 bg-primary/5")}>
            <CardContent className="grid gap-3 p-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.5fr)_auto] md:items-center">
              <Button variant="ghost" className="h-auto min-w-0 justify-start p-0 text-left hover:bg-transparent" onClick={() => props.onApplyAgent(agent.name)}>
                <strong className="truncate text-sm font-semibold">@{agent.name}</strong>
              </Button>
              <span className="truncate text-sm text-muted-foreground">{agent.description || agent.mode || "agent"}</span>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="normal-case tracking-normal">{agent.mode || "all"}</Badge>
                {agent.native ? <Badge variant="outline" className="normal-case tracking-normal">native</Badge> : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PermissionsSection(props: OpenCodeModulePanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <Card className="rounded-lg shadow-none">
        <CardContent className="flex items-center justify-between gap-4 p-3">
          <div className="grid min-w-0 gap-1">
            <strong className="text-sm font-semibold">自动接受权限</strong>
            <small className="text-sm text-muted-foreground">为当前会话写入 allow-all 规则，并自动回复后续 permission.asked。</small>
          </div>
          <Switch checked={props.autoAcceptPermissions} aria-label="自动接受权限" onCheckedChange={props.onToggleAutoAccept} />
        </CardContent>
      </Card>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={props.onRefreshPermissions} disabled={props.permissionLoading}>刷新权限请求</Button>
      </div>
      {props.activePermissions.length === 0 ? (
        <ModuleEmpty title="当前没有待处理授权" />
      ) : (
        <div className="grid gap-2">
          {props.activePermissions.map((req) => (
            <Card key={req.id} className="rounded-lg shadow-none">
              <CardContent className="grid gap-3 p-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_auto] md:items-center">
                <strong className="truncate text-sm font-semibold">{req.permission || "permission"}</strong>
                <span className="truncate text-sm text-muted-foreground">{(req.patterns || []).join(", ") || "*"}</span>
                <code className="truncate rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">{req.id}</code>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => props.onSendPermissionReply(req.id, "once")}>本次</Button>
                  <Button variant="contrast" size="sm" onClick={() => props.onSendPermissionReply(req.id, "always")}>总是</Button>
                  <Button variant="destructive" size="sm" onClick={() => props.onSendPermissionReply(req.id, "reject")}>拒绝</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function McpSection(props: OpenCodeModulePanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onRefreshMcp} disabled={props.mcpLoading}>刷新 MCP</Button>
        {props.mcpError ? <Badge variant="destructive" className="normal-case tracking-normal">{props.mcpError}</Badge> : null}
      </div>
      <Card className="rounded-lg shadow-none">
        <CardContent className="grid gap-3 p-3">
          <Input className="h-10 rounded-lg" placeholder="mcp 名称，例如 context7" value={props.mcpAddForm.name} onChange={(event) => props.mcpAddForm.setName(event.target.value)} />
          <Select value={props.mcpAddForm.type} onValueChange={(value) => props.mcpAddForm.setType(value as "remote" | "local")}>
            <SelectTrigger className="h-10 rounded-lg">
              <SelectValue placeholder="选择类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="remote">remote</SelectItem>
                <SelectItem value="local">local</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {props.mcpAddForm.type === "remote" ? (
            <>
              <Input className="h-10 rounded-lg" placeholder="https://mcp.example.com/mcp" value={props.mcpAddForm.url} onChange={(event) => props.mcpAddForm.setUrl(event.target.value)} />
              <Textarea className="min-h-24 rounded-lg font-mono text-xs" placeholder="Headers，每行 KEY=VALUE（可选）" value={props.mcpAddForm.headers} onChange={(event) => props.mcpAddForm.setHeaders(event.target.value)} />
            </>
          ) : (
            <>
              <Input className="h-10 rounded-lg" placeholder="npx -y @modelcontextprotocol/server-everything" value={props.mcpAddForm.command} onChange={(event) => props.mcpAddForm.setCommand(event.target.value)} />
              <Textarea className="min-h-24 rounded-lg font-mono text-xs" placeholder="Environment，每行 KEY=VALUE（可选）" value={props.mcpAddForm.env} onChange={(event) => props.mcpAddForm.setEnv(event.target.value)} />
            </>
          )}
          <Button variant="contrast" size="sm" onClick={props.onAddMcp} disabled={!!props.mcpBusyName}>添加 MCP</Button>
        </CardContent>
      </Card>
      {props.mcpRows.length === 0 ? <ModuleEmpty title="暂无 MCP server" description="可添加 Context7、Sentry、Grep 等。" /> : null}
      <div className="grid gap-2">
        {props.mcpRows.map(([name, status]) => {
          const statusLabel = String(status?.status || status?.state || (status?.enabled === false ? "disabled" : "configured"));
          const tools = Array.isArray(status?.tools) ? status.tools.length : undefined;
          return (
            <Card key={name} className="rounded-lg shadow-none">
              <CardContent className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="grid min-w-0 gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <strong className="truncate text-sm font-semibold">{name}</strong>
                    <Badge variant="secondary" className="normal-case tracking-normal">{String(status?.type || "mcp")}</Badge>
                  </div>
                  <span className="truncate text-xs text-muted-foreground">{statusLabel}{typeof tools === "number" ? ` · ${tools} tools` : ""}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => props.onRunMcpAction(name, "connect")} disabled={!!props.mcpBusyName}>连接</Button>
                <Button variant="outline" size="sm" onClick={() => props.onRunMcpAction(name, "disconnect")} disabled={!!props.mcpBusyName}>断开</Button>
                <Button variant="outline" size="sm" onClick={() => props.onRunMcpAction(name, "auth")} disabled={!!props.mcpBusyName}>OAuth</Button>
                <Button variant="destructive" size="sm" onClick={() => props.onRunMcpAction(name, "logout")} disabled={!!props.mcpBusyName}>登出</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SkillsSection(props: OpenCodeModulePanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onRefreshSkills} disabled={props.skillsLoading}>刷新 Skills</Button>
        {props.skillsError ? <Badge variant="destructive" className="normal-case tracking-normal">{props.skillsError}</Badge> : null}
      </div>
      <Card className="rounded-lg shadow-none">
        <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="grid gap-1">
            <Badge variant="outline" className="w-fit normal-case tracking-normal">Skill command center</Badge>
            <CardTitle className="text-base">搜索、安装、区分范围，一屏完成</CardTitle>
            <p className="m-0 text-sm text-muted-foreground">默认推荐全局安装通用能力；项目特定规范、私有工作流或团队模板建议安装到当前仓库。</p>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Badge variant="secondary" className="normal-case tracking-normal">{props.skills.filter((skill: OpencodeSkillInfo) => skill.scope === "global").length} Global</Badge>
            <Badge variant="secondary" className="normal-case tracking-normal">{props.skills.filter((skill: OpencodeSkillInfo) => skill.scope === "project").length} Repo</Badge>
            <Badge variant="outline" className="normal-case tracking-normal">{props.skillSearchResults.length} Results</Badge>
          </div>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <span className="text-xs font-medium text-muted-foreground">安装范围</span>
        <ToggleGroup type="single" value={props.skillInstallScope} onValueChange={(value) => { if (value) props.onSkillInstallScopeChange(value as "project" | "global"); }} variant="outline" size="sm">
          <ToggleGroupItem value="project">当前仓库</ToggleGroupItem>
          <ToggleGroupItem value="global">全局通用</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {props.skillBusy ? (
        <ModuleEmpty title="正在安装 Skill" description="会从 skills.sh / GitHub 拉取内容，完成后自动刷新 OpenCode Skills 列表。" />
      ) : null}
      {(props.skillBusy || props.skillInstallingSpec || props.skillInstallLog) ? (
        <Card className="rounded-lg shadow-none">
          <CardHeader className="flex-row items-center justify-between gap-3 p-3">
            <CardTitle>安装日志</CardTitle>
            <Badge variant="secondary" className="normal-case tracking-normal">{props.skillInstallingSpec || "最近一次安装"}</Badge>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <pre className="max-h-32 overflow-auto rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">{props.skillInstallLog || `正在启动安装 ${props.skillInstallingSpec || "skill"}...`}</pre>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-2 md:grid-cols-2">
        {OPENCODE_RECOMMENDED_SKILLS.map((skill) => (
          <Card key={skill.spec} className="rounded-lg shadow-none">
            <CardContent className="grid gap-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="normal-case tracking-normal">{skill.tone}</Badge>
                <small className="text-xs text-muted-foreground">{skill.installs}</small>
              </div>
              <strong className="text-sm font-semibold">{skill.title}</strong>
              <p className="m-0 text-xs text-muted-foreground">{skill.description}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => props.onSkillInstallSpecChange(skill.spec)}>填入</Button>
                <Button variant="contrast" size="sm" onClick={() => props.onInstallSkill(skill.spec, props.skillInstallScope)} disabled={props.skillBusy}>安装</Button>
              </div>
              <code className="truncate rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">{skill.spec}</code>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-2">
        <Input
          className="h-10 rounded-lg"
          placeholder="搜索 skills，例如 frontend / react / testing"
          value={props.skillSearchQuery}
          onChange={(event) => props.onSkillSearchQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.onSearchSkillRegistry();
          }}
        />
      </div>
      {props.skillSearchResults.length > 0 ? (
        <div className="grid gap-2">
          {props.skillSearchResults.map((result) => (
            <Card key={result.spec} className="rounded-lg shadow-none">
              <CardContent className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="grid min-w-0 gap-1">
                  <strong className="truncate text-sm font-semibold">{result.skill}</strong>
                  <span className="truncate text-xs text-muted-foreground">{result.package}</span>
                  <span className="truncate text-xs text-muted-foreground">{result.installs ? `${result.installs} installs` : result.url}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => props.onSkillInstallSpecChange(result.installSpec || result.spec)}>填入</Button>
                <Button variant="contrast" size="sm" onClick={() => props.onInstallSkill(result.installSpec || result.spec, props.skillInstallScope)} disabled={props.skillBusy}>安装</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <Input className="h-10 rounded-lg" placeholder="skills.sh 条目，如 anthropics/skills@frontend-design" value={props.skillInstallSpec} onChange={(event) => props.onSkillInstallSpecChange(event.target.value)} />
        <Button variant="contrast" size="sm" onClick={() => props.onInstallSkill(undefined, props.skillInstallScope)} disabled={props.skillBusy}>从 skills.sh 安装</Button>
      </div>
      <div className="grid gap-2 md:grid-cols-[160px_minmax(0,1fr)_auto]">
        <Select value={props.skillSourceKind} onValueChange={(value) => props.onSkillSourceKindChange(value as "url" | "path")}>
          <SelectTrigger className="h-10 rounded-lg">
            <SelectValue placeholder="选择来源类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="url">skills.urls</SelectItem>
              <SelectItem value="path">skills.paths</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input className="h-10 rounded-lg" placeholder={props.skillSourceKind === "url" ? "https://example.com/.well-known/skills/" : "/path/to/skills"} value={props.skillSourceInput} onChange={(event) => props.onSkillSourceInputChange(event.target.value)} />
        <Button variant="outline" size="sm" onClick={props.onAddSkillSource} disabled={props.skillBusy}>添加来源</Button>
      </div>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px] md:items-center">
        <div className="min-w-0">
          <ToggleGroup type="single" value={props.skillListFilter} onValueChange={(value) => { if (value) props.onSkillListFilterChange(value as "all" | "global" | "project" | "source"); }} variant="outline" size="sm">
            {([
              ["all", `全部 ${props.skills.length}`],
              ["global", `Global ${props.skills.filter((skill) => skill.scope === "global").length}`],
              ["project", `Repo ${props.skills.filter((skill) => skill.scope === "project").length}`],
              ["source", `Source ${props.skills.filter((skill) => (skill.scope || "source") === "source").length}`]
            ] as Array<["all" | "global" | "project" | "source", string]>).map(([filter, label]) => (
              <ToggleGroupItem key={filter} value={filter}>{label}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <Input className="h-10 rounded-lg" placeholder="过滤已安装 skills" value={props.skillListQuery} onChange={(event) => props.onSkillListQueryChange(event.target.value)} />
      </div>
      {props.skills.length === 0 ? <ModuleEmpty title="暂无 Skills" description="OpenCode 会扫描 .opencode/skills、.claude/skills 和全局 skills。" /> : null}
      {props.skills.length > 0 && props.filteredSkills.length === 0 ? <ModuleEmpty title="没有匹配当前过滤条件的 Skill" /> : null}
      <div className="grid gap-2">
        {props.groupedSkills.map((group) => {
          const removing = group.removableItems.some((skill) => props.skillRemovingKey === `${skill.scope || "source"}:${skill.name}:${skill.path || skill.location || ""}`);
          const singleSkill = group.items[0];
          const canRenderFlat = group.items.length === 1
            && !!singleSkill
            && (singleSkill.sourceGroup || "").trim() === ""
            && group.name.trim() === singleSkill.name.trim();
          if (canRenderFlat) {
            const skill = singleSkill;
            const scope = skill.scope || "source";
            const scopeLabel = scope === "global" ? "Global" : scope === "project" ? "Repo" : "Source";
            return (
              <Card key={group.name} className="rounded-lg shadow-none">
                <CardContent className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="grid min-w-0 gap-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <strong className="truncate text-sm font-semibold">{skill.name}</strong>
                      <SkillScopeBadge scope={scope}>{scopeLabel}</SkillScopeBadge>
                    </div>
                    <span className="truncate text-xs text-muted-foreground">{skill.description || INSTALLED_VIA_SKILLS_DESCRIPTION}</span>
                    <span className="truncate text-xs text-muted-foreground">{skill.path || skill.location || skill.license || "skill"}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => props.onReferenceSkill(skill)}>查看</Button>
                  <Button variant="destructive" size="sm" disabled={group.removableItems.length === 0 || removing} onClick={() => props.onRemoveSkill(skill)}>{removing ? "Removing" : "Uninstall"}</Button>
                  </div>
                </CardContent>
              </Card>
            );
          }
          return (
            <Card key={group.name} className="rounded-lg shadow-none">
              <CardContent className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="grid min-w-0 gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <strong className="truncate text-sm font-semibold">{group.name}</strong>
                    <SkillScopeBadge scope="project">{group.items.length} 项</SkillScopeBadge>
                  </div>
                  <span className="truncate text-xs text-muted-foreground">{group.items.map((skill) => skill.name).join(" · ") || "No description"}</span>
                  <span className="truncate text-xs text-muted-foreground">{group.items[0]?.path || group.items[0]?.location || group.items[0]?.license || "skill"}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => props.onReferenceSkill(group.items[0])}>查看</Button>
                <Button variant="destructive" size="sm" disabled={group.removableItems.length === 0 || removing} onClick={() => props.onRemoveSkillGroup(group)}>{removing ? "Removing" : "Uninstall"}</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
