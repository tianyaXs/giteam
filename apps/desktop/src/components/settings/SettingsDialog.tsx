import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SVGProps } from "react";
import { createPortal } from "react-dom";
import type { RuntimeActionJobStatus, RuntimeDepName, RuntimeDependencyStatus, RuntimeRequirementsStatus } from "../../lib/appCache";
import { cn } from "../../lib/utils";
import { AutomationIcon, ImageIcon, PluginsIcon, RefreshIcon, SettingsIcon, SkillsIcon, StarIcon, SyncIcon } from "../icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

type ControlServerSettingsDraft = {
  enabled: boolean;
  port: number;
  publicBaseUrl: string;
  authMode: "none" | "pair_code";
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
};

type SettingsLocale = Exclude<GeneralSettingsDraft["language"], "system">;

const SETTINGS_TEXT = {
  "zh-CN": {
    followSystem: "跟随系统", back: "← 设置", sidebarIntro: "按使用场景管理界面、会话、通知和运行环境。",
    general: "通用", generalKicker: "基础", generalDesc: "调整界面显示、授权行为和会话中的消息展示方式。", basics: "基础", sessionDisplay: "会话显示",
    workspace: "工作区", workspaceKicker: "布局", workspaceDesc: "控制左侧导航中工作区模块是否显示。",
    models: "模型", modelsKicker: "模型", modelsDesc: "管理服务商、默认模型和模型显示状态。", modelsEmpty: "暂无模型信息。",
    dependencies: "依赖", dependenciesKicker: "运行环境", dependenciesDesc: "检查并管理 Git、Entire、OpenCode、giteam 等运行时依赖。",
    api: "接口", apiKicker: "连接", apiDesc: "管理移动端控制服务与 OpenCode 连接参数。",
    skills: "技能", skillsKicker: "扩展", skillsDesc: "管理已安装技能，并配置技能市场的搜索能力。",
    updates: "更新", updatesKicker: "维护", updatesDesc: "管理启动检查和运行时依赖检查。",
    notifications: "通知", notificationsKicker: "提醒", notificationsDesc: "控制哪些事件会发送系统通知。",
    sounds: "声音", soundsKicker: "提醒", soundsDesc: "控制 Agent、授权和错误事件的提示音。",
    language: "界面语言", languageDesc: "选择界面语言；系统会跟随当前环境。", autoAccept: "自动允许授权", autoAcceptDesc: "自动通过当前 OpenCode 会话的工具授权请求。",
    reasoning: "推理摘要", reasoningDesc: "在对话中显示模型推理摘要。", shellParts: "Shell 工具详情", shellPartsDesc: "默认展开 Shell 工具调用详情。", editParts: "编辑工具详情", editPartsDesc: "默认展开编辑工具调用详情。", progressBar: "会话进度条", progressBarDesc: "在会话工作中显示进度条。",
    theme: "主题", themeDesc: "在浅色和深色主题之间切换。", light: "浅色", dark: "深色", uiFont: "界面字号", uiFontDesc: "调整界面文字大小。", codeFont: "代码字号", codeFontDesc: "调整代码、终端和等宽文本大小。",
    changes: "审查", changesDesc: "显示当前仓库变更列表。", worktree: "工作树", worktreeDesc: "显示分支与 worktree 拓扑。", terminal: "终端", terminalDesc: "显示内置终端入口。", skillsModuleDesc: "显示技能市场。", mcpDesc: "显示 MCP 服务管理模块。",
    mobileControl: "移动端控制", mobileControlReady: "配置移动端连接服务、端口、授权方式和扫码连接。", mobileControlMissing: "需要先安装 giteam 依赖，才可以启用移动端控制服务。", service: "服务开关", serviceDesc: "控制移动端控制服务是否启用。", port: "服务端口", portDesc: "移动端访问服务时使用的端口。", publicUrl: "公开地址", publicUrlDesc: "可选，公网或局域网可访问地址；留空时自动取本机可用地址。", authMode: "授权模式", authModeDesc: "选择免认证访问，或要求输入配对码进行授权。", pairCodeAuth: "配对码授权", validPeriod: "有效期", validPeriodDesc: "仅在“配对码授权”下生效，用来控制当前配对码的过期时间。", currentPairCode: "当前配对码", currentPairCodeDesc: "二维码与手机端手动输入都会使用这里展示的配对码。", connectionAddress: "连接地址", authCode: "授权码", qrConnect: "二维码连接", qrConnectDesc: "手机端可直接扫码带入服务地址和当前授权方式。", noAuth: "无需认证", hours24: "24 小时", days7: "7 天", forever: "长期有效", refreshCode: "刷新配对码", copyUrl: "复制地址", qrDisabled: "开启服务后即可生成二维码", qrWaiting: "等待生成可访问地址…", opencodeApi: "OpenCode 接口", opencodeApiBusy: "正在保存并重启 OpenCode 服务。", opencodeApiDesc: "配置 OpenCode 服务端口。",
    apiKey: "API 密钥", apiKeyConfigured: "已配置；清空输入框并保存即可移除。", apiKeyDesc: "可选项；未配置时 AI 搜索会自动回退关键词搜索。",
    agentNotifications: "Agent 通知", agentNotificationsDesc: "Agent 完成或需要关注时发送通知。", permissionNotifications: "授权通知", permissionNotificationsDesc: "出现授权请求时发送通知。", errorNotifications: "错误通知", errorNotificationsDesc: "发生错误时发送通知。",
    agentSound: "Agent 提示音", agentSoundDesc: "Agent 完成或状态变化时播放提示音。", permissionSound: "授权提示音", permissionSoundDesc: "出现授权请求时播放提示音。", errorSound: "错误提示音", errorSoundDesc: "发生错误时播放提示音。",
    startupCheck: "启动时检查", startupCheckDesc: "应用启动后自动检查依赖状态。", checkNow: "立即检查", checkNowDesc: "立即执行一次运行时依赖检查。",
    save: "保存", saving: "保存中...", installFirst: "先安装", install: "安装", uninstall: "卸载", installing: "安装中", uninstalling: "卸载中", checking: "检查中...", check: "检查", refresh: "刷新", installed: "已安装", missing: "缺失", saveMobileTitle: "保存移动端控制配置", installDependencyTitle: "先安装 giteam 依赖", saveToApply: "保存后生效"
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
    updates: "更新", updatesKicker: "維護", updatesDesc: "管理啟動檢查和執行時依賴檢查。",
    notifications: "通知", notificationsKicker: "提醒", notificationsDesc: "控制哪些事件會傳送系統通知。",
    sounds: "聲音", soundsKicker: "提醒", soundsDesc: "控制 Agent、授權和錯誤事件的提示音。",
    language: "介面語言", languageDesc: "選擇介面語言；系統會跟隨目前環境。", autoAccept: "自動允許授權", autoAcceptDesc: "自動通過目前 OpenCode 會話的工具授權請求。",
    reasoning: "推理摘要", reasoningDesc: "在對話中顯示模型推理摘要。", shellParts: "Shell 工具詳情", shellPartsDesc: "預設展開 Shell 工具呼叫詳情。", editParts: "編輯工具詳情", editPartsDesc: "預設展開編輯工具呼叫詳情。", progressBar: "會話進度列", progressBarDesc: "在會話工作中顯示進度列。",
    theme: "主題", themeDesc: "在淺色和深色主題之間切換。", light: "淺色", dark: "深色", uiFont: "介面字號", uiFontDesc: "調整介面文字大小。", codeFont: "程式碼字號", codeFontDesc: "調整程式碼、終端機和等寬文字大小。",
    changes: "審查", changesDesc: "顯示目前倉庫變更列表。", worktree: "工作樹", worktreeDesc: "顯示分支與 worktree 拓撲。", terminal: "終端機", terminalDesc: "顯示內建終端機入口。", skillsModuleDesc: "顯示技能市場。", mcpDesc: "顯示 MCP 服務管理模組。",
    mobileControl: "行動端控制", mobileControlReady: "設定行動端連線服務、連接埠、授權方式與掃碼連線。", mobileControlMissing: "需要先安裝 giteam 依賴，才可以啟用行動端控制服務。", service: "服務開關", serviceDesc: "控制行動端控制服務是否啟用。", port: "服務連接埠", portDesc: "行動端存取服務時使用的連接埠。", publicUrl: "公開地址", publicUrlDesc: "可選，公網或區域網路可存取地址；留空時自動取本機可用地址。", authMode: "授權模式", authModeDesc: "選擇免認證存取，或要求輸入配對碼進行授權。", pairCodeAuth: "配對碼授權", validPeriod: "有效期", validPeriodDesc: "僅在「配對碼授權」下生效，用來控制目前配對碼的過期時間。", currentPairCode: "目前配對碼", currentPairCodeDesc: "QR Code 與手機端手動輸入都會使用這裡顯示的配對碼。", connectionAddress: "連線地址", authCode: "授權碼", qrConnect: "QR Code 連線", qrConnectDesc: "手機端可直接掃碼帶入服務地址和目前授權方式。", noAuth: "無需認證", hours24: "24 小時", days7: "7 天", forever: "長期有效", refreshCode: "重新整理配對碼", copyUrl: "複製地址", qrDisabled: "啟用服務後即可產生 QR Code", qrWaiting: "等待產生可存取地址…", opencodeApi: "OpenCode 介面", opencodeApiBusy: "正在儲存並重新啟動 OpenCode 服務。", opencodeApiDesc: "設定 OpenCode 服務連接埠。",
    apiKey: "API 金鑰", apiKeyConfigured: "已設定；清空輸入框並儲存即可移除。", apiKeyDesc: "可選項；未設定時 AI 搜尋會自動回退關鍵字搜尋。",
    agentNotifications: "Agent 通知", agentNotificationsDesc: "Agent 完成或需要關注時傳送通知。", permissionNotifications: "授權通知", permissionNotificationsDesc: "出現授權請求時傳送通知。", errorNotifications: "錯誤通知", errorNotificationsDesc: "發生錯誤時傳送通知。",
    agentSound: "Agent 提示音", agentSoundDesc: "Agent 完成或狀態變化時播放提示音。", permissionSound: "授權提示音", permissionSoundDesc: "出現授權請求時播放提示音。", errorSound: "錯誤提示音", errorSoundDesc: "發生錯誤時播放提示音。",
    startupCheck: "啟動時檢查", startupCheckDesc: "應用啟動後自動檢查依賴狀態。", checkNow: "立即檢查", checkNowDesc: "立即執行一次執行時依賴檢查。",
    save: "儲存", saving: "儲存中...", installFirst: "先安裝", install: "安裝", uninstall: "解除安裝", installing: "安裝中", uninstalling: "解除安裝中", checking: "檢查中...", check: "檢查", refresh: "重新整理", installed: "已安裝", missing: "缺少", saveMobileTitle: "儲存行動端控制設定", installDependencyTitle: "先安裝 giteam 依賴", saveToApply: "儲存後生效"
  },
  "en-US": {
    followSystem: "Follow System", back: "← Settings", sidebarIntro: "Manage interface, sessions, notifications, and runtime by workflow.", general: "General", generalKicker: "Basics", generalDesc: "Adjust display, permissions, and session message behavior.", basics: "Basics", sessionDisplay: "Session Display", workspace: "Workspace", workspaceKicker: "Layout", workspaceDesc: "Choose which right-side workspace modules are visible.", models: "Models", modelsKicker: "Models", modelsDesc: "Manage providers, default models, and model visibility.", modelsEmpty: "No model information yet.", dependencies: "Dependencies", dependenciesKicker: "Runtime", dependenciesDesc: "Check and manage runtime dependencies such as Git, Entire, OpenCode, and giteam.", api: "API", apiKicker: "Connection", apiDesc: "Manage mobile control service and OpenCode connection settings.", skills: "Skills", skillsKicker: "Extensions", skillsDesc: "Manage installed skills and Skills marketplace search.", updates: "Updates", updatesKicker: "Maintenance", updatesDesc: "Manage startup checks and runtime dependency checks.", notifications: "Notifications", notificationsKicker: "Alerts", notificationsDesc: "Choose which events send system notifications.", sounds: "Sounds", soundsKicker: "Alerts", soundsDesc: "Control sounds for agent, permission, and error events.", language: "Language", languageDesc: "Choose the interface language; system follows your environment.", autoAccept: "Auto Accept Permissions", autoAcceptDesc: "Automatically approve tool permission requests for the current OpenCode session.", reasoning: "Reasoning Summaries", reasoningDesc: "Show model reasoning summaries in conversations.", shellParts: "Shell Tool Details", shellPartsDesc: "Expand Shell tool call details by default.", editParts: "Edit Tool Details", editPartsDesc: "Expand edit tool call details by default.", progressBar: "Session Progress Bar", progressBarDesc: "Show a progress bar while a session is working.", theme: "Theme", themeDesc: "Switch between light and dark themes.", light: "Light", dark: "Dark", uiFont: "UI Font Size", uiFontDesc: "Adjust interface text size.", codeFont: "Code Font Size", codeFontDesc: "Adjust code, terminal, and monospace text size.", changes: "Changes", changesDesc: "Show current repository changes.", worktree: "Worktree", worktreeDesc: "Show branch and worktree topology.", terminal: "Terminal", terminalDesc: "Show the built-in terminal entry.", skillsModuleDesc: "Show the Skills marketplace.", mcpDesc: "Show MCP server management.", mobileControl: "Mobile Control", mobileControlReady: "Configure mobile connection service, port, auth, and QR pairing.", mobileControlMissing: "Install the giteam dependency before enabling mobile control.", service: "Service", serviceDesc: "Enable or disable the mobile control service.", port: "Port", portDesc: "Port used by the mobile control service.", publicUrl: "Public URL", publicUrlDesc: "Optional public or LAN-accessible URL. Leave blank to auto-pick a reachable local address.", authMode: "Auth Mode", authModeDesc: "Choose between direct access and pair-code-based authorization.", pairCodeAuth: "Pair Code", validPeriod: "Validity", validPeriodDesc: "Only applies in pair-code mode and controls when the current pair code expires.", currentPairCode: "Current Pair Code", currentPairCodeDesc: "The QR code and manual mobile input both use the current pair code shown here.", connectionAddress: "Connection URL", authCode: "Auth Code", qrConnect: "QR Connection", qrConnectDesc: "Mobile can scan this QR code to fill the service URL and current auth mode.", noAuth: "No Auth", hours24: "24 hours", days7: "7 days", forever: "Never expires", refreshCode: "Refresh Pair Code", copyUrl: "Copy URL", qrDisabled: "Enable the service to generate a QR code", qrWaiting: "Waiting for a reachable address…", opencodeApi: "OpenCode API", opencodeApiBusy: "Saving and restarting the OpenCode service.", opencodeApiDesc: "Configure the OpenCode service port.", apiKey: "API Key", apiKeyConfigured: "Configured; clear the input and save to remove it.", apiKeyDesc: "Optional; AI search falls back to keyword search when unset.", agentNotifications: "Agent Notifications", agentNotificationsDesc: "Notify when the agent finishes or needs attention.", permissionNotifications: "Permission Notifications", permissionNotificationsDesc: "Notify when a permission request appears.", errorNotifications: "Error Notifications", errorNotificationsDesc: "Notify when an error occurs.", agentSound: "Agent Sound", agentSoundDesc: "Play a sound when the agent finishes or changes state.", permissionSound: "Permission Sound", permissionSoundDesc: "Play a sound when permission is requested.", errorSound: "Error Sound", errorSoundDesc: "Play a sound when an error occurs.", startupCheck: "Check on Startup", startupCheckDesc: "Automatically check dependency status after launch.", checkNow: "Check Now", checkNowDesc: "Run a runtime dependency check now.", save: "Save", saving: "Saving...", installFirst: "Install first", install: "Install", uninstall: "Uninstall", installing: "Installing", uninstalling: "Uninstalling", checking: "Checking...", check: "Check", refresh: "Refresh", installed: "Installed", missing: "Missing", saveMobileTitle: "Save mobile control settings", installDependencyTitle: "Install giteam dependency first", saveToApply: "Save to apply"
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
  controlConnectionUrl: string;
  controlPairCode: string;
  controlPairQrUrl: string;
  controlSettingsDirty: boolean;
  onRefreshControlPairCode: () => void;
  onCopyControlUrl: () => void;
  onMobileVisibilityChange?: (visible: boolean) => void;
  runtimeChecking: boolean;
  checkingDeps: Record<RuntimeDepName, boolean>;
  installingDep: string;
  installingElapsed: number;
  runtimeJob: RuntimeActionJobStatus | null;
  onRunDependencyAction: (name: RuntimeDepName, action: "install" | "uninstall") => void;
  onRefreshRuntime: () => void;
  modelsContent?: ReactNode;
  initialSection?: InitialSettingsSectionId;
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

type SettingsSectionId = "general" | "notifications" | "sounds" | "updates" | "appearance" | "models" | "skillsmp" | "mcp" | "plugins" | "mobile";
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

type SettingsNavIcon = (props: SVGProps<SVGSVGElement>) => ReactNode;

const SETTINGS_SECTION_ICONS: Record<SettingsSectionId, SettingsNavIcon> = {
  general: SettingsIcon,
  appearance: ImageIcon,
  models: StarIcon,
  skillsmp: SkillsIcon,
  mcp: PluginsIcon,
  plugins: PluginsIcon,
  mobile: SyncIcon,
  updates: SyncIcon,
  notifications: AutomationIcon,
  sounds: AutomationIcon
};

function FontSizeStepper(props: { value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="inline-flex h-9 items-center overflow-hidden rounded-md border border-border bg-muted/30">
      <Button className="h-9 rounded-none px-3 text-[15px]" variant="ghost" size="sm" disabled={props.value <= props.min} onClick={() => props.onChange(props.value - 1)}>
        −
      </Button>
      <span className="min-w-11 text-center text-base font-medium tabular-nums text-foreground">{props.value}</span>
      <Button className="h-9 rounded-none px-3 text-[15px]" variant="ghost" size="sm" disabled={props.value >= props.max} onClick={() => props.onChange(props.value + 1)}>
        ＋
      </Button>
    </div>
  );
}

function SegmentedControl(props: { options: Array<{ value: string; label: string }>; value: string; onChange?: (value: string) => void }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      className="rounded-md bg-muted/40 p-0.5"
      value={props.value}
      onValueChange={(value) => {
        if (!value) return;
        props.onChange?.(value);
      }}
    >
      {props.options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="h-9 min-w-20 rounded-sm px-4 text-[15px]">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function SwitchControl(props: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Switch
      checked={props.checked}
      disabled={props.disabled}
      onCheckedChange={props.onChange}
      aria-label={props.checked ? "已开启" : "已关闭"}
    />
  );
}

function LanguagePicker(props: { value: GeneralSettingsDraft["language"]; systemLabel: string; onChange: (value: GeneralSettingsDraft["language"]) => void }) {
  const selected = LANGUAGE_OPTIONS.find((option) => option.value === props.value) || LANGUAGE_OPTIONS[0];
  const labelFor = (option: { label: string; system?: boolean }) => option.system ? props.systemLabel : option.label;
  return (
    <Select value={selected.value} onValueChange={(value) => props.onChange(value as GeneralSettingsDraft["language"])}>
      <SelectTrigger className="h-9 w-52 rounded-md bg-muted/30 text-[15px]">
        <SelectValue placeholder={labelFor(selected)} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {LANGUAGE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {labelFor(option)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function SettingsRows(props: { entries: Array<SettingsEntry> }) {
  return (
    <Card className="overflow-hidden rounded-lg border-border/80 bg-card shadow-none">
      <CardContent className="p-0">
        {props.entries.map((entry) => (
          <article key={entry.title} className="grid min-h-[76px] grid-cols-[minmax(0,1fr)_auto] items-center gap-8 border-b border-border/70 px-4 py-3.5 last:border-b-0">
            <div className="min-w-0">
              <strong className="block text-base font-semibold leading-6 text-foreground">{entry.title}</strong>
              <p className="mt-1 text-[14px] leading-6 text-muted-foreground">{entry.description}</p>
            </div>
            <div className="flex min-w-44 items-center justify-end gap-2">{entry.action}</div>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}

function SettingsGroup(props: { title: string; entries: Array<SettingsEntry>; wide?: boolean }) {
  return (
    <section className={cn("flex flex-col gap-3", props.wide ? "w-full" : undefined)}>
      <div className="px-1 text-[15px] font-medium text-muted-foreground">{props.title}</div>
      <SettingsRows entries={props.entries} />
    </section>
  );
}

function getRuntimeJobLine(job: RuntimeActionJobStatus, elapsed: number): string {
  const actionText = job.action === "uninstall" ? "卸载" : "安装";
  if (job.status === "running") return `${actionText}中 · ${elapsed}s`;
  return job.status === "succeeded" ? `${actionText}完成` : `${actionText}失败`;
}

export function SettingsDialog(props: SettingsDialogProps) {
  const text = useMemo(() => getSettingsText(props.generalSettings.language), [props.generalSettings.language]);
  const lastPairCodeTtlModeRef = useRef<Exclude<ControlServerSettingsDraft["pairCodeTtlMode"], "none">>("24h");
  const normalizeSection = (section?: InitialSettingsSectionId | "opencode"): SettingsSectionId => {
    if (section === "modules") return "general";
    if (section === "opencode") return "mobile";
    if (section === "appearance") return "general";
    return section || "general";
  };
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(normalizeSection(props.initialSection));

  useEffect(() => {
    if (props.initialSection) setActiveSection(normalizeSection(props.initialSection));
  }, [props.initialSection]);

  useEffect(() => {
    if (props.controlSettings.pairCodeTtlMode !== "none") {
      lastPairCodeTtlModeRef.current = props.controlSettings.pairCodeTtlMode;
    }
  }, [props.controlSettings.pairCodeTtlMode]);

  useEffect(() => {
    if (activeSection === "skillsmp") props.onSkillsVisible?.();
    if (activeSection === "mcp") props.onMcpVisible?.();
    props.onMobileVisibilityChange?.(activeSection === "mobile");
  }, [activeSection]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void props.onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [props.onClose]);

  const sections = useMemo(() => {
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
          action: (
            <SegmentedControl
              options={[
                { value: "light", label: text.light },
                { value: "dark", label: text.dark }
              ]}
              value={props.theme}
              onChange={(value) => {
                if (value !== props.theme) props.onToggleTheme();
              }}
            />
          )
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
      plugins: [],
      notifications: [],
      sounds: [],
      updates: [],
      mobile: [
        {
          title: text.service,
          description: text.serviceDesc,
          action: (
            <SwitchControl
              checked={props.controlSettings.enabled}
              disabled={!props.controlInstalled || props.controlBusy}
              onChange={props.onToggleControlService}
            />
          )
        },
        {
          title: text.port,
          description: text.portDesc,
          action: (
            <Input
              className="h-9 w-24 rounded-md bg-muted/30 text-[15px]"
              type="number"
              min={1}
              max={65535}
              value={String(props.controlSettings.port)}
              disabled={!props.controlInstalled}
              onChange={(e) => props.onControlSettingsChange({ ...props.controlSettings, port: Number(e.target.value || "0") })}
            />
          )
        },
        {
          title: text.publicUrl,
          description: text.publicUrlDesc,
          action: (
            <Input
              className="h-9 w-72 rounded-md bg-muted/30 text-[15px]"
              placeholder="http://192.168.1.23:4100"
              value={props.controlSettings.publicBaseUrl}
              disabled={!props.controlInstalled}
              onChange={(e) => props.onControlSettingsChange({ ...props.controlSettings, publicBaseUrl: e.target.value })}
            />
          )
        },
        {
          title: text.authMode,
          description: text.authModeDesc,
          action: (
            <Select
              value={props.controlSettings.authMode}
              disabled={!props.controlInstalled}
              onValueChange={(value) => {
                const authMode = value as ControlServerSettingsDraft["authMode"];
                props.onControlSettingsChange({
                  ...props.controlSettings,
                  authMode,
                  pairCodeTtlMode: authMode === "none"
                    ? "none"
                    : (props.controlSettings.pairCodeTtlMode === "none"
                      ? lastPairCodeTtlModeRef.current
                      : props.controlSettings.pairCodeTtlMode)
                });
              }}
            >
              <SelectTrigger className="h-9 w-56 rounded-md bg-muted/30 text-[15px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">{text.noAuth}</SelectItem>
                  <SelectItem value="pair_code">{text.pairCodeAuth}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          )
        },
        {
          title: text.validPeriod,
          description: text.validPeriodDesc,
          action: (
            <Select
              value={props.controlSettings.pairCodeTtlMode === "none" ? lastPairCodeTtlModeRef.current : props.controlSettings.pairCodeTtlMode}
              disabled={!props.controlInstalled || props.controlSettings.authMode === "none"}
              onValueChange={(value) => props.onControlSettingsChange({ ...props.controlSettings, pairCodeTtlMode: value as ControlServerSettingsDraft["pairCodeTtlMode"] })}
            >
              <SelectTrigger className="h-9 w-56 rounded-md bg-muted/30 text-[15px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="24h">{text.hours24}</SelectItem>
                  <SelectItem value="7d">{text.days7}</SelectItem>
                  <SelectItem value="forever">{text.forever}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          )
        },
        {
          title: text.opencodeApi,
          description: props.opencodeBusy ? text.opencodeApiBusy : text.opencodeApiDesc,
          action: (
            <Input
              className="h-9 w-24 rounded-md bg-muted/30 text-[15px]"
              type="number"
              min={1}
              max={65535}
              value={String(props.opencodePort)}
              disabled={!props.runtimeStatus.opencode.installed || props.opencodeBusy}
              onChange={(e) => props.onOpencodePortChange(Number(e.target.value || "0"))}
              onBlur={props.onSaveOpenCodeApi}
            />
          )
        }
      ],
      models: [],
      mcp: [],
      skillsmp: [
        {
          title: text.apiKey,
          description: props.skillsmpApiKey ? text.apiKeyConfigured : text.apiKeyDesc,
          action: (
            <div className="flex items-center justify-end gap-2">
              <Input
                className="h-9 w-64 rounded-md bg-muted/30 text-[15px]"
                type="password"
                placeholder="sk_live_skillsmp_..."
                value={props.skillsmpApiKeyDraft}
                onChange={(e) => props.onSkillsmpApiKeyDraftChange(e.target.value)}
              />
              <Button variant="secondary" size="sm" onClick={props.onSaveSkillsmpApiKey}>
                {text.save}
              </Button>
              {props.skillsmpApiKey ? (
                <Button variant="ghost" size="sm" onClick={props.onClearSkillsmpApiKey}>
                  清除
                </Button>
              ) : null}
            </div>
          )
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
      {
        title: text.checkNow,
        description: text.checkNowDesc,
        action: (
          <Button variant="secondary" size="sm" disabled={props.runtimeChecking} onClick={props.onCheckUpdates}>
            {props.runtimeChecking ? text.checking : text.check}
          </Button>
        )
      }
    ];
    const desktopEntries = [...entriesBySection.general.slice(0, 2), ...entriesBySection.appearance];
    const openCodeEntries = entriesBySection.general.slice(2);

    const pluginDeps = [props.runtimeStatus.git, props.runtimeStatus.entire, props.runtimeStatus.opencode, props.runtimeStatus.giteam]
      .filter((dep): dep is RuntimeDependencyStatus => Boolean(dep));
    const runtimeBusy = props.runtimeChecking || Boolean(props.installingDep);
    const runtimeHeaderActionText = props.runtimeJob?.status === "running" && props.runtimeJob.action === "uninstall"
      ? text.uninstalling
      : text.installing;

    return [
      {
        id: "general" as const,
        kicker: text.generalKicker,
        title: text.general,
        description: text.generalDesc,
        content: (
          <div className="flex flex-col gap-6">
            <SettingsGroup title={text.basics} entries={desktopEntries} />
            <SettingsGroup title={text.sessionDisplay} entries={openCodeEntries} />
          </div>
        )
      },
      {
        id: "models" as const,
        kicker: text.modelsKicker,
        title: text.models,
        description: text.modelsDesc,
        content: props.modelsContent || (
          <Empty className="min-h-64 border bg-card">
            <EmptyHeader>
              <EmptyTitle>{text.models}</EmptyTitle>
              <EmptyDescription>{text.modelsEmpty}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      },
      {
        id: "plugins" as const,
        kicker: text.dependenciesKicker,
        title: text.dependencies,
        description: text.dependenciesDesc,
        content: (
          <Card className="overflow-hidden rounded-lg border-border/80 bg-card shadow-none">
            <CardContent className="flex flex-col gap-0 p-0">
              <div className="flex items-center justify-between gap-4 border-b border-border/70 px-4 py-3.5">
                <div className="min-w-0">
                  <strong className="block text-base font-semibold leading-6 text-foreground">{text.dependencies}</strong>
                  <p className="mt-1 text-[14px] leading-6 text-muted-foreground">统一检查和安装必要运行环境。</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={runtimeBusy}
                  onClick={props.onOpenRuntimeSetup}
                >
                  {props.installingDep ? runtimeHeaderActionText : text.install}
                </Button>
              </div>
              {pluginDeps.map((dep) => {
                const depName = dep.name as RuntimeDepName;
                const depJob = props.runtimeJob?.name === dep.name ? props.runtimeJob : null;
                const action = dep.installed ? "uninstall" : "install";
                const actionLabel = depJob?.status === "running"
                  ? depJob.action === "uninstall" ? text.uninstalling : text.installing
                  : dep.installed ? text.uninstall : text.install;
                return (
                  <article key={dep.name} className="grid min-h-[76px] grid-cols-[minmax(0,1fr)_auto] items-center gap-8 border-b border-border/70 px-4 py-3.5 last:border-b-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <strong className="text-base font-semibold text-foreground">{dep.name}</strong>
                        <Badge variant={dep.installed ? "success" : "secondary"}>
                          {props.checkingDeps[depName] ? text.checking : dep.installed ? text.installed : text.missing}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[14px] leading-6 text-muted-foreground">
                        {props.checkingDeps[depName]
                          ? text.checking
                          : dep.installed
                            ? dep.version || text.installed
                            : dep.installHint || text.missing}
                      </p>
                      {dep.path ? <p className="mt-1 truncate font-mono text-[13px] text-muted-foreground">{dep.path}</p> : null}
                      {depJob ? (
                        <p className="mt-1 text-[14px] text-muted-foreground">{getRuntimeJobLine(depJob, props.installingElapsed)}</p>
                      ) : null}
                    </div>
                    <div className="flex min-w-28 justify-end">
                      <Button
                        variant={dep.installed ? "outline" : "secondary"}
                        size="sm"
                        disabled={runtimeBusy || props.checkingDeps[depName]}
                        onClick={() => props.onRunDependencyAction(depName, action)}
                      >
                        {props.checkingDeps[depName] ? text.checking : actionLabel}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </CardContent>
          </Card>
        )
      },
      {
        id: "mobile" as const,
        kicker: text.apiKicker,
        title: text.api,
        description: text.apiDesc,
        content: (
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2">
              <div className="px-1 text-[15px] font-medium text-muted-foreground">{text.apiKicker}</div>
              <Card className="overflow-hidden rounded-lg border-border/80 bg-card shadow-none">
                <CardContent className="p-0">
                  <div className="grid gap-6 p-4 sm:grid-cols-[minmax(0,1fr)_144px]">
                    <div className="flex min-w-0 flex-col gap-5">
                      <div className="min-w-0">
                        <strong className="block text-base font-semibold text-foreground">{text.connectionAddress}</strong>
                        <Button
                          variant="ghost"
                          className="mt-1 h-auto max-w-full justify-start px-0 py-1 text-left font-mono text-[14px] text-muted-foreground hover:bg-transparent"
                          title={text.copyUrl}
                          disabled={!props.controlSettings.enabled || !props.controlConnectionUrl}
                          onClick={props.onCopyControlUrl}
                        >
                          <span className="truncate">
                            {props.controlSettings.enabled
                              ? (props.controlConnectionUrl || text.qrWaiting).replace(/^https?:\/\//i, "")
                              : text.qrDisabled}
                          </span>
                        </Button>
                      </div>
                      <div>
                        <strong className="block text-base font-semibold text-foreground">{text.authCode}</strong>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="inline-flex h-9 min-w-28 items-center justify-center rounded-md border border-border bg-muted px-3 font-mono text-[15px] font-semibold tracking-[0.18em] text-foreground">
                            {!props.controlSettings.enabled
                              ? "------"
                              : props.controlSettings.authMode === "none"
                                ? text.noAuth
                                : props.controlPairCode || "------"}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={text.refreshCode}
                            disabled={!props.controlSettings.enabled || props.controlBusy || props.controlSettings.authMode === "none"}
                            onClick={props.onRefreshControlPairCode}
                          >
                            <RefreshIcon />
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="flex size-36 items-center justify-center rounded-lg border border-border bg-background p-3">
                      {props.controlSettings.enabled && props.controlPairQrUrl ? (
                        <img className="size-full rounded-md object-contain" src={props.controlPairQrUrl} alt="Mobile pair QR code" />
                      ) : (
                        <div className="text-center text-[14px] leading-6 text-muted-foreground">
                          {props.controlSettings.enabled ? text.qrWaiting : text.qrDisabled}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>
            {!props.controlInstalled ? (
              <SettingsGroup
                title={text.mobileControl}
                entries={[{
                  title: text.mobileControl,
                  description: text.mobileControlMissing,
                  action: (
                    <Button
                      variant="secondary"
                      size="sm"
                      title={text.installDependencyTitle}
                      onClick={props.onOpenRuntimeSetup}
                    >
                      {text.installFirst}
                    </Button>
                  )
                }]}
                wide
              />
            ) : (
              <SettingsGroup title={text.mobileControl} entries={entriesBySection.mobile} wide />
            )}
          </div>
        )
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

  return createPortal(
    <div
      aria-modal="true"
      aria-labelledby="settings-title"
      className="fixed inset-0 z-[2600] grid h-svh min-h-0 grid-cols-[clamp(222px,18vw,268px)_minmax(0,1fr)] overflow-hidden bg-background text-foreground"
      role="dialog"
    >
      <div className="fixed inset-x-0 top-0 z-[2601] h-8" data-tauri-drag-region aria-hidden="true" />
      <aside
        className="grid min-h-0 grid-rows-[auto_1fr] border-r border-sidebar-border bg-sidebar px-4 pb-8 pt-[58px] text-sidebar-foreground"
        style={{
          "--sidebar": "color-mix(in srgb, var(--bg) 88%, #8f8270 12%)",
          backgroundColor: "var(--sidebar)",
        } as CSSProperties}
      >
        <div className="pb-5">
          <Button variant="ghost" className="h-8 justify-start gap-2 px-2 font-normal text-sidebar-foreground/60 hover:bg-[color-mix(in_srgb,#8f8270_10%,transparent)] hover:text-sidebar-foreground" onClick={() => void props.onClose()}>
            <span className="text-[18px] leading-4" aria-hidden="true">←</span>
            <span className="text-[15px] leading-5 font-medium">返回应用</span>
          </Button>
        </div>
        <ScrollArea className="min-h-0">
          <div className="flex flex-col gap-0.5">
            {sections.map((section) => {
              const Icon = SETTINGS_SECTION_ICONS[section.id];
              return (
                <Button
                  key={section.id}
                  variant="ghost"
                  className={cn(
                    "h-9 w-full justify-start gap-3 rounded-lg px-3 font-normal text-sidebar-foreground/76 transition-[background-color,color,box-shadow] hover:bg-[color-mix(in_srgb,#8f8270_10%,transparent)] hover:text-sidebar-foreground [&_svg]:size-[17px]",
                    activeSection === section.id && "bg-[color-mix(in_srgb,#8f8270_16%,var(--bg)_84%)] text-sidebar-foreground shadow-none hover:bg-[color-mix(in_srgb,#8f8270_18%,var(--bg)_82%)]"
                  )}
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon className="shrink-0" />
                  <span className="truncate text-[15px] leading-5 font-medium">{section.title}</span>
                </Button>
              );
            })}
          </div>
        </ScrollArea>
      </aside>

      <section className="min-h-0 bg-background">
        <ScrollArea className="h-full min-h-0">
          <div
            className={cn(
              "mx-auto flex w-full flex-col gap-[clamp(22px,3vh,32px)] px-[clamp(24px,3vw,32px)] py-[clamp(34px,6vh,56px)]",
              active.id === "models" || active.id === "skillsmp" || active.id === "mcp"
                ? "max-w-[1120px]"
                : "max-w-[680px]"
            )}
          >
            <header className="flex items-center justify-between gap-4">
              <div>
                <h2 id="settings-title" className="text-[clamp(21px,2vw,24px)] font-semibold tracking-[-0.02em] text-foreground">{active.title}</h2>
                {active.description ? <p className="mt-[clamp(12px,2vh,20px)] text-[15px] leading-7 text-muted-foreground">{active.description}</p> : null}
              </div>
              <div className="flex h-8 shrink-0 items-center justify-end">
                {active.id === "plugins" ? (
                  <Button variant="ghost" size="icon" title={text.refresh} disabled={props.runtimeChecking || Boolean(props.installingDep)} onClick={props.onRefreshRuntime}>
                    <RefreshIcon />
                  </Button>
                ) : active.id === "skillsmp" ? (
                  <Button variant="ghost" size="icon" title={text.refresh} disabled={props.skillsLoading} onClick={props.onRefreshSkills}>
                    <RefreshIcon />
                  </Button>
                ) : active.id === "mcp" ? (
                  <Button variant="ghost" size="icon" title={text.refresh} disabled={props.mcpLoading} onClick={props.onRefreshMcp}>
                    <RefreshIcon />
                  </Button>
                ) : null}
              </div>
            </header>
            <div className="flex flex-col gap-8">
              {active.content ? active.content : null}
              {active.entries?.length ? <SettingsRows entries={active.entries} /> : null}
            </div>
          </div>
        </ScrollArea>
      </section>
    </div>,
    document.body
  );
}
