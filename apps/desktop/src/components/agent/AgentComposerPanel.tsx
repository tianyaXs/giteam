import * as React from "react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEventHandler,
  type ClipboardEventHandler,
  type DragEventHandler,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type RefObject
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type AgentThinkingLevel,
  type ComposerAgentName
} from "../../lib/agentComposerSettings";
import { getAttachmentBadgeLabel, isImageAttachment, type AgentAttachment } from "../../lib/imageAttachments";
import type { GraphContextRef } from "../../lib/graphContextRefs";
import {
  agentPromptTokens,
  type AgentChatUsage,
  type ContextBreakdown
} from "../../lib/agentSessions";
import { describePermissionInteraction, type AgentPermissionReply, type PermissionInteraction } from "../../lib/agentPermissions";
import type { QuestionAnswer, QuestionRequest } from "../../lib/types";
import { QuestionDock } from "../QuestionDock";
import { DeepAgentComposer } from "../deep-agent-composer/DeepAgentComposer";
import {
  deepAgentAttachmentsToGiteam,
  fromDeepAgentPermission,
  fromDeepAgentPermissionPreset,
  fromDeepAgentThinking,
  readHostThemeTokens,
  toDeepAgentContextUsage,
  toDeepAgentPermission,
  toDeepAgentThinking
} from "../deep-agent-composer/bridge";
import {
  autoAcceptFromPermissionPreset,
  permissionPresetFromAutoAccept,
  type AgentPermissionPreset
} from "../../lib/agentPermissionPresets";
import type { DeepAgentComposerOptions } from "../deep-agent-composer/DeepAgentComposerEngine";
import { FullAccessRiskDialog } from "./FullAccessRiskDialog";
import { Suggestion, Suggestions } from "../ai-elements/suggestion";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { CloseIcon, EditIcon, TrashIcon } from "../icons";
import {
  ArrowUp,
  ChevronDown,
  FilePen,
  FileCode,
  Globe,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";

type SlashCommandOption = {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  source: "builtin" | "command" | "skill";
};

type AgentModelDisplay = {
  label: string;
  provider: string;
  providerLabel?: string;
};

type AgentComposerPanelProps = {
  permissions: PermissionInteraction[];
  onOpenPermissionsPanel: () => void;
  onReplyPermission: (requestId: string, reply: AgentPermissionReply) => void;
  questionLoading: boolean;
  activeQuestions: QuestionRequest[];
  staleQuestions: QuestionRequest[];
  onReplyQuestion: (requestId: string, answers: QuestionAnswer[]) => void;
  onDismissQuestion: (requestId: string) => void;
  onDismissStaleQuestion: (requestId: string) => void;
  showEmptyState: boolean;
  activeSessionStale?: boolean;
  selectedRepoName: string;
  /** @deprecated 拉到最新已改由 AgentChatFrame 悬浮层渲染 */
  showJumpLatest?: boolean;
  onJumpLatest?: () => void;
  attachments: AgentAttachment[];
  onRemoveAttachment: (id: string) => void;
  /** 图谱节点引用 chip（发送时注入 <graph_context>） */
  graphRefs?: GraphContextRef[];
  onRemoveGraphRef?: (id: string) => void;
  slashOpen: boolean;
  slashSuggestions: SlashCommandOption[];
  slashActiveIndex: number;
  onHoverSlashSuggestion: (index: number) => void;
  onActivateSlashCommand: (command: SlashCommandOption) => void;
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  promptInput: string;
  onPromptCompositionStart: () => void;
  onPromptCompositionEnd: () => void;
  onPromptChange: ChangeEventHandler<HTMLTextAreaElement>;
  onPromptKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onPromptPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  onPromptContextMenu?: MouseEventHandler<HTMLTextAreaElement>;
  onPromptDragOver: DragEventHandler<HTMLTextAreaElement>;
  onPromptDrop: DragEventHandler<HTMLTextAreaElement>;
  attachmentMenuOpen: boolean;
  onToggleAttachmentMenu: () => void;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  attachmentInputAccept: string;
  onOpenAttachmentPicker: () => void;
  onAttachmentInputChange: ChangeEventHandler<HTMLInputElement>;
  activeAgent: ComposerAgentName | string;
  onApplyAgent: (agentName: string) => void;
  activeThinkingLevel: AgentThinkingLevel;
  thinkingLevelOptions: AgentThinkingLevel[];
  onApplyThinkingLevel: (level: AgentThinkingLevel) => void;
  autoAcceptPermissions: boolean;
  onToggleAutoAcceptPermissions: () => void;
  /** 对齐 dsh 的三档权限预设；优先于布尔 autoAccept。 */
  permissionPreset?: import("../../lib/agentPermissionPresets").AgentPermissionPreset;
  onApplyPermissionPreset?: (preset: import("../../lib/agentPermissionPresets").AgentPermissionPreset) => void;
  configuredModelCandidates: string[];
  activeModel: string;
  getModelDisplay: (modelRef: string) => AgentModelDisplay;
  onApplyModel: (modelRef: string) => void;
  onOpenModelSettings: () => void;
  labels: {
    model: string;
    configureModels: string;
    configureModelsAction: string;
    emptyComposerHeadline: string;
  };
  activeSessionBusy: boolean;
  canSubmit: boolean;
  onPrimaryAction: () => void;
  /** Deep Agent Composer 提交（文本 + 附件）。 */
  onComposerSubmit: (payload: {
    text: string;
    attachments: AgentAttachment[];
  }) => void;
  queuedFollowUps?: Array<{ id: string; content: string }>;
  onRemoveQueuedFollowUp?: (id: string) => void;
  /** 取回输入框改口。 */
  onEditQueuedFollowUp?: (id: string) => void;
  /** 立刻发送 / 插队：空闲直接发；运行中打断当前回合后发出。 */
  onSendQueuedFollowUpNow?: (id: string) => void;
  /** 空态建议 chips 点击回填(并聚焦输入框)。 */
  onFillPrompt?: (text: string) => void;
  /** 最近一次 assistant 单次 usage（官方 Context 组件）。 */
  contextUsage?: AgentChatUsage | null;
  /** 上下文分类占用（chars÷4 估计）。 */
  contextBreakdown?: ContextBreakdown | null;
  /** 当前模型上下文窗口。 */
  contextWindow?: number | null;
};

/** 空态建议(ai-elements Suggestions 风格,ChatGPT 式起手 chips)。 */
const COMPOSER_SUGGESTIONS = [
  "解释一下这个仓库的结构",
  "找出代码里潜在的 bug",
  "最近几次提交改了什么",
  "帮我优化性能热点"
];

function permissionToolIcon(tool: string): LucideIcon {
  if (tool === "bash") return Terminal;
  if (tool === "edit" || tool === "hashline_edit" || tool === "write") return FilePen;
  if (tool === "read" || tool === "grep" || tool === "find" || tool === "ls") return FileCode;
  if (tool === "web_search" || tool === "web_fetch") return Globe;
  return Wrench;
}

function permissionRiskLabel(risk: string): string {
  const key = risk.trim().toUpperCase();
  if (key === "NETWORK") return "网络";
  if (key === "WRITE" || key === "EDIT") return "写入";
  if (key === "EXEC" || key === "SHELL") return "执行";
  if (key === "READ") return "读取";
  return risk.trim();
}

export function AgentComposerPanel(props: AgentComposerPanelProps) {
  const {
    permissions,
    onOpenPermissionsPanel,
    onReplyPermission,
    questionLoading,
    activeQuestions,
    staleQuestions,
    onReplyQuestion,
    onDismissQuestion,
    onDismissStaleQuestion,
    showEmptyState,
    activeSessionStale,
    selectedRepoName,
    attachments,
    onRemoveAttachment,
    graphRefs = [],
    onRemoveGraphRef,
    activeThinkingLevel,
    thinkingLevelOptions,
    onApplyThinkingLevel,
    autoAcceptPermissions,
    onToggleAutoAcceptPermissions,
    permissionPreset,
    onApplyPermissionPreset,
    configuredModelCandidates,
    activeModel,
    onApplyModel,
    onOpenModelSettings,
    labels,
    activeSessionBusy,
    onPrimaryAction,
    onComposerSubmit,
    queuedFollowUps = [],
    onRemoveQueuedFollowUp,
    onEditQueuedFollowUp,
    onSendQueuedFollowUpNow,
    onFillPrompt,
    contextUsage,
    contextBreakdown,
    contextWindow
  } = props;

  const hasComposerPreviews = attachments.length > 0 || graphRefs.length > 0;
  const composerPlaceholder = showEmptyState ? "尽管问..." : "继续跟进";
  const visiblePermissions = permissions.slice(0, 2);
  const hiddenPermissionCount = Math.max(0, permissions.length - visiblePermissions.length);
  const previewStripRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [fullAccessConfirmOpen, setFullAccessConfirmOpen] = useState(false);
  const fullAccessResolverRef = useRef<((ok: boolean) => void) | null>(null);

  const settleFullAccessConfirm = (ok: boolean) => {
    setFullAccessConfirmOpen(false);
    const resolve = fullAccessResolverRef.current;
    fullAccessResolverRef.current = null;
    resolve?.(ok);
  };

  const requestFullAccessConfirm = () =>
    new Promise<boolean>((resolve) => {
      fullAccessResolverRef.current?.(false);
      fullAccessResolverRef.current = resolve;
      setFullAccessConfirmOpen(true);
    });
  const [emptyGrowUpOffset, setEmptyGrowUpOffset] = useState(0);
  const [draftSeed, setDraftSeed] = useState<{ text: string; key: number } | null>(null);
  const [themeTokens, setThemeTokens] = useState<Record<string, string>>(() => readHostThemeTokens());

  useLayoutEffect(() => {
    if (!showEmptyState || !hasComposerPreviews) {
      setEmptyGrowUpOffset(0);
      return;
    }
    const node = previewStripRef.current;
    if (!node) {
      setEmptyGrowUpOffset(0);
      return;
    }
    const gapPx = 12;
    const sync = () => setEmptyGrowUpOffset(node.offsetHeight + gapPx);
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, [showEmptyState, hasComposerPreviews, attachments.length, graphRefs.length]);

  useLayoutEffect(() => {
    const syncTheme = () => setThemeTokens(readHostThemeTokens(hostRef.current));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"]
    });
    return () => observer.disconnect();
  }, []);

  const reduceMotion = useReducedMotion();
  const previewExpandTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const };

  const models = configuredModelCandidates.length > 0
    ? configuredModelCandidates
    : activeModel
      ? [activeModel]
      : [];

  const composerOptions = useMemo<DeepAgentComposerOptions>(() => ({
    models,
    selectedModel: activeModel || models[0],
    value: toDeepAgentThinking(activeThinkingLevel),
    busy: activeSessionBusy,
    stopping: false,
    disabled: !activeModel && models.length === 0,
    placeholder: composerPlaceholder,
    draftText: draftSeed?.text,
    draftTextKey: draftSeed?.key,
    themeTokens,
    reducedMotion: Boolean(reduceMotion),
    permission: toDeepAgentPermission(
      permissionPreset ?? permissionPresetFromAutoAccept(autoAcceptPermissions)
    ),
    contextUsage: toDeepAgentContextUsage(contextUsage, contextBreakdown, contextWindow),
    contextUsageFallbackTokens: agentPromptTokens(contextUsage),
    onModelChange: (model) => {
      if (!model) {
        onOpenModelSettings();
        return;
      }
      onApplyModel(model);
    },
    onValueChange: (value) => {
      onApplyThinkingLevel(fromDeepAgentThinking(value, thinkingLevelOptions));
    },
    onPermissionChange: (permission) => {
      const nextPreset = fromDeepAgentPermissionPreset(permission);
      const current = permissionPreset ?? permissionPresetFromAutoAccept(autoAcceptPermissions);
      if (nextPreset === current) return;
      if (onApplyPermissionPreset) {
        onApplyPermissionPreset(nextPreset);
        return;
      }
      const nextAuto = autoAcceptFromPermissionPreset(nextPreset);
      if (nextAuto !== autoAcceptPermissions) onToggleAutoAcceptPermissions();
    },
    requestFullAccessConfirm,
    onStop: () => onPrimaryAction(),
    onSubmit: (message) => {
      const text = String(message.text || "").trim();
      const mapped = deepAgentAttachmentsToGiteam(message.attachments || []);
      if (message.model && message.model !== activeModel) onApplyModel(message.model);
      if (message.thinking) {
        onApplyThinkingLevel(fromDeepAgentThinking(message.thinking, thinkingLevelOptions));
      }
      const nextPreset = fromDeepAgentPermissionPreset(message.permission);
      const current = permissionPreset ?? permissionPresetFromAutoAccept(autoAcceptPermissions);
      if (nextPreset !== current) {
        if (onApplyPermissionPreset) onApplyPermissionPreset(nextPreset);
        else if (fromDeepAgentPermission(message.permission) !== autoAcceptPermissions) {
          onToggleAutoAcceptPermissions();
        }
      }
      if (!text && mapped.length === 0 && graphRefs.length === 0) return;
      onComposerSubmit({ text, attachments: mapped });
    }
  }), [
    activeModel,
    activeSessionBusy,
    activeThinkingLevel,
    autoAcceptPermissions,
    onApplyPermissionPreset,
    permissionPreset,
    composerPlaceholder,
    contextBreakdown,
    contextUsage,
    contextWindow,
    draftSeed,
    graphRefs.length,
    models,
    onApplyModel,
    onApplyThinkingLevel,
    onComposerSubmit,
    onOpenModelSettings,
    onPrimaryAction,
    onToggleAutoAcceptPermissions,
    reduceMotion,
    themeTokens,
    thinkingLevelOptions
  ]);

  const previewStrip = (
    <AnimatePresence initial={false}>
      {hasComposerPreviews ? (
        <motion.div
          key="composer-previews"
          ref={showEmptyState ? previewStripRef : undefined}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={previewExpandTransition}
          className="w-full min-w-0 overflow-hidden"
        >
          <div className="flex w-full min-w-0 flex-wrap items-start justify-start gap-1.5 pb-2">
            {graphRefs.length > 0 ? (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {graphRefs.map((ref) => (
                  <div
                    key={ref.id}
                    className="group flex max-w-[220px] items-center gap-1 rounded-full border border-border/60 bg-muted/40 py-0.5 pl-2 pr-1 text-[11px] text-foreground"
                    title={ref.snippet ? `${ref.typeLabel}: ${ref.label}\n${ref.snippet}` : `${ref.typeLabel}: ${ref.label}`}
                  >
                    <span className="shrink-0 text-muted-foreground">{ref.typeLabel}</span>
                    <span className="min-w-0 truncate font-medium">{ref.label}</span>
                    {onRemoveGraphRef ? (
                      <button
                        type="button"
                        className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                        aria-label={`移除引用 ${ref.label}`}
                        onClick={() => onRemoveGraphRef(ref.id)}
                      >
                        <CloseIcon width={10} height={10} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {attachments.length > 0 ? (
              <div className="flex min-w-0 flex-wrap items-start gap-1.5">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="group relative size-14 overflow-hidden rounded-2xl border border-border/60 bg-background p-0.5 shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
                    title={attachment.filename}
                  >
                    {isImageAttachment(attachment) ? (
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.filename}
                        className="size-full rounded-[13px] border border-border/35 bg-background object-cover"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center rounded-[13px] border border-border/35 bg-muted/45">
                        <span className="max-w-[44px] truncate rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] font-semibold text-foreground/85">
                          {getAttachmentBadgeLabel(attachment)}
                        </span>
                      </div>
                    )}
                    <Button
                      className="absolute right-0.5 top-0.5 size-5 rounded-full bg-foreground/90 p-0 text-background shadow-sm hover:bg-foreground hover:text-background"
                      onClick={() => onRemoveAttachment(attachment.id)}
                      aria-label={`移除 ${attachment.filename}`}
                      variant="ghost"
                      size="icon"
                    >
                      <CloseIcon width={12} height={12} />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  const composerCard = (
    <div ref={hostRef} className="relative z-40 w-full min-w-0 overflow-visible">
      {previewStrip}
      <DeepAgentComposer options={composerOptions} className="relative z-40 w-full min-w-0 overflow-visible" />
    </div>
  );

  return (
    <div className={showEmptyState ? "mx-auto flex w-full max-w-[620px] flex-col items-stretch justify-center px-2" : "w-full"}>
      <FullAccessRiskDialog
        open={fullAccessConfirmOpen}
        onOpenChange={(open) => {
          if (!open) settleFullAccessConfirm(false);
          else setFullAccessConfirmOpen(true);
        }}
        onConfirm={() => settleFullAccessConfirm(true)}
      />
      <div className="flex w-full flex-col gap-3">
        {activeSessionStale ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <span>当前会话可能已被移除，请从左侧列表重新选择一个会话。</span>
          </div>
        ) : null}
        {permissions.length > 0 ? (
          <div className="grid gap-1.5" role="status" aria-live="polite">
            {visiblePermissions.map((request) => {
              const view = describePermissionInteraction(request);
              const ToolIcon = permissionToolIcon(view.tool);
              const riskLabel = view.risk ? permissionRiskLabel(view.risk) : "";
              return (
                <div
                  key={request.id}
                  className="rounded-xl border border-border/70 bg-card px-3 py-2 shadow-[var(--gt-elev-card)] dark:shadow-none"
                  title={view.target || undefined}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <ToolIcon className="size-3.5" aria-hidden />
                    </span>
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <strong className="truncate text-[13px] font-semibold leading-5 text-foreground">
                        {view.tool}
                      </strong>
                      {riskLabel ? (
                        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
                          {riskLabel}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => onReplyPermission(request.id, "reject")}
                      >
                        拒绝
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => onReplyPermission(request.id, "once")}
                      >
                        本次允许
                      </Button>
                      <Button
                        type="button"
                        variant="contrast"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => onReplyPermission(request.id, "always")}
                      >
                        总是允许
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
            {hiddenPermissionCount > 0 ? (
              <Button type="button" className="h-auto justify-start px-2 py-1.5 text-xs" onClick={onOpenPermissionsPanel} variant="ghost">
                还有 {hiddenPermissionCount} 条授权请求，前往详情面板处理
              </Button>
            ) : null}
          </div>
        ) : null}

        {activeQuestions.map((request) => (
          <QuestionDock
            key={request.id}
            request={request}
            onReply={onReplyQuestion}
            onDismiss={onDismissQuestion}
          />
        ))}

        {!questionLoading && activeQuestions.length === 0 ? staleQuestions.map((request) => (
          <QuestionDock
            key={request.id}
            request={request}
            disabledReason="该问题已失效，无法提交；请重新发起本轮请求"
            onReply={() => {}}
            onDismiss={onDismissStaleQuestion}
          />
        )) : null}

        {queuedFollowUps.length > 0 ? (
          <Collapsible
            defaultOpen
            className="group overflow-hidden rounded-xl border border-border/70 bg-background/80"
          >
            <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[13px] text-muted-foreground outline-none hover:text-foreground">
              <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=closed]:-rotate-90" strokeWidth={1.8} />
              <span className="tabular-nums">
                {queuedFollowUps.length} Queued Message{queuedFollowUps.length === 1 ? "" : "s"}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-2 pb-2">
              <div className="grid gap-1.5">
                {queuedFollowUps.map((item) => (
                  <div
                    key={item.id}
                    className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/35 px-2.5 py-1.5"
                  >
                    <p className="min-w-0 flex-1 truncate text-[13px] leading-5 text-foreground/90">
                      {item.content}
                    </p>
                    {onSendQueuedFollowUpNow ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label="Send now"
                        onClick={() => onSendQueuedFollowUpNow(item.id)}
                      >
                        <ArrowUp className="size-3.5" strokeWidth={2} />
                      </Button>
                    ) : null}
                    {onEditQueuedFollowUp ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label="Edit"
                        onClick={() => {
                          setDraftSeed({ text: item.content, key: Date.now() });
                          onEditQueuedFollowUp(item.id);
                        }}
                      >
                        <EditIcon width={13} height={13} />
                      </Button>
                    ) : null}
                    {onRemoveQueuedFollowUp ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label="Delete"
                        onClick={() => onRemoveQueuedFollowUp(item.id)}
                      >
                        <TrashIcon width={13} height={13} />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {showEmptyState ? (
          <div
            className="flex w-full flex-col gap-8 motion-safe:transition-[margin-top] motion-safe:duration-200 motion-safe:ease-out"
            style={emptyGrowUpOffset > 0 ? { marginTop: -emptyGrowUpOffset } : undefined}
          >
            <div className="flex flex-col items-center">
              <div className="max-w-[28rem] text-center text-[22px] font-semibold leading-snug tracking-tight text-foreground">
                {(labels.emptyComposerHeadline || "What should we build in {name}?").replace(
                  "{name}",
                  selectedRepoName || "Giteam"
                )}
              </div>
            </div>

            {composerCard}

            {onFillPrompt ? (
              <Suggestions className="-mt-4 justify-center px-2">
                {COMPOSER_SUGGESTIONS.map((suggestion) => (
                  <Suggestion
                    key={suggestion}
                    suggestion={suggestion}
                    onClick={(text) => {
                      setDraftSeed({ text, key: Date.now() });
                      onFillPrompt(text);
                    }}
                    variant="outline"
                    className="border-border/70 bg-background/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {suggestion}
                  </Suggestion>
                ))}
              </Suggestions>
            ) : null}
          </div>
        ) : composerCard}
      </div>
    </div>
  );
}
