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
import appIconMarkUrl from "../../assets/app-icon-mark.png";
import {
  shortModelLabel,
  thinkingLevelMeta,
  type AgentThinkingLevel,
  type ComposerAgentName
} from "../../lib/agentComposerSettings";
import { getAttachmentBadgeLabel, isImageAttachment, type AgentAttachment } from "../../lib/imageAttachments";
import type { GraphContextRef } from "../../lib/graphContextRefs";
import { describePermissionInteraction, type AgentPermissionReply, type PermissionInteraction } from "../../lib/agentPermissions";
import type { QuestionAnswer, QuestionRequest } from "../../lib/types";
import { QuestionDock } from "../QuestionDock";
import { Confirmation, ConfirmationAction, ConfirmationActions } from "../ai-elements/confirmation";
import { QueueItem, QueueItemContent } from "../ai-elements/queue";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger
} from "../ai-elements/model-selector";
import { Suggestion } from "../ai-elements/suggestion";
import {
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputSubmit,
  PromptInputTextarea
} from "../ai-elements/prompt-input";
import { SendIcon } from "../common/AppChromeIcons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Switch } from "../ui/switch";
import { cn } from "../../lib/utils";
import {
  CheckIcon,
  CloseIcon,
  ImageIcon
} from "../icons";
import { Sparkles, Terminal, FilePen, FileCode, SlidersHorizontal, Wrench, type LucideIcon } from "lucide-react";

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
  modelPickerRef: RefObject<HTMLDivElement | null>;
  showModelPicker: boolean;
  onToggleModelPicker: () => void;
  modelPickerSearch: string;
  onModelPickerSearchChange: (value: string) => void;
  activeAgent: ComposerAgentName | string;
  onApplyAgent: (agentName: string) => void;
  activeThinkingLevel: AgentThinkingLevel;
  thinkingLevelOptions: AgentThinkingLevel[];
  onApplyThinkingLevel: (level: AgentThinkingLevel) => void;
  autoAcceptPermissions: boolean;
  onToggleAutoAcceptPermissions: () => void;
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
  queuedFollowUps?: Array<{ id: string; content: string }>;
  onRemoveQueuedFollowUp?: (id: string) => void;
  /** 空态建议 chips 点击回填(并聚焦输入框)。 */
  onFillPrompt?: (text: string) => void;
};

/** 空态建议(ai-elements Suggestions 风格,ChatGPT 式起手 chips)。 */
const COMPOSER_SUGGESTIONS = [
  "解释一下这个仓库的结构",
  "找出代码里潜在的 bug",
  "最近几次提交改了什么",
  "帮我优化性能热点"
];

type ComposerEditorProps = {
  className?: string;
  textareaClassName?: string;
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  promptInput: string;
  placeholder: string;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  onContextMenu?: MouseEventHandler<HTMLTextAreaElement>;
  onDragOver: DragEventHandler<HTMLTextAreaElement>;
  onDrop: DragEventHandler<HTMLTextAreaElement>;
  slashOpen: boolean;
  slashSuggestions: SlashCommandOption[];
  slashActiveIndex: number;
  onHoverSlashSuggestion: (index: number) => void;
  onActivateSlashCommand: (command: SlashCommandOption) => void;
};

type ComposerAttachmentButtonProps = {
  buttonClassName?: string;
  attachmentMenuOpen: boolean;
  onToggleAttachmentMenu: () => void;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  attachmentInputAccept: string;
  onOpenAttachmentPicker: () => void;
  onAttachmentInputChange: ChangeEventHandler<HTMLInputElement>;
};

/** models.dev 有 logo 的提供商白名单;之外的提供商用兜底图标。 */
const LOGO_PROVIDERS = new Set([
  "openai", "anthropic", "deepseek", "openrouter", "google", "xai", "groq",
  "mistral", "azure", "amazon-bedrock", "togetherai", "fireworks-ai",
  "perplexity", "zai", "zhipuai", "alibaba", "moonshotai", "lmstudio",
  "huggingface", "cerebras", "google-vertex", "ollama"
]);

type ComposerConfigButtonProps = {
  modelPickerRef: RefObject<HTMLDivElement | null>;
  showModelPicker: boolean;
  onToggleModelPicker: () => void;
  configSummaryLabel: string;
  /** 是否已有可用的已启用模型；否则引导去设置配置。 */
  hasConfiguredModel: boolean;
  modelPickerSearch: string;
  onModelPickerSearchChange: (value: string) => void;
  modelValueLabel: string;
  activeThinkingLevel: AgentThinkingLevel;
  thinkingLevelOptions: AgentThinkingLevel[];
  thinkingValueLabel: string;
  onApplyThinkingLevel: (level: AgentThinkingLevel) => void;
  autoAcceptPermissions: boolean;
  onToggleAutoAcceptPermissions: () => void;
  configuredModelCandidates: string[];
  activeModel: string;
  getModelDisplay: (modelRef: string) => AgentModelDisplay;
  onApplyModel: (modelRef: string) => void;
  onOpenModelSettings: () => void;
  labels: {
    model: string;
    configureModels: string;
    configureModelsAction: string;
  };
};

function permissionToolIcon(tool: string): LucideIcon {
  if (tool === "bash") return Terminal;
  if (tool === "edit" || tool === "hashline_edit" || tool === "write") return FilePen;
  if (tool === "read" || tool === "grep" || tool === "find" || tool === "ls") return FileCode;
  return Wrench;
}

function ComposerEditor(props: ComposerEditorProps) {
  return (
    <div className={cn("relative min-w-0 flex-1", props.className)}>
      {props.slashOpen && props.slashSuggestions.length > 0 ? (
        <div className="absolute bottom-full left-0 z-[2600] mb-2 grid max-h-72 w-[min(520px,calc(100vw-48px))] gap-1 overflow-auto rounded-xl border border-border/70 bg-background p-1 shadow-xl">
          {props.slashSuggestions.map((command, index) => (
            <Button
              key={command.id}
              className={cn(
                "grid h-auto w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 text-left",
                index === props.slashActiveIndex && "bg-accent text-accent-foreground"
              )}
              onMouseEnter={() => props.onHoverSlashSuggestion(index)}
              onClick={() => props.onActivateSlashCommand(command)}
              variant="ghost"
            >
              <span className="font-mono text-xs font-semibold text-muted-foreground">/{command.trigger}</span>
              <span className="min-w-0 truncate text-sm font-medium">{command.title}</span>
              <Badge variant="secondary" className="shrink-0 normal-case tracking-normal">
                {command.source}
              </Badge>
              {command.description ? (
                <span className="col-start-2 min-w-0 truncate text-xs text-muted-foreground">{command.description}</span>
              ) : null}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="flex min-w-0 items-end">
        <PromptInputTextarea
          ref={props.promptInputRef as RefObject<HTMLTextAreaElement>}
          className={cn(
            "min-h-8 max-h-40 resize-none rounded-none border-0 bg-transparent px-0 py-1 text-[15px] leading-7 shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            props.textareaClassName
          )}
          style={{ fontSize: 15, lineHeight: "24px" }}
          placeholder={props.placeholder}
          value={props.promptInput}
          onCompositionStart={props.onCompositionStart}
          onCompositionEnd={props.onCompositionEnd}
          onChange={props.onChange}
          onKeyDown={props.onKeyDown}
          onPaste={props.onPaste}
          onContextMenu={props.onContextMenu}
          onDragOver={props.onDragOver}
          onDrop={props.onDrop}
          rows={1}
        />
      </div>
    </div>
  );
}

function ComposerAddIcon(props: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={props.className}
      fill="none"
      height="20"
      viewBox="0 0 20 20"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M10 3.75V16.25M3.75 10H16.25" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

function ComposerAttachmentButton(props: ComposerAttachmentButtonProps) {
  return (
    <>
      <DropdownMenu
        open={props.attachmentMenuOpen}
        onOpenChange={(open) => {
          if (open !== props.attachmentMenuOpen) props.onToggleAttachmentMenu();
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            className={cn(
              // 参考底栏：干净细线 +，默认黑色；与发送按钮同为 size-8。
              "size-8 rounded-full text-foreground [&_svg]:size-[18px]",
              "hover:bg-muted/70 hover:text-foreground",
              props.attachmentMenuOpen && "bg-muted text-foreground",
              props.buttonClassName
            )}
            aria-label={props.attachmentMenuOpen ? "关闭附件菜单" : "添加附件"}
            aria-expanded={props.attachmentMenuOpen}
            title="添加附件"
            variant="ghost"
            size="icon"
          >
            {props.attachmentMenuOpen ? <CloseIcon width={16} height={16} /> : <ComposerAddIcon />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem className="gap-2" onClick={props.onOpenAttachmentPicker}>
              <ImageIcon width={18} height={18} aria-hidden="true" />
              <span>上传图片或文档</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={props.attachmentInputRef as RefObject<HTMLInputElement>}
        type="file"
        accept={props.attachmentInputAccept}
        multiple
        className="hidden"
        onChange={props.onAttachmentInputChange}
      />
    </>
  );
}

function ComposerAttachmentPreview({
  attachment,
  onRemove
}: {
  attachment: AgentAttachment;
  onRemove: (id: string) => void;
}) {
  if (isImageAttachment(attachment)) {
    return (
      <div
        className="group relative size-14 overflow-hidden rounded-2xl border border-border/60 bg-background p-0.5 shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
        title={attachment.filename}
      >
        <img
          src={attachment.dataUrl}
          alt={attachment.filename}
          className="size-full rounded-[13px] border border-border/35 bg-background object-cover"
        />
        <Button
          className="absolute right-0.5 top-0.5 size-5 rounded-full bg-foreground/90 p-0 text-background shadow-sm hover:bg-foreground hover:text-background"
          onClick={() => onRemove(attachment.id)}
          aria-label={`移除 ${attachment.filename}`}
          variant="ghost"
          size="icon"
        >
          <CloseIcon width={12} height={12} />
        </Button>
      </div>
    );
  }

  return (
    <div
      className="group relative size-14 overflow-hidden rounded-2xl border border-border/60 bg-background p-0.5 shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
      title={attachment.filename}
    >
      <div className="flex size-full items-center justify-center rounded-[13px] border border-border/35 bg-muted/45">
        <span className="max-w-[44px] truncate rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] font-semibold tracking-normal text-foreground/85">
          {getAttachmentBadgeLabel(attachment)}
        </span>
      </div>
      <Button
        className="absolute right-0.5 top-0.5 size-5 rounded-full bg-foreground/90 p-0 text-background shadow-sm hover:bg-foreground hover:text-background"
        onClick={() => onRemove(attachment.id)}
        aria-label={`移除 ${attachment.filename}`}
        variant="ghost"
        size="icon"
      >
        <CloseIcon width={12} height={12} />
      </Button>
    </div>
  );
}

function ComposerConfigButton(props: ComposerConfigButtonProps) {
  const updateOpen = (open: boolean) => {
    if (open !== props.showModelPicker) props.onToggleModelPicker();
  };
  const search = props.modelPickerSearch.trim().toLowerCase();
  // 按 provider 分组 + 搜索过滤(models.dev 有 logo 的提供商才渲染图标,否则用兜底图标)。
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const modelRef of props.configuredModelCandidates) {
      const display = props.getModelDisplay(modelRef);
      if (
        search
        && !(modelRef.toLowerCase().includes(search)
          || (display.label || "").toLowerCase().includes(search)
          || (display.provider || "").toLowerCase().includes(search))
      ) {
        continue;
      }
      const provider = display.provider || "其他";
      if (!map.has(provider)) map.set(provider, []);
      map.get(provider)!.push(modelRef);
    }
    return [...map.entries()];
  }, [props.configuredModelCandidates, props.getModelDisplay, search]);

  const pillButton = (
    <Button
      className={cn(
        "h-7 max-w-[220px] rounded-full px-2.5 py-0 text-[13px] font-medium leading-4 text-foreground",
        "hover:bg-muted/70 hover:text-foreground",
        "focus-visible:ring-0 data-[state=open]:bg-muted/70 data-[state=open]:text-foreground"
      )}
      aria-label={props.hasConfiguredModel ? "选择模型" : props.labels.configureModels}
      title={props.hasConfiguredModel ? "选择模型" : props.labels.configureModels}
      variant="ghost"
    >
      <span className="min-w-0 truncate">{props.configSummaryLabel}</span>
    </Button>
  );

  if (!props.hasConfiguredModel) {
    return (
      <div ref={props.modelPickerRef as RefObject<HTMLDivElement>}>
        <span onClick={props.onOpenModelSettings} role="button" tabIndex={0}>
          {pillButton}
        </span>
      </div>
    );
  }

  return (
    <div ref={props.modelPickerRef as RefObject<HTMLDivElement>} className="flex items-center gap-0.5">
      <ModelSelector open={props.showModelPicker} onOpenChange={updateOpen}>
        <ModelSelectorTrigger asChild>
          {pillButton}
        </ModelSelectorTrigger>
        <ModelSelectorContent title={props.labels.model}>
          <ModelSelectorInput
            value={props.modelPickerSearch}
            onValueChange={props.onModelPickerSearchChange}
            placeholder="搜索模型..."
          />
          <ModelSelectorList>
            {groups.map(([provider, refs]) => (
              <ModelSelectorGroup key={provider} heading={provider}>
                {refs.map((modelRef) => {
                  const display = props.getModelDisplay(modelRef);
                  const selected = modelRef === props.activeModel;
                  const providerKey = (display.provider || "").toLowerCase();
                  return (
                    <ModelSelectorItem
                      key={modelRef}
                      value={modelRef}
                      onSelect={() => props.onApplyModel(modelRef)}
                      title={modelRef}
                    >
                      {LOGO_PROVIDERS.has(providerKey) ? (
                        <ModelSelectorLogo provider={providerKey} />
                      ) : (
                        <Sparkles className="size-3 shrink-0 text-muted-foreground" />
                      )}
                      <ModelSelectorName>{display.label || modelRef}</ModelSelectorName>
                      {selected ? <CheckIcon width={14} height={14} className="shrink-0" /> : null}
                    </ModelSelectorItem>
                  );
                })}
              </ModelSelectorGroup>
            ))}
            <ModelSelectorEmpty>没有匹配的模型</ModelSelectorEmpty>
          </ModelSelectorList>
        </ModelSelectorContent>
      </ModelSelector>

      <PromptInputActionMenu>
        <PromptInputActionMenuTrigger
          className="size-7 rounded-full text-foreground hover:bg-muted/70 hover:text-foreground"
          aria-label="推理强度与自动权限"
          title="推理强度与自动权限"
        >
          <SlidersHorizontal className="size-3.5" strokeWidth={1.75} />
        </PromptInputActionMenuTrigger>
        <PromptInputActionMenuContent align="end" side="top" sideOffset={12} className="min-w-[180px]">
          {props.thinkingLevelOptions.map((level) => {
            const meta = thinkingLevelMeta(level);
            const active = props.activeThinkingLevel === level;
            return (
              <PromptInputActionMenuItem
                key={level}
                onSelect={() => props.onApplyThinkingLevel(level)}
                className="justify-between gap-2"
              >
                <span>推理强度 · {meta.label}</span>
                {active ? <CheckIcon width={14} height={14} /> : null}
              </PromptInputActionMenuItem>
            );
          })}
          <PromptInputActionMenuItem
            onSelect={(event) => {
              event.preventDefault();
              props.onToggleAutoAcceptPermissions();
            }}
            className="justify-between gap-2"
          >
            <span>自动接受权限</span>
            <Switch
              size="sm"
              checked={props.autoAcceptPermissions}
              aria-label="自动接受权限"
              tabIndex={-1}
              className="pointer-events-none"
            />
          </PromptInputActionMenuItem>
        </PromptInputActionMenuContent>
      </PromptInputActionMenu>
    </div>
  );
}

function ComposerSubmitButton({
  activeSessionBusy,
  canSubmit,
  hasModel,
  onPrimaryAction
}: {
  activeSessionBusy: boolean;
  canSubmit: boolean;
  hasModel: boolean;
  onPrimaryAction: () => void;
}) {
  // 单一主按钮态机：有内容 → 可发送（空闲发新消息 / busy 插话）；busy 且无内容 → 停止。
  const canSteer = activeSessionBusy && canSubmit;
  const showStop = activeSessionBusy && !canSubmit;
  const disabled = !activeSessionBusy && !canSubmit;
  const idleTitle = !hasModel ? "请先配置并选择模型" : canSubmit ? "发送" : "输入内容后发送";
  const primaryLabel = canSteer ? "插话发送" : showStop ? "停止" : "发送";
  const primaryTitle = canSteer
    ? "发送补充指令（当前任务进行中插话）"
    : showStop
      ? "停止生成"
      : idleTitle;
  return (
    <PromptInputSubmit
      className={cn(
        "size-8 rounded-full shadow-sm transition-[transform,background-color,color,box-shadow] duration-150",
        // 覆盖默认 [&_svg]:size-4，让箭头在圆钮里更饱满。
        "[&_svg]:size-5",
        "hover:-translate-y-0.5 active:translate-y-0",
        disabled
          ? "shadow-none hover:translate-y-0 hover:bg-muted/80"
          : "hover:shadow-md"
      )}
      disabled={disabled}
      onClick={onPrimaryAction}
      aria-label={primaryLabel}
      title={primaryTitle}
      variant={disabled ? "secondary" : "contrast"}
      status={showStop ? "streaming" : undefined}
    >
      <SendIcon busy={showStop} />
    </PromptInputSubmit>
  );
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
    slashOpen,
    slashSuggestions,
    slashActiveIndex,
    onHoverSlashSuggestion,
    onActivateSlashCommand,
    promptInputRef,
    promptInput,
    onPromptCompositionStart,
    onPromptCompositionEnd,
    onPromptChange,
    onPromptKeyDown,
    onPromptPaste,
    onPromptContextMenu,
    onPromptDragOver,
    onPromptDrop,
    attachmentMenuOpen,
    onToggleAttachmentMenu,
    attachmentInputRef,
    attachmentInputAccept,
    onOpenAttachmentPicker,
    onAttachmentInputChange,
    modelPickerRef,
    showModelPicker,
    onToggleModelPicker,
    modelPickerSearch,
    onModelPickerSearchChange,
    activeAgent: _activeAgent,
    onApplyAgent: _onApplyAgent,
    activeThinkingLevel,
    thinkingLevelOptions,
    onApplyThinkingLevel,
    autoAcceptPermissions,
    onToggleAutoAcceptPermissions,
    configuredModelCandidates,
    activeModel,
    getModelDisplay,
    onApplyModel,
    onOpenModelSettings,
    labels,
    activeSessionBusy,
    canSubmit,
    onPrimaryAction,
    queuedFollowUps = [],
    onRemoveQueuedFollowUp,
    onFillPrompt
  } = props;

  const activeModelDisplay = getModelDisplay(activeModel || "");
  const hasConfiguredModel = configuredModelCandidates.length > 0;
  const modelValueLabel = (activeModel || "").trim()
    ? shortModelLabel(activeModelDisplay.label || "", activeModel || "")
    : hasConfiguredModel
      ? "选择模型"
      : "未配置";
  const thinkingValueLabel = thinkingLevelMeta(activeThinkingLevel).shortLabel;
  const hasComposerPreviews = attachments.length > 0 || graphRefs.length > 0;
  // 旧会话空输入始终「继续跟进」；贴图不应改成「要做什么？」。
  const composerPlaceholder = showEmptyState ? "要做什么？" : "继续跟进";
  const configSummaryLabel = (activeModel || "").trim()
    ? `${modelValueLabel} ${thinkingValueLabel}`.trim()
    : hasConfiguredModel
      ? "选择模型"
      : labels.configureModels;
  const visiblePermissions = permissions.slice(0, 2);
  const hiddenPermissionCount = Math.max(0, permissions.length - visiblePermissions.length);
  const previewStripRef = useRef<HTMLDivElement | null>(null);
  const [emptyGrowUpOffset, setEmptyGrowUpOffset] = useState(0);

  // 空状态垂直居中：贴图增高后用负 margin 抵消布局占位，底边与提示文字位置不变，只向上延伸。
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
    const gapPx = 12; // 与卡片内 gap-3 一致
    const sync = () => setEmptyGrowUpOffset(node.offsetHeight + gapPx);
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, [showEmptyState, hasComposerPreviews, attachments.length, graphRefs.length]);

  const editorProps = {
    textareaClassName: "py-0 text-[15px] leading-7",
    promptInputRef,
    promptInput,
    placeholder: composerPlaceholder,
    onCompositionStart: onPromptCompositionStart,
    onCompositionEnd: onPromptCompositionEnd,
    onChange: onPromptChange,
    onKeyDown: onPromptKeyDown,
    onPaste: onPromptPaste,
    onContextMenu: onPromptContextMenu,
    onDragOver: onPromptDragOver,
    onDrop: onPromptDrop,
    slashOpen,
    slashSuggestions,
    slashActiveIndex,
    onHoverSlashSuggestion,
    onActivateSlashCommand
  } as const;

  const reduceMotion = useReducedMotion();
  const previewExpandTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const };

  // 软悬浮：近距微阴影 + 中层 + 远距弥散，避免「只有描边、贴在平面上」的扁平感。
  const composerSurfaceClass =
    "border border-border/55 bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04),0_6px_16px_rgba(15,23,42,0.06),0_18px_44px_rgba(15,23,42,0.09)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_8px_24px_rgba(0,0,0,0.32)]";

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
          <div className="flex w-full min-w-0 flex-wrap items-start justify-start gap-1.5">
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
                  <ComposerAttachmentPreview
                    key={attachment.id}
                    attachment={attachment}
                    onRemove={onRemoveAttachment}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  const configButtonProps: ComposerConfigButtonProps = {
    modelPickerRef,
    showModelPicker,
    onToggleModelPicker,
    configSummaryLabel,
    hasConfiguredModel,
    modelPickerSearch,
    onModelPickerSearchChange,
    modelValueLabel,
    activeThinkingLevel,
    thinkingLevelOptions,
    thinkingValueLabel,
    onApplyThinkingLevel,
    autoAcceptPermissions,
    onToggleAutoAcceptPermissions,
    configuredModelCandidates,
    activeModel,
    getModelDisplay,
    onApplyModel,
    onOpenModelSettings,
    labels
  };

  return (
    <div className={showEmptyState ? "mx-auto flex w-full max-w-[620px] flex-col items-stretch justify-center px-2" : "w-full"}>
      <div className="flex w-full flex-col gap-3">
        {activeSessionStale ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <span>当前会话可能已被移除，请从左侧列表重新选择一个会话。</span>
          </div>
        ) : null}
        {permissions.length > 0 ? (
          <div className="grid gap-2" role="status" aria-live="polite">
            {visiblePermissions.map((request) => {
              const view = describePermissionInteraction(request);
              const ToolIcon = permissionToolIcon(view.tool);
              // 同 AgentModulePanel:仅 pending 阶段渲染,适配 approval-requested 状态。
              return (
                <Confirmation
                  key={request.id}
                  approval={{ id: request.id }}
                  state="approval-requested"
                  className="rounded-xl border-border/60 bg-card/80 p-3 shadow-sm"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
                      <ToolIcon className="h-4 w-4" />
                    </span>
                    <div className="grid min-w-0">
                      <strong className="truncate text-sm font-semibold">{view.tool}</strong>
                      {view.risk ? <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{view.risk}</span> : null}
                    </div>
                  </div>
                  {view.target ? (
                    <code className="min-w-0 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-muted/55 px-3 py-2 font-mono text-xs leading-relaxed">{view.target}</code>
                  ) : null}
                  <ConfirmationActions>
                    <ConfirmationAction onClick={() => onReplyPermission(request.id, "reject")} variant="ghost" size="sm">拒绝</ConfirmationAction>
                    <ConfirmationAction onClick={() => onReplyPermission(request.id, "once")} variant="outline" size="sm">本次允许</ConfirmationAction>
                    <ConfirmationAction onClick={() => onReplyPermission(request.id, "always")} variant="contrast" size="sm">总是允许</ConfirmationAction>
                  </ConfirmationActions>
                </Confirmation>
              );
            })}
            {hiddenPermissionCount > 0 ? (
              <Button type="button" className="h-auto justify-start px-3 py-2 text-xs" onClick={onOpenPermissionsPanel} variant="ghost">
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
          <div className="grid gap-1.5 px-1" role="status" aria-live="polite">
            <div className="text-xs text-muted-foreground">
              {activeSessionBusy ? "将在当前回复结束后继续" : "未发送的跟进"}
            </div>
            {queuedFollowUps.map((item) => (
              <QueueItem
                key={item.id}
                className="flex-row items-start gap-2 bg-muted/45 px-2.5 py-1.5 hover:bg-muted/60"
              >
                <span className="shrink-0 text-muted-foreground">↳</span>
                <QueueItemContent className="line-clamp-none whitespace-pre-wrap break-words text-sm text-foreground/90">
                  {item.content}
                </QueueItemContent>
                {onRemoveQueuedFollowUp ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="删除待发送"
                    onClick={() => onRemoveQueuedFollowUp(item.id)}
                  >
                    <CloseIcon width={12} height={12} />
                  </Button>
                ) : null}
              </QueueItem>
            ))}
          </div>
        ) : null}

        {showEmptyState ? (
          <div
            className="flex w-full flex-col gap-8 motion-safe:transition-[margin-top] motion-safe:duration-200 motion-safe:ease-out"
            style={emptyGrowUpOffset > 0 ? { marginTop: -emptyGrowUpOffset } : undefined}
          >
            <div className="flex flex-col items-center gap-5">
              {/* 透明底 logo 本体，深色主题反白；悬浮旋转一周的彩蛋保留 */}
              <img
                src={appIconMarkUrl}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="size-9 origin-center opacity-[0.92] dark:invert motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] motion-safe:hover:rotate-[360deg]"
              />
              <div className="max-w-[28rem] text-center text-[22px] font-semibold leading-snug tracking-tight text-foreground">
                {(labels.emptyComposerHeadline || "What should we build in {name}?").replace(
                  "{name}",
                  selectedRepoName || "Giteam"
                )}
              </div>
            </div>

            <div className={cn("relative flex w-full min-w-0 flex-col gap-3 rounded-3xl p-5", composerSurfaceClass)}>
              {previewStrip}
              <div className="flex min-h-[102px] w-full min-w-0 flex-1 flex-col gap-3">
                <ComposerEditor className="w-full -mt-0.5" {...editorProps} />
                <div className="mt-auto flex items-end justify-between gap-3">
                  <ComposerAttachmentButton
                    buttonClassName="-ml-[15px] translate-y-[15px]"
                    attachmentMenuOpen={attachmentMenuOpen}
                    onToggleAttachmentMenu={onToggleAttachmentMenu}
                    attachmentInputRef={attachmentInputRef}
                    attachmentInputAccept={attachmentInputAccept}
                    onOpenAttachmentPicker={onOpenAttachmentPicker}
                    onAttachmentInputChange={onAttachmentInputChange}
                  />
                  <div className="flex translate-x-[15px] translate-y-[15px] items-center gap-1">
                    <ComposerConfigButton {...configButtonProps} />
                    <ComposerSubmitButton
                      activeSessionBusy={activeSessionBusy}
                      canSubmit={canSubmit}
                      hasModel={Boolean((activeModel || "").trim())}
                      onPrimaryAction={onPrimaryAction}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 建议 chips 紧贴输入卡下方(官方 ChatGPT 式布局)。
                不用 vendored Suggestions:它的 ScrollArea 包装在自绘 scroll-area
                下高度计算异常会把 chips 裁掉;普通 flex 容器即可。 */}
            {onFillPrompt ? (
              <div className="-mt-5 flex flex-wrap items-center justify-center gap-2 px-2">
                {COMPOSER_SUGGESTIONS.map((suggestion) => (
                  <Suggestion
                    key={suggestion}
                    suggestion={suggestion}
                    onClick={onFillPrompt}
                    variant="outline"
                    className="rounded-full border-border/70 bg-background/70 px-4 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {suggestion}
                  </Suggestion>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          // 旧会话：贴图只叠在输入行上方，底栏「继续跟进」行布局不变，整卡自然向上增高。
          // 「拉到最新」由 AgentChatFrame 悬浮渲染，避免占行或被 footer overflow 裁切。
          <div
            className={cn(
              // 再收一档厚度：控件 size-8 + py-1，贴边约 4px。
              "relative flex w-full min-w-0 flex-col rounded-[24px] px-1 py-1",
              composerSurfaceClass,
              hasComposerPreviews && "gap-2"
            )}
          >
            {previewStrip}
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-1">
              <ComposerAttachmentButton
                attachmentMenuOpen={attachmentMenuOpen}
                onToggleAttachmentMenu={onToggleAttachmentMenu}
                attachmentInputRef={attachmentInputRef}
                attachmentInputAccept={attachmentInputAccept}
                onOpenAttachmentPicker={onOpenAttachmentPicker}
                onAttachmentInputChange={onAttachmentInputChange}
              />
              <ComposerEditor
                {...editorProps}
                // 与 size-8 控件同高，单行文字上下约 4px。
                textareaClassName="min-h-8 py-1 text-[15px] leading-6"
              />
              <div className="flex items-center gap-1">
                <ComposerConfigButton {...configButtonProps} />
                <ComposerSubmitButton
                  activeSessionBusy={activeSessionBusy}
                  canSubmit={canSubmit}
                  hasModel={Boolean((activeModel || "").trim())}
                  onPrimaryAction={onPrimaryAction}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
