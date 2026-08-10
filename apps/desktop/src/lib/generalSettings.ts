import type { GeneralSettingsDraft } from "../components/settings/SettingsDialog";
import { loadLocalBool, saveLocalBool } from "./localPreferences";
import { invoke } from "./platform";

export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsDraft = {
  language: "system",
  autoAcceptPermissions: false,
  showReasoningSummaries: false,
  shellToolPartsExpanded: false,
  editToolPartsExpanded: false,
  showSessionProgressBar: true,
  notificationsAgent: true,
  notificationsPermissions: true,
  notificationsErrors: false,
  soundsAgent: true,
  soundsPermissions: true,
  soundsErrors: true,
  updatesStartup: true,
  updatesAutoInstall: false,
  maxToolIterations: 0,
  closeBehavior: "tray",
  navigatorSide: "right",
  navigatorScope: "all"
};

export type AppLocale = "zh-CN" | "zh-TW" | "en-US";

const APP_TEXT: Record<AppLocale, {
  close: string;
  closeProject: string;
  archiveSession: string;
  newSession: string;
  importProject: string;
  pinnedProjects: string;
  projects: string;
  openWorkspace: string;
  loadMore: string;
  pinProject: string;
  unpinProject: string;
  projectTaskCount: string;
  settings: string;
  noProjectsHint: string;
  agentRequired: string;
  collapseSidebar: string;
  expandSidebar: string;
  collapseRightSidebar: string;
  expandRightSidebar: string;
  changes: string;
  worktree: string;
  terminal: string;
  skills: string;
  plugins: string;
  automation: string;
  search: string;
  searchPlaceholder: string;
  searchScopeCurrentSession: string;
  searchScopeCurrentRepo: string;
  searchScopeAll: string;
  searchNoResults: string;
  searchLoading: string;
  searchEmptyHint: string;
  closeFileView: string;
  removeWorktree: string;
  removeWorktreeTitle: string;
  removeWorktreeDesc: string;
  removing: string;
  confirmRemove: string;
  cancel: string;
  createWorktreeFromCommit: string;
  createBranchFromCommit: string;
  explainInspectCommit: string;
  cherryPickCurrentBranch: string;
  revertCurrentBranch: string;
  copyCommitId: string;
  createBranch: string;
  createWorktree: string;
  checkoutNewLocalBranch: string;
  checkout: string;
  deleteBranch: string;
  createBranchFromWorktree: string;
  openWorktree: string;
  bindAgent: string;
  unbindAgent: string;
  commit: string;
  push: string;
  commitPush: string;
  commitSync: string;
  timeNow: string;
  timeMinutes: string;
  timeHours: string;
  timeDays: string;
  timeWeeks: string;
  timeMonths: string;
  timeYears: string;
  model: string;
  configureModels: string;
  configureModelsAction: string;
  configure: string;
  emptyComposerHeadline: string;
  sessionNavigator: string;
  navigatorRoleYou: string;
  navigatorRoleAssistant: string;
  navigatorRoleSystem: string;
  navigatorDragHint: string;
}> = {
  "zh-CN": {
    close: "关闭", closeProject: "关闭项目", archiveSession: "归档会话", newSession: "新对话", importProject: "导入项目", pinnedProjects: "置顶项目", projects: "项目", openWorkspace: "打开工作区", loadMore: "加载更多", pinProject: "置顶项目", unpinProject: "取消置顶", projectTaskCount: "{count} 个任务", settings: "设置", noProjectsHint: "还没有项目，先导入一个本地工作区。", agentRequired: "导入项目后即可使用会话。", collapseSidebar: "收起左侧栏", expandSidebar: "展开左侧栏", collapseRightSidebar: "收起右侧栏", expandRightSidebar: "展开右侧栏", changes: "审查", worktree: "工作树", terminal: "终端", skills: "技能", plugins: "插件", automation: "自动化", search: "搜索", searchPlaceholder: "搜索消息…", searchScopeCurrentSession: "当前会话", searchScopeCurrentRepo: "当前仓库", searchScopeAll: "所有仓库", searchNoResults: "没有找到相关消息", searchLoading: "正在搜索…", searchEmptyHint: "输入关键词以搜索消息，支持当前会话或跨会话检索", closeFileView: "关闭文件视图", removeWorktree: "移除 worktree", removeWorktreeTitle: "移除 worktree？", removeWorktreeDesc: "这会删除 worktree 目录并清理 Git worktree 记录，目录内文件会被删除。", removing: "移除中...", confirmRemove: "确认移除", cancel: "取消",
    createWorktreeFromCommit: "从提交创建 worktree", createBranchFromCommit: "从提交创建分支", explainInspectCommit: "解释 / 检查提交", cherryPickCurrentBranch: "Cherry-pick 到当前分支", revertCurrentBranch: "在当前分支 Revert", copyCommitId: "复制提交 ID",
    createBranch: "创建分支", createWorktree: "创建 worktree", checkoutNewLocalBranch: "检出为本地新分支", checkout: "检出", deleteBranch: "删除分支", createBranchFromWorktree: "从 worktree 创建分支", openWorktree: "打开 worktree", bindAgent: "绑定 Agent", unbindAgent: "解绑 Agent",
    commit: "提交", push: "推送", commitPush: "提交并推送", commitSync: "提交并同步",
    timeNow: "刚刚", timeMinutes: "分钟", timeHours: "小时", timeDays: "天", timeWeeks: "周", timeMonths: "个月", timeYears: "年",
    model: "模型", configureModels: "配置模型", configureModelsAction: "去配置", configure: "配置",
    emptyComposerHeadline: "要在 {name} 里做什么？",
    sessionNavigator: "会话导航", navigatorRoleYou: "你", navigatorRoleAssistant: "AI", navigatorRoleSystem: "系统", navigatorDragHint: "按住拖动快速滚动，点击跳转"
  },
  "zh-TW": {
    close: "关闭", closeProject: "关闭项目", archiveSession: "归档会话", newSession: "新对话", importProject: "导入项目", pinnedProjects: "置顶项目", projects: "项目", openWorkspace: "打开工作区", loadMore: "加载更多", pinProject: "置顶项目", unpinProject: "取消置顶", projectTaskCount: "{count} 個任務", settings: "设置", noProjectsHint: "还没有项目，先导入一个本地工作区。", agentRequired: "导入项目后即可使用会话。", collapseSidebar: "收起左侧栏", expandSidebar: "展开左侧栏", collapseRightSidebar: "收起右侧栏", expandRightSidebar: "展开右侧栏", changes: "审查", worktree: "工作树", terminal: "终端", skills: "技能", plugins: "插件", automation: "自动化", search: "搜索", searchPlaceholder: "搜索消息…", searchScopeCurrentSession: "当前会话", searchScopeCurrentRepo: "当前仓库", searchScopeAll: "所有仓库", searchNoResults: "没有找到相关消息", searchLoading: "正在搜索…", searchEmptyHint: "输入关键词以搜索消息，支持当前会话或跨会话检索", closeFileView: "关闭文件视图", removeWorktree: "移除 worktree", removeWorktreeTitle: "移除 worktree？", removeWorktreeDesc: "这会删除 worktree 目录并清理 Git worktree 记录，目录内文件会被删除。", removing: "移除中...", confirmRemove: "确认移除", cancel: "取消",
    createWorktreeFromCommit: "从提交创建 worktree", createBranchFromCommit: "从提交创建分支", explainInspectCommit: "解释 / 检查提交", cherryPickCurrentBranch: "Cherry-pick 到当前分支", revertCurrentBranch: "在当前分支 Revert", copyCommitId: "复制提交 ID",
    createBranch: "创建分支", createWorktree: "创建 worktree", checkoutNewLocalBranch: "检出为本地新分支", checkout: "检出", deleteBranch: "删除分支", createBranchFromWorktree: "从 worktree 创建分支", openWorktree: "打开 worktree", bindAgent: "绑定 Agent", unbindAgent: "解绑 Agent",
    commit: "提交", push: "推送", commitPush: "提交并推送", commitSync: "提交并同步",
    timeNow: "刚刚", timeMinutes: "分钟", timeHours: "小时", timeDays: "天", timeWeeks: "周", timeMonths: "个月", timeYears: "年",
    model: "模型", configureModels: "配置模型", configureModelsAction: "去配置", configure: "配置",
    emptyComposerHeadline: "準備在 {name} 裡做什麼？",
    sessionNavigator: "會話導航", navigatorRoleYou: "你", navigatorRoleAssistant: "AI", navigatorRoleSystem: "系統", navigatorDragHint: "按住拖動快速滾動，點擊跳轉"
  },
  "en-US": {
    close: "Close", closeProject: "Close Project", archiveSession: "Archive Session", newSession: "New Session", importProject: "Import Project", pinnedProjects: "Pinned", projects: "Projects", openWorkspace: "Open Workspace", loadMore: "Load More", pinProject: "Pin Project", unpinProject: "Unpin Project", projectTaskCount: "{count} tasks", settings: "Settings", noProjectsHint: "No projects yet. Import a local workspace to get started.", agentRequired: "Import a project to use sessions.", collapseSidebar: "Collapse Sidebar", expandSidebar: "Expand Sidebar", collapseRightSidebar: "Collapse Right Panel", expandRightSidebar: "Expand Right Panel", changes: "Changes", worktree: "Worktree", terminal: "Terminal", skills: "Skills", plugins: "Plugins", automation: "Automation", search: "Search", searchPlaceholder: "Search messages…", searchScopeCurrentSession: "Current session", searchScopeCurrentRepo: "Current repo", searchScopeAll: "All repos", searchNoResults: "No matching messages", searchLoading: "Searching…", searchEmptyHint: "Type a keyword to search messages across the current session or history", closeFileView: "Close File View", removeWorktree: "Remove worktree", removeWorktreeTitle: "Remove worktree?", removeWorktreeDesc: "This will remove the worktree directory and clean up the Git worktree entry. Files inside will be deleted.", removing: "Removing...", confirmRemove: "Confirm Remove", cancel: "Cancel",
    createWorktreeFromCommit: "Create worktree from commit", createBranchFromCommit: "Create branch from commit", explainInspectCommit: "Explain / inspect commit", cherryPickCurrentBranch: "Cherry-pick to current branch", revertCurrentBranch: "Revert on current branch", copyCommitId: "Copy commit ID",
    createBranch: "Create Branch", createWorktree: "Create Worktree", checkoutNewLocalBranch: "Checkout as new local branch", checkout: "Checkout", deleteBranch: "Delete Branch", createBranchFromWorktree: "Create Branch from Worktree", openWorktree: "Open Worktree", bindAgent: "Bind Agent", unbindAgent: "Unbind Agent",
    commit: "Commit", push: "Push", commitPush: "Commit & Push", commitSync: "Commit & Sync",
    timeNow: "just now", timeMinutes: "min", timeHours: "h", timeDays: "d", timeWeeks: "w", timeMonths: "mo", timeYears: "y",
    model: "Model", configureModels: "Configure Models", configureModelsAction: "Set up", configure: "Configure",
    emptyComposerHeadline: "What should we build in {name}?",
    sessionNavigator: "Session navigator", navigatorRoleYou: "You", navigatorRoleAssistant: "Assistant", navigatorRoleSystem: "System", navigatorDragHint: "Drag to scrub, click to jump"
  }
};

export type AppText = (typeof APP_TEXT)[AppLocale];

function normalizeAppLocale(value: string): AppLocale {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk")) return "zh-TW";
  if (normalized.startsWith("zh")) return "zh-CN";
  return "en-US";
}

function normalizeStoredLanguage(value: unknown): GeneralSettingsDraft["language"] {
  return value === "system" || value === "zh-CN" || value === "zh-TW" || value === "en-US" ? value : "system";
}

export function getAppText(language: GeneralSettingsDraft["language"]): AppText {
  const locale = language === "system" ? normalizeAppLocale(navigator.language || "zh-CN") : normalizeAppLocale(language);
  return APP_TEXT[locale];
}

export function loadGeneralSettings(
  generalSettingsKey: string,
  autoAcceptPermissionsKey: string
): GeneralSettingsDraft {
  try {
    const raw = window.localStorage.getItem(generalSettingsKey);
    const parsed = raw ? JSON.parse(raw) as Partial<GeneralSettingsDraft> : {};
    return {
      ...DEFAULT_GENERAL_SETTINGS,
      ...parsed,
      language: normalizeStoredLanguage(parsed.language),
      closeBehavior:
        parsed.closeBehavior === "quit" || parsed.closeBehavior === "ask"
          ? parsed.closeBehavior
          : "tray",
      navigatorSide: parsed.navigatorSide === "left" ? "left" : "right",
      navigatorScope: parsed.navigatorScope === "sent" ? "sent" : "all",
      // 数值字段防御归一：手改 localStorage 产生的 NaN/负数/小数组值回退为 0（不限制）。
      maxToolIterations:
        typeof parsed.maxToolIterations === "number" &&
        Number.isFinite(parsed.maxToolIterations) &&
        parsed.maxToolIterations > 0
          ? Math.floor(parsed.maxToolIterations)
          : 0,
      autoAcceptPermissions: loadLocalBool(
        autoAcceptPermissionsKey,
        parsed.autoAcceptPermissions ?? DEFAULT_GENERAL_SETTINGS.autoAcceptPermissions
      )
    };
  } catch {
    return {
      ...DEFAULT_GENERAL_SETTINGS,
      autoAcceptPermissions: loadLocalBool(
        autoAcceptPermissionsKey,
        DEFAULT_GENERAL_SETTINGS.autoAcceptPermissions
      )
    };
  }
}

export function saveGeneralSettings(
  generalSettingsKey: string,
  autoAcceptPermissionsKey: string,
  settings: GeneralSettingsDraft
): void {
  try {
    window.localStorage.setItem(generalSettingsKey, JSON.stringify(settings));
    saveLocalBool(autoAcceptPermissionsKey, settings.autoAcceptPermissions);
  } catch {
    // ignore unavailable storage
  }
}

export function playSettingsTone(kind: "agent" | "permission" | "error"): void {
  try {
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const freq = kind === "error" ? 190 : kind === "permission" ? 520 : 740;
    osc.type = kind === "error" ? "sawtooth" : "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    window.setTimeout(() => void ctx.close().catch(() => { }), 360);
  } catch {
    // ignore unavailable audio
  }
}

export async function showSettingsNotification(title: string, body: string): Promise<void> {
  // 窗口处于前台并聚焦时（用户正盯着应用）不弹系统通知；只有失焦或最小化时才提醒。
  // 一处短路覆盖所有调用点（agent 完成 / 授权 / 错误 / 应用更新）。
  if (typeof document !== "undefined" && document.hasFocus()) return;
  try {
    await invoke("send_desktop_notification", { title, body });
    return;
  } catch {
    // Fall back to browser notifications when native notification is unavailable.
  }
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(title, { body });
      return;
    }
    if (Notification.permission === "default") {
      await Notification.requestPermission().then((permission) => {
        if (permission === "granted") new Notification(title, { body });
      });
    }
  } catch {
    // ignore unavailable notifications
  }
}
