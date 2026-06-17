import type {
  ChangeEventHandler,
  ClipboardEventHandler,
  DragEventHandler,
  KeyboardEventHandler,
  RefObject
} from "react";
import { OPENCODE_COMPOSER_AGENT_OPTIONS } from "../../lib/opencodeComposerSettings";
import { getAttachmentBadgeLabel, isImageAttachment, type OpencodeAttachment } from "../../lib/imageAttachments";
import type { OpencodePermissionReply, OpencodePermissionRequest } from "../../lib/opencodePermissions";
import type { OpencodeTodoItem } from "../../lib/opencodeSessions";
import type { QuestionAnswer, QuestionRequest } from "../../lib/types";
import { QuestionDock } from "../QuestionDock";
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
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  ImageIcon,
  PlusIcon
} from "../icons";

type SlashCommandOption = {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  source: "builtin" | "command" | "skill" | "mcp";
};

type OpencodeModelDisplay = {
  label: string;
  provider: string;
};

type OpencodeComposerPanelProps = {
  showSessionProgressBar: boolean;
  todoDockVisible: boolean;
  todoDockCollapsed: boolean;
  activeTodos: OpencodeTodoItem[];
  todoProgress: {
    total: number;
    done: number;
    active: OpencodeTodoItem | null;
  };
  onToggleTodoDockCollapsed: () => void;
  permissions: OpencodePermissionRequest[];
  onOpenPermissionsPanel: () => void;
  onReplyPermission: (requestId: string, reply: OpencodePermissionReply) => void;
  questionLoading: boolean;
  activeQuestions: QuestionRequest[];
  staleQuestions: QuestionRequest[];
  onReplyQuestion: (requestId: string, answers: QuestionAnswer[]) => void;
  onDismissQuestion: (requestId: string) => void;
  onDismissStaleQuestion: (requestId: string) => void;
  showEmptyState: boolean;
  selectedRepoName: string;
  showJumpLatest: boolean;
  onJumpLatest: () => void;
  attachments: OpencodeAttachment[];
  mcpPromptRefs: string[];
  onRemoveAttachment: (id: string) => void;
  onRemoveMcpPromptRef: (name: string) => void;
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
  activeAgent: string;
  onApplyAgent: (agentName: string) => void;
  autoAcceptPermissions: boolean;
  onToggleAutoAcceptPermissions: () => void;
  configuredModelCandidates: string[];
  activeModel: string;
  getModelDisplay: (modelRef: string) => OpencodeModelDisplay;
  onApplyModel: (modelRef: string) => void;
  onOpenModelSettings: () => void;
  activeSessionBusy: boolean;
  canSubmit: boolean;
  onPrimaryAction: () => void;
};

type ComposerEditorProps = {
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  promptInput: string;
  placeholder: string;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  onDragOver: DragEventHandler<HTMLTextAreaElement>;
  onDrop: DragEventHandler<HTMLTextAreaElement>;
  slashOpen: boolean;
  slashSuggestions: SlashCommandOption[];
  slashActiveIndex: number;
  onHoverSlashSuggestion: (index: number) => void;
  onActivateSlashCommand: (command: SlashCommandOption) => void;
};

type ComposerAttachmentButtonProps = {
  attachmentMenuOpen: boolean;
  onToggleAttachmentMenu: () => void;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  attachmentInputAccept: string;
  onOpenAttachmentPicker: () => void;
  onAttachmentInputChange: ChangeEventHandler<HTMLInputElement>;
};

type ComposerConfigButtonProps = {
  modelPickerRef: RefObject<HTMLDivElement | null>;
  showModelPicker: boolean;
  onToggleModelPicker: () => void;
  configSummaryLabel: string;
  modelPickerSearch: string;
  onModelPickerSearchChange: (value: string) => void;
  activeAgent: string;
  onApplyAgent: (agentName: string) => void;
  autoAcceptPermissions: boolean;
  onToggleAutoAcceptPermissions: () => void;
  configuredModelCandidates: string[];
  activeModel: string;
  getModelDisplay: (modelRef: string) => OpencodeModelDisplay;
  onApplyModel: (modelRef: string) => void;
  onOpenModelSettings: () => void;
};

function formatPermissionPatterns(patterns: string[]): string {
  if (!patterns.length) return "*";
  return patterns.join(" · ");
}

function ComposerEditor(props: ComposerEditorProps) {
  return (
    <div className="relative min-w-0 flex-1">
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

      <div className="flex min-w-0 items-center">
        <Textarea
          ref={props.promptInputRef as RefObject<HTMLTextAreaElement>}
          className="min-h-8 max-h-40 resize-none border-0 bg-transparent px-0 py-1 text-sm leading-6 shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
          placeholder={props.placeholder}
          value={props.promptInput}
          onCompositionStart={props.onCompositionStart}
          onCompositionEnd={props.onCompositionEnd}
          onChange={props.onChange}
          onKeyDown={props.onKeyDown}
          onPaste={props.onPaste}
          onDragOver={props.onDragOver}
          onDrop={props.onDrop}
          rows={1}
        />
      </div>
    </div>
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
            className={cn("size-9 rounded-full", props.attachmentMenuOpen && "bg-accent text-accent-foreground")}
            aria-label={props.attachmentMenuOpen ? "关闭附件菜单" : "添加附件"}
            aria-expanded={props.attachmentMenuOpen}
            title="添加附件"
            variant="ghost"
            size="icon"
          >
            {props.attachmentMenuOpen ? <CloseIcon width={16} height={16} /> : <PlusIcon width={16} height={16} />}
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

function ComposerConfigButton(props: ComposerConfigButtonProps) {
  return (
    <div className="relative" ref={props.modelPickerRef as RefObject<HTMLDivElement>}>
      <Button
        className="h-9 max-w-[190px] rounded-full px-3 text-xs"
        aria-haspopup="dialog"
        aria-expanded={props.showModelPicker}
        onClick={props.onToggleModelPicker}
        title="配置 Agent、Auto 和模型"
        variant="ghost"
      >
        <span className="min-w-0 truncate">{props.configSummaryLabel}</span>
        <ChevronDownIcon width={14} height={14} aria-hidden="true" />
      </Button>
      {props.showModelPicker ? (
        <div className="absolute bottom-full right-0 z-[2600] mb-2 grid w-[min(360px,calc(100vw-48px))] gap-2 rounded-xl border border-border/70 bg-background p-2 shadow-xl">
          <Input
            className="h-9"
            placeholder="Search models"
            value={props.modelPickerSearch}
            onChange={(event) => props.onModelPickerSearchChange(event.target.value)}
          />
          <div className="grid gap-1" aria-label="Agent 模式">
            {OPENCODE_COMPOSER_AGENT_OPTIONS.map((agent) => (
              <Button
                key={agent.name}
                aria-pressed={props.activeAgent === agent.name}
                className={cn("h-9 w-full justify-between px-3 text-sm", props.activeAgent === agent.name && "bg-accent text-accent-foreground")}
                onClick={() => props.onApplyAgent(agent.name)}
                title={agent.title}
                variant="ghost"
              >
                <span>{agent.label}</span>
                {props.activeAgent === agent.name ? <CheckIcon width={16} height={16} /> : null}
              </Button>
            ))}
          </div>
          <div className="flex h-9 items-center justify-between gap-3 rounded-lg px-3 text-sm">
            <span className="font-medium">Auto</span>
            <Switch
              checked={props.autoAcceptPermissions}
              aria-label="自动接受权限"
              onCheckedChange={() => props.onToggleAutoAcceptPermissions()}
            />
          </div>
          <Separator />
          <ScrollArea className="h-56 pr-2">
            {props.configuredModelCandidates.length === 0 ? (
              <div className="grid gap-1 rounded-lg border border-dashed border-border/70 p-4 text-sm">
                <strong>暂无已配置模型</strong>
                <span className="text-xs text-muted-foreground">连接提供商或添加自定义模型后，这里会显示可用项。</span>
              </div>
            ) : (
              props.configuredModelCandidates.map((modelRef) => {
                const display = props.getModelDisplay(modelRef);
                return (
                  <Button
                    key={`saved-model-${modelRef}`}
                    className={cn("h-auto w-full justify-between gap-3 px-3 py-2 text-left", modelRef === props.activeModel && "bg-accent text-accent-foreground")}
                    onClick={() => props.onApplyModel(modelRef)}
                    title={modelRef}
                    variant="ghost"
                  >
                    <span className="grid min-w-0 gap-0.5">
                      <span className="min-w-0 truncate text-sm font-medium">{display.label || modelRef}</span>
                      <span className="min-w-0 truncate text-xs text-muted-foreground">{display.provider || "Provider"}</span>
                    </span>
                    {modelRef === props.activeModel ? <CheckIcon width={16} height={16} /> : null}
                  </Button>
                );
              })
            )}
          </ScrollArea>
          <Button type="button" className="h-9 w-full justify-between px-3" onClick={props.onOpenModelSettings} variant="ghost">
            <span>Add Models</span>
            <span className="text-xs text-muted-foreground">⌘</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ComposerSubmitButton({
  activeSessionBusy,
  canSubmit,
  onPrimaryAction
}: {
  activeSessionBusy: boolean;
  canSubmit: boolean;
  onPrimaryAction: () => void;
}) {
  const disabled = !activeSessionBusy && !canSubmit;
  return (
    <Button
      className={cn(
        "size-9 rounded-full shadow-sm transition-transform hover:-translate-y-0.5 active:translate-y-0",
        disabled && "shadow-none hover:translate-y-0"
      )}
      disabled={disabled}
      onClick={onPrimaryAction}
      aria-label={activeSessionBusy ? "停止" : "发送"}
      title={activeSessionBusy ? "停止生成" : "发送"}
      variant={disabled ? "secondary" : "contrast"}
      size="icon"
    >
      <SendIcon busy={activeSessionBusy} />
    </Button>
  );
}

export function OpencodeComposerPanel(props: OpencodeComposerPanelProps) {
  const {
    showSessionProgressBar,
    todoDockVisible,
    todoDockCollapsed,
    activeTodos,
    todoProgress,
    onToggleTodoDockCollapsed,
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
    selectedRepoName,
    showJumpLatest,
    onJumpLatest,
    attachments,
    mcpPromptRefs,
    onRemoveAttachment,
    onRemoveMcpPromptRef,
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
    activeAgent,
    onApplyAgent,
    autoAcceptPermissions,
    onToggleAutoAcceptPermissions,
    configuredModelCandidates,
    activeModel,
    getModelDisplay,
    onApplyModel,
    onOpenModelSettings,
    activeSessionBusy,
    canSubmit,
    onPrimaryAction
  } = props;

  const activeModelDisplay = getModelDisplay(activeModel || "");
  const isBlankComposer = !promptInput.trim() && attachments.length === 0 && mcpPromptRefs.length === 0;
  const composerPlaceholder = showEmptyState ? "要做什么？" : isBlankComposer ? "继续跟进" : "要做什么？";
  const configSummaryLabel = activeModelDisplay.label || activeModel || "Auto";
  const visiblePermissions = permissions.slice(0, 2);
  const hiddenPermissionCount = Math.max(0, permissions.length - visiblePermissions.length);

  return (
    <div className={showEmptyState ? "mx-auto flex w-full max-w-[620px] flex-col items-stretch justify-center px-2" : "w-full px-6 pb-4 pt-3"}>
      <div className="flex w-full flex-col gap-3">
        {showSessionProgressBar && todoDockVisible && activeTodos.length > 0 ? (
          <div className="grid gap-2 rounded-xl border border-border/60 bg-card/70 p-2">
            <Button
              className="h-auto w-full justify-between px-3 py-2 text-left"
              onClick={onToggleTodoDockCollapsed}
              aria-expanded={!todoDockCollapsed}
              variant="ghost"
            >
              <span className="min-w-0 text-sm font-medium">
                已完成 {todoProgress.done} 个任务（共 {todoProgress.total} 个）
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {todoDockCollapsed ? todoProgress.active?.content || "" : ""}
              </span>
              <ChevronDownIcon className={cn("transition-transform", todoDockCollapsed && "-rotate-90")} width={16} height={16} aria-hidden="true" />
            </Button>
            {!todoDockCollapsed ? (
              <div className="grid gap-1.5 px-1 pb-1">
                {activeTodos.map((todo) => (
                  <div key={todo.id} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border/70 text-muted-foreground" aria-hidden="true">
                      {todo.status === "completed" ? (
                        <CheckIcon width={14} height={14} />
                      ) : todo.status === "in_progress" ? (
                        <span className="flex items-center gap-0.5">
                          <span className="size-1 animate-pulse rounded-full bg-foreground/65" />
                          <span className="size-1 animate-pulse rounded-full bg-foreground/50" />
                          <span className="size-1 animate-pulse rounded-full bg-foreground/35" />
                        </span>
                      ) : (
                        ""
                      )}
                    </span>
                    <span className="min-w-0 truncate">{todo.content}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {permissions.length > 0 ? (
          <div className="grid gap-2 rounded-xl border border-border/60 bg-card/70 p-2" role="status" aria-live="polite">
            <div className="flex items-center justify-between px-1">
              <Badge variant="outline" className="normal-case tracking-normal">请求授权</Badge>
            </div>
            {visiblePermissions.map((request) => (
              <div key={request.id} className="grid gap-3 rounded-lg border border-border/45 bg-background/70 p-3">
                <div className="grid min-w-0 gap-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <strong className="min-w-0 truncate text-sm">{request.permission || "permission"}</strong>
                    {request.tool?.callID ? <span className="shrink-0 text-xs text-muted-foreground">{request.tool.callID}</span> : null}
                  </div>
                  <div className="grid min-w-0 gap-1">
                    <span className="text-xs text-muted-foreground">作用范围</span>
                    <code className="min-w-0 break-words rounded-md bg-muted/55 px-2 py-1 font-mono text-xs">{formatPermissionPatterns(request.patterns || [])}</code>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    onClick={() => onReplyPermission(request.id, "once")}
                    variant="outline"
                    size="sm"
                  >
                    本次允许
                  </Button>
                  <Button
                    onClick={() => onReplyPermission(request.id, "always")}
                    variant="contrast"
                    size="sm"
                  >
                    总是允许
                  </Button>
                  <Button
                    onClick={() => onReplyPermission(request.id, "reject")}
                    variant="destructive"
                    size="sm"
                  >
                    拒绝
                  </Button>
                </div>
              </div>
            ))}
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

        {showEmptyState ? (
          <div className="text-center text-lg font-semibold text-foreground">What should we build in {selectedRepoName || "Giteam"}?</div>
        ) : null}

        <div
          className={cn(
            "relative w-full min-w-0 border border-border/70 bg-card text-card-foreground shadow-sm",
            showEmptyState
              ? "flex min-h-[142px] flex-col gap-3 rounded-3xl p-5"
              : "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[28px] px-2 py-2"
          )}
        >
          {showJumpLatest ? (
            <Button
              className="absolute -top-11 left-1/2 size-9 -translate-x-1/2 rounded-full shadow-md"
              onClick={onJumpLatest}
              aria-label="拉到最新"
              title="拉到最新"
              variant="ghost"
              size="icon"
            >
              <ArrowDownIcon />
            </Button>
          ) : null}

          {attachments.length > 0 || mcpPromptRefs.length > 0 ? (
            <div className="col-span-full flex min-w-0 flex-wrap items-center gap-2">
              {attachments.length > 0 ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {attachments.map((attachment) => (
                    <Badge key={attachment.id} variant="outline" className="max-w-full gap-2 normal-case tracking-normal">
                      {isImageAttachment(attachment) ? (
                        <img src={attachment.dataUrl} alt={attachment.filename} className="size-6 rounded object-cover" />
                      ) : (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">{getAttachmentBadgeLabel(attachment)}</span>
                      )}
                      <span className="min-w-0 truncate" title={attachment.filename}>{attachment.filename}</span>
                      <Button
                        className="size-5 shrink-0 rounded-full p-0"
                        onClick={() => onRemoveAttachment(attachment.id)}
                        aria-label={`移除 ${attachment.filename}`}
                        variant="ghost"
                        size="icon"
                      >
                        <CloseIcon width={16} height={16} />
                      </Button>
                    </Badge>
                  ))}
                </div>
              ) : null}
              {mcpPromptRefs.length > 0 ? (
                <div className="flex min-w-0 flex-wrap items-start gap-1.5">
                  {mcpPromptRefs.map((name) => (
                    <Badge key={name} variant="outline" className="max-w-full gap-1.5 normal-case tracking-normal">
                      <span className="min-w-0 truncate">{name}</span>
                      <Button
                        type="button"
                        className="size-5 shrink-0 rounded-full p-0"
                        onClick={() => onRemoveMcpPromptRef(name)}
                        aria-label={`移除 ${name} MCP 引用`}
                        variant="ghost"
                        size="icon"
                      >
                        <CloseIcon width={14} height={14} />
                      </Button>
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {showEmptyState ? (
            <>
              <ComposerEditor
                promptInputRef={promptInputRef}
                promptInput={promptInput}
                placeholder={composerPlaceholder}
                onCompositionStart={onPromptCompositionStart}
                onCompositionEnd={onPromptCompositionEnd}
                onChange={onPromptChange}
                onKeyDown={onPromptKeyDown}
                onPaste={onPromptPaste}
                onDragOver={onPromptDragOver}
                onDrop={onPromptDrop}
                slashOpen={slashOpen}
                slashSuggestions={slashSuggestions}
                slashActiveIndex={slashActiveIndex}
                onHoverSlashSuggestion={onHoverSlashSuggestion}
                onActivateSlashCommand={onActivateSlashCommand}
              />
              <div className="mt-auto flex items-center justify-between gap-3">
                <ComposerAttachmentButton
                  attachmentMenuOpen={attachmentMenuOpen}
                  onToggleAttachmentMenu={onToggleAttachmentMenu}
                  attachmentInputRef={attachmentInputRef}
                  attachmentInputAccept={attachmentInputAccept}
                  onOpenAttachmentPicker={onOpenAttachmentPicker}
                  onAttachmentInputChange={onAttachmentInputChange}
                />
                <div className="flex items-center gap-2">
                  <ComposerConfigButton
                    modelPickerRef={modelPickerRef}
                    showModelPicker={showModelPicker}
                    onToggleModelPicker={onToggleModelPicker}
                    configSummaryLabel={configSummaryLabel}
                    modelPickerSearch={modelPickerSearch}
                    onModelPickerSearchChange={onModelPickerSearchChange}
                    activeAgent={activeAgent}
                    onApplyAgent={onApplyAgent}
                    autoAcceptPermissions={autoAcceptPermissions}
                    onToggleAutoAcceptPermissions={onToggleAutoAcceptPermissions}
                    configuredModelCandidates={configuredModelCandidates}
                    activeModel={activeModel}
                    getModelDisplay={getModelDisplay}
                    onApplyModel={onApplyModel}
                    onOpenModelSettings={onOpenModelSettings}
                  />
                  <ComposerSubmitButton
                    activeSessionBusy={activeSessionBusy}
                    canSubmit={canSubmit}
                    onPrimaryAction={onPrimaryAction}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center">
              <ComposerAttachmentButton
                attachmentMenuOpen={attachmentMenuOpen}
                onToggleAttachmentMenu={onToggleAttachmentMenu}
                attachmentInputRef={attachmentInputRef}
                attachmentInputAccept={attachmentInputAccept}
                onOpenAttachmentPicker={onOpenAttachmentPicker}
                onAttachmentInputChange={onAttachmentInputChange}
              />
              </div>
              <ComposerEditor
                promptInputRef={promptInputRef}
                promptInput={promptInput}
                placeholder={composerPlaceholder}
                onCompositionStart={onPromptCompositionStart}
                onCompositionEnd={onPromptCompositionEnd}
                onChange={onPromptChange}
                onKeyDown={onPromptKeyDown}
                onPaste={onPromptPaste}
                onDragOver={onPromptDragOver}
                onDrop={onPromptDrop}
                slashOpen={slashOpen}
                slashSuggestions={slashSuggestions}
                slashActiveIndex={slashActiveIndex}
                onHoverSlashSuggestion={onHoverSlashSuggestion}
                onActivateSlashCommand={onActivateSlashCommand}
              />
              <div className="flex items-center gap-2">
              <ComposerConfigButton
                modelPickerRef={modelPickerRef}
                showModelPicker={showModelPicker}
                onToggleModelPicker={onToggleModelPicker}
                configSummaryLabel={configSummaryLabel}
                modelPickerSearch={modelPickerSearch}
                onModelPickerSearchChange={onModelPickerSearchChange}
                activeAgent={activeAgent}
                onApplyAgent={onApplyAgent}
                autoAcceptPermissions={autoAcceptPermissions}
                onToggleAutoAcceptPermissions={onToggleAutoAcceptPermissions}
                configuredModelCandidates={configuredModelCandidates}
                activeModel={activeModel}
                getModelDisplay={getModelDisplay}
                onApplyModel={onApplyModel}
                onOpenModelSettings={onOpenModelSettings}
              />
              <ComposerSubmitButton
                activeSessionBusy={activeSessionBusy}
                canSubmit={canSubmit}
                onPrimaryAction={onPrimaryAction}
              />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
