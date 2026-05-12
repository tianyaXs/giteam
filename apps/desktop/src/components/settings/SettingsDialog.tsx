import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { RuntimeActionJobStatus, RuntimeDepName, RuntimeDependencyStatus, RuntimeRequirementsStatus } from "../../lib/appCache";

type RightModuleKey = "changes" | "worktree" | "terminal" | "skills" | "mcp";

type ControlServerSettingsDraft = {
  enabled: boolean;
  port: number;
  publicBaseUrl: string;
  pairCodeTtlMode: "none" | "24h" | "7d" | "forever";
};

type SettingsDialogProps = {
  theme: "dark" | "light";
  runtimeStatus: RuntimeRequirementsStatus;
  onClose: () => void;
  onToggleTheme: () => void;
  onOpenRuntimeSetup: () => void;
  onOpenMobileControl: () => void;
  onOpenOpenCodeApi: () => void;
  onOpenModelManager: () => void;
  onOpenSkillsMarketplaceSettings: () => void;
  rightModules: Record<RightModuleKey, boolean>;
  onToggleRightModule: (key: RightModuleKey) => void;
  opencodePort: number;
  opencodeBusy: boolean;
  onOpencodePortChange: (port: number) => void;
  onSaveOpenCodeApi: () => void;
  skillsmpApiKey: string;
  skillsmpApiKeyDraft: string;
  onSkillsmpApiKeyDraftChange: (value: string) => void;
  onSaveSkillsmpApiKey: () => void;
  onClearSkillsmpApiKey: () => void;
  uiFontSize: number;
  codeFontSize: number;
  onUiFontSizeChange: (value: number) => void;
  onCodeFontSizeChange: (value: number) => void;
  controlSettings: ControlServerSettingsDraft;
  controlBusy: boolean;
  controlInstalled: boolean;
  onControlSettingsChange: (settings: ControlServerSettingsDraft) => void;
  onSaveControlSettings: () => void;
  runtimeChecking: boolean;
  checkingDeps: Record<RuntimeDepName, boolean>;
  installingDep: string;
  installingElapsed: number;
  runtimeJob: RuntimeActionJobStatus | null;
  onRefreshRuntime: () => void;
  onRunDependencyAction: (name: RuntimeDepName, action: "install" | "uninstall") => void;
  modelsContent?: ReactNode;
  initialSection?: SettingsSectionId;
  mobileStatusContent?: ReactNode;
  onToggleControlService: (enabled: boolean) => void;
};

type SettingsSectionId = "appearance" | "modules" | "plugins" | "mobile" | "opencode" | "models" | "skillsmp";

type SettingsEntry = {
  title: string;
  description: string;
  action: ReactNode;
};

type SettingsSection = {
  id: SettingsSectionId;
  kicker: string;
  title: string;
  description: string;
  entries?: Array<SettingsEntry>;
  content?: ReactNode;
};

function FontSizeStepper(props: { value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="settings-stepper">
      <button className="chip" type="button" disabled={props.value <= props.min} onClick={() => props.onChange(props.value - 1)}>−</button>
      <span>{props.value}</span>
      <button className="chip" type="button" disabled={props.value >= props.max} onClick={() => props.onChange(props.value + 1)}>＋</button>
    </div>
  );
}

export function SettingsDialog(props: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(props.initialSection || "appearance");

  useEffect(() => {
    if (props.initialSection) setActiveSection(props.initialSection);
  }, [props.initialSection]);

  const sections = useMemo(() => {
    const rightModuleLabels: Record<RightModuleKey, { title: string; description: string }> = {
      changes: { title: "Changes", description: "显示当前仓库变更列表。" },
      worktree: { title: "GitTree", description: "显示分支与 worktree 拓扑。" },
      terminal: { title: "Terminal", description: "显示内置终端入口。" },
      skills: { title: "Skills", description: "显示 Skills marketplace。" },
      mcp: { title: "MCP", description: "显示 MCP server 管理模块。" }
    };
    const entriesBySection: Record<SettingsSectionId, Array<SettingsEntry>> = {
      appearance: [
        {
          title: "Theme",
          description: "切换明暗主题。",
          action: (
            <button className="chip" onClick={props.onToggleTheme} title={props.theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}>
              {props.theme === "dark" ? "Light" : "Dark"}
            </button>
          )
        },
        {
          title: "UI Font Size",
          description: "调整界面文字大小。",
          action: <FontSizeStepper value={props.uiFontSize} min={11} max={18} onChange={props.onUiFontSizeChange} />
        },
        {
          title: "Code Font Size",
          description: "调整代码、终端和等宽文本大小。",
          action: <FontSizeStepper value={props.codeFontSize} min={10} max={18} onChange={props.onCodeFontSizeChange} />
        }
      ],
      modules: (Object.entries(rightModuleLabels) as Array<[RightModuleKey, { title: string; description: string }]>).map(([key, item]) => ({
        title: item.title,
        description: item.description,
        action: (
          <button
            type="button"
            className={props.rightModules[key] ? "gt-switch on" : "gt-switch"}
            aria-pressed={props.rightModules[key]}
            onClick={() => props.onToggleRightModule(key)}
          >
            <span className="gt-switch-thumb" aria-hidden="true" />
          </button>
        )
      })),
      plugins: [],
      mobile: [
        {
          title: "Mobile Control API",
          description: props.runtimeStatus.giteam.installed
            ? "配置移动端连接服务、端口与配对方式。"
            : "需要先安装 giteam plugin，才可以启用移动控制服务。",
          action: (
            <button
              className="chip"
              disabled={!props.runtimeStatus.giteam.installed}
              title={props.runtimeStatus.giteam.installed ? "Save Mobile Control API" : "Install giteam plugin first"}
              onClick={props.controlInstalled ? props.onSaveControlSettings : () => props.onRunDependencyAction("giteam", "install")}
            >
              {props.controlBusy ? "Saving..." : props.controlInstalled ? "Save" : "Install first"}
            </button>
          )
        },
        {
          title: "Service",
          description: "是否启用移动端控制服务。",
          action: (
            <button
              type="button"
              className={props.controlSettings.enabled ? "gt-switch on" : "gt-switch"}
              disabled={!props.controlInstalled || props.controlBusy}
              onClick={() => props.onToggleControlService(!props.controlSettings.enabled)}
            >
              <span className="gt-switch-thumb" aria-hidden="true" />
            </button>
          )
        },
        {
          title: "Port",
          description: "移动端访问服务端口。",
          action: <input className="path-input settings-inline-input" type="number" min={1} max={65535} value={String(props.controlSettings.port)} disabled={!props.controlInstalled || props.controlBusy} onChange={(e) => props.onControlSettingsChange({ ...props.controlSettings, port: Number(e.target.value || "0") })} />
        },
        {
          title: "Public URL",
          description: "可选，公网或局域网可访问地址。",
          action: <input className="path-input settings-inline-input settings-inline-input-wide" placeholder="http://192.168.1.23:4100" value={props.controlSettings.publicBaseUrl} disabled={!props.controlInstalled || props.controlBusy} onChange={(e) => props.onControlSettingsChange({ ...props.controlSettings, publicBaseUrl: e.target.value })} />
        },
        {
          title: "Pair Code",
          description: "设置配对码有效期。",
          action: (
            <select className="path-input settings-inline-input settings-inline-input-wide" value={props.controlSettings.pairCodeTtlMode} disabled={!props.controlInstalled || props.controlBusy} onChange={(e) => props.onControlSettingsChange({ ...props.controlSettings, pairCodeTtlMode: e.target.value as ControlServerSettingsDraft["pairCodeTtlMode"] })}>
              <option value="none">No Auth</option>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
            </select>
          )
        }
      ],
      opencode: [
        {
          title: "Service port",
          description: props.opencodeBusy ? "正在保存并重启 OpenCode 服务。" : "修改后自动保存并重启服务。",
          action: <input className="path-input settings-inline-input" type="number" min={1} max={65535} value={String(props.opencodePort)} disabled={!props.runtimeStatus.opencode.installed || props.opencodeBusy} onChange={(e) => props.onOpencodePortChange(Number(e.target.value || "0"))} onBlur={props.onSaveOpenCodeApi} />
        }
      ],
      models: [],
      skillsmp: [
        {
          title: "API Key",
          description: props.skillsmpApiKey ? "已配置；清空输入框并保存即可移除。" : "可选项；未配置时 AI 搜索会自动回退关键词搜索。",
          action: <div className="settings-inline-combo"><input className="path-input settings-inline-input settings-inline-input-wide" type="password" placeholder="sk_live_skillsmp_..." value={props.skillsmpApiKeyDraft} onChange={(e) => props.onSkillsmpApiKeyDraftChange(e.target.value)} /><button className="chip primary" onClick={props.onSaveSkillsmpApiKey}>Save</button></div>
        }
      ]
    };

    const pluginDeps = [props.runtimeStatus.git, props.runtimeStatus.entire, props.runtimeStatus.opencode, props.runtimeStatus.giteam]
      .filter((dep): dep is RuntimeDependencyStatus => Boolean(dep));

    return [
      {
        id: "appearance" as const,
        kicker: "Preferences",
        title: "Appearance",
        description: "调整主题、模块入口与界面基础风格。",
        entries: entriesBySection.appearance
      },
      {
        id: "modules" as const,
        kicker: "Layout",
        title: "Right modules",
        description: "控制右侧模块按钮是否显示，保留你常用的工作区。",
        entries: entriesBySection.modules
      },
      {
        id: "plugins" as const,
        kicker: "Runtime",
        title: "Plugins",
        description: "",
        content: (
          <div className="settings-panel-list">
            <div className="settings-inline-head">
              <span />
              <button className="gt-icon-chip" title="Refresh" disabled={props.runtimeChecking || Boolean(props.installingDep)} onClick={props.onRefreshRuntime}>↻</button>
            </div>
            {pluginDeps.map((dep) => {
              const depName = dep.name as RuntimeDepName;
              const busy = props.installingDep === dep.name;
              const action = dep.installed ? "uninstall" : "install";
              return (
                <article key={dep.name} className="settings-panel-card settings-plugin-row">
                  <div className="settings-panel-copy">
                    <strong>{dep.name}</strong>
                    <p>{props.checkingDeps[depName] ? "Checking..." : dep.installed ? `Installed${dep.version ? ` · ${dep.version}` : ""}` : dep.installHint || "Missing"}</p>
                    {dep.path ? <p className="settings-plugin-path">{dep.path}</p> : null}
                    {props.runtimeJob?.name === dep.name ? <p>{props.runtimeJob.action} · {props.runtimeJob.status} · {props.installingElapsed}s</p> : null}
                  </div>
                  <div className="settings-panel-action">
                    <button className="chip" disabled={props.runtimeChecking || Boolean(props.installingDep)} onClick={() => props.onRunDependencyAction(depName, action)}>
                      {busy ? `${action === "install" ? "Installing" : "Uninstalling"}...` : dep.installed ? "Uninstall" : "Install"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )
      },
      {
        id: "mobile" as const,
        kicker: "Service",
        title: "Mobile Control API",
        description: "直接在设置页中管理移动端服务，不再跳转额外弹窗。",
        content: <><div className="settings-panel-list">{entriesBySection.mobile.map((entry) => <article key={entry.title} className="settings-panel-card"><div className="settings-panel-copy"><strong>{entry.title}</strong><p>{entry.description}</p></div><div className="settings-panel-action">{entry.action}</div></article>)}</div>{props.mobileStatusContent}</>
      },
      {
        id: "opencode" as const,
        kicker: "Service",
        title: "OpenCode API",
        description: "配置 OpenCode 服务端口和连接参数。",
        entries: entriesBySection.opencode
      },
      {
        id: "models" as const,
        kicker: "AI",
        title: "Models",
        description: "管理 provider 和模型选择。",
        content: props.modelsContent || <div className="settings-panel-card"><div className="settings-panel-copy"><strong>Models</strong><p>暂无模型信息。</p></div></div>
      },
      {
        id: "skillsmp" as const,
        kicker: "Marketplace",
        title: "SkillsMP",
        description: "配置 Skills 市场的 AI 搜索能力。",
        entries: entriesBySection.skillsmp
      }
    ] satisfies SettingsSection[];
  }, [props]);

  const active = sections.find((section) => section.id === activeSection) || sections[0];

  return (
    <div className="modal-mask" onClick={() => void props.onClose()}>
      <div className="modal-card settings-card settings-card--redesigned" onClick={(e) => e.stopPropagation()}>
        <div className="settings-shell">
          <aside className="settings-sidebar">
            <div className="settings-sidebar-head">
              <span className="gt-module-kicker">workspace settings</span>
              <h3>Settings</h3>
            </div>
            <div className="settings-nav">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={activeSection === section.id ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setActiveSection(section.id)}
                >
                  <span>{section.title}</span>
                  <small>{section.kicker}</small>
                </button>
              ))}
            </div>
            <div className="settings-sidebar-foot">
              <button className="chip" onClick={() => void props.onClose()}>
                Close
              </button>
            </div>
          </aside>

          <section className="settings-main">
            <div className="settings-main-head">
              <span className="gt-module-kicker">{active.kicker}</span>
              <h4>{active.title}</h4>
              {active.description ? <p>{active.description}</p> : null}
            </div>

            {active.content ? active.content : (
              <div className="settings-panel-list">
              {(active.entries || []).map((entry) => (
                <article key={entry.title} className="settings-panel-card">
                  <div className="settings-panel-copy">
                    <strong>{entry.title}</strong>
                    <p>{entry.description}</p>
                  </div>
                  <div className="settings-panel-action">{entry.action}</div>
                </article>
              ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
