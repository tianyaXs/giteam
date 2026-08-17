import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SVGProps } from "react";
import { createPortal } from "react-dom";
import type { RuntimeActionJobStatus, RuntimeDepName, RuntimeDependencyStatus, RuntimeRequirementsStatus } from "../../lib/appCache";
import { cn } from "../../lib/utils";
import { REMOTE_REPO_MODULE_ENABLED } from "../../lib/featureFlags";
import { UI_ZOOM_RANGE, CODE_FONT_RANGE } from "../../lib/useAppearanceFontSize";
import { CheckIcon, AboutIcon, BellIcon, ImageIcon, LinkIcon, ModelIcon, PackageIcon, PanelLeftIcon, PluginsIcon, RefreshIcon, SettingsIcon, SkillsIcon, SoundIcon, SyncIcon } from "../icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SegmentedControl } from "../ui/segmented";
import { NavigatorPreview } from "./NavigatorPreview";
import { ServiceSettingsPanel } from "./ServiceSettingsPanel";

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
  /** 发现新版本后自动下载安装并重启（默认关，需用户显式开启）。 */
  updatesAutoInstall: boolean;
  /** 单次任务最大工具调用轮数；0 = 不限制（默认），仅对新建会话生效。 */
  maxToolIterations: number;
  /** 关闭按钮行为：tray=最小化到系统托盘（默认，后台运行）；quit=直接退出；ask=每次询问。 */
  closeBehavior: "tray" | "quit" | "ask";
  /** 概览标尺位置：right=内容列右缘（默认）；left=内容列左缘。 */
  navigatorSide: "left" | "right";
  /** 概览标尺范围：all=全部消息（默认）；sent=仅「我发送」的消息。 */
  navigatorScope: "sent" | "all";
};

type SettingsLocale = Exclude<GeneralSettingsDraft["language"], "system">;

const SETTINGS_TEXT = {
  "zh-CN": {
    followSystem: "跟随系统", back: "← 设置", sidebarIntro: "按使用场景管理界面、会话、通知和运行环境。",
    general: "通用", generalKicker: "基础", generalDesc: "调整界面显示、授权行为和会话中的消息展示方式。", basics: "基础", sessionDisplay: "会话显示",
    workspace: "工作区", workspaceKicker: "布局", workspaceDesc: "控制左侧导航中工作区模块是否显示。",
    models: "模型", modelsKicker: "模型", modelsDesc: "管理服务商、默认模型和模型显示状态。", modelsEmpty: "暂无模型信息。",
    dependencies: "插件", dependenciesKicker: "扩展", dependenciesDesc: "检查并管理 Git、Entire 等桌面运行时插件；giteam CLI 仅用于无头 Host / doctor，可按需安装。",
    api: "服务", apiKicker: "服务", apiDesc: "管理局域网 Host、云端与私有部署连接。",
    skills: "技能", skillsKicker: "扩展", skillsDesc: "管理已安装技能，并配置技能市场的搜索能力。",
    updates: "关于", updatesKicker: "应用", updatesDesc: "查看当前版本，并检查、安装桌面端更新。",
    notifications: "通知", notificationsKicker: "提醒", notificationsDesc: "控制哪些事件会发送系统通知。",
    sounds: "声音", soundsKicker: "提醒", soundsDesc: "控制 Agent、授权和错误事件的提示音。",
    language: "界面语言", languageDesc: "选择界面语言；系统会跟随当前环境。", autoAccept: "自动允许授权", autoAcceptDesc: "自动通过当前 Giteam 会话的工具授权请求。",
    reasoning: "推理摘要", reasoningDesc: "在对话中显示模型推理摘要。", shellParts: "Shell 工具详情", shellPartsDesc: "默认展开 Shell 工具调用详情。", editParts: "编辑工具详情", editPartsDesc: "默认展开编辑工具调用详情。", progressBar: "会话进度条", progressBarDesc: "在会话工作中显示进度条。", maxToolIterations: "单次任务最大工具调用次数", maxToolIterationsDesc: "限制单次任务的工具调用轮数；0 为不限制，对新建会话生效。", closeBehavior: "关闭按钮行为", closeBehaviorDesc: "点击窗口关闭按钮时的动作：最小化到系统托盘后台运行、直接退出，或每次询问。", closeBehaviorTray: "最小化到托盘", closeBehaviorQuit: "直接退出", closeBehaviorAsk: "每次询问", navigator: "概览标尺", navigatorDesc: "会话侧边的可拖动快速滚动标尺：点击跳转、长按拖动。", navigatorPreviewCaption: "实时预览", navigatorPosition: "标尺位置", navigatorPositionDesc: "贴内容列左缘或右缘。", navigatorPosLeft: "左", navigatorPosRight: "右", navigatorScope: "标尺范围", navigatorScopeDesc: "仅「我发送」的消息，或全部消息。", navigatorScopeSent: "仅我发送", navigatorScopeAll: "全部消息",
    theme: "主题", themeDesc: "在浅色和深色主题之间切换。", light: "浅色", dark: "深色", uiFont: "界面缩放", uiFontDesc: "等比缩放整个界面，含字号、间距与图标。", codeFont: "代码字号", codeFontDesc: "调整代码、终端和等宽文本大小。", fontSizeSection: "显示大小", fontSizeSectionDesc: "调整界面缩放与代码字号，拖动即时预览。", presetCompact: "紧凑", presetStandard: "标准", presetRoomy: "宽松", resetDefault: "重置",
    changes: "审查", changesDesc: "显示当前仓库变更列表。", worktree: "工作树", worktreeDesc: "显示分支与 worktree 拓扑。", terminal: "终端", terminalDesc: "显示内置终端入口。", skillsModuleDesc: "显示技能市场。",
    mobileControl: "本机 Host 服务", mobileControlReady: "由桌面进程内嵌提供与 CLI 相同的手机服务；配置偏好端口、授权与扫码连接。", mobileControlMissing: "本机 Host 由桌面内嵌，无需安装 giteam CLI。", service: "服务开关", serviceDesc: "是否在桌面进程内启动 Host（Control）服务。", port: "偏好端口", portDesc: "优先绑定的端口；若被占用会自动顺延，二维码使用实际监听端口。", listeningPort: "实际监听", listeningPortDesc: "当前 Host 正在监听的端口；与偏好端口不同时说明已自动顺延。", listeningPortRemapped: "偏好端口被占用，已顺延到此端口（扫码与连接地址使用此端口）。", publicUrl: "公开地址", publicUrlDesc: "可选，公网或局域网可访问地址；留空时自动取本机可用地址。", authMode: "授权模式", authModeDesc: "选择免认证访问，或要求输入配对码进行授权。", pairCodeAuth: "配对码授权", validPeriod: "有效期", validPeriodDesc: "仅在“配对码授权”下生效，用来控制当前配对码的过期时间。", currentPairCode: "当前配对码", currentPairCodeDesc: "二维码与手机端手动输入都会使用这里展示的配对码。", connectionAddress: "连接地址", authCode: "授权码", qrConnect: "二维码连接", qrConnectDesc: "手机端可直接扫码带入服务地址和当前授权方式。", noAuth: "无需认证", hours24: "24 小时", days7: "7 天", forever: "长期有效", refreshCode: "刷新配对码", copyUrl: "复制地址", qrDisabled: "开启服务后即可生成二维码", qrWaiting: "等待生成可访问地址…", agentApi: "Host 接口", agentApiBusy: "正在保存并重启本机 Host 服务。", agentApiDesc: "配置本机 Host 偏好端口。",
    apiKey: "API 密钥", apiKeyConfigured: "已配置；清空输入框并保存即可移除。", apiKeyDesc: "可选项；未配置时 AI 搜索会自动回退关键词搜索。",
    agentNotifications: "Agent 通知", agentNotificationsDesc: "Agent 完成或需要关注时发送通知。", permissionNotifications: "授权通知", permissionNotificationsDesc: "出现授权请求时发送通知。", errorNotifications: "错误通知", errorNotificationsDesc: "发生错误时发送通知。",
    agentSound: "Agent 提示音", agentSoundDesc: "Agent 完成或状态变化时播放提示音。", permissionSound: "授权提示音", permissionSoundDesc: "出现授权请求时播放提示音。", errorSound: "错误提示音", errorSoundDesc: "发生错误时播放提示音。",
    startupCheck: "启动时检查更新", startupCheckDesc: "应用启动后自动检查是否有新版本。",
    autoInstall: "自动更新", autoInstallDesc: "发现新版本后自动下载安装并重启，无需再点确认。",
    checkNow: "检查更新", checkNowDesc: "立即向 GitHub Releases 查询新版本。",
    currentVersion: "当前版本", currentVersionDesc: "本机正在运行的应用版本。",
    updateAvailable: "发现新版本", updateAvailableDesc: "下载并安装后需要重启应用。",
    installUpdate: "下载并安装", upToDate: "已是最新版本", downloading: "下载中", restartToUpdate: "重启以完成更新",
    updateUnsupported: "当前环境不支持在线更新", updateUnsupportedDesc: "请使用桌面端安装包运行以启用自动更新。",
    updateNotes: "更新内容", updateNotesEmpty: "此版本未提供更新说明。", updateFromTo: "版本", reviewWhatsNew: "查看更新内容", reviewWhatsNewDesc: "重新查看本次更新的说明", review: "查看", whatsNewLoadingLabel: "加载中…",
    save: "保存", saving: "保存中...", installFirst: "先安装", install: "安装", uninstall: "卸载", installing: "安装中", uninstalling: "卸载中", checking: "检查中...", check: "检查", refresh: "刷新", installed: "已安装", missing: "缺失", saveMobileTitle: "保存本机 Host 配置", installDependencyTitle: "安装 giteam CLI（可选）", saveToApply: "保存后生效"
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
    dependencies: "外掛", dependenciesKicker: "擴充", dependenciesDesc: "檢查並管理 Git、Entire 等桌面執行時外掛；giteam 用於行動端連線，可按需安裝。",
    api: "服務", apiKicker: "服務", apiDesc: "管理區域網路控制、雲端與私有部署連線。",
    skills: "技能", skillsKicker: "擴充", skillsDesc: "管理已安裝技能，並設定技能市場搜尋能力。",
    updates: "關於", updatesKicker: "應用", updatesDesc: "查看目前版本，並檢查、安裝桌面端更新。",
    notifications: "通知", notificationsKicker: "提醒", notificationsDesc: "控制哪些事件會傳送系統通知。",
    sounds: "聲音", soundsKicker: "提醒", soundsDesc: "控制 Agent、授權和錯誤事件的提示音。",
    language: "介面語言", languageDesc: "選擇介面語言；系統會跟隨目前環境。", autoAccept: "自動允許授權", autoAcceptDesc: "自動通過目前 Giteam 會話的工具授權請求。",
    reasoning: "推理摘要", reasoningDesc: "在對話中顯示模型推理摘要。", shellParts: "Shell 工具詳情", shellPartsDesc: "預設展開 Shell 工具呼叫詳情。", editParts: "編輯工具詳情", editPartsDesc: "預設展開編輯工具呼叫詳情。", progressBar: "會話進度列", progressBarDesc: "在會話工作中顯示進度列。", maxToolIterations: "單次任務最大工具呼叫次數", maxToolIterationsDesc: "限制單次任務的工具呼叫輪數；0 為不限制，對新建會話生效。", closeBehavior: "關閉按鈕行為", closeBehaviorDesc: "點擊視窗關閉按鈕時的動作：最小化到系統托盤背景執行、直接結束，或每次詢問。", closeBehaviorTray: "最小化到托盤", closeBehaviorQuit: "直接結束", closeBehaviorAsk: "每次詢問", navigator: "概覽標尺", navigatorDesc: "會話側邊的可拖動快速滾動標尺：點擊跳轉、長按拖動。", navigatorPreviewCaption: "即時預覽", navigatorPosition: "標尺位置", navigatorPositionDesc: "貼內容列左緣或右緣。", navigatorPosLeft: "左", navigatorPosRight: "右", navigatorScope: "標尺範圍", navigatorScopeDesc: "僅「我傳送」的訊息，或全部訊息。", navigatorScopeSent: "僅我傳送", navigatorScopeAll: "全部訊息",
    theme: "主題", themeDesc: "在淺色和深色主題之間切換。", light: "淺色", dark: "深色", uiFont: "介面縮放", uiFontDesc: "等比縮放整個介面，含字號、間距與圖示。", codeFont: "程式碼字號", codeFontDesc: "調整程式碼、終端機和等寬文字大小。", fontSizeSection: "顯示大小", fontSizeSectionDesc: "調整介面縮放與程式碼字號，拖動即時預覽。", presetCompact: "緊湊", presetStandard: "標準", presetRoomy: "寬鬆", resetDefault: "重設",
    changes: "審查", changesDesc: "顯示目前倉庫變更列表。", worktree: "工作樹", worktreeDesc: "顯示分支與 worktree 拓撲。", terminal: "終端機", terminalDesc: "顯示內建終端機入口。", skillsModuleDesc: "顯示技能市場。",
    mobileControl: "行動端控制", mobileControlReady: "設定行動端連線服務、連接埠、授權方式與掃碼連線。", mobileControlMissing: "需要先安裝 giteam 依賴，才可以啟用行動端控制服務。", service: "服務開關", serviceDesc: "控制行動端控制服務是否啟用。", port: "偏好連接埠", portDesc: "優先綁定的連接埠；若被占用會自動順延，QR Code 使用實際監聽連接埠。", listeningPort: "實際監聽", listeningPortDesc: "目前 Host 正在監聽的連接埠；與偏好連接埠不同時表示已自動順延。", listeningPortRemapped: "偏好連接埠被占用，已順延到此連接埠（掃碼與連線地址使用此連接埠）。", publicUrl: "公開地址", publicUrlDesc: "可選，公網或區域網路可存取地址；留空時自動取本機可用地址。", authMode: "授權模式", authModeDesc: "選擇免認證存取，或要求輸入配對碼進行授權。", pairCodeAuth: "配對碼授權", validPeriod: "有效期", validPeriodDesc: "僅在「配對碼授權」下生效，用來控制目前配對碼的過期時間。", currentPairCode: "目前配對碼", currentPairCodeDesc: "QR Code 與手機端手動輸入都會使用這裡顯示的配對碼。", connectionAddress: "連線地址", authCode: "授權碼", qrConnect: "QR Code 連線", qrConnectDesc: "手機端可直接掃碼帶入服務地址和目前授權方式。", noAuth: "無需認證", hours24: "24 小時", days7: "7 天", forever: "長期有效", refreshCode: "重新整理配對碼", copyUrl: "複製地址", qrDisabled: "啟用服務後即可產生 QR Code", qrWaiting: "等待產生可存取地址…", agentApi: "Giteam 介面", agentApiBusy: "正在儲存並重新啟動 Giteam 服務。", agentApiDesc: "設定 Giteam 服務連接埠。",
    apiKey: "API 金鑰", apiKeyConfigured: "已設定；清空輸入框並儲存即可移除。", apiKeyDesc: "可選項；未設定時 AI 搜尋會自動回退關鍵字搜尋。",
    agentNotifications: "Agent 通知", agentNotificationsDesc: "Agent 完成或需要關注時傳送通知。", permissionNotifications: "授權通知", permissionNotificationsDesc: "出現授權請求時傳送通知。", errorNotifications: "錯誤通知", errorNotificationsDesc: "發生錯誤時傳送通知。",
    agentSound: "Agent 提示音", agentSoundDesc: "Agent 完成或狀態變化時播放提示音。", permissionSound: "授權提示音", permissionSoundDesc: "出現授權請求時播放提示音。", errorSound: "錯誤提示音", errorSoundDesc: "發生錯誤時播放提示音。",
    startupCheck: "啟動時檢查更新", startupCheckDesc: "應用啟動後自動檢查是否有新版本。",
    autoInstall: "自動更新", autoInstallDesc: "發現新版本後自動下載安裝並重新啟動，無需再點確認。",
    checkNow: "檢查更新", checkNowDesc: "立即向 GitHub Releases 查詢新版本。",
    currentVersion: "目前版本", currentVersionDesc: "本機正在執行的應用版本。",
    updateAvailable: "發現新版本", updateAvailableDesc: "下載並安裝後需要重新啟動應用。",
    installUpdate: "下載並安裝", upToDate: "已是最新版本", downloading: "下載中", restartToUpdate: "重新啟動以完成更新",
    updateUnsupported: "目前環境不支援線上更新", updateUnsupportedDesc: "請使用桌面端安裝包執行以啟用自動更新。",
    updateNotes: "更新內容", updateNotesEmpty: "此版本未提供更新說明。", updateFromTo: "版本", reviewWhatsNew: "查看更新內容", reviewWhatsNewDesc: "重新查看本次更新的說明", review: "查看", whatsNewLoadingLabel: "載入中…",
    save: "儲存", saving: "儲存中...", installFirst: "先安裝", install: "安裝", uninstall: "解除安裝", installing: "安裝中", uninstalling: "解除安裝中", checking: "檢查中...", check: "檢查", refresh: "重新整理", installed: "已安裝", missing: "缺少", saveMobileTitle: "儲存行動端控制設定", installDependencyTitle: "先安裝 giteam 依賴", saveToApply: "儲存後生效"
  },
  "en-US": {
    followSystem: "Follow System", back: "← Settings", sidebarIntro: "Manage interface, sessions, notifications, and runtime by workflow.", general: "General", generalKicker: "Basics", generalDesc: "Adjust display, permissions, and session message behavior.", basics: "Basics", sessionDisplay: "Session Display", workspace: "Workspace", workspaceKicker: "Layout", workspaceDesc: "Choose which right-side workspace modules are visible.", models: "Models", modelsKicker: "Models", modelsDesc: "Manage providers, default models, and model visibility.", modelsEmpty: "No model information yet.", dependencies: "Plugins", dependenciesKicker: "Extensions", dependenciesDesc: "Check and manage desktop runtime plugins such as Git and Entire; giteam is optional for mobile connection.", api: "Service", apiKicker: "Service", apiDesc: "Manage LAN control, cloud, and private gateway connections.", skills: "Skills", skillsKicker: "Extensions", skillsDesc: "Manage installed skills and Skills marketplace search.", updates: "About", updatesKicker: "App", updatesDesc: "View the current version and check or install desktop updates.", notifications: "Notifications", notificationsKicker: "Alerts", notificationsDesc: "Choose which events send system notifications.", sounds: "Sounds", soundsKicker: "Alerts", soundsDesc: "Control sounds for agent, permission, and error events.", language: "Language", languageDesc: "Choose the interface language; system follows your environment.", autoAccept: "Auto Accept Permissions", autoAcceptDesc: "Automatically approve tool permission requests for the current Giteam session.", reasoning: "Reasoning Summaries", reasoningDesc: "Show model reasoning summaries in conversations.", shellParts: "Shell Tool Details", shellPartsDesc: "Expand Shell tool call details by default.", editParts: "Edit Tool Details", editPartsDesc: "Expand edit tool call details by default.", progressBar: "Session Progress Bar", progressBarDesc: "Show a progress bar while a session is working.", maxToolIterations: "Max Tool Iterations", maxToolIterationsDesc: "Limit tool-calling rounds per task; 0 means unlimited. Applies to newly created sessions.", closeBehavior: "Close Button", closeBehaviorDesc: "What the window close button does: minimize to system tray, quit, or ask each time.", closeBehaviorTray: "Minimize to Tray", closeBehaviorQuit: "Quit", closeBehaviorAsk: "Ask Each Time", navigator: "Overview Rail", navigatorDesc: "A draggable fast-scroll rail on the side of the conversation — click to jump, drag to scrub.", navigatorPreviewCaption: "Live preview", navigatorPosition: "Rail Position", navigatorPositionDesc: "Place the rail on the left or right edge of the content column.", navigatorPosLeft: "Left", navigatorPosRight: "Right", navigatorScope: "Rail Scope", navigatorScopeDesc: "Show only messages you sent, or all messages.", navigatorScopeSent: "Only Mine", navigatorScopeAll: "All Messages", theme: "Theme", themeDesc: "Switch between light and dark themes.", light: "Light", dark: "Dark", uiFont: "Interface Zoom", uiFontDesc: "Scale the entire interface, including text, spacing, and icons.", codeFont: "Code Font Size", codeFontDesc: "Adjust code, terminal, and monospace text size.", fontSizeSection: "Display Size", fontSizeSectionDesc: "Adjust interface zoom and code font size with live preview.", presetCompact: "Compact", presetStandard: "Standard", presetRoomy: "Roomy", resetDefault: "Reset", changes: "Changes", changesDesc: "Show current repository changes.", worktree: "Worktree", worktreeDesc: "Show branch and worktree topology.", terminal: "Terminal", terminalDesc: "Show the built-in terminal entry.", skillsModuleDesc: "Show the Skills marketplace.", mobileControl: "Local Host", mobileControlReady: "Desktop embeds the same mobile Host as the CLI; configure preferred port, auth, and QR pairing.", mobileControlMissing: "Local Host is embedded in desktop; giteam CLI is optional.", service: "Service", serviceDesc: "Start the Host (Control) service inside the desktop process.", port: "Preferred Port", portDesc: "Preferred bind port; if busy, Host remaps automatically and QR uses the listening port.", listeningPort: "Listening Port", listeningPortDesc: "Port the Host is actually listening on; differs from preferred when remapped.", listeningPortRemapped: "Preferred port was busy; remapped here (QR and connection URL use this port).", publicUrl: "Public URL", publicUrlDesc: "Optional public or LAN-accessible URL. Leave blank to auto-pick a reachable local address.", authMode: "Auth Mode", authModeDesc: "Choose between direct access and pair-code-based authorization.", pairCodeAuth: "Pair Code", validPeriod: "Validity", validPeriodDesc: "Only applies in pair-code mode and controls when the current pair code expires.", currentPairCode: "Current Pair Code", currentPairCodeDesc: "The QR code and manual mobile input both use the current pair code shown here.", connectionAddress: "Connection URL", authCode: "Auth Code", qrConnect: "QR Connection", qrConnectDesc: "Mobile can scan this QR code to fill the service URL and current auth mode.", noAuth: "No Auth", hours24: "24 hours", days7: "7 days", forever: "Never expires", refreshCode: "Refresh Pair Code", copyUrl: "Copy URL", qrDisabled: "Enable the service to generate a QR code", qrWaiting: "Waiting for a reachable address…", agentApi: "Giteam API", agentApiBusy: "Saving and restarting the Giteam service.", agentApiDesc: "Configure the Giteam service port.", apiKey: "API Key", apiKeyConfigured: "Configured; clear the input and save to remove it.", apiKeyDesc: "Optional; AI search falls back to keyword search when unset.", agentNotifications: "Agent Notifications", agentNotificationsDesc: "Notify when the agent finishes or needs attention.", permissionNotifications: "Permission Notifications", permissionNotificationsDesc: "Notify when a permission request appears.", errorNotifications: "Error Notifications", errorNotificationsDesc: "Notify when an error occurs.", agentSound: "Agent Sound", agentSoundDesc: "Play a sound when the agent finishes or changes state.", permissionSound: "Permission Sound", permissionSoundDesc: "Play a sound when permission is requested.", errorSound: "Error Sound", errorSoundDesc: "Play a sound when an error occurs.", startupCheck: "Check for Updates on Startup", startupCheckDesc: "Automatically check for a new app version after launch.", autoInstall: "Automatic Updates", autoInstallDesc: "When a new version is found, download, install, and restart without asking.", checkNow: "Check for Updates", checkNowDesc: "Query GitHub Releases for a newer version now.", currentVersion: "Current Version", currentVersionDesc: "The app version running on this machine.", updateAvailable: "Update Available", updateAvailableDesc: "Download and install, then restart the app.", installUpdate: "Download & Install", upToDate: "You are up to date", downloading: "Downloading", restartToUpdate: "Restart to finish update", updateUnsupported: "In-app updates are unavailable here", updateUnsupportedDesc: "Use the desktop installer build to enable automatic updates.", updateNotes: "What's New", updateNotesEmpty: "No release notes were provided for this version.", updateFromTo: "Version", reviewWhatsNew: "Review What's New", reviewWhatsNewDesc: "Reopen the release notes for the current version", review: "View", whatsNewLoadingLabel: "Loading…", save: "Save", saving: "Saving...", installFirst: "Install first", install: "Install", uninstall: "Uninstall", installing: "Installing", uninstalling: "Uninstalling", checking: "Checking...", check: "Check", refresh: "Refresh", installed: "Installed", missing: "Missing", saveMobileTitle: "Save mobile control settings", installDependencyTitle: "Install giteam dependency first", saveToApply: "Save to apply"
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

function remoteRepoText(language: GeneralSettingsDraft["language"]) {
  if (language === "en-US") {
    return {
      title: "Remote Repositories", kicker: "Connection", description: "Choose the Remote Repo Service used by this Giteam client.",
      serviceUrl: "Service URL", serviceUrlDesc: "Use an http(s) address or a same-origin proxy path. The address is stored only on this client.",
      serviceApiKey: "API Key", serviceApiKeyDesc: "Optional key sent as X-API-Key when the service requires authentication.",
      test: "Test connection", save: "Save & use", reset: "Use default", effective: "Active endpoint",
    };
  }
  if (language === "zh-TW") {
    return {
      title: "遠端倉庫", kicker: "連線", description: "選擇這個 Giteam 用戶端要使用的遠端倉庫服務。",
      serviceUrl: "服務地址", serviceUrlDesc: "輸入 http(s) 位址或同源代理路徑。此地址只保存在目前用戶端。",
      serviceApiKey: "API Key", serviceApiKeyDesc: "選填；服務要求認證時會以 X-API-Key 傳送。",
      test: "測試連線", save: "儲存並使用", reset: "使用預設值", effective: "目前端點",
    };
  }
  return {
    title: "远程仓库", kicker: "连接", description: "选择此 Giteam 客户端要使用的远程仓库服务。",
    serviceUrl: "服务地址", serviceUrlDesc: "输入 http(s) 地址或同源代理路径。该地址只保存在当前客户端。",
    serviceApiKey: "API Key", serviceApiKeyDesc: "可选；服务要求认证时会通过 X-API-Key 发送。",
    test: "测试连接", save: "保存并使用", reset: "使用默认值", effective: "当前端点",
  };
}

type SettingsDialogProps = {
  theme: "dark" | "light";
  runtimeStatus: RuntimeRequirementsStatus;
  onClose: () => void;
  onToggleTheme: () => void;
  onOpenRuntimeSetup: () => void;
  onOpenMobileControl: () => void;
  onOpenAgentApi: () => void;
  onOpenModelManager: () => void;
  onOpenSkillsMarketplaceSettings: () => void;
  generalSettings: GeneralSettingsDraft;
  onGeneralSettingsChange: (settings: GeneralSettingsDraft) => void;
  appVersion: string;
  appUpdateState: import("../../lib/appUpdater").AppUpdateState;
  onCheckAppUpdate: () => void;
  onInstallAppUpdate: () => void;
  onReopenUpdateCelebration: () => void | Promise<void>;
  agentPort: number;
  agentBusy: boolean;
  onAgentPortChange: (port: number) => void;
  onSaveAgentApi: () => void;
  skillsmpApiKey: string;
  skillsmpApiKeyDraft: string;
  onSkillsmpApiKeyDraftChange: (value: string) => void;
  onSaveSkillsmpApiKey: () => void;
  onClearSkillsmpApiKey: () => void;
  uiZoom: number;
  codeFontSize: number;
  onUiZoomChange: (value: number) => void;
  onCodeFontSizeChange: (value: number) => void;
  controlSettings: ControlServerSettingsDraft;
  controlBusy: boolean;
  controlInstalled: boolean;
  onControlSettingsChange: (settings: ControlServerSettingsDraft) => void;
  onSaveControlSettings: () => void;
  controlConnectionUrl: string;
  controlPairCode: string;
  controlPairQrUrl: string;
  /** 实际监听端口；与偏好端口不同时表示发生了顺延。 */
  controlListeningPort?: number;
  controlPortRemapped?: boolean;
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
  onToggleControlService: (enabled: boolean) => void;
  remoteRepoServiceUrl: string;
  remoteRepoServiceDraft: string;
  remoteRepoServiceApiKeyDraft: string;
  remoteRepoServiceBusy: boolean;
  remoteRepoServiceNotice: string;
  onRemoteRepoServiceDraftChange: (value: string) => void;
  onRemoteRepoServiceApiKeyDraftChange: (value: string) => void;
  onTestRemoteRepoService: () => void;
  onSaveRemoteRepoService: () => void;
  onResetRemoteRepoService: () => void;
};

type SettingsSectionId = "general" | "notifications" | "sounds" | "updates" | "appearance" | "models" | "skillsmp" | "plugins" | "mobile" | "remoteRepos";
type InitialSettingsSectionId = SettingsSectionId | "modules";

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
  models: PackageIcon,
  skillsmp: SkillsIcon,
  plugins: ModelIcon,
  mobile: LinkIcon,
  remoteRepos: SyncIcon,
  updates: AboutIcon,
  notifications: BellIcon,
  sounds: SoundIcon
};

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
      <SelectTrigger className="h-8 w-52 rounded-md bg-muted/30 text-sm">
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

// 主题缩略图专用配色：硬编码而非 CSS 变量，确保两个预览始终各自固定外观，
// 不随当前应用主题变化（取自 tokens.css 的浅色/深色值并做小尺寸视觉调优）。
const THEME_PRESETS = {
  light: {
    bg: "#ffffff",
    sidebar: "#eef1f5",
    panel: "#e2e6ec",
    text: "#2b2b2b",
    muted: "#c7ccd4",
    divider: "#e3e6eb",
    accent: "#0066b8",
    accentSoft: "#bcd8f0"
  },
  dark: {
    bg: "#1e1e1e",
    sidebar: "#25262a",
    panel: "#2d2d2d",
    text: "#d4d4d4",
    muted: "#4a4d52",
    divider: "#33353a",
    accent: "#0e639c",
    accentSoft: "#1f4d6e"
  }
} as const;

function ThemePreview(props: { variant: "light" | "dark" }) {
  const c = THEME_PRESETS[props.variant];
  return (
    <div className="flex h-full w-full overflow-hidden rounded-[5px]" style={{ background: c.bg }}>
      <div
        className="flex w-[34%] flex-col gap-[3px] px-[5px] pt-[6px]"
        style={{ background: c.sidebar, borderRight: `1px solid ${c.divider}` }}
      >
        <span className="h-[3px] w-full rounded-full" style={{ background: c.muted }} />
        <span className="h-[3px] w-[85%] rounded-full" style={{ background: c.accentSoft }} />
        <span className="h-[3px] w-[64%] rounded-full" style={{ background: c.muted }} />
      </div>
      <div className="flex flex-1 flex-col gap-[4px] px-[6px] pt-[6px]">
        <span className="h-[4px] w-[52%] rounded-full" style={{ background: c.panel }} />
        <span className="mt-[3px] h-[3px] w-[84%] rounded-full" style={{ background: c.text, opacity: 0.9 }} />
        <span className="h-[3px] w-[58%] rounded-full" style={{ background: c.text, opacity: 0.4 }} />
        <span className="mt-[3px] h-[6px] w-[36%] rounded-full" style={{ background: c.accent }} />
      </div>
    </div>
  );
}

function ThemePicker(props: {
  value: "dark" | "light";
  lightLabel: string;
  darkLabel: string;
  onSelect: (value: "light" | "dark") => void;
}) {
  const options: Array<{ value: "light" | "dark"; label: string }> = [
    { value: "light", label: props.lightLabel },
    { value: "dark", label: props.darkLabel }
  ];
  return (
    <div className="flex items-center gap-2">
      {options.map((option) => {
        const selected = props.value === option.value;
        const accent = THEME_PRESETS[option.value].accent;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            aria-label={option.label}
            title={option.label}
            onClick={() => props.onSelect(option.value)}
            className="relative flex w-[88px] flex-col gap-1 rounded-lg border border-border/70 p-1 outline-none transition-[border-color,box-shadow] hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-foreground/40"
            style={selected ? { borderColor: accent, boxShadow: `0 0 0 3px ${accent}33` } : undefined}
          >
            <div className="h-[44px] w-full">
              <ThemePreview variant={option.value} />
            </div>
            <span className={cn("text-center text-[11px] leading-[14px]", selected ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {option.label}
            </span>
            {selected ? (
              <span
                className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
                style={{ background: accent }}
              >
                <CheckIcon className="size-2.5" />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function FontSlider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  presets: Array<{ label: string; value: number }>;
  format: (value: number) => string;
  resetLabel: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  onReset: () => void;
  preview: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border/70 bg-card/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm font-semibold text-foreground">{props.label}</strong>
        <div className="inline-flex items-center gap-0.5 rounded-md bg-muted/40 p-0.5">
          {props.presets.map((preset) => {
            const active = props.value === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => { props.onChange(preset.value); props.onCommit(preset.value); }}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                  active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          className="gt-range flex-1"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          onChange={(event) => props.onChange(Number(event.target.value))}
          onPointerUp={(event) => props.onCommit(Number(event.currentTarget.value))}
          onKeyUp={(event) => props.onCommit(Number(event.currentTarget.value))}
          aria-label={props.label}
        />
        <span className="w-12 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
          {props.format(props.value)}
        </span>
        <button
          type="button"
          onClick={props.onReset}
          title={props.resetLabel}
          aria-label={props.resetLabel}
          className="rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/40"
        >
          <RefreshIcon className="size-3.5" />
        </button>
      </div>
      {props.preview}
    </div>
  );
}

function ZoomPreview(props: { zoom: number }) {
  // 用 CSS zoom 包裹样例，等比缩放即时反映界面缩放效果；origin 顶部对齐避免居中跳动。
  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-background">
      <div style={{ zoom: `${props.zoom}%` } as CSSProperties} className="origin-top-left">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="size-2 rounded-full" style={{ background: "var(--accent)" }} />
          <span className="text-[12px] font-semibold text-foreground">Giteam</span>
          <span className="text-[11px] text-muted-foreground">· 设置 · 通用</span>
        </div>
        <div className="flex items-center gap-2 px-3 pb-2.5">
          <span className="h-[3px] w-10 rounded-full bg-foreground/80" />
          <span className="h-[3px] w-16 rounded-full bg-muted-foreground/60" />
        </div>
      </div>
    </div>
  );
}

function CodePreview(props: { fontSize: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-background px-3 py-2">
      <pre className="m-0 overflow-hidden font-mono text-foreground" style={{ fontSize: props.fontSize, lineHeight: 1.55 }}>
        <code>{'const greet = (name: string) => {\n  return `Hello, ${name}!`;\n};'}</code>
      </pre>
    </div>
  );
}

function WhatsNewReviewButton(props: {
  label: string;
  loadingLabel: string;
  onReopen: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          await props.onReopen();
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? props.loadingLabel : props.label}
    </Button>
  );
}

function FontSizeSection(props: {
  text: Record<SettingsTextKey, string>;
  uiZoom: number;
  codeFontSize: number;
  onUiZoomChange: (value: number) => void;
  onCodeFontSizeChange: (value: number) => void;
}) {
  // 拖动中的预览草稿保持在局部：滑动时只更新 draft 驱动预览，
  // 不上抛到 SettingsDialog 顶层（避免整棵 sections 树重算与全局 zoom/字号重排）；
  // 松手（onCommit）时才回调 hook 真正应用，拖动因此丝滑。
  const [zoomDraft, setZoomDraft] = useState(props.uiZoom);
  const [codeDraft, setCodeDraft] = useState(props.codeFontSize);

  useEffect(() => { setZoomDraft(props.uiZoom); }, [props.uiZoom]);
  useEffect(() => { setCodeDraft(props.codeFontSize); }, [props.codeFontSize]);

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <div className="text-sm font-medium text-muted-foreground">{props.text.fontSizeSection}</div>
        <div className="text-[11px] text-muted-foreground/70">{props.text.fontSizeSectionDesc}</div>
      </div>
      <FontSlider
        label={props.text.uiFont}
        value={zoomDraft}
        min={UI_ZOOM_RANGE.min}
        max={UI_ZOOM_RANGE.max}
        step={1}
        presets={[
          { label: props.text.presetCompact, value: 90 },
          { label: props.text.presetStandard, value: 100 },
          { label: props.text.presetRoomy, value: 110 }
        ]}
        format={(value) => `${value}%`}
        resetLabel={props.text.resetDefault}
        onChange={setZoomDraft}
        onCommit={props.onUiZoomChange}
        onReset={() => {
          setZoomDraft(UI_ZOOM_RANGE.default);
          props.onUiZoomChange(UI_ZOOM_RANGE.default);
        }}
        preview={<ZoomPreview zoom={zoomDraft} />}
      />
      <FontSlider
        label={props.text.codeFont}
        value={codeDraft}
        min={CODE_FONT_RANGE.min}
        max={CODE_FONT_RANGE.max}
        step={1}
        presets={[
          { label: props.text.presetCompact, value: 11 },
          { label: props.text.presetStandard, value: 12 },
          { label: props.text.presetRoomy, value: 14 }
        ]}
        format={(value) => `${value}px`}
        resetLabel={props.text.resetDefault}
        onChange={setCodeDraft}
        onCommit={props.onCodeFontSizeChange}
        onReset={() => {
          setCodeDraft(CODE_FONT_RANGE.default);
          props.onCodeFontSizeChange(CODE_FONT_RANGE.default);
        }}
        preview={<CodePreview fontSize={codeDraft} />}
      />
    </section>
  );
}

function SettingsRows(props: { entries: Array<SettingsEntry> }) {
  return (
    <Card className="overflow-hidden rounded-lg border-border/80 bg-card shadow-none">
      <CardContent className="p-0">
        {props.entries.map((entry) => (
          <article key={entry.title} className="grid min-h-[64px] grid-cols-[minmax(0,1fr)_auto] items-center gap-6 border-b border-border/70 px-4 py-3 last:border-b-0">
            <div className="min-w-0">
              <strong className="block text-sm font-semibold leading-6 text-foreground">{entry.title}</strong>
              <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{entry.description}</p>
            </div>
            <div className="flex min-w-40 items-center justify-end gap-2">{entry.action}</div>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}

function SettingsGroup(props: { title: string; entries: Array<SettingsEntry>; wide?: boolean }) {
  return (
    <section className={cn("flex flex-col gap-2.5", props.wide ? "w-full" : undefined)}>
      <div className="px-1 text-sm font-medium text-muted-foreground">{props.title}</div>
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
  const remoteText = useMemo(() => remoteRepoText(props.generalSettings.language), [props.generalSettings.language]);
  const lastPairCodeTtlModeRef = useRef<Exclude<ControlServerSettingsDraft["pairCodeTtlMode"], "none">>("24h");
  const normalizeSection = (section?: InitialSettingsSectionId): SettingsSectionId => {
    if (section === "modules") return "general";
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
        },
        {
          title: text.maxToolIterations,
          description: text.maxToolIterationsDesc,
          action: (
            <Input
              className="h-8 w-24 rounded-md bg-muted/30 text-sm"
              type="number"
              min={0}
              value={String(props.generalSettings.maxToolIterations)}
              onChange={(e) => {
                const next = Math.max(0, Math.floor(Number(e.target.value || "0")) || 0);
                updateGeneral({ maxToolIterations: next });
              }}
            />
          )
        },
        {
          title: text.closeBehavior,
          description: text.closeBehaviorDesc,
          action: (
            <Select
              value={props.generalSettings.closeBehavior}
              onValueChange={(value) => {
                if (value === "tray" || value === "quit" || value === "ask") {
                  updateGeneral({ closeBehavior: value });
                }
              }}
            >
              <SelectTrigger className="h-8 w-52 rounded-md bg-muted/30 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="tray">{text.closeBehaviorTray}</SelectItem>
                  <SelectItem value="quit">{text.closeBehaviorQuit}</SelectItem>
                  <SelectItem value="ask">{text.closeBehaviorAsk}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          )
        }
      ],
      appearance: [
        {
          title: text.theme,
          description: text.themeDesc,
          action: (
            <ThemePicker
              value={props.theme}
              lightLabel={text.light}
              darkLabel={text.dark}
              onSelect={(value) => { if (value !== props.theme) props.onToggleTheme(); }}
            />
          )
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
              className="h-8 w-24 rounded-md bg-muted/30 text-sm"
              type="number"
              min={1}
              max={65535}
              value={String(props.controlSettings.port)}
              disabled={!props.controlInstalled}
              onChange={(e) => props.onControlSettingsChange({ ...props.controlSettings, port: Number(e.target.value || "0") })}
            />
          )
        },
        ...(props.controlListeningPort && props.controlListeningPort > 0
          ? [{
              title: text.listeningPort,
              description: props.controlPortRemapped
                ? text.listeningPortRemapped
                : text.listeningPortDesc,
              action: (
                <Input
                  className="h-8 w-24 rounded-md bg-muted/30 text-sm"
                  type="number"
                  value={String(props.controlListeningPort)}
                  disabled
                  readOnly
                />
              )
            } satisfies SettingsEntry]
          : []),
        {
          title: text.publicUrl,
          description: text.publicUrlDesc,
          action: (
            <Input
              className="h-8 w-72 rounded-md bg-muted/30 text-sm"
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
              <SelectTrigger className="h-8 w-56 rounded-md bg-muted/30 text-sm">
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
              <SelectTrigger className="h-8 w-56 rounded-md bg-muted/30 text-sm">
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
          title: text.agentApi,
          description: "Agent 已在桌面进程内运行（pi SDK），无需单独服务端口。",
          action: (
            <Input
              className="h-8 w-24 rounded-md bg-muted/30 text-sm"
              type="number"
              min={1}
              max={65535}
              value={String(props.agentPort)}
              disabled
              title="pi 嵌入式运行时无需端口"
              onChange={(e) => props.onAgentPortChange(Number(e.target.value || "0"))}
              onBlur={props.onSaveAgentApi}
            />
          )
        }
      ],
      remoteRepos: [],
      models: [],
      skillsmp: [
        {
          title: text.apiKey,
          description: props.skillsmpApiKey ? text.apiKeyConfigured : text.apiKeyDesc,
          action: (
            <div className="flex items-center justify-end gap-2">
              <Input
                className="h-8 w-64 rounded-md bg-muted/30 text-sm"
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
    const updateBusy =
      props.appUpdateState.status === "checking" ||
      props.appUpdateState.status === "downloading";
    const updateNotes =
      props.appUpdateState.status === "available" ||
      props.appUpdateState.status === "downloading" ||
      props.appUpdateState.status === "ready"
        ? props.appUpdateState.notes
        : "";
    const updateTargetVersion =
      props.appUpdateState.status === "available" ||
      props.appUpdateState.status === "downloading" ||
      props.appUpdateState.status === "ready"
        ? props.appUpdateState.version
        : "";
    const updateStatusLabel = (() => {
      const state = props.appUpdateState;
      switch (state.status) {
        case "checking":
          return text.checking;
        case "upToDate":
          return text.upToDate;
        case "available":
          return `${text.updateAvailable} ${state.version}`;
        case "downloading":
          return `${text.downloading} ${state.progress}%`;
        case "ready":
          return text.restartToUpdate;
        case "unsupported":
          return text.updateUnsupported;
        case "error":
          return state.message;
        default:
          return "";
      }
    })();
    const updateEntries: Array<SettingsEntry> = [
      {
        title: text.currentVersion,
        description: text.currentVersionDesc,
        action: <span className="font-mono text-[13px] text-muted-foreground">{props.appVersion || "—"}</span>
      },
      {
        title: text.startupCheck,
        description: text.startupCheckDesc,
        action: (
          <SwitchControl
            checked={props.generalSettings.updatesStartup}
            onChange={(checked) => updateGeneral({ updatesStartup: checked })}
          />
        )
      },
      {
        title: text.autoInstall,
        description: text.autoInstallDesc,
        action: (
          <SwitchControl
            checked={props.generalSettings.updatesAutoInstall}
            onChange={(checked) => updateGeneral({ updatesAutoInstall: checked })}
          />
        )
      },
      {
        title: text.checkNow,
        description: updateStatusLabel || text.checkNowDesc,
        action: (
          <div className="flex items-center gap-2">
            {props.appUpdateState.status === "available" || props.appUpdateState.status === "ready" ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={updateBusy}
                onClick={props.onInstallAppUpdate}
              >
                {props.appUpdateState.status === "ready" ? text.restartToUpdate : text.installUpdate}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={updateBusy || props.appUpdateState.status === "unsupported"}
              onClick={props.onCheckAppUpdate}
            >
              {props.appUpdateState.status === "checking" ? text.checking : text.check}
            </Button>
          </div>
        )
      },
      ...(props.appVersion && props.appVersion !== "web"
        ? [{
            title: text.reviewWhatsNew,
            description: text.reviewWhatsNewDesc,
            action: (
              <WhatsNewReviewButton
                label={text.review}
                loadingLabel={text.whatsNewLoadingLabel}
                onReopen={props.onReopenUpdateCelebration}
              />
            )
          }]
        : [])
    ];
    const updatesContent = (
      <div className="flex flex-col gap-6">
        <SettingsGroup title={text.updates} entries={updateEntries} />
        {updateTargetVersion ? (
          <div
            className="overflow-hidden rounded-xl border border-[color-mix(in_srgb,#8f8270_16%,var(--border))]"
            style={{
              background: "linear-gradient(180deg, color-mix(in srgb, #8f8270 8%, var(--bg)) 0%, var(--bg) 100%)"
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color-mix(in_srgb,#8f8270_12%,var(--border))] px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[color-mix(in_srgb,#8f8270_78%,var(--muted-foreground))]">
                {text.updateNotes}
              </div>
              <div className="font-mono text-[12px] tracking-tight text-muted-foreground">
                <span className="text-foreground/65">{props.appVersion || "—"}</span>
                <span className="mx-1.5 text-[color-mix(in_srgb,#8f8270_55%,transparent)]">→</span>
                <span className="font-medium text-foreground">{updateTargetVersion}</span>
              </div>
            </div>
            <div className="max-h-[220px] overflow-auto whitespace-pre-wrap px-4 py-3 text-[13.5px] leading-7 text-foreground/88">
              {updateNotes.trim() || text.updateNotesEmpty}
            </div>
          </div>
        ) : null}
      </div>
    );
    const desktopEntries = [...entriesBySection.general.slice(0, 2), ...entriesBySection.appearance];
    const openCodeEntries = entriesBySection.general.slice(2);

    const pluginDeps = [props.runtimeStatus.git, props.runtimeStatus.entire, props.runtimeStatus.giteam]
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
            <section className="flex flex-col gap-2.5">
              <div className="px-1 text-sm font-medium text-muted-foreground">{text.navigator}</div>
              <Card className="overflow-hidden rounded-lg border-border/80 bg-card shadow-none">
                <CardContent className="flex flex-col gap-4 p-4">
                  <NavigatorPreview
                    side={props.generalSettings.navigatorSide}
                    scope={props.generalSettings.navigatorScope}
                    caption={text.navigatorPreviewCaption}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block text-sm font-semibold leading-6 text-foreground">{text.navigatorPosition}</strong>
                      <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{text.navigatorPositionDesc}</p>
                    </div>
                    <SegmentedControl
                      group="nav-side"
                      value={props.generalSettings.navigatorSide}
                      onChange={(v) => updateGeneral({ navigatorSide: v })}
                      options={[
                        { value: "left", label: text.navigatorPosLeft, icon: <PanelLeftIcon className="size-3.5" /> },
                        { value: "right", label: text.navigatorPosRight, icon: <PanelLeftIcon className="size-3.5" style={{ transform: "scaleX(-1)" }} /> }
                      ]}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block text-sm font-semibold leading-6 text-foreground">{text.navigatorScope}</strong>
                      <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{text.navigatorScopeDesc}</p>
                    </div>
                    <SegmentedControl
                      group="nav-scope"
                      value={props.generalSettings.navigatorScope}
                      onChange={(v) => updateGeneral({ navigatorScope: v })}
                      options={[
                        { value: "sent", label: text.navigatorScopeSent },
                        { value: "all", label: text.navigatorScopeAll }
                      ]}
                    />
                  </div>
                </CardContent>
              </Card>
            </section>
            <FontSizeSection
              text={text}
              uiZoom={props.uiZoom}
              codeFontSize={props.codeFontSize}
              onUiZoomChange={props.onUiZoomChange}
              onCodeFontSizeChange={props.onCodeFontSizeChange}
            />
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
                  <strong className="block text-sm font-semibold leading-6 text-foreground">{text.dependencies}</strong>
                  <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">统一检查和安装必要插件。</p>
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
                        <strong className="text-sm font-semibold text-foreground">{dep.name}</strong>
                        <Badge variant={dep.installed ? "success" : "secondary"}>
                          {props.checkingDeps[depName] ? text.checking : dep.installed ? text.installed : text.missing}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
                        {props.checkingDeps[depName]
                          ? text.checking
                          : dep.installed
                            ? dep.version || text.installed
                            : dep.installHint || text.missing}
                      </p>
                      {dep.path ? <p className="mt-1 truncate font-mono text-[13px] text-muted-foreground">{dep.path}</p> : null}
                      {depJob ? (
                        <p className="mt-1 text-[13px] text-muted-foreground">{getRuntimeJobLine(depJob, props.installingElapsed)}</p>
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
          <ServiceSettingsPanel
            controlSettings={props.controlSettings}
            controlBusy={props.controlBusy}
            controlConnectionUrl={props.controlConnectionUrl}
            controlPairCode={props.controlPairCode}
            controlPairQrUrl={props.controlPairQrUrl}
            onCopyControlUrl={props.onCopyControlUrl}
            onRefreshControlPairCode={props.onRefreshControlPairCode}
            connectionAddress={text.connectionAddress}
            authCode={text.authCode}
            copyUrl={text.copyUrl}
            refreshCode={text.refreshCode}
            noAuth={text.noAuth}
            qrWaiting={text.qrWaiting}
            qrDisabled={text.qrDisabled}
            mobileControlEntries={
              !props.controlInstalled ? (
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
              )
            }
          />
        )
      },
      ...(REMOTE_REPO_MODULE_ENABLED
        ? [{
          id: "remoteRepos" as const,
          kicker: remoteText.kicker,
        title: remoteText.title,
        description: remoteText.description,
        content: (
          <Card className="overflow-hidden rounded-lg border-border/80 bg-card shadow-none">
            <CardContent className="p-0">
              <div className="border-b border-border/70 bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] px-4 py-3">
                <strong className="text-sm font-semibold text-foreground">{remoteText.serviceUrl}</strong>
                <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{remoteText.serviceUrlDesc}</p>
              </div>
              <div className="space-y-3 p-4">
                <Input
                  className="h-10 w-full rounded-md bg-muted/30 font-mono text-[13px]"
                  aria-label={remoteText.serviceUrl}
                  placeholder="https://giteam.example.com/remote-repo-service"
                  value={props.remoteRepoServiceDraft}
                  disabled={props.remoteRepoServiceBusy}
                  onChange={(event) => props.onRemoteRepoServiceDraftChange(event.target.value)}
                />
                <div className="space-y-1.5">
                  <div>
                    <strong className="text-sm font-semibold text-foreground">{remoteText.serviceApiKey}</strong>
                    <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{remoteText.serviceApiKeyDesc}</p>
                  </div>
                  <Input
                    className="h-10 w-full rounded-md bg-muted/30 font-mono text-[13px]"
                    aria-label={remoteText.serviceApiKey}
                    placeholder="gteam-server-api-key"
                    type="password"
                    value={props.remoteRepoServiceApiKeyDraft}
                    disabled={props.remoteRepoServiceBusy}
                    onChange={(event) => props.onRemoteRepoServiceApiKeyDraftChange(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" disabled={props.remoteRepoServiceBusy} onClick={props.onTestRemoteRepoService}>
                    {props.remoteRepoServiceBusy ? text.checking : remoteText.test}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={props.remoteRepoServiceBusy} onClick={props.onSaveRemoteRepoService}>
                    {props.remoteRepoServiceBusy ? text.saving : remoteText.save}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={props.remoteRepoServiceBusy || !props.remoteRepoServiceDraft} onClick={props.onResetRemoteRepoService}>
                    {remoteText.reset}
                  </Button>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/25 px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{remoteText.effective}</p>
                  <p className="mt-1 truncate font-mono text-[12px] text-foreground" title={props.remoteRepoServiceUrl}>{props.remoteRepoServiceUrl || "—"}</p>
                </div>
                {props.remoteRepoServiceNotice ? <p className="text-[13px] leading-5 text-muted-foreground">{props.remoteRepoServiceNotice}</p> : null}
              </div>
            </CardContent>
          </Card>
        )
          }]
        : []),
      {
        id: "skillsmp" as const,
        kicker: text.skillsKicker,
        title: text.skills,
        description: text.skillsDesc,
        entries: entriesBySection.skillsmp,
        content: props.skillsContent
      },
      {
        id: "updates" as const,
        kicker: text.updatesKicker,
        title: text.updates,
        description: text.updatesDesc,
        content: updatesContent
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
            <span className="text-[16px] leading-4" aria-hidden="true">←</span>
            <span className="text-sm leading-5 font-medium">返回应用</span>
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
                    "h-8 w-full justify-start gap-2.5 rounded-lg px-3 font-normal text-sidebar-foreground/76 transition-[background-color,color,box-shadow] hover:bg-[color-mix(in_srgb,#8f8270_10%,transparent)] hover:text-sidebar-foreground [&_svg]:size-4",
                    activeSection === section.id && "bg-[color-mix(in_srgb,#8f8270_16%,var(--bg)_84%)] text-sidebar-foreground shadow-none hover:bg-[color-mix(in_srgb,#8f8270_18%,var(--bg)_82%)]"
                  )}
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon className="shrink-0" />
                  <span className="truncate text-sm leading-5 font-medium">{section.title}</span>
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
              "mx-auto flex w-full flex-col gap-6 px-[clamp(24px,3vw,32px)] py-[clamp(28px,5vh,44px)]",
              active.id === "models" || active.id === "skillsmp" || active.id === "mobile"
                ? "max-w-[1120px]"
                : "max-w-[680px]"
            )}
          >
            <header className="flex items-center justify-between gap-4">
              <div>
                <h2 id="settings-title" className="text-xl font-semibold tracking-[-0.02em] text-foreground">{active.title}</h2>
                {active.description ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{active.description}</p> : null}
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
                ) : null}
              </div>
            </header>
            <div className="flex flex-col gap-6">
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
