import {
  Archive,
  Cloud,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  PencilLine,
  Search,
  Settings,
  Smartphone,
  Sparkles,
  SquarePen,
  SquareTerminal,
  Waypoints,
} from "lucide-react";
import Lenis from "lenis";
import { motion, useReducedMotion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { OptionalRightPaneTab, RightPaneTab } from "../common/AppChromeIcons";

import type { AppText } from "../../lib/generalSettings";
import type { AgentChatSession } from "../../lib/agentSessions";
import { firstLetter } from "../../lib/textFormatting";
import type { GitUserIdentity, RepositoryEntry } from "../../lib/types";
import { cn } from "../../lib/utils";
import { REMOTE_REPO_MODULE_ENABLED } from "../../lib/featureFlags";
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
  agentInstalled: boolean;
  repos: RepositoryEntry[];
  pinnedRepoIds: string[];
  expandedProjectIds: string[];
  selectedRepoId: string;
  activeSessionId: string;
  draftRepoId: string;
  sessionBusyById: Record<string, boolean>;
  gitUserIdentity: GitUserIdentity;
  getVisibleRepoSessions: (repoId: string) => AgentChatSession[];
  hasMoreRepoSessions: (repoId: string) => boolean;
  isRepoSessionsLoading: (repoId: string) => boolean;
  isRepoSessionsPaging: (repoId: string) => boolean;
  isRepoSessionsLoaded: (repoId: string) => boolean;
  onImportRepository: () => void | Promise<void>;
  onCreateSession: () => void | Promise<void>;
  onOpenSearch: () => void;
  onToggleRepoSessions: (repo: RepositoryEntry) => void;
  onEnsureRepoSessions: (repo: RepositoryEntry) => void;
  onOpenRepoContextMenu: (x: number, y: number, repo: RepositoryEntry) => void;
  onTogglePinnedRepo: (repoId: string) => void;
  onStartDraftSession: (repo: RepositoryEntry) => void;
  onFocusDraftSession: () => void;
  onOpenSession: (repo: RepositoryEntry, session: AgentChatSession) => void;
  onArchiveSession: (repo: RepositoryEntry, sessionId: string) => void | Promise<void>;
  onLoadMoreSessions: (repo: RepositoryEntry) => void | Promise<void>;
  rightDrawerOpen: boolean;
  rightPaneTab: RightPaneTab;
  rightOptionalTabs: OptionalRightPaneTab[];
  rightModules: Record<RightPaneTab, boolean>;
  onOpenRightPane: (tab: RightPaneTab) => void;
  onOpenSettings: () => void;
  onOpenMobilePairQr: () => void;
  mobileClientConnected?: boolean;
  remoteRepoActive: boolean;
  onOpenRemoteRepos: () => void;
};

const SECTION_LABEL_CLASS = "h-6 min-w-0 flex-1 px-1.5 text-sm font-medium text-muted-foreground";

type LeftNavPaneTab = Exclude<RightPaneTab, "changes" | "remoteRepos" | "browser">;

const LEFT_NAV_PANES: Array<{
  tab: LeftNavPaneTab;
  icon: React.ComponentType<{ className?: string }>;
  labelKey?: keyof Pick<AppText, "worktree" | "terminal" | "skills">;
  /** labelKey 覆盖不到的 pane 用固定文案（对齐 tabLabels 的「远程仓库」做法）。 */
  label?: string;
}> = [
  { tab: "worktree", icon: GitBranch, labelKey: "worktree" },
  { tab: "terminal", icon: SquareTerminal, labelKey: "terminal" },
  { tab: "skills", icon: Sparkles, labelKey: "skills" },
  { tab: "assetGraph", icon: Waypoints, label: "记忆" }
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
    agentInstalled,
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
    isRepoSessionsLoaded,
    onImportRepository,
    onCreateSession,
    onOpenSearch,
    onToggleRepoSessions,
    onEnsureRepoSessions,
    onOpenRepoContextMenu,
    onTogglePinnedRepo,
    onStartDraftSession,
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
    onOpenMobilePairQr,
    mobileClientConnected = false,
    remoteRepoActive,
    onOpenRemoteRepos,
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
            disabled={noRepos ? busy : busy || !agentInstalled}
          />
          <NavItem
            icon={Search}
            label={text.search}
            onClick={onOpenSearch}
          />
          {REMOTE_REPO_MODULE_ENABLED ? (
            <NavItem
              icon={Cloud}
              label="远程仓库"
              isActive={remoteRepoActive}
              onClick={onOpenRemoteRepos}
            />
          ) : null}
          {LEFT_NAV_PANES.map(({ tab, icon, labelKey, label: fixedLabel }) =>
            rightModules[tab] ? (
              <NavItem
                key={tab}
                icon={icon}
                label={fixedLabel ?? text[labelKey ?? "worktree"]}
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
            agentInstalled={agentInstalled}
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
            onEnsureRepoSessions={onEnsureRepoSessions}
            onOpenRepoContextMenu={onOpenRepoContextMenu}
            onTogglePinnedRepo={onTogglePinnedRepo}
            onStartDraftSession={onStartDraftSession}
            onFocusDraftSession={onFocusDraftSession}
            onOpenSession={onOpenSession}
            onArchiveSession={onArchiveSession}
            onLoadMoreSessions={onLoadMoreSessions}
            isRepoSessionsLoaded={isRepoSessionsLoaded}
          />
        ) : null}

        {otherRepos.length > 0 ? (
          <ProjectSection
            text={text}
            title={text.projects}
            repos={otherRepos}
            busy={busy}
            agentInstalled={agentInstalled}
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
            onEnsureRepoSessions={onEnsureRepoSessions}
            onOpenRepoContextMenu={onOpenRepoContextMenu}
            onTogglePinnedRepo={onTogglePinnedRepo}
            onStartDraftSession={onStartDraftSession}
            onFocusDraftSession={onFocusDraftSession}
            onOpenSession={onOpenSession}
            onArchiveSession={onArchiveSession}
            onLoadMoreSessions={onLoadMoreSessions}
            isRepoSessionsLoaded={isRepoSessionsLoaded}
            headerAction={
              <ProjectImportAction label={text.openWorkspace} disabled={busy} onClick={onImportRepository} />
            }
          />
        ) : null}

      </SmoothSidebarContent>

      <SidebarFooter className="shrink-0 p-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-1">
            {/* 设置与手机入口并排独立高亮，避免设置 hover/active 背景盖住手机图标 */}
            <SidebarMenuButton
              size="default"
              className="h-9 min-w-0 flex-1 text-sm [&>svg]:size-[18px]"
              onClick={onOpenSettings}
            >
              <Settings />
              <span className="truncate">{text.settings}</span>
              <span className="sr-only">{gitUserIdentity.name || gitUserIdentity.email || getIdentityInitial(gitUserIdentity)}</span>
            </SidebarMenuButton>
            <button
              type="button"
              title={mobileClientConnected ? "手机已连接" : "连接你的手机"}
              aria-label={mobileClientConnected ? "手机已连接" : "连接你的手机"}
              className="flex size-9 shrink-0 appearance-none items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2"
              onClick={() => {
                onOpenMobilePairQr();
              }}
            >
              <span className="relative inline-flex">
                <Smartphone className="size-[16px]" strokeWidth={1.75} />
                {mobileClientConnected ? (
                  <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-emerald-500 ring-2 ring-sidebar" />
                ) : null}
              </span>
            </button>
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

function SidebarPinnedIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block size-3.5 bg-current opacity-70", className)}
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

/** 实心图钉（Material push_pin, Apache-2.0）：置顶态使用，与描边态形成实心/描边对比。 */
function FilledPinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={cn("size-3.5", className)}>
      <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
    </svg>
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
  agentInstalled: boolean;
  expandedProjectIdSet: ReadonlySet<string>;
  selectedRepoId: string;
  activeSessionId: string;
  draftRepoId: string;
  sessionBusyById: Record<string, boolean>;
  getVisibleRepoSessions: (repoId: string) => AgentChatSession[];
  hasMoreRepoSessions: (repoId: string) => boolean;
  isRepoSessionsLoading: (repoId: string) => boolean;
  isRepoSessionsPaging: (repoId: string) => boolean;
  isRepoSessionsLoaded: (repoId: string) => boolean;
  onToggleRepoSessions: (repo: RepositoryEntry) => void;
  onEnsureRepoSessions: (repo: RepositoryEntry) => void;
  onOpenRepoContextMenu: (x: number, y: number, repo: RepositoryEntry) => void;
  onTogglePinnedRepo: (repoId: string) => void;
  onStartDraftSession: (repo: RepositoryEntry) => void;
  onFocusDraftSession: () => void;
  onOpenSession: (repo: RepositoryEntry, session: AgentChatSession) => void;
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
    agentInstalled,
    expandedProjectIdSet,
    selectedRepoId,
    activeSessionId,
    draftRepoId,
    sessionBusyById,
    getVisibleRepoSessions,
    hasMoreRepoSessions,
    isRepoSessionsLoading,
    isRepoSessionsPaging,
    isRepoSessionsLoaded,
    onToggleRepoSessions,
    onEnsureRepoSessions,
    onOpenRepoContextMenu,
    onTogglePinnedRepo,
    onStartDraftSession,
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
              agentInstalled={agentInstalled}
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
              onEnsureRepoSessions={onEnsureRepoSessions}
              onOpenRepoContextMenu={onOpenRepoContextMenu}
              onTogglePinnedRepo={onTogglePinnedRepo}
              onStartDraftSession={onStartDraftSession}
              onFocusDraftSession={onFocusDraftSession}
              onOpenSession={onOpenSession}
              onArchiveSession={onArchiveSession}
              onLoadMoreSessions={onLoadMoreSessions}
              sessionsLoaded={isRepoSessionsLoaded(repo.id)}
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
  agentInstalled: boolean;
  expanded: boolean;
  selectedRepoId: string;
  activeSessionId: string;
  hasDraftForRepo: boolean;
  sessionBusyById: Record<string, boolean>;
  sessions: AgentChatSession[];
  hasMoreSessions: boolean;
  sessionsLoading: boolean;
  sessionsPaging: boolean;
  onToggleRepoSessions: (repo: RepositoryEntry) => void;
  onEnsureRepoSessions: (repo: RepositoryEntry) => void;
  onOpenRepoContextMenu: (x: number, y: number, repo: RepositoryEntry) => void;
  onTogglePinnedRepo: (repoId: string) => void;
  onStartDraftSession: (repo: RepositoryEntry) => void;
  onFocusDraftSession: () => void;
  onOpenSession: (repo: RepositoryEntry, session: AgentChatSession) => void;
  onArchiveSession: (repo: RepositoryEntry, sessionId: string) => void | Promise<void>;
  onLoadMoreSessions: (repo: RepositoryEntry) => void | Promise<void>;
  sessionsLoaded: boolean;
};

const PROJECT_HOVER_CARD_OPEN_DELAY_MS = 400;
const PROJECT_HOVER_CARD_CLOSE_DELAY_MS = 180;
const PROJECT_HOVER_CARD_WIDTH = 248;

/** 目录行悬浮卡片：置顶开关、任务数量、所在目录（参考 ChatGPT 项目悬浮卡）。 */
function ProjectHoverCard({
  text,
  repo,
  pinned,
  sessionCountLabel,
  sessionsLoaded,
  position,
  onTogglePin,
  onMouseEnter,
  onMouseLeave
}: {
  text: AppText;
  repo: RepositoryEntry;
  pinned: boolean;
  sessionCountLabel: string;
  sessionsLoaded: boolean;
  position: { x: number; y: number };
  onTogglePin: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return createPortal(
    <div
      className="fixed z-[3000] w-[248px] overflow-hidden rounded-xl border border-border/60 bg-popover py-0 text-popover-foreground shadow-[0_10px_36px_-8px_rgba(0,0,0,0.22)] animate-in fade-in-0 zoom-in-95 slide-in-from-left-1 duration-150"
      style={{ left: position.x, top: position.y }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="dialog"
      aria-label={repo.name}
    >
      <div className="flex items-center gap-2 px-3 pt-3">
        <Folder className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{repo.name}</span>
        {/* 置顶态只靠实心图钉区分，不加常亮底色 */}
        <button
          type="button"
          className={cn(
            "shrink-0 rounded-md p-1.5 transition-colors hover:bg-muted",
            pinned ? "text-foreground" : "text-muted-foreground/50 hover:text-foreground"
          )}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
          title={pinned ? text.unpinProject : text.pinProject}
          aria-label={pinned ? text.unpinProject : text.pinProject}
          aria-pressed={pinned}
        >
          {pinned ? <FilledPinIcon className="rotate-45" /> : <SidebarPinnedIcon />}
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2 px-3 pb-3 text-xs text-muted-foreground">
        <MessageCircle className="size-3.5 shrink-0" />
        <span>{sessionsLoaded ? sessionCountLabel : "…"}</span>
      </div>
      <div className="border-t border-border/60" />
      <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
        <FolderOpen className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate" title={repo.path}>{repo.path}</span>
      </div>
    </div>,
    document.body
  );
}

const ProjectRow = memo(function ProjectRow(props: ProjectRowProps) {
  const {
    text,
    repo,
    pinned,
    busy,
    agentInstalled,
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
    onEnsureRepoSessions,
    onOpenRepoContextMenu,
    onTogglePinnedRepo,
    onStartDraftSession,
    onFocusDraftSession,
    onOpenSession,
    onArchiveSession,
    onLoadMoreSessions,
    sessionsLoaded,
  } = props;

  const hasCollapsibleContent = sessionsLoading || sessions.length > 0 || hasMoreSessions || hasDraftForRepo || !agentInstalled;
  const showLoadMoreRow = agentInstalled && (hasMoreSessions || sessionsPaging);
  const loadMorePending = sessionsLoading || sessionsPaging;
  const loadMoreLabel = loadMorePending ? `${text.loadMore}...` : text.loadMore;
  const showLoadingSkeleton = agentInstalled && sessionsLoading && sessions.length === 0;
  const reduceMotion = useReducedMotion();

  // 悬浮卡片：带打开/关闭延迟的 hover intent，卡片本身可悬浮交互（置顶开关）。
  const [hoverCard, setHoverCard] = useState<{ x: number; y: number } | null>(null);
  const hoverCardOpenTimerRef = useRef(0);
  const hoverCardCloseTimerRef = useRef(0);
  const clearHoverCardTimers = () => {
    window.clearTimeout(hoverCardOpenTimerRef.current);
    window.clearTimeout(hoverCardCloseTimerRef.current);
  };
  useEffect(() => clearHoverCardTimers, []);
  const scheduleHoverCardOpen = (event: ReactMouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    clearHoverCardTimers();
    hoverCardOpenTimerRef.current = window.setTimeout(() => {
      setHoverCard({
        x: Math.min(rect.right + 8, window.innerWidth - PROJECT_HOVER_CARD_WIDTH - 8),
        y: Math.min(Math.max(rect.top - 6, 8), window.innerHeight - 132)
      });
      // 未加载过会话列表的目录，打开卡片时顺带拉取，保证任务数量准确。
      if (!sessionsLoaded) onEnsureRepoSessions(repo);
    }, PROJECT_HOVER_CARD_OPEN_DELAY_MS);
  };
  const scheduleHoverCardClose = () => {
    clearHoverCardTimers();
    hoverCardCloseTimerRef.current = window.setTimeout(() => setHoverCard(null), PROJECT_HOVER_CARD_CLOSE_DELAY_MS);
  };
  const cancelHoverCardClose = () => {
    window.clearTimeout(hoverCardCloseTimerRef.current);
  };
  const sessionCountLabel = text.projectTaskCount.replace("{count}", `${sessions.length}${hasMoreSessions ? "+" : ""}`);
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
            onMouseEnter={scheduleHoverCardOpen}
            onMouseLeave={scheduleHoverCardClose}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              clearHoverCardTimers();
              setHoverCard(null);
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
                clearHoverCardTimers();
                setHoverCard(null);
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
              showOnHover
              onClick={(event) => {
                event.stopPropagation();
                onStartDraftSession(repo);
              }}
              title={text.newSession}
              aria-label={text.newSession}
            >
              <SquarePen />
            </SidebarMenuAction>
          </SidebarMenuButton>
        </CollapsibleTrigger>

        {hoverCard ? (
          <ProjectHoverCard
            text={text}
            repo={repo}
            pinned={pinned}
            sessionCountLabel={sessionCountLabel}
            sessionsLoaded={sessionsLoaded}
            position={hoverCard}
            onTogglePin={() => onTogglePinnedRepo(repo.id)}
            onMouseEnter={cancelHoverCardClose}
            onMouseLeave={scheduleHoverCardClose}
          />
        ) : null}

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

                  {!agentInstalled ? (
                    <p className="px-2 py-1 text-xs text-muted-foreground">{text.agentRequired}</p>
                  ) : null}

                  {agentInstalled
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
  // 进行中的会话不允许归档：隐藏归档按钮——既避免与运行中 spinner 在右列重叠，
  // 也防止误归档正在运行的会话（归档会中断/丢失进行中的工作）
  const hasArchive = Boolean(onArchive) && !running;
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
