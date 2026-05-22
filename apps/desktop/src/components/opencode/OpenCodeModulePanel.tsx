import { createPortal } from "react-dom";
import { CloseIcon } from "../icons";
import {
  INSTALLED_VIA_SKILLS_DESCRIPTION,
  type OpencodeInstalledSkillGroup,
  type OpencodeSkillInfo
} from "../../lib/opencodeSkillData";
import type { OpencodeAgentInfo } from "../../lib/opencodeAgents";
import type { OpencodePermissionReply, OpencodePermissionRequest } from "../../lib/opencodePermissions";
import { OPENCODE_RECOMMENDED_SKILLS, type OpencodeSkillSearchResult } from "../../lib/opencodeSkillMarketplace";

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

  return createPortal(
    <div
      className="gt-module-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div className="gt-module-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="gt-module-head">
          <div>
            <div className="gt-module-kicker">OpenCode Modules</div>
            <h2>Agent / 权限 / MCP / Skills</h2>
          </div>
          <button type="button" className="modal-close" onClick={props.onClose}><CloseIcon /></button>
        </div>
        <div className="gt-module-tabs">
          {([
            ["agents", "Agents"],
            ["permissions", `权限${props.activePermissions.length ? ` (${props.activePermissions.length})` : ""}`],
            ["mcp", "MCP"],
            ["skills", "Skills"]
          ] as Array<[OpencodeModuleTab, string]>).map(([tab, label]) => (
            <button key={tab} type="button" className={props.activeTab === tab ? "active" : ""} onClick={() => props.onTabChange(tab)}>{label}</button>
          ))}
        </div>
        <div className="gt-module-body">
          {props.activeTab === "agents" ? <AgentsSection {...props} /> : null}
          {props.activeTab === "permissions" ? <PermissionsSection {...props} /> : null}
          {props.activeTab === "mcp" ? <McpSection {...props} /> : null}
          {props.activeTab === "skills" ? <SkillsSection {...props} /> : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

function AgentsSection(props: OpenCodeModulePanelProps) {
  return (
    <div className="gt-module-section">
      <div className="gt-module-toolbar">
        <input className="path-input" placeholder="搜索 agent" value={props.agentSearch} onChange={(event) => props.onAgentSearchChange(event.target.value)} />
        <button className="chip" onClick={props.onRefreshAgents} disabled={props.agentsLoading}>刷新</button>
      </div>
      {props.agentsError ? <div className="small" style={{ color: "var(--danger)" }}>{props.agentsError}</div> : null}
      <div className="gt-module-list">
        {props.visibleAgents.map((agent) => (
          <button key={agent.name} type="button" className={agent.name === props.activeAgent ? "gt-module-row selected" : "gt-module-row"} onClick={() => props.onApplyAgent(agent.name)}>
            <span className="gt-module-row-title">@{agent.name}</span>
            <span className="gt-module-row-desc">{agent.description || agent.mode || "agent"}</span>
            <span className="gt-module-row-meta">{agent.mode || "all"}{agent.native ? " · native" : ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PermissionsSection(props: OpenCodeModulePanelProps) {
  return (
    <div className="gt-module-section">
      <label className="gt-switch-row">
        <span>
          <strong>自动接受权限</strong>
          <small>为当前会话写入 allow-all 规则，并自动回复后续 permission.asked。</small>
        </span>
        <button type="button" className={props.autoAcceptPermissions ? "gt-switch active" : "gt-switch"} onClick={props.onToggleAutoAccept}>
          {props.autoAcceptPermissions ? "ON" : "OFF"}
        </button>
      </label>
      <div className="gt-module-toolbar">
        <button className="chip" onClick={props.onRefreshPermissions} disabled={props.permissionLoading}>刷新权限请求</button>
      </div>
      {props.activePermissions.length === 0 ? (
        <div className="gt-module-empty">当前没有待处理授权。</div>
      ) : (
        <div className="gt-module-list">
          {props.activePermissions.map((req) => (
            <div key={req.id} className="gt-module-row gt-module-row-static">
              <span className="gt-module-row-title">{req.permission || "permission"}</span>
              <span className="gt-module-row-desc">{(req.patterns || []).join(", ") || "*"}</span>
              <span className="gt-module-row-meta">{req.id}</span>
              <span className="gt-module-row-actions">
                <button className="chip" onClick={() => props.onSendPermissionReply(req.id, "once")}>本次</button>
                <button className="chip primary" onClick={() => props.onSendPermissionReply(req.id, "always")}>总是</button>
                <button className="chip danger" onClick={() => props.onSendPermissionReply(req.id, "reject")}>拒绝</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function McpSection(props: OpenCodeModulePanelProps) {
  return (
    <div className="gt-module-section">
      <div className="gt-module-toolbar">
        <button className="chip" onClick={props.onRefreshMcp} disabled={props.mcpLoading}>刷新 MCP</button>
        {props.mcpError ? <span className="small" style={{ color: "var(--danger)" }}>{props.mcpError}</span> : null}
      </div>
      <div className="gt-module-form">
        <input className="path-input" placeholder="mcp 名称，例如 context7" value={props.mcpAddForm.name} onChange={(event) => props.mcpAddForm.setName(event.target.value)} />
        <select className="path-input" value={props.mcpAddForm.type} onChange={(event) => props.mcpAddForm.setType(event.target.value as "remote" | "local")}>
          <option value="remote">remote</option>
          <option value="local">local</option>
        </select>
        {props.mcpAddForm.type === "remote" ? (
          <>
            <input className="path-input" placeholder="https://mcp.example.com/mcp" value={props.mcpAddForm.url} onChange={(event) => props.mcpAddForm.setUrl(event.target.value)} />
            <textarea className="path-input gt-module-textarea" placeholder="Headers，每行 KEY=VALUE（可选）" value={props.mcpAddForm.headers} onChange={(event) => props.mcpAddForm.setHeaders(event.target.value)} />
          </>
        ) : (
          <>
            <input className="path-input" placeholder="npx -y @modelcontextprotocol/server-everything" value={props.mcpAddForm.command} onChange={(event) => props.mcpAddForm.setCommand(event.target.value)} />
            <textarea className="path-input gt-module-textarea" placeholder="Environment，每行 KEY=VALUE（可选）" value={props.mcpAddForm.env} onChange={(event) => props.mcpAddForm.setEnv(event.target.value)} />
          </>
        )}
        <button className="chip primary" onClick={props.onAddMcp} disabled={!!props.mcpBusyName}>添加 MCP</button>
      </div>
      {props.mcpRows.length === 0 ? <div className="gt-module-empty">暂无 MCP server。可添加 Context7、Sentry、Grep 等。</div> : null}
      <div className="gt-module-list">
        {props.mcpRows.map(([name, status]) => {
          const statusLabel = String(status?.status || status?.state || (status?.enabled === false ? "disabled" : "configured"));
          const tools = Array.isArray(status?.tools) ? status.tools.length : undefined;
          return (
            <div key={name} className="gt-module-row gt-module-row-static">
              <span className="gt-module-row-title">{name}</span>
              <span className="gt-module-row-desc">{statusLabel}{typeof tools === "number" ? ` · ${tools} tools` : ""}</span>
              <span className="gt-module-row-meta">{String(status?.type || "mcp")}</span>
              <span className="gt-module-row-actions">
                <button className="chip" onClick={() => props.onRunMcpAction(name, "connect")} disabled={!!props.mcpBusyName}>连接</button>
                <button className="chip" onClick={() => props.onRunMcpAction(name, "disconnect")} disabled={!!props.mcpBusyName}>断开</button>
                <button className="chip" onClick={() => props.onRunMcpAction(name, "auth")} disabled={!!props.mcpBusyName}>OAuth</button>
                <button className="chip danger" onClick={() => props.onRunMcpAction(name, "logout")} disabled={!!props.mcpBusyName}>登出</button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SkillsSection(props: OpenCodeModulePanelProps) {
  return (
    <div className="gt-module-section">
      <div className="gt-module-toolbar">
        <button className="chip" onClick={props.onRefreshSkills} disabled={props.skillsLoading}>刷新 Skills</button>
        {props.skillsError ? <span className="small" style={{ color: "var(--danger)" }}>{props.skillsError}</span> : null}
      </div>
      <div className="gt-skills-hero">
        <div className="gt-skills-hero-copy">
          <span className="gt-module-kicker">Skill command center</span>
          <h3>搜索、安装、区分范围，一屏完成</h3>
          <p>默认推荐全局安装通用能力；项目特定规范、私有工作流或团队模板建议安装到当前仓库。</p>
        </div>
        <div className="gt-skills-hero-stats">
          <span><strong>{props.skills.filter((skill: OpencodeSkillInfo) => skill.scope === "global").length}</strong> Global</span>
          <span><strong>{props.skills.filter((skill: OpencodeSkillInfo) => skill.scope === "project").length}</strong> Repo</span>
          <span><strong>{props.skillSearchResults.length}</strong> Results</span>
        </div>
      </div>
      <div className="gt-skill-scope-picker">
        <span>安装范围</span>
        <button type="button" className={props.skillInstallScope === "project" ? "active" : ""} onClick={() => props.onSkillInstallScopeChange("project")}>当前仓库</button>
        <button type="button" className={props.skillInstallScope === "global" ? "active" : ""} onClick={() => props.onSkillInstallScopeChange("global")}>全局通用</button>
      </div>
      {props.skillBusy ? (
        <div className="gt-skill-progress">
          <span className="gt-skill-progress-orb" />
          <div>
            <strong>正在安装 Skill</strong>
            <small>会从 skills.sh / GitHub 拉取内容，完成后自动刷新 OpenCode Skills 列表。</small>
          </div>
        </div>
      ) : null}
      {(props.skillBusy || props.skillInstallingSpec || props.skillInstallLog) ? (
        <div className="gt-skill-install-log">
          <div><strong>安装日志</strong><span>{props.skillInstallingSpec || "最近一次安装"}</span></div>
          <pre>{props.skillInstallLog || `正在启动安装 ${props.skillInstallingSpec || "skill"}...`}</pre>
        </div>
      ) : null}
      <div className="gt-skill-recommend-grid">
        {OPENCODE_RECOMMENDED_SKILLS.map((skill) => (
          <div key={skill.spec} className="gt-skill-recommend-card">
            <div className="gt-skill-recommend-top">
              <span>{skill.tone}</span>
              <small>{skill.installs}</small>
            </div>
            <strong>{skill.title}</strong>
            <p>{skill.description}</p>
            <div className="gt-skill-recommend-actions">
              <button className="chip" onClick={() => props.onSkillInstallSpecChange(skill.spec)}>填入</button>
              <button className="chip primary" onClick={() => props.onInstallSkill(skill.spec, props.skillInstallScope)} disabled={props.skillBusy}>安装</button>
            </div>
            <code>{skill.spec}</code>
          </div>
        ))}
      </div>
      <div className="gt-module-form compact gt-skill-enter-search">
        <input
          className="path-input"
          placeholder="搜索 skills，例如 frontend / react / testing"
          value={props.skillSearchQuery}
          onChange={(event) => props.onSkillSearchQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.onSearchSkillRegistry();
          }}
        />
      </div>
      {props.skillSearchResults.length > 0 ? (
        <div className="gt-module-list gt-skill-search-list">
          {props.skillSearchResults.map((result) => (
            <div key={result.spec} className="gt-module-row gt-module-row-static">
              <span className="gt-module-row-title">{result.skill}</span>
              <span className="gt-module-row-desc">{result.package}</span>
              <span className="gt-module-row-meta">{result.installs ? `${result.installs} installs` : result.url}</span>
              <span className="gt-module-row-actions">
                <button className="chip" onClick={() => props.onSkillInstallSpecChange(result.installSpec || result.spec)}>填入</button>
                <button className="chip primary" onClick={() => props.onInstallSkill(result.installSpec || result.spec, props.skillInstallScope)} disabled={props.skillBusy}>安装</button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="gt-module-form">
        <input className="path-input" placeholder="skills.sh 条目，如 anthropics/skills@frontend-design" value={props.skillInstallSpec} onChange={(event) => props.onSkillInstallSpecChange(event.target.value)} />
        <button className="chip primary" onClick={() => props.onInstallSkill(undefined, props.skillInstallScope)} disabled={props.skillBusy}>从 skills.sh 安装</button>
      </div>
      <div className="gt-module-form compact">
        <select className="path-input" value={props.skillSourceKind} onChange={(event) => props.onSkillSourceKindChange(event.target.value as "url" | "path")}>
          <option value="url">skills.urls</option>
          <option value="path">skills.paths</option>
        </select>
        <input className="path-input" placeholder={props.skillSourceKind === "url" ? "https://example.com/.well-known/skills/" : "/path/to/skills"} value={props.skillSourceInput} onChange={(event) => props.onSkillSourceInputChange(event.target.value)} />
        <button className="chip" onClick={props.onAddSkillSource} disabled={props.skillBusy}>添加来源</button>
      </div>
      <div className="gt-installed-skill-tools">
        <div className="gt-skill-filter-tabs">
          {([
            ["all", `全部 ${props.skills.length}`],
            ["global", `Global ${props.skills.filter((skill) => skill.scope === "global").length}`],
            ["project", `Repo ${props.skills.filter((skill) => skill.scope === "project").length}`],
            ["source", `Source ${props.skills.filter((skill) => (skill.scope || "source") === "source").length}`]
          ] as Array<["all" | "global" | "project" | "source", string]>).map(([filter, label]) => (
            <button key={filter} type="button" className={props.skillListFilter === filter ? "active" : ""} onClick={() => props.onSkillListFilterChange(filter)}>{label}</button>
          ))}
        </div>
        <input className="path-input" placeholder="过滤已安装 skills" value={props.skillListQuery} onChange={(event) => props.onSkillListQueryChange(event.target.value)} />
      </div>
      {props.skills.length === 0 ? <div className="gt-module-empty">暂无 Skills。OpenCode 会扫描 .opencode/skills、.claude/skills 和全局 skills。</div> : null}
      {props.skills.length > 0 && props.filteredSkills.length === 0 ? <div className="gt-module-empty">没有匹配当前过滤条件的 Skill。</div> : null}
      <div className="gt-module-list">
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
              <div key={group.name} className="gt-module-row gt-module-row-static">
                <span className="gt-module-row-title">{skill.name}<span className={`gt-scope-badge ${scope}`}>{scopeLabel}</span></span>
                <span className="gt-module-row-desc">{skill.description || INSTALLED_VIA_SKILLS_DESCRIPTION}</span>
                <span className="gt-module-row-meta">{skill.path || skill.location || skill.license || "skill"}</span>
                <span className="gt-module-row-actions">
                  <button className="chip" onClick={() => props.onReferenceSkill(skill)}>查看</button>
                  <button className="chip danger" disabled={group.removableItems.length === 0 || removing} onClick={() => props.onRemoveSkill(skill)}>{removing ? "Removing" : "Uninstall"}</button>
                </span>
              </div>
            );
          }
          return (
            <div key={group.name} className="gt-module-row gt-module-row-static">
              <span className="gt-module-row-title">{group.name}<span className="gt-scope-badge project">{group.items.length} 项</span></span>
              <span className="gt-module-row-desc">{group.items.map((skill) => skill.name).join(" · ") || "No description"}</span>
              <span className="gt-module-row-meta">{group.items[0]?.path || group.items[0]?.location || group.items[0]?.license || "skill"}</span>
              <span className="gt-module-row-actions">
                <button className="chip" onClick={() => props.onReferenceSkill(group.items[0])}>查看</button>
                <button className="chip danger" disabled={group.removableItems.length === 0 || removing} onClick={() => props.onRemoveSkillGroup(group)}>{removing ? "Removing" : "Uninstall"}</button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
