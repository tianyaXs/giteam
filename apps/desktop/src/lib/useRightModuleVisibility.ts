import { useEffect, useState } from "react";
import type { RightPaneTab } from "../components/common/AppChromeIcons";
import { loadLocalJson, saveLocalJson } from "./localPreferences";

const RIGHT_MODULE_VISIBILITY_KEY = "giteam.right-modules.visibility.v1";
const RIGHT_PANE_TABS: RightPaneTab[] = ["changes", "worktree", "terminal", "skills", "mcp"];

const DEFAULT_RIGHT_MODULE_VISIBILITY: Record<RightPaneTab, boolean> = {
  changes: true,
  worktree: true,
  terminal: true,
  skills: true,
  mcp: true
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
    return { ...DEFAULT_RIGHT_MODULE_VISIBILITY, ...stored };
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
