import React, { useMemo } from 'react';
import { ConnectionDrawer, SessionListDrawer } from '../../components/chat/AppDrawerPanels';
import type { DrawerSessionRow, ProjectTreeNode } from './useLeftDrawerController';

export function useNotebookDrawerRenderers(params: {
  currentWorkspaceName: string;
  sessionSearch: string;
  projectTrees: ProjectTreeNode[];
  searchSessionRows: DrawerSessionRow[];
  isSessionListEmpty: boolean;
  serverUrl: string;
  token: string;
  settingsTab: 'general' | 'models';
  onPressProject: (worktree: string, hasSessions: boolean) => void;
  onNewSession: () => void;
  onChangeSessionSearch: (value: string) => void;
  onSelectSession: (sessionId: string, worktree: string, active: boolean) => void;
  onArchiveSession?: (sessionId: string, worktree: string) => void;
  onShowMoreSessions: (worktree: string) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onOpenDrawerFromSettings?: () => void;
  onResetAuth: () => void;
  autoAcceptPermissions: boolean;
  onToggleAutoAccept: () => void;
  onModelsChanged: () => void;
}) {
  const {
    autoAcceptPermissions,
    currentWorkspaceName,
    isSessionListEmpty,
    onChangeSessionSearch,
    onCloseSettings,
    onModelsChanged,
    onNewSession,
    onOpenDrawerFromSettings,
    onOpenSettings,
    onResetAuth,
    onToggleAutoAccept,
    onPressProject,
    onSelectSession,
    onArchiveSession,
    onShowMoreSessions,
    projectTrees,
    searchSessionRows,
    serverUrl,
    sessionSearch,
    settingsTab,
    token
  } = params;

  const leftDrawer = useMemo(
    () => (
      <SessionListDrawer
        sessionSearch={sessionSearch}
        projectTrees={projectTrees}
        searchSessionRows={searchSessionRows}
        isEmpty={isSessionListEmpty}
        currentWorkspaceName={currentWorkspaceName}
        onPressProject={onPressProject}
        onNewSession={onNewSession}
        onChangeSessionSearch={onChangeSessionSearch}
        onSelectSession={onSelectSession}
        onArchiveSession={onArchiveSession}
        onShowMore={onShowMoreSessions}
        onOpenSettings={onOpenSettings}
      />
    ),
    [
      currentWorkspaceName,
      isSessionListEmpty,
      onArchiveSession,
      onChangeSessionSearch,
      onNewSession,
      onOpenSettings,
      onPressProject,
      onSelectSession,
      onShowMoreSessions,
      projectTrees,
      searchSessionRows,
      sessionSearch
    ]
  );

  const rightDrawer = useMemo(
    () => (
      <ConnectionDrawer
        currentWorkspaceName={currentWorkspaceName}
        serverUrl={serverUrl}
        token={token}
        settingsTab={settingsTab}
        onClose={onCloseSettings}
        onOpenDrawer={onOpenDrawerFromSettings}
        onResetAuth={onResetAuth}
        autoAcceptPermissions={autoAcceptPermissions}
        onToggleAutoAccept={onToggleAutoAccept}
        onModelsChanged={onModelsChanged}
      />
    ),
    [
      autoAcceptPermissions,
      currentWorkspaceName,
      onCloseSettings,
      onModelsChanged,
      onOpenDrawerFromSettings,
      onResetAuth,
      onToggleAutoAccept,
      serverUrl,
      settingsTab,
      token
    ]
  );

  return { leftDrawer, rightDrawer };
}
