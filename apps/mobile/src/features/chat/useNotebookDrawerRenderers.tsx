import React, { useMemo } from 'react';
import { Animated } from 'react-native';
import { LeftDrawerPanel, RightDrawerPanel } from '../../components/chat/NotebookDrawers';

type ProjectOption = {
  worktree: string;
  name: string;
};

type SessionRow = {
  id: string;
  title: string;
  preview: string;
  timeLabel: string;
  active: boolean;
};

type QuickSkillRef = {
  key: string;
  name: string;
  subtitle: string;
  itemCount: number;
};

type QuickMcpRef = {
  key: string;
  name: string;
  subtitle: string;
  state: string;
};

type NotebookColors = {
  left: string;
  right: string;
  paper: string;
  text: string;
  muted: string;
  faint: string;
  line: string;
  ink: string;
};

export function useNotebookDrawerRenderers(params: {
  styles: Record<string, any>;
  notebookColors: NotebookColors;
  leftDrawerPulse: Animated.Value;
  rightDrawerPulse: Animated.Value;
  currentWorkspaceName: string;
  workspaceSwitcherOpen: boolean;
  availableProjects: ProjectOption[];
  repoPath: string;
  sessionSearch: string;
  leftDrawerSessionRows: SessionRow[];
  showMoreSessions: boolean;
  isSessionListEmpty: boolean;
  serverUrl: string;
  token: string;
  noAuthToken: string;
  pairCode: string;
  extensionsLoading: boolean;
  visibleQuickSkillRefs: QuickSkillRef[];
  visibleQuickMcpRefs: QuickMcpRef[];
  onToggleWorkspaceSwitcher: () => void;
  onNewSession: () => void;
  onSelectProject: (worktree: string, active: boolean) => void;
  onChangeSessionSearch: (value: string) => void;
  onSelectSession: (sessionId: string, active: boolean) => void;
  onShowMoreSessions: () => void;
  onInsertQuickReference: (value: string) => void;
  onResetAuth: () => void;
}) {
  const {
    availableProjects,
    currentWorkspaceName,
    extensionsLoading,
    isSessionListEmpty,
    leftDrawerPulse,
    leftDrawerSessionRows,
    noAuthToken,
    notebookColors,
    onChangeSessionSearch,
    onInsertQuickReference,
    onNewSession,
    onResetAuth,
    onSelectProject,
    onSelectSession,
    onShowMoreSessions,
    onToggleWorkspaceSwitcher,
    pairCode,
    repoPath,
    rightDrawerPulse,
    serverUrl,
    sessionSearch,
    showMoreSessions,
    styles,
    token,
    visibleQuickMcpRefs,
    visibleQuickSkillRefs,
    workspaceSwitcherOpen
  } = params;

  const leftDrawer = useMemo(() => (
    <LeftDrawerPanel
      styles={styles}
      colors={notebookColors}
      pulse={leftDrawerPulse}
      currentWorkspaceName={currentWorkspaceName}
      workspaceSwitcherOpen={workspaceSwitcherOpen}
      availableProjects={availableProjects}
      repoPath={repoPath}
      sessionSearch={sessionSearch}
      sessionRows={leftDrawerSessionRows}
      showMoreButton={showMoreSessions}
      isEmpty={isSessionListEmpty}
      onToggleWorkspaceSwitcher={onToggleWorkspaceSwitcher}
      onNewSession={onNewSession}
      onSelectProject={onSelectProject}
      onChangeSessionSearch={onChangeSessionSearch}
      onSelectSession={onSelectSession}
      onShowMore={onShowMoreSessions}
    />
  ), [
    availableProjects,
    currentWorkspaceName,
    isSessionListEmpty,
    leftDrawerPulse,
    leftDrawerSessionRows,
    notebookColors,
    onChangeSessionSearch,
    onNewSession,
    onSelectProject,
    onSelectSession,
    onShowMoreSessions,
    onToggleWorkspaceSwitcher,
    repoPath,
    sessionSearch,
    showMoreSessions,
    styles,
    workspaceSwitcherOpen
  ]);

  const rightDrawer = useMemo(() => (
    <RightDrawerPanel
      styles={styles}
      colors={notebookColors}
      pulse={rightDrawerPulse}
      currentWorkspaceName={currentWorkspaceName}
      serverUrl={serverUrl}
      repoPath={repoPath}
      token={token}
      noAuthToken={noAuthToken}
      pairCode={pairCode}
      extensionsLoading={extensionsLoading}
      visibleQuickSkillRefs={visibleQuickSkillRefs}
      visibleQuickMcpRefs={visibleQuickMcpRefs}
      onInsertQuickReference={onInsertQuickReference}
      onResetAuth={onResetAuth}
    />
  ), [
    currentWorkspaceName,
    extensionsLoading,
    noAuthToken,
    notebookColors,
    onInsertQuickReference,
    onResetAuth,
    pairCode,
    repoPath,
    rightDrawerPulse,
    serverUrl,
    styles,
    token,
    visibleQuickMcpRefs,
    visibleQuickSkillRefs
  ]);

  return {
    leftDrawer,
    rightDrawer
  };
}
