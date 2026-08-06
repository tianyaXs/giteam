import { useEffect, useState } from "react";
import type { RightPaneTab } from "../components/common/AppChromeIcons";
import { loadLocalJson, saveLocalJson } from "./localPreferences";
import { MCP_MODULE_ENABLED, REMOTE_REPO_MODULE_ENABLED } from "./featureFlags";

const RIGHT_MODULE_VISIBILITY_KEY = "giteam.right-modules.visibility.v1";
// 右侧面板可选 tab。mcp / remoteRepos 受各自功能开关控制：开关为 false 时
// 该 tab 既不出现在列表里，也在下方 visibility 里被强制 false 覆盖 localStorage 缓存。
const RIGHT_PANE_TABS: RightPaneTab[] = ([
  "changes",
  "worktree",
  "terminal",
  "remoteRepos",
  "skills",
  "mcp",
  "browser",
] as RightPaneTab[]).filter((tab) =>
  tab === "mcp" ? MCP_MODULE_ENABLED
    : tab === "remoteRepos" ? REMOTE_REPO_MODULE_ENABLED
      : true
);

const DEFAULT_RIGHT_MODULE_VISIBILITY: Record<RightPaneTab, boolean> = {
  changes: true,
  worktree: true,
  terminal: true,
  remoteRepos: true,
  skills: true,
  mcp: true,
  browser: true
};

export function useRightModuleVisibility(
  activeTab: RightPaneTab,
  setActiveTab: (tab: RightPaneTab) => void
) {
  const [visibility, setVisibility] = useState<Record<RightPaneTab, boolean>>(() => {
    const stored = loadLocalJson<Partial<Record<RightPaneTab, boolean>>>(
      RIGHT_MODULE_VISIBILITY_KEY,
      DEFAULT_RIGHT_MODULE_VISIBILITY
    );
    // MCP 模块下线时强制 mcp:false，覆盖 localStorage 里可能缓存的 mcp:true，
    // 使侧边栏 NavItem 与右侧面板 tab bar 都不再出现 mcp。
    return {
      ...DEFAULT_RIGHT_MODULE_VISIBILITY,
      ...stored,
      ...(MCP_MODULE_ENABLED ? {} : { mcp: false }),
      ...(REMOTE_REPO_MODULE_ENABLED ? {} : { remoteRepos: false })
    };
  });

  useEffect(() => {
    saveLocalJson(RIGHT_MODULE_VISIBILITY_KEY, visibility);
    if (visibility[activeTab]) return;
    const next = RIGHT_PANE_TABS.find((tab) => visibility[tab]);
    if (next) setActiveTab(next);
  }, [activeTab, setActiveTab, visibility]);

  const toggleVisibility = (tab: RightPaneTab) => {
    setVisibility((prev) => {
      const enabledCount = Object.values(prev).filter(Boolean).length;
      if (prev[tab] && enabledCount <= 1) return prev;
      return { ...prev, [tab]: !prev[tab] };
    });
  };

  return {
    rightModuleVisibility: visibility,
    setRightModuleVisibility: setVisibility,
    toggleRightModuleVisibility: toggleVisibility
  };
}
