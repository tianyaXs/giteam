import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { RuntimeActionJobStatus, RuntimeDepName, RuntimeDependencyStatus, RuntimeRequirementsStatus } from "../../lib/appCache";

type RightModuleKey = "changes" | "worktree" | "terminal" | "skills" | "mcp";

type ControlServerSettingsDraft = {
  enabled: boolean;
  port: number;
  publicBaseUrl: string;
  pairCodeTtlMode: "none" | "24h" | "7d" | "forever";
};

export type GeneralSettingsDraft = {
  language: "system" | "zh-CN" | "zh-TW" | "en-US";
  autoAcceptPermissions: boolean;
  showReasoningSummaries: boolean;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  showSessionProgressBar: boolean;
  notificationsAgent: boolean;
  notificationsPermissions: boolean;
  notificationsErrors: boolean;
  soundsAgent: boolean;
  soundsPermissions: boolean;
  soundsErrors: boolean;
  updatesStartup: boolean;
  releaseNotes: boolean;
};

type SettingsLocale = Exclude<GeneralSettingsDraft["language"], "system">;

const SETTINGS_TEXT = {
  "zh-CN": {
    followSystem: "跟随系统", back: "← 设置", sidebarIntro: "按使用场景管理界面、会话、通知和运行环境。",
    general: "通用", generalKicker: "基础", generalDesc: "调整界面显示、授权行为和会话中的消息展示方式。", basics: "基础", sessionDisplay: "会话显示",
    workspace: "工作区", workspaceKicker: "布局", workspaceDesc: "控制右侧模块按钮是否显示，保留你常用的工作区。",
    models: "模型", modelsKicker: "模型", modelsDesc: "管理服务商、默认模型和模型显示状态。", modelsEmpty: "暂无模型信息。",
    dependencies: "依赖", dependenciesKicker: "运行环境", dependenciesDesc: "检查并管理 Git、Entire、OpenCode、giteam 等运行时依赖。",
    api: "接口", apiKicker: "连接", apiDesc: "管理移动端控制服务与 OpenCode 连接参数。",
    skills: "技能", skillsKicker: "扩展", skillsDesc: "管理已安装技能，并配置技能市场的搜索能力。",
    updates: "更新", updatesKicker: "维护", updatesDesc: "管理启动检查、发布说明和运行时依赖检查。",
    notifications: "通知", notificationsKicker: "提醒", notificationsDesc: "控制哪些事件会发送系统通知。",
    sounds: "声音", soundsKicker: "提醒", soundsDesc: "控制 Agent、授权和错误事件的提示音。",
    language: "界面语言", languageDesc: "选择界面语言；系统会跟随当前环境。", autoAccept: "自动允许授权", autoAcceptDesc: "自动通过当前 OpenCode 会话的工具授权请求。",
    reasoning: "推理摘要", reasoningDesc: "在对话中显示模型推理摘要。", shellParts: "Shell 工具详情", shellPartsDesc: "默认展开 Shell 工具调用详情。", editParts: "编辑工具详情", editPartsDesc: "默认展开编辑工具调用详情。", progressBar: "会话进度条", progressBarDesc: "在会话工作中显示进度条。",
    theme: "主题", themeDesc: "在浅色和深色主题之间切换。", light: "浅色", dark: "深色", uiFont: "界面字号", uiFontDesc: "调整界面文字大小。", codeFont: "代码字号", codeFontDesc: "调整代码、终端和等宽文本大小。",
    changes: "变更", changesDesc: "显示当前仓库变更列表。", worktree: "工作树", worktreeDesc: "显示分支与 worktree 拓扑。", terminal: "终端", terminalDesc: "显示内置终端入口。", skillsModuleDesc: "显示技能市场。", mcpDesc: "显示 MCP 服务管理模块。",
    mobileControl: "移动端控制", mobileControlReady: "配置移动端连接服务、端口与配对方式。", mobileControlMissing: "需要先安装 giteam 依赖，才可以启用移动控制服务。", service: "服务开关", serviceDesc: "是否启用移动端控制服务。", port: "服务端口", portDesc: "移动端访问服务端口。", publicUrl: "公开地址", publicUrlDesc: "可选，公网或局域网可访问地址。", pairCode: "配对码", pairCodeDesc: "设置配对码有效期。", noAuth: "无需认证", hours24: "24 小时", days7: "7 天", opencodeApi: "OpenCode 接口", opencodeApiBusy: "正在保存并重启 OpenCode 服务。", opencodeApiDesc: "配置 OpenCode 服务端口。",
    apiKey: "API 密钥", apiKeyConfigured: "已配置；清空输入框并保存即可移除。", apiKeyDesc: "可选项；未配置时 AI 搜索会自动回退关键词搜索。",
    agentNotifications: "Agent 通知", agentNotificationsDesc: "Agent 完成或需要关注时发送通知。", permissionNotifications: "授权通知", permissionNotificationsDesc: "出现授权请求时发送通知。", errorNotifications: "错误通知", errorNotificationsDesc: "发生错误时发送通知。",
    agentSound: "Agent 提示音", agentSoundDesc: "Agent 完成或状态变化时播放提示音。", permissionSound: "授权提示音", permissionSoundDesc: "出现授权请求时播放提示音。", errorSound: "错误提示音", errorSoundDesc: "发生错误时播放提示音。",
    startupCheck: "启动时检查", startupCheckDesc: "应用启动后自动检查依赖状态。", releaseNotes: "发布说明", releaseNotesDesc: "新版本首次启动时展示更新内容。", checkNow: "立即检查", checkNowDesc: "立即执行一次运行时依赖检查。",
    save: "保存", saving: "保存中...", installFirst: "先安装", install: "安装", uninstall: "卸载", installing: "安装中", uninstalling: "卸载中", checking: "检查中...", check: "检查", refresh: "刷新", installed: "已安装", missing: "缺失", saveMobileTitle: "保存移动端控制配置", installDependencyTitle: "先安装 giteam 依赖"
  },
  "zh-TW": {}, "en-US": {}
} as const;

type SettingsTextKey = keyof typeof SETTINGS_TEXT["zh-CN"];

const SETTINGS_TEXT_OVERRIDES: Record<Exclude<SettingsLocale, "zh-CN">, Record<SettingsTextKey, string>> = {
  "zh-TW": {
    followSystem: "跟隨系統", back: "← 設定", sidebarIntro: "依使用情境管理介面、會話、通知與執行環境。",
    general: "一般", generalKicker: "基礎", generalDesc: "調整介面顯示、授權行為和會話中的訊息顯示方式。", basics: "基礎", sessionDisplay: "會話顯示",
    workspace: "工作區", workspaceKicker: "版面", workspaceDesc: "控制右側模組按鈕是否顯示，保留常用工作區。",
    models: "模型", modelsKicker: "模型", modelsDesc: "管理服務商、預設模型和模型顯示狀態。", modelsEmpty: "暫無模型資訊。",
    dependencies: "依賴", dependenciesKicker: "執行環境", dependenciesDesc: "檢查並管理 Git、Entire、OpenCode、giteam 等執行時依賴。",
    api: "介面", apiKicker: "連線", apiDesc: "管理行動端控制服務與 OpenCode 連線參數。",
    skills: "技能", skillsKicker: "擴充", skillsDesc: "管理已安裝技能，並設定技能市場搜尋能力。",
    updates: "更新", updatesKicker: "維護", updatesDesc: "管理啟動檢查、發布說明和執行時依賴檢查。",
    notifications: "通知", notificationsKicker: "提醒", notificationsDesc: "控制哪些事件會傳送系統通知。",
    sounds: "聲音", soundsKicker: "提醒", soundsDesc: "控制 Agent、授權和錯誤事件的提示音。",
    language: "介面語言", languageDesc: "選擇介面語言；系統會跟隨目前環境。", autoAccept: "自動允許授權", autoAcceptDesc: "自動通過目前 OpenCode 會話的工具授權請求。",
    reasoning: "推理摘要", reasoningDesc: "在對話中顯示模型推理摘要。", shellParts: "Shell 工具詳情", shellPartsDesc: "預設展開 Shell 工具呼叫詳情。", editParts: "編輯工具詳情", editPartsDesc: "預設展開編輯工具呼叫詳情。", progressBar: "會話進度列", progressBarDesc: "在會話工作中顯示進度列。",
    theme: "主題", themeDesc: "在淺色和深色主題之間切換。", light: "淺色", dark: "深色", uiFont: "介面字號", uiFontDesc: "調整介面文字大小。", codeFont: "程式碼字號", codeFontDesc: "調整程式碼、終端機和等寬文字大小。",
    changes: "變更", changesDesc: "顯示目前倉庫變更列表。", worktree: "工作樹", worktreeDesc: "顯示分支與 worktree 拓撲。", terminal: "終端機", terminalDesc: "顯示內建終端機入口。", skillsModuleDesc: "顯示技能市場。", mcpDesc: "顯示 MCP 服務管理模組。",
    mobileControl: "行動端控制", mobileControlReady: "設定行動端連線服務、連接埠與配對方式。", mobileControlMissing: "需要先安裝 giteam 依賴，才可以啟用行動端控制服務。", service: "服務開關", serviceDesc: "是否啟用行動端控制服務。", port: "服務連接埠", portDesc: "行動端存取服務連接埠。", publicUrl: "公開地址", publicUrlDesc: "可選，公網或區域網路可存取地址。", pairCode: "配對碼", pairCodeDesc: "設定配對碼有效期。", noAuth: "無需認證", hours24: "24 小時", days7: "7 天", opencodeApi: "OpenCode 介面", opencodeApiBusy: "正在儲存並重新啟動 OpenCode 服務。", opencodeApiDesc: "設定 OpenCode 服務連接埠。",
    apiKey: "API 金鑰", apiKeyConfigured: "已設定；清空輸入框並儲存即可移除。", apiKeyDesc: "可選項；未設定時 AI 搜尋會自動回退關鍵字搜尋。",
    agentNotifications: "Agent 通知", agentNotificationsDesc: "Agent 完成或需要關注時傳送通知。", permissionNotifications: "授權通知", permissionNotificationsDesc: "出現授權請求時傳送通知。", errorNotifications: "錯誤通知", errorNotificationsDesc: "發生錯誤時傳送通知。",
    agentSound: "Agent 提示音", agentSoundDesc: "Agent 完成或狀態變化時播放提示音。", permissionSound: "授權提示音", permissionSoundDesc: "出現授權請求時播放提示音。", errorSound: "錯誤提示音", errorSoundDesc: "發生錯誤時播放提示音。",
    startupCheck: "啟動時檢查", startupCheckDesc: "應用啟動後自動檢查依賴狀態。", releaseNotes: "發布說明", releaseNotesDesc: "新版本首次啟動時顯示更新內容。", checkNow: "立即檢查", checkNowDesc: "立即執行一次執行時依賴檢查。",
    save: "儲存", saving: "儲存中...", installFirst: "先安裝", install: "安裝", uninstall: "解除安裝", installing: "安裝中", uninstalling: "解除安裝中", checking: "檢查中...", check: "檢查", refresh: "重新整理", installed: "已安裝", missing: "缺少", saveMobileTitle: "儲存行動端控制設定", installDependencyTitle: "先安裝 giteam 依賴"
  },
  "en-US": {
    followSystem: "Follow System", back: "← Settings", sidebarIntro: "Manage interface, sessions, notifications, and runtime by workflow.", general: "General", generalKicker: "Basics", generalDesc: "Adjust display, permissions, and session message behavior.", basics: "Basics", sessionDisplay: "Session Display", workspace: "Workspace", workspaceKicker: "Layout", workspaceDesc: "Choose which right-side workspace modules are visible.", models: "Models", modelsKicker: "Models", modelsDesc: "Manage providers, default models, and model visibility.", modelsEmpty: "No model information yet.", dependencies: "Dependencies", dependenciesKicker: "Runtime", dependenciesDesc: "Check and manage runtime dependencies such as Git, Entire, OpenCode, and giteam.", api: "API", apiKicker: "Connection", apiDesc: "Manage mobile control service and OpenCode connection settings.", skills: "Skills", skillsKicker: "Extensions", skillsDesc: "Manage installed skills and Skills marketplace search.", updates: "Updates", updatesKicker: "Maintenance", updatesDesc: "Manage startup checks, release notes, and runtime dependency checks.", notifications: "Notifications", notificationsKicker: "Alerts", notificationsDesc: "Choose which events send system notifications.", sounds: "Sounds", soundsKicker: "Alerts", soundsDesc: "Control sounds for agent, permission, and error events.", language: "Language", languageDesc: "Choose the interface language; system follows your environment.", autoAccept: "Auto Accept Permissions", autoAcceptDesc: "Automatically approve tool permission requests for the current OpenCode session.", reasoning: "Reasoning Summaries", reasoningDesc: "Show model reasoning summaries in conversations.", shellParts: "Shell Tool Details", shellPartsDesc: "Expand Shell tool call details by default.", editParts: "Edit Tool Details", editPartsDesc: "Expand edit tool call details by default.", progressBar: "Session Progress Bar", progressBarDesc: "Show a progress bar while a session is working.", theme: "Theme", themeDesc: "Switch between light and dark themes.", light: "Light", dark: "Dark", uiFont: "UI Font Size", uiFontDesc: "Adjust interface text size.", codeFont: "Code Font Size", codeFontDesc: "Adjust code, terminal, and monospace text size.", changes: "Changes", changesDesc: "Show current repository changes.", worktree: "Worktree", worktreeDesc: "Show branch and worktree topology.", terminal: "Terminal", terminalDesc: "Show the built-in terminal entry.", skillsModuleDesc: "Show the Skills marketplace.", mcpDesc: "Show MCP server management.", mobileControl: "Mobile Control", mobileControlReady: "Configure mobile connection service, port, and pairing.", mobileControlMissing: "Install the giteam dependency before enabling mobile control.", service: "Service", serviceDesc: "Enable or disable the mobile control service.", port: "Port", portDesc: "Service port for mobile access.", publicUrl: "Public URL", publicUrlDesc: "Optional public or LAN-accessible URL.", pairCode: "Pair Code", pairCodeDesc: "Set pair code expiration.", noAuth: "No Auth", hours24: "24 hours", days7: "7 days", opencodeApi: "OpenCode API", opencodeApiBusy: "Saving and restarting the OpenCode service.", opencodeApiDesc: "Configure the OpenCode service port.", apiKey: "API Key", apiKeyConfigured: "Configured; clear the input and save to remove it.", apiKeyDesc: "Optional; AI search falls back to keyword search when unset.", agentNotifications: "Agent Notifications", agentNotificationsDesc: "Notify when the agent finishes or needs attention.", permissionNotifications: "Permission Notifications", permissionNotificationsDesc: "Notify when a permission request appears.", errorNotifications: "Error Notifications", errorNotificationsDesc: "Notify when an error occurs.", agentSound: "Agent Sound", agentSoundDesc: "Play a sound when the agent finishes or changes state.", permissionSound: "Permission Sound", permissionSoundDesc: "Play a sound when permission is requested.", errorSound: "Error Sound", errorSoundDesc: "Play a sound when an error occurs.", startupCheck: "Check on Startup", startupCheckDesc: "Automatically check dependency status after launch.", releaseNotes: "Release Notes", releaseNotesDesc: "Show release notes the first time a new version starts.", checkNow: "Check Now", checkNowDesc: "Run a runtime dependency check now.", save: "Save", saving: "Saving...", installFirst: "Install first", install: "Install", uninstall: "Uninstall", installing: "Installing", uninstalling: "Uninstalling", checking: "Checking...", check: "Check", refresh: "Refresh", installed: "Installed", missing: "Missing", saveMobileTitle: "Save mobile control settings", installDependencyTitle: "Install giteam dependency first"
  }
};

function normalizeSettingsLocale(value: string): SettingsLocale {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk")) return "zh-TW";
  if (normalized.startsWith("zh")) return "zh-CN";
  return "en-US";
}

function getSettingsText(language: GeneralSettingsDraft["language"]): Record<SettingsTextKey, string> {
  const locale = language === "system" ? normalizeSettingsLocale(navigator.language || "zh-CN") : language;
  return locale === "zh-CN" ? { ...SETTINGS_TEXT["zh-CN"] } : { ...SETTINGS_TEXT["zh-CN"], ...SETTINGS_TEXT_OVERRIDES[locale] };
}

const LANGUAGE_OPTIONS: Array<{ value: GeneralSettingsDraft["language"]; label: string; system?: boolean }> = [
  { value: "system", label: "跟随系统", system: true },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en-US", label: "English" }
];

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
  generalSettings: GeneralSettingsDraft;
  onGeneralSettingsChange: (settings: GeneralSettingsDraft) => void;
  onCheckUpdates: () => void;
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
  initialSection?: InitialSettingsSectionId;
  mobileStatusContent?: ReactNode;
  skillsContent?: ReactNode;
  skillsLoading?: boolean;
  onRefreshSkills?: () => void;
  onSkillsVisible?: () => void;
  mcpContent?: ReactNode;
  mcpLoading?: boolean;
  onRefreshMcp?: () => void;
  onMcpVisible?: () => void;
  onToggleControlService: (enabled: boolean) => void;
};

type SettingsSectionId = "general" | "notifications" | "sounds" | "updates" | "appearance" | "workspace" | "models" | "skillsmp" | "mcp" | "plugins" | "mobile";
type InitialSettingsSectionId = SettingsSectionId | "modules" | "opencode";

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

function SegmentedControl(props: { options: string[]; value: string; onChange?: (value: string) => void }) {
  return (
    <div className="settings-segmented" role="group">
      {props.options.map((option) => (
        <button key={option} type="button" className={props.value === option ? "active" : ""} onClick={() => props.onChange?.(option)}>
          {option}
        </button>
      ))}
    </div>
  );
}

function SwitchControl(props: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      className={props.checked ? "gt-switch on" : "gt-switch"}
      aria-pressed={props.checked}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="gt-switch-thumb" aria-hidden="true" />
    </button>
  );
}

function LanguagePicker(props: { value: GeneralSettingsDraft["language"]; systemLabel: string; onChange: (value: GeneralSettingsDraft["language"]) => void }) {
  const [open, setOpen] = useState(false);
  const selected = LANGUAGE_OPTIONS.find((option) => option.value === props.value) || LANGUAGE_OPTIONS[0];
  const labelFor = (option: { label: string; system?: boolean }) => option.system ? props.systemLabel : option.label;
  return (
    <div className="settings-language-picker">
      <button type="button" className="settings-language-trigger" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{labelFor(selected)}</span>
        <span className="settings-language-chevron" aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div className="settings-language-menu" role="listbox">
          {LANGUAGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={props.value === option.value}
              className={props.value === option.value ? "active" : ""}
              onClick={() => {
                props.onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{labelFor(option)}</span>
              {props.value === option.value ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SettingsRows(props: { entries: Array<SettingsEntry> }) {
  return (
    <div className="settings-panel-list">
      {props.entries.map((entry) => (
        <article key={entry.title} className="settings-panel-card">
          <div className="settings-panel-copy">
            <strong>{entry.title}</strong>
            <p>{entry.description}</p>
          </div>
          <div className="settings-panel-action">{entry.action}</div>
        </article>
      ))}
    </div>
  );
}

function SettingsGroup(props: { title: string; entries: Array<SettingsEntry>; wide?: boolean }) {
  return (
    <section className={props.wide ? "settings-general-group is-wide" : "settings-general-group"}>
      <div className="settings-subsection-title">{props.title}</div>
      <SettingsRows entries={props.entries} />
    </section>
  );
}

export function SettingsDialog(props: SettingsDialogProps) {
  const text = useMemo(() => getSettingsText(props.generalSettings.language), [props.generalSettings.language]);
  const normalizeSection = (section?: InitialSettingsSectionId | "opencode"): SettingsSectionId => {
    if (section === "modules") return "workspace";
    if (section === "opencode") return "mobile";
    if (section === "appearance") return "general";
    return section || "general";
  };
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(normalizeSection(props.initialSection));

  useEffect(() => {
    if (props.initialSection) setActiveSection(normalizeSection(props.initialSection));
  }, [props.initialSection]);

  useEffect(() => {
    if (activeSection === "skillsmp") props.onSkillsVisible?.();
    if (activeSection === "mcp") props.onMcpVisible?.();
  }, [activeSection]);

  const sections = useMemo(() => {
    const rightModuleLabels: Record<RightModuleKey, { title: string; description: string }> = {
      changes: { title: text.changes, description: text.changesDesc },
      worktree: { title: text.worktree, description: text.worktreeDesc },
      terminal: { title: text.terminal, description: text.terminalDesc },
      skills: { title: text.skills, description: text.skillsModuleDesc },
      mcp: { title: "MCP", description: text.mcpDesc }
    };
    const updateGeneral = (patch: Partial<GeneralSettingsDraft>) => props.onGeneralSettingsChange({ ...props.generalSettings, ...patch });
    const entriesBySection: Record<SettingsSectionId, Array<SettingsEntry>> = {
      general: [
        {
          title: text.language,
          description: text.languageDesc,
          action: <LanguagePicker value={props.generalSettings.language} systemLabel={text.followSystem} onChange={(language) => updateGeneral({ language })} />
        },
        {
          title: text.autoAccept,
          description: text.autoAcceptDesc,
          action: <SwitchControl checked={props.generalSettings.autoAcceptPermissions} onChange={(checked) => updateGeneral({ autoAcceptPermissions: checked })} />
        },
        {
          title: text.reasoning,
          description: text.reasoningDesc,
          action: <SwitchControl checked={props.generalSettings.showReasoningSummaries} onChange={(checked) => updateGeneral({ showReasoningSummaries: checked })} />
        },
        {
          title: text.shellParts,
          description: text.shellPartsDesc,
          action: <SwitchControl checked={props.generalSettings.shellToolPartsExpanded} onChange={(checked) => updateGeneral({ shellToolPartsExpanded: checked })} />
        },
        {
          title: text.editParts,
          description: text.editPartsDesc,
          action: <SwitchControl checked={props.generalSettings.editToolPartsExpanded} onChange={(checked) => updateGeneral({ editToolPartsExpanded: checked })} />
        },
        {
          title: text.progressBar,
          description: text.progressBarDesc,
          action: <SwitchControl checked={props.generalSettings.showSessionProgressBar} onChange={(checked) => updateGeneral({ showSessionProgressBar: checked })} />
        }
      ],
      appearance: [
        {
          title: text.theme,
          description: text.themeDesc,
          action: <SegmentedControl options={[text.light, text.dark]} value={props.theme === "dark" ? text.dark : text.light} onChange={(value) => { if ((value === text.dark) !== (props.theme === "dark")) props.onToggleTheme(); }} />
        },
        {
          title: text.uiFont,
          description: text.uiFontDesc,
          action: <FontSizeStepper value={props.uiFontSize} min={11} max={18} onChange={props.onUiFontSizeChange} />
        },
        {
          title: text.codeFont,
          description: text.codeFontDesc,
          action: <FontSizeStepper value={props.codeFontSize} min={10} max={18} onChange={props.onCodeFontSizeChange} />
        }
      ],
      workspace: [
        ...((Object.entries(rightModuleLabels) as Array<[RightModuleKey, { title: string; description: string }]>).map(([key, item]) => ({
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
      })))
      ],
      plugins: [],
      notifications: [],
      sounds: [],
      updates: [],
      mobile: [
        {
          title: text.mobileControl,
          description: props.runtimeStatus.giteam.installed
            ? text.mobileControlReady
            : text.mobileControlMissing,
          action: (
            <button
              className="chip"
              disabled={!props.runtimeStatus.giteam.installed}
              title={props.runtimeStatus.giteam.installed ? text.saveMobileTitle : text.installDependencyTitle}
              onClick={props.controlInstalled ? props.onSaveControlSettings : () => props.onRunDependencyAction("giteam", "install")}
            >
              {props.controlBusy ? text.saving : props.controlInstalled ? text.save : text.installFirst}
            </button>
          )
        },
        {
          title: text.service,
          description: text.serviceDesc,
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
          title: text.port,
          description: text.portDesc,
          action: <input className="path-input settings-inline-input" type="number" min={1} max={65535} value={String(props.controlSettings.port)} disabled={!props.controlInstalled || props.controlBusy} onChange={(e) => props.onControlSettingsChange({ ...props.controlSettings, port: Number(e.target.value || "0") })} />
        },
        {
          title: text.publicUrl,
          description: text.publicUrlDesc,
          action: <input className="path-input settings-inline-input settings-inline-input-wide" placeholder="http://192.168.1.23:4100" value={props.controlSettings.publicBaseUrl} disabled={!props.controlInstalled || props.controlBusy} onChange={(e) => props.onControlSettingsChange({ ...props.controlSettings, publicBaseUrl: e.target.value })} />
        },
        {
          title: text.pairCode,
          description: text.pairCodeDesc,
          action: (
            <select className="path-input settings-inline-input settings-inline-input-wide" value={props.controlSettings.pairCodeTtlMode} disabled={!props.controlInstalled || props.controlBusy} onChange={(e) => props.onControlSettingsChange({ ...props.controlSettings, pairCodeTtlMode: e.target.value as ControlServerSettingsDraft["pairCodeTtlMode"] })}>
              <option value="none">{text.noAuth}</option>
              <option value="24h">{text.hours24}</option>
              <option value="7d">{text.days7}</option>
            </select>
          )
        },
        {
          title: text.opencodeApi,
          description: props.opencodeBusy ? text.opencodeApiBusy : text.opencodeApiDesc,
          action: <input className="path-input settings-inline-input" type="number" min={1} max={65535} value={String(props.opencodePort)} disabled={!props.runtimeStatus.opencode.installed || props.opencodeBusy} onChange={(e) => props.onOpencodePortChange(Number(e.target.value || "0"))} onBlur={props.onSaveOpenCodeApi} />
        }
      ],
      models: [],
      mcp: [],
      skillsmp: [
        {
          title: text.apiKey,
          description: props.skillsmpApiKey ? text.apiKeyConfigured : text.apiKeyDesc,
          action: <div className="settings-inline-combo"><input className="path-input settings-inline-input settings-inline-input-wide" type="password" placeholder="sk_live_skillsmp_..." value={props.skillsmpApiKeyDraft} onChange={(e) => props.onSkillsmpApiKeyDraftChange(e.target.value)} /><button className="chip primary" onClick={props.onSaveSkillsmpApiKey}>{text.save}</button></div>
        }
      ]
    };
    const notificationEntries: Array<SettingsEntry> = [
      { title: text.agentNotifications, description: text.agentNotificationsDesc, action: <SwitchControl checked={props.generalSettings.notificationsAgent} onChange={(checked) => updateGeneral({ notificationsAgent: checked })} /> },
      { title: text.permissionNotifications, description: text.permissionNotificationsDesc, action: <SwitchControl checked={props.generalSettings.notificationsPermissions} onChange={(checked) => updateGeneral({ notificationsPermissions: checked })} /> },
      { title: text.errorNotifications, description: text.errorNotificationsDesc, action: <SwitchControl checked={props.generalSettings.notificationsErrors} onChange={(checked) => updateGeneral({ notificationsErrors: checked })} /> }
    ];
    const soundEntries: Array<SettingsEntry> = [
      { title: text.agentSound, description: text.agentSoundDesc, action: <SwitchControl checked={props.generalSettings.soundsAgent} onChange={(checked) => updateGeneral({ soundsAgent: checked })} /> },
      { title: text.permissionSound, description: text.permissionSoundDesc, action: <SwitchControl checked={props.generalSettings.soundsPermissions} onChange={(checked) => updateGeneral({ soundsPermissions: checked })} /> },
      { title: text.errorSound, description: text.errorSoundDesc, action: <SwitchControl checked={props.generalSettings.soundsErrors} onChange={(checked) => updateGeneral({ soundsErrors: checked })} /> }
    ];
    const updateEntries: Array<SettingsEntry> = [
      { title: text.startupCheck, description: text.startupCheckDesc, action: <SwitchControl checked={props.generalSettings.updatesStartup} onChange={(checked) => updateGeneral({ updatesStartup: checked })} /> },
      { title: text.releaseNotes, description: text.releaseNotesDesc, action: <SwitchControl checked={props.generalSettings.releaseNotes} onChange={(checked) => updateGeneral({ releaseNotes: checked })} /> },
      { title: text.checkNow, description: text.checkNowDesc, action: <button className="chip" disabled={props.runtimeChecking} onClick={props.onCheckUpdates}>{props.runtimeChecking ? text.checking : text.check}</button> }
    ];
    const desktopEntries = [...entriesBySection.general.slice(0, 2), ...entriesBySection.appearance];
    const openCodeEntries = entriesBySection.general.slice(2);

    const pluginDeps = [props.runtimeStatus.git, props.runtimeStatus.entire, props.runtimeStatus.opencode, props.runtimeStatus.giteam]
      .filter((dep): dep is RuntimeDependencyStatus => Boolean(dep));

    return [
      {
        id: "general" as const,
        kicker: text.generalKicker,
        title: text.general,
        description: text.generalDesc,
        content: (
          <div className="settings-general-stack">
            <SettingsGroup title={text.basics} entries={desktopEntries} />
            <SettingsGroup title={text.sessionDisplay} entries={openCodeEntries} />
          </div>
        )
      },
      {
        id: "workspace" as const,
        kicker: text.workspaceKicker,
        title: text.workspace,
        description: text.workspaceDesc,
        entries: entriesBySection.workspace
      },
      {
        id: "models" as const,
        kicker: text.modelsKicker,
        title: text.models,
        description: text.modelsDesc,
        content: props.modelsContent || <div className="settings-panel-list"><div className="settings-panel-card"><div className="settings-panel-copy"><strong>{text.models}</strong><p>{text.modelsEmpty}</p></div></div></div>
      },
      {
        id: "plugins" as const,
        kicker: text.dependenciesKicker,
        title: text.dependencies,
        description: text.dependenciesDesc,
        content: (
          <div className="settings-panel-list">
            {pluginDeps.map((dep) => {
              const depName = dep.name as RuntimeDepName;
              const busy = props.installingDep === dep.name;
              const action = dep.installed ? "uninstall" : "install";
              return (
                <article key={dep.name} className="settings-panel-card settings-plugin-row">
                  <div className="settings-panel-copy">
                    <strong>{dep.name}</strong>
                    <p>{props.checkingDeps[depName] ? text.checking : dep.installed ? `${text.installed}${dep.version ? ` · ${dep.version}` : ""}` : dep.installHint || text.missing}</p>
                    {dep.path ? <p className="settings-plugin-path">{dep.path}</p> : null}
                    {props.runtimeJob?.name === dep.name ? <p>{props.runtimeJob.action} · {props.runtimeJob.status} · {props.installingElapsed}s</p> : null}
                  </div>
                  <div className="settings-panel-action">
                    <button className="chip" disabled={props.runtimeChecking || Boolean(props.installingDep)} onClick={() => props.onRunDependencyAction(depName, action)}>
                      {busy ? `${action === "install" ? text.installing : text.uninstalling}...` : dep.installed ? text.uninstall : text.install}
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
        kicker: text.apiKicker,
        title: text.api,
        description: text.apiDesc,
        content: <><div className="settings-panel-list">{entriesBySection.mobile.map((entry) => <article key={entry.title} className="settings-panel-card"><div className="settings-panel-copy"><strong>{entry.title}</strong><p>{entry.description}</p></div><div className="settings-panel-action">{entry.action}</div></article>)}</div>{props.mobileStatusContent}</>
      },
      {
        id: "skillsmp" as const,
        kicker: text.skillsKicker,
        title: text.skills,
        description: text.skillsDesc,
        entries: entriesBySection.skillsmp,
        content: props.skillsContent
      },
      {
        id: "mcp" as const,
        kicker: "MCP",
        title: "MCP Servers",
        description: "管理当前项目和全局 OpenCode MCP 配置。",
        content: props.mcpContent
      },
      {
        id: "updates" as const,
        kicker: text.updatesKicker,
        title: text.updates,
        description: text.updatesDesc,
        entries: updateEntries
      },
      {
        id: "notifications" as const,
        kicker: text.notificationsKicker,
        title: text.notifications,
        description: text.notificationsDesc,
        entries: notificationEntries
      },
      {
        id: "sounds" as const,
        kicker: text.soundsKicker,
        title: text.sounds,
        description: text.soundsDesc,
        entries: soundEntries
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
              <button className="settings-back" type="button" onClick={() => void props.onClose()}>{text.back}</button>
              <p>{text.sidebarIntro}</p>
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
                </button>
              ))}
            </div>
          </aside>

          <section className="settings-main">
            <div className="settings-main-head">
              <div>
                <span className="gt-module-kicker">{active.kicker}</span>
                <h4>{active.title}</h4>
                {active.description ? <p>{active.description}</p> : null}
              </div>
              {active.id === "plugins" ? (
                <button className="gt-icon-chip" title={text.refresh} disabled={props.runtimeChecking || Boolean(props.installingDep)} onClick={props.onRefreshRuntime}>↻</button>
              ) : active.id === "skillsmp" ? (
                <button className="gt-icon-chip" title={text.refresh} disabled={props.skillsLoading} onClick={props.onRefreshSkills}>↻</button>
              ) : active.id === "mcp" ? (
                <button className="gt-icon-chip" title={text.refresh} disabled={props.mcpLoading} onClick={props.onRefreshMcp}>↻</button>
              ) : null}
            </div>

            <div className="settings-main-body">
              {active.content ? active.content : null}
              {active.entries?.length ? <SettingsRows entries={active.entries} /> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
