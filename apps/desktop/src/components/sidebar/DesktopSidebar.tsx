import {
  Archive,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  LoaderCircle,
  MoreHorizontal,
  PencilLine,
  Plug,
  Settings,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import Lenis from "lenis";
import { motion, useReducedMotion } from "motion/react";
import { memo, useEffect, useMemo, useRef, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from "react";

import type { OptionalRightPaneTab, RightPaneTab } from "../common/AppChromeIcons";

import type { AppText } from "../../lib/generalSettings";
import type { OpencodeChatSession } from "../../lib/opencodeSessions";
import { firstLetter } from "../../lib/textFormatting";
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
  SidebarMenuSubItem,
} from "../ui/sidebar";
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
  sessionBusyById: Record<string, boolean>;
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
  onArchiveSession: (repo: RepositoryEntry, sessionId: string) => void | Promise<void>;
  onLoadMoreSessions: (repo: RepositoryEntry) => void | Promise<void>;
  rightDrawerOpen: boolean;
  rightPaneTab: RightPaneTab;
  rightOptionalTabs: OptionalRightPaneTab[];
  rightModules: Record<RightPaneTab, boolean>;
  onOpenRightPane: (tab: RightPaneTab) => void;
  onOpenSettings: () => void;
};

const SECTION_LABEL_CLASS = "h-6 min-w-0 flex-1 px-1.5 text-sm font-medium text-muted-foreground";

type LeftNavPaneTab = Exclude<RightPaneTab, "changes">;

const LEFT_NAV_PANES: Array<{
  tab: LeftNavPaneTab;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: keyof Pick<AppText, "worktree" | "terminal" | "skills" | "mcp">;
}> = [
  { tab: "worktree", icon: GitBranch, labelKey: "worktree" },
  { tab: "terminal", icon: SquareTerminal, labelKey: "terminal" },
  { tab: "skills", icon: Sparkles, labelKey: "skills" },
  { tab: "mcp", icon: Plug, labelKey: "mcp" },
];

const SIDEBAR_SCROLL_EDGE_EPSILON = 1;
const SIDEBAR_TRACKPAD_DELTA_THRESHOLD = 10;

function SmoothSidebarContent({ className, children, ...props }: ComponentPropsWithoutRef<typeof SidebarContent>) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;

    const reduceMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let lenis: Lenis | null = null;

    const setupLenis = () => {
      lenis?.destroy();
      lenis = null;
      if (reduceMotionQuery?.matches) return;

      lenis = new Lenis({
        wrapper,
        content,
        eventsTarget: wrapper,
        smoothWheel: true,
        syncTouch: false,
        duration: 0.28,
        easing: (t) => 1 - Math.pow(1 - t, 3),
        wheelMultiplier: 0.88,
        orientation: "vertical",
        gestureOrientation: "vertical",
        overscroll: false,
        autoRaf: true,
        virtualScroll: ({ deltaX, deltaY }) => {
          if (Math.abs(deltaX) > Math.abs(deltaY)) return false;
          if (Math.abs(deltaY) < SIDEBAR_TRACKPAD_DELTA_THRESHOLD) return false;

          const maxScrollTop = Math.max(0, wrapper.scrollHeight - wrapper.clientHeight);
          if (maxScrollTop <= 0) return false;

          const atTop = wrapper.scrollTop <= SIDEBAR_SCROLL_EDGE_EPSILON;
          const atBottom = wrapper.scrollTop >= maxScrollTop - SIDEBAR_SCROLL_EDGE_EPSILON;
          if ((atTop && deltaY < 0) || (atBottom && deltaY > 0)) return false;

          return true;
        },
      });
    };

    setupLenis();
    reduceMotionQuery?.addEventListener?.("change", setupLenis);

    return () => {
      reduceMotionQuery?.removeEventListener?.("change", setupLenis);
      lenis?.destroy();
      lenis = null;
    };
  }, []);

  return (
    <SidebarContent
      ref={wrapperRef}
      className={cn(
        "overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
      {...props}
    >
      <div ref={contentRef} className="flex min-w-0 flex-col gap-1">
        {children}
      </div>
    </SidebarContent>
  );
}

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
    sessionBusyById,
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
    onArchiveSession,
    onLoadMoreSessions,
    rightDrawerOpen,
    rightPaneTab,
    rightOptionalTabs,
    rightModules,
    onOpenRightPane,
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
      style={{
        "--sidebar": "color-mix(in srgb, var(--bg) 92%, #8f8270 8%)",
        backgroundColor: "var(--sidebar)",
      } as CSSProperties}
    >
      <SidebarHeader className="shrink-0 gap-1 py-2 pl-[10px] pr-2 pt-10" data-tauri-drag-region>
        <SidebarMenu className="gap-0.5">
          <NavItem
            icon={PencilLine}
            label={text.newSession}
            onClick={() => void (noRepos ? onImportRepository() : onCreateSession())}
            disabled={noRepos ? busy : busy || !opencodeInstalled}
          />
          {LEFT_NAV_PANES.map(({ tab, icon, labelKey }) =>
            rightModules[tab] ? (
              <NavItem
                key={tab}
                icon={icon}
                label={text[labelKey]}
                isActive={rightDrawerOpen && rightOptionalTabs.includes(tab) && rightPaneTab === tab}
                onClick={() => onOpenRightPane(tab)}
              />
            ) : null
          )}
        </SidebarMenu>
      </SidebarHeader>

      <SmoothSidebarContent className="pb-2 pl-[10px] pr-2 pt-0">
        {noRepos ? (
          <SidebarGroup className="gap-0 p-0">
            <div className="group/project-heading flex min-h-6 items-center gap-1">
              <SidebarGroupLabel className={SECTION_LABEL_CLASS}>
                <span className="truncate">{text.projects}</span>
              </SidebarGroupLabel>
              <ProjectImportAction label={text.openWorkspace} disabled={busy} onClick={onImportRepository} />
            </div>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={() => void onImportRepository()} disabled={busy}>
                    <Folder />
                    <span className="truncate">{text.openWorkspace}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
              <p className="px-2 text-xs text-muted-foreground">{text.noProjectsHint}</p>
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
            sessionBusyById={sessionBusyById}
            getVisibleRepoSessions={getVisibleRepoSessions}
            hasMoreRepoSessions={hasMoreRepoSessions}
            isRepoSessionsLoading={isRepoSessionsLoading}
            isRepoSessionsPaging={isRepoSessionsPaging}
            onToggleRepoSessions={onToggleRepoSessions}
            onOpenRepoContextMenu={onOpenRepoContextMenu}
            onTogglePinnedRepo={onTogglePinnedRepo}
            onFocusDraftSession={onFocusDraftSession}
            onOpenSession={onOpenSession}
            onArchiveSession={onArchiveSession}
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
            sessionBusyById={sessionBusyById}
            getVisibleRepoSessions={getVisibleRepoSessions}
            hasMoreRepoSessions={hasMoreRepoSessions}
            isRepoSessionsLoading={isRepoSessionsLoading}
            isRepoSessionsPaging={isRepoSessionsPaging}
            onToggleRepoSessions={onToggleRepoSessions}
            onOpenRepoContextMenu={onOpenRepoContextMenu}
            onTogglePinnedRepo={onTogglePinnedRepo}
            onFocusDraftSession={onFocusDraftSession}
            onOpenSession={onOpenSession}
            onArchiveSession={onArchiveSession}
            onLoadMoreSessions={onLoadMoreSessions}
            headerAction={
              <ProjectImportAction label={text.openWorkspace} disabled={busy} onClick={onImportRepository} />
            }
          />
        ) : null}
      </SmoothSidebarContent>

      <SidebarFooter className="shrink-0 p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="default" className="h-9 text-sm [&>svg]:size-[18px]" onClick={onOpenSettings}>
              <Settings />
              <span className="truncate">{text.settings}</span>
              <span className="sr-only">{gitUserIdentity.name || gitUserIdentity.email || getIdentityInitial(gitUserIdentity)}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

type NavItemProps = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  isActive?: boolean;
  size?: "sm" | "default";
};

function NavItem({ icon: Icon, label, onClick, disabled = false, isActive = false, size = "default" }: NavItemProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size={size}
        isActive={isActive}
        disabled={disabled}
        className="h-8 text-sm transition-[background-color,color,box-shadow] hover:bg-[color-mix(in_srgb,#8f8270_10%,transparent)] active:bg-[color-mix(in_srgb,#8f8270_14%,transparent)] data-[active=true]:!bg-[color-mix(in_srgb,#8f8270_18%,var(--bg)_82%)] data-[active=true]:!text-sidebar-foreground data-[active=true]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,#8f8270_16%,transparent)] data-[active=true]:hover:!bg-[color-mix(in_srgb,#8f8270_21%,var(--bg)_79%)]"
        onClick={onClick}
      >
        <Icon />
        <span className="truncate">{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ProjectImportAction({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void | Promise<void> }) {
  return (
    <SidebarGroupAction
      className="static text-muted-foreground opacity-0 transition-[background-color,color,opacity,transform] duration-150 ease-out hover:text-sidebar-accent-foreground focus-visible:opacity-100 group-hover/project-heading:opacity-100 group-focus-within/project-heading:opacity-100 active:scale-95"
      title={label}
      aria-label={label}
      onClick={() => void onClick()}
      disabled={disabled}
    >
      <FolderPlus />
    </SidebarGroupAction>
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
  sessionBusyById: Record<string, boolean>;
  getVisibleRepoSessions: (repoId: string) => OpencodeChatSession[];
  hasMoreRepoSessions: (repoId: string) => boolean;
  isRepoSessionsLoading: (repoId: string) => boolean;
  isRepoSessionsPaging: (repoId: string) => boolean;
  onToggleRepoSessions: (repo: RepositoryEntry) => void;
  onOpenRepoContextMenu: (x: number, y: number, repo: RepositoryEntry) => void;
  onTogglePinnedRepo: (repoId: string) => void;
  onFocusDraftSession: () => void;
  onOpenSession: (repo: RepositoryEntry, session: OpencodeChatSession) => void;
  onArchiveSession: (repo: RepositoryEntry, sessionId: string) => void | Promise<void>;
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
    sessionBusyById,
    getVisibleRepoSessions,
    hasMoreRepoSessions,
    isRepoSessionsLoading,
    isRepoSessionsPaging,
    onToggleRepoSessions,
    onOpenRepoContextMenu,
    onTogglePinnedRepo,
    onFocusDraftSession,
    onOpenSession,
    onArchiveSession,
    onLoadMoreSessions,
    headerAction,
  } = props;

  return (
    <SidebarGroup className="gap-0 p-0">
      <div className="group/project-heading flex min-h-6 items-center gap-1">
        <SidebarGroupLabel className={SECTION_LABEL_CLASS}>
          <span className="truncate">{title}</span>
        </SidebarGroupLabel>
        {headerAction}
      </div>
      <SidebarGroupContent>
        <SidebarMenu className="gap-px">
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
              sessionBusyById={sessionBusyById}
              sessions={getVisibleRepoSessions(repo.id)}
              hasMoreSessions={hasMoreRepoSessions(repo.id)}
              sessionsLoading={isRepoSessionsLoading(repo.id)}
              sessionsPaging={isRepoSessionsPaging(repo.id)}
              onToggleRepoSessions={onToggleRepoSessions}
              onOpenRepoContextMenu={onOpenRepoContextMenu}
              onTogglePinnedRepo={onTogglePinnedRepo}
              onFocusDraftSession={onFocusDraftSession}
              onOpenSession={onOpenSession}
              onArchiveSession={onArchiveSession}
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
  sessionBusyById: Record<string, boolean>;
  sessions: OpencodeChatSession[];
  hasMoreSessions: boolean;
  sessionsLoading: boolean;
  sessionsPaging: boolean;
  onToggleRepoSessions: (repo: RepositoryEntry) => void;
  onOpenRepoContextMenu: (x: number, y: number, repo: RepositoryEntry) => void;
  onTogglePinnedRepo: (repoId: string) => void;
  onFocusDraftSession: () => void;
  onOpenSession: (repo: RepositoryEntry, session: OpencodeChatSession) => void;
  onArchiveSession: (repo: RepositoryEntry, sessionId: string) => void | Promise<void>;
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
    sessionBusyById,
    sessions,
    hasMoreSessions,
    sessionsLoading,
    sessionsPaging,
    onToggleRepoSessions,
    onOpenRepoContextMenu,
    onTogglePinnedRepo,
    onFocusDraftSession,
    onOpenSession,
    onArchiveSession,
    onLoadMoreSessions,
  } = props;

  const hasCollapsibleContent = sessionsLoading || sessions.length > 0 || hasMoreSessions || hasDraftForRepo || !opencodeInstalled;
  const showLoadMoreRow = opencodeInstalled && (hasMoreSessions || sessionsPaging);
  const loadMorePending = sessionsLoading || sessionsPaging;
  const loadMoreLabel = loadMorePending ? `${text.loadMore}...` : text.loadMore;
  const showLoadingSkeleton = opencodeInstalled && sessionsLoading && sessions.length === 0;
  const reduceMotion = useReducedMotion();
  const contentTransition = reduceMotion
    ? { duration: 0.01 }
    : {
        height: { duration: expanded ? 0.26 : 0.18, ease: expanded ? [0.22, 1, 0.36, 1] : [0.4, 0, 0.2, 1] },
        opacity: { duration: expanded ? 0.16 : 0.1, ease: "linear" },
      };
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
            size="sm"
            className="h-8 rounded-lg border border-transparent pl-[10px] pr-2 text-sm text-muted-foreground transition-[background-color,border-color,color] hover:!bg-[color-mix(in_srgb,var(--text)_5%,transparent)] active:!bg-[color-mix(in_srgb,var(--text)_7%,transparent)] data-[state=open]:!bg-transparent data-[state=open]:hover:!bg-[color-mix(in_srgb,var(--text)_5%,transparent)] data-[state=open]:active:!bg-[color-mix(in_srgb,var(--text)_7%,transparent)]"
            disabled={busy || (!expanded && sessionsLoading)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenRepoContextMenu(event.clientX, event.clientY, repo);
            }}
          >
            {!expanded && sessionsLoading ? <LoaderCircle className="animate-spin" /> : expanded ? <FolderOpen /> : <Folder />}
            <span className="truncate">{repo.name}</span>
            <SidebarMenuAction
              type="button"
              showOnHover
              className="right-7"
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                onOpenRepoContextMenu(rect.left, rect.bottom + 4, repo);
              }}
              title="更多操作"
              aria-label="更多操作"
            >
              <MoreHorizontal />
            </SidebarMenuAction>
            <SidebarMenuAction
              type="button"
              showOnHover={!pinned}
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

        <CollapsibleContent
          asChild
          forceMount
        >
          <motion.div
            initial={false}
            animate={expanded ? "open" : "closed"}
            variants={{
              open: { height: "auto", opacity: 1 },
              closed: { height: 0, opacity: 0 },
            }}
            transition={contentTransition}
            className="overflow-hidden"
            style={{ pointerEvents: expanded ? "auto" : "none" }}
          >
            {hasCollapsibleContent ? (
              <motion.div
                variants={{
                  open: { y: 0 },
                  closed: { y: reduceMotion ? 0 : -6 },
                }}
                transition={contentTransition}
                className="min-h-0 overflow-hidden"
              >
                <SidebarMenuSub className="mx-0 gap-1 border-l-0 px-2 py-1">
                  {hasDraftForRepo ? (
                    <SessionRow active title={text.newSession} onClick={onFocusDraftSession} />
                  ) : null}

                  {!opencodeInstalled ? (
                    <p className="px-2 py-1 text-xs text-muted-foreground">{text.opencodeRequired}</p>
                  ) : null}

                  {opencodeInstalled
                    ? sessions.map((session) => (
                      <SessionRow
                        key={`left-session-${session.id}`}
                        active={!hasDraftForRepo && repo.id === selectedRepoId && session.id === activeSessionId}
                        title={session.title}
                        running={Boolean(sessionBusyById[session.id])}
                        time={session.updatedAt || session.createdAt ? formatRelativeTimeLocalized(session.updatedAt || session.createdAt, text) : ""}
                        onClick={() => onOpenSession(repo, session)}
                        onArchive={() => void onArchiveSession(repo, session.id)}
                        archiveLabel={text.archiveSession}
                      />
                    ))
                    : null}

                  {showLoadingSkeleton ? <SidebarMenuSkeleton /> : null}

                  {showLoadMoreRow ? (
                    <SidebarMenuSubItem className="relative -mx-2">
                      <button
                        type="button"
                        className="flex h-8 w-full min-w-0 items-center rounded-lg border-0 bg-transparent py-0 pl-[34px] pr-3 text-left text-sm text-muted-foreground outline-none ring-sidebar-ring transition-[background-color,color,box-shadow] duration-150 ease-out hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-[color-mix(in_srgb,var(--text)_7%,transparent)] disabled:pointer-events-none disabled:opacity-50"
                        onClick={() => void onLoadMoreSessions(repo)}
                        disabled={loadMorePending}
                        aria-busy={loadMorePending}
                      >
                        <span className="truncate">{loadMoreLabel}</span>
                      </button>
                    </SidebarMenuSubItem>
                  ) : null}
                </SidebarMenuSub>
              </motion.div>
            ) : null}
          </motion.div>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
});

type SessionRowProps = {
  title: string;
  active?: boolean;
  running?: boolean;
  time?: string;
  onClick: () => void;
  onArchive?: () => void;
  archiveLabel?: string;
};

const SessionRow = memo(function SessionRow({ title, active = false, running = false, time = "", onClick, onArchive, archiveLabel = "归档会话" }: SessionRowProps) {
  const hasArchive = Boolean(onArchive);
  const hasTrailing = running || Boolean(time);

  return (
    <SidebarMenuSubItem className="group/session-row relative -mx-2">
      <button
        type="button"
        className={cn(
          "relative flex h-8 w-full min-w-0 items-center rounded-lg border-0 bg-transparent py-0 pl-[34px] pr-3 text-left text-sm text-sidebar-foreground outline-none ring-sidebar-ring transition-[background-color,color,box-shadow] duration-150 ease-out hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-[color-mix(in_srgb,var(--text)_7%,transparent)]",
          hasTrailing && "pr-[58px]",
          hasArchive && !hasTrailing && "pr-9",
          active && "bg-[color-mix(in_srgb,var(--text)_8%,transparent)] font-medium text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.025)] hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)]"
        )}
        data-active={active}
        onClick={onClick}
      >
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        {running ? (
          <LoaderCircle className="absolute right-3 size-4 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : time ? (
          <span className={cn("absolute right-3 text-right text-xs text-muted-foreground tabular-nums transition-opacity duration-150", hasArchive && "group-hover/session-row:opacity-0 group-focus-within/session-row:opacity-0")}>{time}</span>
        ) : null}
      </button>
      {hasArchive ? (
        <button
          type="button"
          className="absolute right-3 top-1 flex size-6 items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground opacity-0 outline-none ring-sidebar-ring transition-[background-color,color,opacity,transform] duration-150 ease-out hover:bg-[color-mix(in_srgb,var(--text)_7%,transparent)] hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 group-hover/session-row:opacity-100 group-focus-within/session-row:opacity-100 active:scale-95"
          title={archiveLabel}
          aria-label={archiveLabel}
          onClick={(event) => {
            event.stopPropagation();
            onArchive?.();
          }}
        >
          <Archive className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </SidebarMenuSubItem>
  );
});
