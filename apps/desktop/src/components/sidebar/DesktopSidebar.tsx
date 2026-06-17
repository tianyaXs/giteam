import { memo, useMemo, type ReactNode } from "react";
import {
  Box,
  Folder,
  FolderOpen,
  PencilLine,
  Plus,
  Settings,
} from "lucide-react";

import { firstLetter } from "../../lib/textFormatting";
import type { AppText } from "../../lib/generalSettings";
import type { OpencodeChatSession } from "../../lib/opencodeSessions";
import type { GitUserIdentity, RepositoryEntry } from "../../lib/types";
import { cn } from "../../lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../ui/sidebar";
import { Button } from "../ui/button";
import pinnedIconUrl from "./sidebar-pin.png";

function formatRelativeTimeLocalized(timestamp: number, text: AppText): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years} ${text.timeYears || "年"}`;
  if (months > 0) return `${months} ${text.timeMonths || "个月"}`;
  if (weeks > 0) return `${weeks} ${text.timeWeeks || "周"}`;
  if (days > 0) return `${days} ${text.timeDays || "天"}`;
  if (hours > 0) return `${hours} ${text.timeHours || "小时"}`;
  if (minutes > 0) return `${minutes} ${text.timeMinutes || "分钟"}`;
  return text.timeNow || "刚刚";
}

type DesktopSidebarProps = {
  text: AppText;
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
  getVisibleRepoSessions: (repoId: string) => OpencodeChatSession[];
  hasMoreRepoSessions: (repoId: string) => boolean;
  isRepoSessionsLoading: (repoId: string) => boolean;
  isRepoSessionsPaging: (repoId: string) => boolean;
  onImportRepository: () => void | Promise<void>;
  onCreateSession: () => void | Promise<void>;
  onToggleRepoSessions: (repo: RepositoryEntry) => void;
  onOpenRepoContextMenu: (x: number, y: number, repo: RepositoryEntry) => void;
  onTogglePinnedRepo: (repoId: string) => void;
  onFocusDraftSession: () => void;
  onOpenSession: (repo: RepositoryEntry, session: OpencodeChatSession) => void;
  onOpenSessionContextMenu: (x: number, y: number, repo: RepositoryEntry, session: OpencodeChatSession) => void;
  onLoadMoreSessions: (repo: RepositoryEntry) => void | Promise<void>;
  onOpenSkills: () => void;
  onOpenSettings: () => void;
};

export function DesktopSidebar(props: DesktopSidebarProps) {
  const {
    text,
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
    getVisibleRepoSessions,
    hasMoreRepoSessions,
    isRepoSessionsLoading,
    isRepoSessionsPaging,
    onImportRepository,
    onCreateSession,
    onToggleRepoSessions,
    onOpenRepoContextMenu,
    onTogglePinnedRepo,
    onFocusDraftSession,
    onOpenSession,
    onOpenSessionContextMenu,
    onLoadMoreSessions,
    onOpenSkills,
    onOpenSettings,
  } = props;

  const { pinnedRepos, otherRepos } = useMemo(() => {
    const pinnedRepoIdSet = new Set(pinnedRepoIds);
    return {
      pinnedRepos: repos.filter((repo) => pinnedRepoIdSet.has(repo.id)),
      otherRepos: repos.filter((repo) => !pinnedRepoIdSet.has(repo.id)),
    };
  }, [pinnedRepoIds, repos]);
  const expandedProjectIdSet = useMemo(() => new Set(expandedProjectIds), [expandedProjectIds]);
  const pinnedTitle = text.pinnedProjects.replace(/项目$/, "");

  return (
    <Sidebar
      collapsible="none"
      className="h-full overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <SidebarHeader className="shrink-0 px-4 pb-4 pt-10" data-tauri-drag-region>
        <SidebarMenu className="gap-0.5">
          <NavItem
            icon={PencilLine}
            label={text.newSession}
            onClick={() => void (noRepos ? onImportRepository() : onCreateSession())}
            disabled={noRepos ? busy : busy || !opencodeInstalled}
            prominent
          />
          <NavItem icon={Box} label={text.skills} onClick={onOpenSkills} />
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-4 overflow-x-hidden overflow-y-auto px-4 pb-5 pt-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {noRepos ? (
          <SidebarGroup className="min-w-0 gap-2 p-0">
            <div className="flex min-h-7 min-w-0 items-center gap-2">
              <SidebarGroupLabel className="h-auto min-w-0 flex-1 px-0 text-[14px] font-semibold text-sidebar-foreground/28">
                <span className="truncate">{text.projects}</span>
              </SidebarGroupLabel>
              <SidebarGroupAction
                className="static size-8 shrink-0 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                title={text.openWorkspace}
                onClick={() => void onImportRepository()}
                disabled={busy}
              >
                <Plus className="size-4" />
              </SidebarGroupAction>
            </div>
            <SidebarGroupContent className="min-w-0 overflow-x-hidden">
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full min-w-0 justify-start gap-3 px-0 text-left text-[16px] font-medium text-sidebar-foreground/52 hover:bg-transparent hover:text-sidebar-foreground"
                onClick={() => void onImportRepository()}
                disabled={busy}
              >
                <Folder className="size-5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{text.openWorkspace}</span>
              </Button>
              <p className="m-0 mt-1.5 max-w-full text-[15px] font-medium leading-6 text-sidebar-foreground/32">
                {text.noProjectsHint}
              </p>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {pinnedRepos.length > 0 ? (
          <ProjectSection
            text={text}
            title={pinnedTitle}
            repos={pinnedRepos}
            isPinnedSection
            busy={busy}
            opencodeInstalled={opencodeInstalled}
            expandedProjectIdSet={expandedProjectIdSet}
            selectedRepoId={selectedRepoId}
            activeSessionId={activeSessionId}
            draftRepoId={draftRepoId}
            getVisibleRepoSessions={getVisibleRepoSessions}
            hasMoreRepoSessions={hasMoreRepoSessions}
            isRepoSessionsLoading={isRepoSessionsLoading}
            isRepoSessionsPaging={isRepoSessionsPaging}
            onToggleRepoSessions={onToggleRepoSessions}
            onOpenRepoContextMenu={onOpenRepoContextMenu}
            onTogglePinnedRepo={onTogglePinnedRepo}
            onFocusDraftSession={onFocusDraftSession}
            onOpenSession={onOpenSession}
            onOpenSessionContextMenu={onOpenSessionContextMenu}
            onLoadMoreSessions={onLoadMoreSessions}
          />
        ) : null}

        {otherRepos.length > 0 ? (
          <ProjectSection
            text={text}
            title={text.projects}
            repos={otherRepos}
            busy={busy}
            opencodeInstalled={opencodeInstalled}
            expandedProjectIdSet={expandedProjectIdSet}
            selectedRepoId={selectedRepoId}
            activeSessionId={activeSessionId}
            draftRepoId={draftRepoId}
            getVisibleRepoSessions={getVisibleRepoSessions}
            hasMoreRepoSessions={hasMoreRepoSessions}
            isRepoSessionsLoading={isRepoSessionsLoading}
            isRepoSessionsPaging={isRepoSessionsPaging}
            onToggleRepoSessions={onToggleRepoSessions}
            onOpenRepoContextMenu={onOpenRepoContextMenu}
            onTogglePinnedRepo={onTogglePinnedRepo}
            onFocusDraftSession={onFocusDraftSession}
            onOpenSession={onOpenSession}
            onOpenSessionContextMenu={onOpenSessionContextMenu}
            onLoadMoreSessions={onLoadMoreSessions}
            headerAction={
              <SidebarGroupAction
                className="static size-8 shrink-0 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                title={text.openWorkspace}
                onClick={() => void onImportRepository()}
                disabled={busy}
              >
                <Plus className="size-4" />
              </SidebarGroupAction>
            }
          />
        ) : null}
      </SidebarContent>

      <SidebarFooter className="shrink-0 px-4 pb-2 pt-3">
        <Button
          type="button"
          variant="ghost"
          className="min-h-8 w-full min-w-0 justify-start gap-2.5 px-0 py-0.5 text-left text-sidebar-foreground/86 hover:bg-transparent hover:text-sidebar-foreground"
          onClick={onOpenSettings}
        >
          <Settings className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5">{text.settings}</span>
          <span className="sr-only">{gitUserIdentity.name || gitUserIdentity.email || getIdentityInitial(gitUserIdentity)}</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}

type NavItemProps = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  muted?: boolean;
  prominent?: boolean;
};

function NavItem({ icon: Icon, label, onClick, disabled = false, muted = false, prominent = false }: NavItemProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className={cn(
          "h-[32px] min-w-0 gap-3 rounded-lg px-0 !text-[14px] font-semibold text-sidebar-foreground/82 transition-[background-color,color] hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent [&>svg]:!size-4",
          prominent && "h-9 !text-[14.5px] leading-5 [&>svg]:!size-4",
          muted && "text-sidebar-foreground/34 hover:text-sidebar-foreground/48",
          disabled && "cursor-not-allowed opacity-55"
        )}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon className="size-4" />
        <span className={cn("min-w-0 flex-1 truncate", prominent ? "!text-[14.5px]" : "!text-[14px]")}>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SidebarPinnedIcon() {
  return (
    <span
      className="inline-block size-3.5 bg-current opacity-70"
      aria-hidden="true"
      style={{
        WebkitMaskImage: `url(${pinnedIconUrl})`,
        maskImage: `url(${pinnedIconUrl})`,
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}

function getIdentityInitial(identity: GitUserIdentity): string {
  const value = identity.name.trim() || identity.email.trim() || "G";
  return firstLetter(value).toUpperCase();
}

type ProjectSectionProps = {
  text: AppText;
  title: string;
  repos: RepositoryEntry[];
  isPinnedSection?: boolean;
  busy: boolean;
  opencodeInstalled: boolean;
  expandedProjectIdSet: ReadonlySet<string>;
  selectedRepoId: string;
  activeSessionId: string;
  draftRepoId: string;
  getVisibleRepoSessions: (repoId: string) => OpencodeChatSession[];
  hasMoreRepoSessions: (repoId: string) => boolean;
  isRepoSessionsLoading: (repoId: string) => boolean;
  isRepoSessionsPaging: (repoId: string) => boolean;
  onToggleRepoSessions: (repo: RepositoryEntry) => void;
  onOpenRepoContextMenu: (x: number, y: number, repo: RepositoryEntry) => void;
  onTogglePinnedRepo: (repoId: string) => void;
  onFocusDraftSession: () => void;
  onOpenSession: (repo: RepositoryEntry, session: OpencodeChatSession) => void;
  onOpenSessionContextMenu: (x: number, y: number, repo: RepositoryEntry, session: OpencodeChatSession) => void;
  onLoadMoreSessions: (repo: RepositoryEntry) => void | Promise<void>;
  headerAction?: ReactNode;
};

function ProjectSection(props: ProjectSectionProps) {
  const {
    text,
    title,
    repos,
    isPinnedSection = false,
    busy,
    opencodeInstalled,
    expandedProjectIdSet,
    selectedRepoId,
    activeSessionId,
    draftRepoId,
    getVisibleRepoSessions,
    hasMoreRepoSessions,
    isRepoSessionsLoading,
    isRepoSessionsPaging,
    onToggleRepoSessions,
    onOpenRepoContextMenu,
    onTogglePinnedRepo,
    onFocusDraftSession,
    onOpenSession,
    onOpenSessionContextMenu,
    onLoadMoreSessions,
    headerAction,
  } = props;

  return (
    <SidebarGroup className="min-w-0 gap-2 p-0">
      <div className="flex min-h-7 min-w-0 items-center gap-2">
        <SidebarGroupLabel className="h-auto min-w-0 flex-1 px-0 text-[14px] font-semibold text-sidebar-foreground/28">
          <span className="truncate">{title}</span>
        </SidebarGroupLabel>
        {headerAction}
      </div>
      <SidebarGroupContent className="min-w-0 overflow-x-hidden">
        <SidebarMenu className="min-w-0 gap-0.5 overflow-x-hidden">
          {repos.map((repo) => (
            <ProjectRow
              key={repo.id}
              text={text}
              repo={repo}
              pinned={isPinnedSection}
              busy={busy}
              opencodeInstalled={opencodeInstalled}
              expanded={expandedProjectIdSet.has(repo.id)}
              selectedRepoId={selectedRepoId}
              activeSessionId={activeSessionId}
              hasDraftForRepo={draftRepoId === repo.id}
              sessions={getVisibleRepoSessions(repo.id)}
              hasMoreSessions={hasMoreRepoSessions(repo.id)}
              sessionsLoading={isRepoSessionsLoading(repo.id)}
              sessionsPaging={isRepoSessionsPaging(repo.id)}
              onToggleRepoSessions={onToggleRepoSessions}
              onOpenRepoContextMenu={onOpenRepoContextMenu}
              onTogglePinnedRepo={onTogglePinnedRepo}
              onFocusDraftSession={onFocusDraftSession}
              onOpenSession={onOpenSession}
              onOpenSessionContextMenu={onOpenSessionContextMenu}
              onLoadMoreSessions={onLoadMoreSessions}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

type ProjectRowProps = {
  text: AppText;
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
  sessionsPaging: boolean;
  onToggleRepoSessions: (repo: RepositoryEntry) => void;
  onOpenRepoContextMenu: (x: number, y: number, repo: RepositoryEntry) => void;
  onTogglePinnedRepo: (repoId: string) => void;
  onFocusDraftSession: () => void;
  onOpenSession: (repo: RepositoryEntry, session: OpencodeChatSession) => void;
  onOpenSessionContextMenu: (x: number, y: number, repo: RepositoryEntry, session: OpencodeChatSession) => void;
  onLoadMoreSessions: (repo: RepositoryEntry) => void | Promise<void>;
};

const ProjectRow = memo(function ProjectRow(props: ProjectRowProps) {
  const {
    text,
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
    sessionsPaging,
    onToggleRepoSessions,
    onOpenRepoContextMenu,
    onTogglePinnedRepo,
    onFocusDraftSession,
    onOpenSession,
    onOpenSessionContextMenu,
    onLoadMoreSessions,
  } = props;

  const hasCollapsibleContent = sessionsLoading || sessions.length > 0 || hasMoreSessions || hasDraftForRepo || !opencodeInstalled;
  const loadMoreLabel = sessionsPaging ? `${text.loadMore}...` : text.loadMore;

  return (
    <Collapsible
      asChild
      className="group/project"
      open={expanded}
      onOpenChange={(open) => {
        if (busy || open === expanded) return;
        onToggleRepoSessions(repo);
      }}
    >
      <SidebarMenuItem className="min-w-0 overflow-x-hidden">
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className={cn(
              "h-9 min-w-0 gap-3 rounded-lg px-0 text-[17px] font-semibold text-sidebar-foreground/50 transition-colors hover:bg-transparent hover:text-sidebar-foreground/74 active:bg-transparent data-[active=true]:bg-transparent [&>svg]:size-5",
              expanded && "text-sidebar-foreground/58"
            )}
            disabled={busy}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenRepoContextMenu(event.clientX, event.clientY, repo);
            }}
          >
            {expanded ? <FolderOpen className="size-5" /> : <Folder className="size-5" />}
            <span className="min-w-0 flex-1 truncate">{repo.name}</span>
            <SidebarMenuAction
              type="button"
              showOnHover={!pinned}
              className={cn(
                "right-0.5 top-1.5 size-6",
                pinned ? "text-sidebar-foreground/50" : "text-sidebar-foreground/36"
              )}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePinnedRepo(repo.id);
              }}
              title={pinned ? text.unpinProject : text.pinProject}
              aria-label={pinned ? text.unpinProject : text.pinProject}
            >
              <SidebarPinnedIcon />
            </SidebarMenuAction>
          </SidebarMenuButton>
        </CollapsibleTrigger>

        {hasCollapsibleContent ? (
          <CollapsibleContent
            forceMount
            className={cn(
              "grid overflow-hidden transition-[grid-template-rows,opacity] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=closed]:grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]",
              "data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
              "motion-reduce:transition-none"
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <SidebarMenuSub className="mx-0 w-full translate-x-0 gap-0.5 overflow-x-hidden border-l-0 px-0 py-0.5">
                {hasDraftForRepo ? (
                  <SessionRow active title={text.newSession} onClick={onFocusDraftSession} />
                ) : null}

                {!opencodeInstalled ? (
                  <div className="min-w-0 py-2 pl-11 pr-3 text-[15px] leading-6 text-sidebar-foreground/32">{text.opencodeRequired}</div>
                ) : null}

                {opencodeInstalled && sessionsLoading && sessions.length === 0 ? (
                  <SidebarMenuSkeleton />
                ) : null}

                {opencodeInstalled
                  ? sessions.map((session) => (
                      <SessionRow
                        key={`left-session-${session.id}`}
                        active={!hasDraftForRepo && repo.id === selectedRepoId && session.id === activeSessionId}
                        title={session.title}
                        time={session.updatedAt || session.createdAt ? formatRelativeTimeLocalized(session.updatedAt || session.createdAt, text) : ""}
                        onClick={() => onOpenSession(repo, session)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onOpenSessionContextMenu(event.clientX, event.clientY, repo, session);
                        }}
                      />
                    ))
                  : null}

                {opencodeInstalled && hasMoreSessions ? (
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton asChild className="h-8 w-full min-w-0 translate-x-0 rounded-xl pl-[33px] pr-3 text-[15px] font-semibold text-sidebar-foreground/34 hover:bg-transparent hover:text-sidebar-foreground/50 active:bg-transparent">
                      <button
                        type="button"
                        onClick={() => void onLoadMoreSessions(repo)}
                        disabled={sessionsLoading || sessionsPaging}
                        aria-busy={sessionsPaging}
                      >
                        <span className="min-w-0 flex-1 truncate text-left">{loadMoreLabel}</span>
                      </button>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ) : null}
              </SidebarMenuSub>
            </div>
          </CollapsibleContent>
        ) : null}
      </SidebarMenuItem>
    </Collapsible>
  );
});

type SessionRowProps = {
  title: string;
  active?: boolean;
  time?: string;
  onClick: () => void;
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
};

const SessionRow = memo(function SessionRow({ title, active = false, time = "", onClick, onContextMenu }: SessionRowProps) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        asChild
        isActive={active}
        className={cn(
          "h-[34px] w-full min-w-0 translate-x-0 rounded-xl pl-[33px] pr-3 text-[15.5px] font-semibold text-sidebar-foreground/76 hover:bg-sidebar-accent/70 active:bg-sidebar-accent",
          active && "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.01)]"
        )}
      >
        <button
          type="button"
          onClick={onClick}
          onContextMenu={onContextMenu}
        >
          <span className="min-w-0 flex-1 truncate text-left">{title}</span>
          {time ? <span className="ml-3 shrink-0 text-[13px] font-medium text-sidebar-foreground/40 tabular-nums">{time}</span> : null}
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
});
