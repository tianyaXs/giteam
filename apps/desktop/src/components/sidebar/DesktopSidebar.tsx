import type { ReactNode } from "react";
import { ChevronRightIcon, EditIcon, FolderIcon, MoreHorizontalIcon, PlusIcon } from "../icons";
import { firstLetter, formatRelativeTime } from "../../lib/textFormatting";
import type { OpencodeChatSession } from "../../lib/opencodeSessions";
import type { GitUserIdentity, RepositoryEntry } from "../../lib/types";
import pinnedIconUrl from "./sidebar-pin.png";

type DesktopSidebarProps = {
  noRepos: boolean;
  busy: boolean;
  opencodeInstalled: boolean;
  repos: RepositoryEntry[];
  pinnedRepoIds: string[];
  expandedProjectIds: string[];
  selectedRepoId: string;
  activeSessionId: string;
  draftRepoId: string;
  gitUserIdentity: GitUserIdentity;
  fallbackIdentityName: string;
  getVisibleRepoSessions: (repoId: string) => OpencodeChatSession[];
  hasMoreRepoSessions: (repoId: string) => boolean;
  isRepoSessionsLoading: (repoId: string) => boolean;
  onImportRepository: () => void | Promise<void>;
  onCreateSession: () => void | Promise<void>;
  onSelectRepo: (repo: RepositoryEntry) => void;
  onToggleRepoSessions: (repo: RepositoryEntry) => void;
  onOpenRepoContextMenu: (x: number, y: number, repo: RepositoryEntry) => void;
  onTogglePinnedRepo: (repoId: string) => void;
  onFocusDraftSession: () => void;
  onOpenSession: (repo: RepositoryEntry, session: OpencodeChatSession) => void;
  onOpenSessionContextMenu: (x: number, y: number, repo: RepositoryEntry, session: OpencodeChatSession) => void;
  onLoadMoreSessions: (repo: RepositoryEntry) => void | Promise<void>;
  onOpenSettings: () => void;
};

export function DesktopSidebar(props: DesktopSidebarProps) {
  const {
    noRepos,
    busy,
    opencodeInstalled,
    repos,
    pinnedRepoIds,
    expandedProjectIds,
    selectedRepoId,
    activeSessionId,
    draftRepoId,
    gitUserIdentity,
    fallbackIdentityName,
    getVisibleRepoSessions,
    hasMoreRepoSessions,
    isRepoSessionsLoading,
    onImportRepository,
    onCreateSession,
    onSelectRepo,
    onToggleRepoSessions,
    onOpenRepoContextMenu,
    onTogglePinnedRepo,
    onFocusDraftSession,
    onOpenSession,
    onOpenSessionContextMenu,
    onLoadMoreSessions,
    onOpenSettings
  } = props;

  const pinnedRepos = repos.filter((repo) => pinnedRepoIds.includes(repo.id));
  const otherRepos = repos.filter((repo) => !pinnedRepoIds.includes(repo.id));

  return (
    <div className="wb-sidebar-inner gt-sidebar-inner">
      <div className="gt-sidebar-top">
        <button
          className="gt-new-session-btn"
          onClick={() => void (noRepos ? onImportRepository() : onCreateSession())}
          disabled={noRepos ? busy : busy || !opencodeInstalled}
        >
          <div className="gt-new-session-main">
            <span className="gt-new-session-icon">{noRepos ? <FolderIcon /> : <EditIcon />}</span>
            <span className="gt-new-session-label">{noRepos ? "导入项目" : "New Session"}</span>
          </div>
          {!noRepos ? <span className="gt-new-session-kbd" aria-hidden="true"><kbd>⌘N</kbd></span> : null}
        </button>
      </div>

      <div className="gt-project-stack">
        {noRepos ? (
          <div className="gt-empty-hint">还没有项目，先通过顶部入口导入一个本地工作区。</div>
        ) : null}

        {pinnedRepos.length > 0 ? (
          <ProjectSection
            title="Pinned"
            repos={pinnedRepos}
            isPinnedSection
            busy={busy}
            opencodeInstalled={opencodeInstalled}
            expandedProjectIds={expandedProjectIds}
            selectedRepoId={selectedRepoId}
            activeSessionId={activeSessionId}
            draftRepoId={draftRepoId}
            getVisibleRepoSessions={getVisibleRepoSessions}
            hasMoreRepoSessions={hasMoreRepoSessions}
            isRepoSessionsLoading={isRepoSessionsLoading}
            onSelectRepo={onSelectRepo}
            onToggleRepoSessions={onToggleRepoSessions}
            onOpenRepoContextMenu={onOpenRepoContextMenu}
            onTogglePinnedRepo={onTogglePinnedRepo}
            onFocusDraftSession={onFocusDraftSession}
            onOpenSession={onOpenSession}
            onOpenSessionContextMenu={onOpenSessionContextMenu}
            onLoadMoreSessions={onLoadMoreSessions}
          />
        ) : null}

        {repos.length > 0 ? (
          <ProjectSection
            title="Projects"
            repos={otherRepos}
            busy={busy}
            opencodeInstalled={opencodeInstalled}
            expandedProjectIds={expandedProjectIds}
            selectedRepoId={selectedRepoId}
            activeSessionId={activeSessionId}
            draftRepoId={draftRepoId}
            getVisibleRepoSessions={getVisibleRepoSessions}
            hasMoreRepoSessions={hasMoreRepoSessions}
            isRepoSessionsLoading={isRepoSessionsLoading}
            onSelectRepo={onSelectRepo}
            onToggleRepoSessions={onToggleRepoSessions}
            onOpenRepoContextMenu={onOpenRepoContextMenu}
            onTogglePinnedRepo={onTogglePinnedRepo}
            onFocusDraftSession={onFocusDraftSession}
            onOpenSession={onOpenSession}
            onOpenSessionContextMenu={onOpenSessionContextMenu}
            onLoadMoreSessions={onLoadMoreSessions}
            headerAction={(
              <button
                className="gt-sidebar-action-btn"
                title="Open Workspace"
                onClick={() => void onImportRepository()}
                disabled={busy}
              >
                <PlusIcon />
              </button>
            )}
          />
        ) : null}
      </div>

      <div className="gt-sidebar-footer">
        <div className="gt-user-row">
          <div className="gt-user-main">
            <span className="gt-user-avatar">{firstLetter(gitUserIdentity.name || gitUserIdentity.email || fallbackIdentityName || "g")}</span>
            <span className="gt-user-meta">
              <strong>{gitUserIdentity.name || "Git User"}</strong>
              <small>{gitUserIdentity.email || "No git email configured"}</small>
            </span>
          </div>
          <button className="gt-user-settings" title="Settings" onClick={onOpenSettings} aria-label="Settings">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Z" fill="none" stroke="currentColor" strokeWidth="1.55" />
              <path d="M19 13.2v-2.4l-1.9-.34a5.7 5.7 0 0 0-.47-1.13l1.1-1.57-1.7-1.7-1.57 1.1c-.36-.2-.74-.36-1.14-.47L13 4.8h-2.4l-.34 1.89c-.4.11-.78.27-1.14.47l-1.57-1.1-1.7 1.7 1.1 1.57c-.2.36-.36.74-.47 1.13L4.6 10.8v2.4l1.88.34c.11.39.27.77.47 1.13l-1.1 1.57 1.7 1.7 1.57-1.1c.36.2.74.36 1.14.47l.34 1.89H13l.33-1.89c.4-.11.78-.27 1.14-.47l1.57 1.1 1.7-1.7-1.1-1.57c.2-.36.36-.74.47-1.13L19 13.2Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function SidebarPinnedIcon() {
  return (
    <span
      className="gt-sidebar-pinned-icon"
      aria-hidden="true"
      style={{
        WebkitMaskImage: `url(${pinnedIconUrl})`,
        maskImage: `url(${pinnedIconUrl})`
      }}
    />
  );
}

type ProjectSectionProps = {
  title: string;
  repos: RepositoryEntry[];
  isPinnedSection?: boolean;
  busy: boolean;
  opencodeInstalled: boolean;
  expandedProjectIds: string[];
  selectedRepoId: string;
  activeSessionId: string;
  draftRepoId: string;
  headerAction?: ReactNode;
  getVisibleRepoSessions: (repoId: string) => OpencodeChatSession[];
  hasMoreRepoSessions: (repoId: string) => boolean;
  isRepoSessionsLoading: (repoId: string) => boolean;
  onSelectRepo: (repo: RepositoryEntry) => void;
  onToggleRepoSessions: (repo: RepositoryEntry) => void;
  onOpenRepoContextMenu: (x: number, y: number, repo: RepositoryEntry) => void;
  onTogglePinnedRepo: (repoId: string) => void;
  onFocusDraftSession: () => void;
  onOpenSession: (repo: RepositoryEntry, session: OpencodeChatSession) => void;
  onOpenSessionContextMenu: (x: number, y: number, repo: RepositoryEntry, session: OpencodeChatSession) => void;
  onLoadMoreSessions: (repo: RepositoryEntry) => void | Promise<void>;
};

function ProjectSection(props: ProjectSectionProps) {
  const {
    title,
    repos,
    isPinnedSection = false,
    busy,
    opencodeInstalled,
    expandedProjectIds,
    selectedRepoId,
    activeSessionId,
    draftRepoId,
    headerAction,
    getVisibleRepoSessions,
    hasMoreRepoSessions,
    isRepoSessionsLoading,
    onSelectRepo,
    onToggleRepoSessions,
    onOpenRepoContextMenu,
    onTogglePinnedRepo,
    onFocusDraftSession,
    onOpenSession,
    onOpenSessionContextMenu,
    onLoadMoreSessions
  } = props;

  return (
    <div className="gt-sidebar-section">
      <div className="gt-sidebar-section-header">
        <span className="gt-sidebar-section-title">{title}</span>
        {headerAction ? <div className="gt-sidebar-actions">{headerAction}</div> : null}
      </div>
      <div className="gt-sidebar-project-list">
        {repos.map((repo) => (
          <ProjectRow
            key={repo.id}
            repo={repo}
            pinned={isPinnedSection}
            busy={busy}
            opencodeInstalled={opencodeInstalled}
            expanded={expandedProjectIds.includes(repo.id)}
            selectedRepoId={selectedRepoId}
            activeSessionId={activeSessionId}
            hasDraftForRepo={draftRepoId === repo.id}
            sessions={getVisibleRepoSessions(repo.id)}
            hasMoreSessions={hasMoreRepoSessions(repo.id)}
            sessionsLoading={isRepoSessionsLoading(repo.id)}
            onSelectRepo={onSelectRepo}
            onToggleRepoSessions={onToggleRepoSessions}
            onOpenRepoContextMenu={onOpenRepoContextMenu}
            onTogglePinnedRepo={onTogglePinnedRepo}
            onFocusDraftSession={onFocusDraftSession}
            onOpenSession={onOpenSession}
            onOpenSessionContextMenu={onOpenSessionContextMenu}
            onLoadMoreSessions={onLoadMoreSessions}
          />
        ))}
      </div>
    </div>
  );
}

type ProjectRowProps = {
  repo: RepositoryEntry;
  pinned: boolean;
  busy: boolean;
  opencodeInstalled: boolean;
  expanded: boolean;
  selectedRepoId: string;
  activeSessionId: string;
  hasDraftForRepo: boolean;
  sessions: OpencodeChatSession[];
  hasMoreSessions: boolean;
  sessionsLoading: boolean;
  onSelectRepo: (repo: RepositoryEntry) => void;
  onToggleRepoSessions: (repo: RepositoryEntry) => void;
  onOpenRepoContextMenu: (x: number, y: number, repo: RepositoryEntry) => void;
  onTogglePinnedRepo: (repoId: string) => void;
  onFocusDraftSession: () => void;
  onOpenSession: (repo: RepositoryEntry, session: OpencodeChatSession) => void;
  onOpenSessionContextMenu: (x: number, y: number, repo: RepositoryEntry, session: OpencodeChatSession) => void;
  onLoadMoreSessions: (repo: RepositoryEntry) => void | Promise<void>;
};

function ProjectRow(props: ProjectRowProps) {
  const {
    repo,
    pinned,
    busy,
    opencodeInstalled,
    expanded,
    selectedRepoId,
    activeSessionId,
    hasDraftForRepo,
    sessions,
    hasMoreSessions,
    sessionsLoading,
    onSelectRepo,
    onToggleRepoSessions,
    onOpenRepoContextMenu,
    onTogglePinnedRepo,
    onFocusDraftSession,
    onOpenSession,
    onOpenSessionContextMenu,
    onLoadMoreSessions
  } = props;

  const shouldRenderChildren = expanded && (sessionsLoading || sessions.length > 0 || hasMoreSessions || hasDraftForRepo || !opencodeInstalled);

  return (
    <div className="gt-sidebar-project-wrap">
      <div
        className="gt-sidebar-project-row"
        title={repo.path}
        onClick={() => {
          if (busy) return;
          onSelectRepo(repo);
          onToggleRepoSessions(repo);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenRepoContextMenu(event.clientX, event.clientY, repo);
        }}
      >
        <span className="gt-sidebar-project-icon">{pinned ? <SidebarPinnedIcon /> : <FolderIcon />}</span>
        <span className="gt-sidebar-project-name">{repo.name}</span>
        <span className={expanded ? "gt-sidebar-project-chevron is-open" : "gt-sidebar-project-chevron"} aria-hidden="true"><ChevronRightIcon width={14} height={14} /></span>
        <button
          className={pinned ? "gt-sidebar-project-pin active" : "gt-sidebar-project-pin"}
          title={pinned ? "取消置顶" : "置顶"}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePinnedRepo(repo.id);
          }}
        >
          <SidebarPinnedIcon />
        </button>
      </div>

      {shouldRenderChildren ? (
        <div className="gt-sidebar-project-children">
          {hasDraftForRepo ? (
            <button className="gt-session-item active gt-session-item-draft" onClick={onFocusDraftSession}>
              <span className="gt-session-title">New Session</span>
            </button>
          ) : null}
          {!opencodeInstalled ? <div className="gt-empty-hint">安装 `opencode` 后可用会话。</div> : null}
          {opencodeInstalled && sessionsLoading && sessions.length === 0 ? (
            <div className="gt-tree-loading" aria-hidden="true">
              <span className="gt-tree-loading-row" />
              <span className="gt-tree-loading-row" />
              <span className="gt-tree-loading-row short" />
            </div>
          ) : null}
          {opencodeInstalled ? sessions.map((session) => (
            <button
              key={`left-session-${session.id}`}
              className={!hasDraftForRepo && repo.id === selectedRepoId && session.id === activeSessionId ? "gt-session-item active" : "gt-session-item"}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenSessionContextMenu(event.clientX, event.clientY, repo, session);
              }}
              onClick={() => onOpenSession(repo, session)}
            >
              <span className="gt-session-title">{session.title}</span>
              {session.updatedAt || session.createdAt ? (
                <span className="gt-session-time">{formatRelativeTime(session.updatedAt || session.createdAt)}</span>
              ) : null}
            </button>
          )) : null}
          {opencodeInstalled && hasMoreSessions ? (
            <button className="gt-load-more-btn" onClick={() => void onLoadMoreSessions(repo)} disabled={sessionsLoading}>
              <span className="gt-load-more-icon" aria-hidden="true"><MoreHorizontalIcon /></span>
              <span>{sessionsLoading ? "Loading..." : "More"}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
