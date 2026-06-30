import type {
  ChangeEventHandler,
  ClipboardEventHandler,
  DragEventHandler,
  KeyboardEventHandler,
  MouseEventHandler,
  RefObject
} from "react";
import { OPENCODE_COMPOSER_AGENT_OPTIONS } from "../../lib/opencodeComposerSettings";
import { getAttachmentBadgeLabel, isImageAttachment, type OpencodeAttachment } from "../../lib/imageAttachments";
import type { OpencodePermissionReply, OpencodePermissionRequest } from "../../lib/opencodePermissions";
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  ImageIcon
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

      <div className="flex min-w-0 items-center">
        <Textarea
          ref={props.promptInputRef as RefObject<HTMLTextAreaElement>}
          className={cn(
            "min-h-8 max-h-40 resize-none rounded-none border-0 bg-transparent px-0 py-1 text-[15px] leading-7 shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
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
      height="18"
      viewBox="0 0 20 20"
      width="18"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M10 4.75V15.25M4.75 10H15.25" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
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
              "size-9 rounded-full text-foreground/70 hover:text-foreground",
              props.attachmentMenuOpen && "bg-accent text-accent-foreground",
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
  attachment: OpencodeAttachment;
  onRemove: (id: string) => void;
}) {
  if (isImageAttachment(attachment)) {
    return (
      <div
        className="group relative size-[76px] overflow-hidden rounded-[18px] border border-border/60 bg-background p-1 shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
        title={attachment.filename}
      >
        <img
          src={attachment.dataUrl}
          alt={attachment.filename}
          className="size-full rounded-[14px] border border-border/35 bg-background object-contain"
        />
        <Button
          className="absolute right-1 top-1 size-6 rounded-full bg-foreground/90 p-0 text-background shadow-sm hover:bg-foreground hover:text-background"
          onClick={() => onRemove(attachment.id)}
          aria-label={`移除 ${attachment.filename}`}
          variant="ghost"
          size="icon"
        >
          <CloseIcon width={14} height={14} />
        </Button>
      </div>
    );
  }

  return (
    <div
      className="group relative size-[76px] overflow-hidden rounded-[18px] border border-border/60 bg-background p-1 shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
      title={attachment.filename}
    >
      <div className="flex size-full items-center justify-center rounded-[14px] border border-border/35 bg-muted/45">
        <span className="max-w-[54px] truncate rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] font-semibold tracking-normal text-foreground/85">
          {getAttachmentBadgeLabel(attachment)}
        </span>
      </div>
      <Button
        className="absolute right-1 top-1 size-6 rounded-full bg-foreground/90 p-0 text-background shadow-sm hover:bg-foreground hover:text-background"
        onClick={() => onRemove(attachment.id)}
        aria-label={`移除 ${attachment.filename}`}
        variant="ghost"
        size="icon"
      >
        <CloseIcon width={14} height={14} />
      </Button>
    </div>
  );
}

function ComposerConfigButton(props: ComposerConfigButtonProps) {
  const updateOpen = (open: boolean) => {
    if (open !== props.showModelPicker) props.onToggleModelPicker();
  };

  return (
    <div ref={props.modelPickerRef as RefObject<HTMLDivElement>}>
      <DropdownMenu open={props.showModelPicker} onOpenChange={updateOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            className="h-9 max-w-[190px] rounded-full px-3 text-[13px] font-medium leading-5 focus-visible:ring-0"
            aria-label="配置 Agent、Auto 和模型"
            title="配置 Agent、Auto 和模型"
            variant="ghost"
          >
            <span className="min-w-0 truncate">{props.configSummaryLabel}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          sideOffset={8}
          alignOffset={0}
          className="w-[190px] rounded-[18px] border-border/55 bg-background p-1 shadow-md"
        >
          <DropdownMenuGroup>
            {OPENCODE_COMPOSER_AGENT_OPTIONS.map((agent) => (
              <DropdownMenuItem
                key={agent.name}
                className={cn(
                  "h-7 justify-between rounded-xl px-2.5 text-[13px] font-medium leading-5 data-[highlighted]:bg-muted data-[highlighted]:text-foreground",
                  props.activeAgent === agent.name && "bg-muted text-foreground"
                )}
                onSelect={() => props.onApplyAgent(agent.name)}
                title={agent.title}
              >
                <span>{agent.label}</span>
                {props.activeAgent === agent.name ? <CheckIcon width={14} height={14} /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuItem
            className="h-7 justify-between rounded-xl px-2.5 text-[13px] font-medium leading-5 data-[highlighted]:bg-muted data-[highlighted]:text-foreground"
            onSelect={(event) => {
              event.preventDefault();
              props.onToggleAutoAcceptPermissions();
            }}
          >
            <span>Auto</span>
            <Switch
              size="sm"
              checked={props.autoAcceptPermissions}
              aria-label="自动接受权限"
              tabIndex={-1}
              className="pointer-events-none"
            />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="h-7 justify-between rounded-xl px-2.5 text-[13px] font-medium leading-5 data-[highlighted]:bg-muted data-[highlighted]:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground">
              <span className="min-w-0 truncate">{props.configSummaryLabel || "模型"}</span>
              <ChevronRightIcon width={14} height={14} aria-hidden="true" />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              sideOffset={6}
              className="w-[250px] rounded-[18px] border-border/55 bg-background p-1 shadow-md"
            >
              <div className="px-1 pb-1">
                <Input
                  className="h-8 rounded-xl text-[13px] shadow-none"
                  placeholder="Search models"
                  value={props.modelPickerSearch}
                  onChange={(event) => props.onModelPickerSearchChange(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </div>
              <ScrollArea type="always" className="max-h-72 min-h-0" scrollBarClassName="w-2 bg-transparent py-1" thumbClassName="bg-muted/55 hover:bg-muted/70">
                {props.configuredModelCandidates.length === 0 ? (
                  <div className="px-2.5 py-3 text-[13px] text-muted-foreground">
                    暂无已配置模型
                  </div>
                ) : (
                  <DropdownMenuGroup>
                    {props.configuredModelCandidates.map((modelRef) => {
                      const display = props.getModelDisplay(modelRef);
                      return (
                        <DropdownMenuItem
                          key={`saved-model-${modelRef}`}
                          className={cn(
                            "h-auto min-h-8 justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left data-[highlighted]:bg-muted data-[highlighted]:text-foreground",
                            modelRef === props.activeModel && "bg-muted text-foreground"
                          )}
                          onSelect={() => props.onApplyModel(modelRef)}
                          title={modelRef}
                        >
                          <span className="grid min-w-0 gap-0.5">
                            <span className="min-w-0 truncate text-[13px] font-medium leading-5">{display.label || modelRef}</span>
                            {display.provider ? (
                              <span className="min-w-0 truncate text-[12px] font-medium leading-4 text-muted-foreground">{display.provider}</span>
                            ) : null}
                          </span>
                          {modelRef === props.activeModel ? <CheckIcon width={14} height={14} /> : null}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuGroup>
                )}
              </ScrollArea>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="h-7 justify-between rounded-xl px-2.5 text-[13px] font-medium leading-5 data-[highlighted]:bg-muted data-[highlighted]:text-foreground"
                onSelect={props.onOpenModelSettings}
              >
                <span>Add Models</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
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
  const hasComposerPreviews = attachments.length > 0 || mcpPromptRefs.length > 0;
  const useStackedComposer = showEmptyState || hasComposerPreviews;
  const composerPlaceholder = showEmptyState ? "要做什么？" : isBlankComposer ? "继续跟进" : "要做什么？";
  const configSummaryLabel = activeModelDisplay.label || activeModel || "Auto";
  const visiblePermissions = permissions.slice(0, 2);
  const hiddenPermissionCount = Math.max(0, permissions.length - visiblePermissions.length);

  return (
    <div className={showEmptyState ? "mx-auto flex w-full max-w-[620px] flex-col items-stretch justify-center px-2" : "w-full px-6 pb-4 pt-3"}>
      <div className="flex w-full flex-col gap-3">
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
              : hasComposerPreviews
                ? "flex min-h-[148px] flex-col gap-2 rounded-[28px] px-3 py-2.5"
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

          {hasComposerPreviews ? (
            <div className="col-span-full flex w-full min-w-0 flex-wrap items-start justify-start gap-2">
              {attachments.length > 0 ? (
                <div className="flex min-w-0 flex-wrap items-start gap-2">
                  {attachments.map((attachment) => (
                    <ComposerAttachmentPreview
                      key={attachment.id}
                      attachment={attachment}
                      onRemove={onRemoveAttachment}
                    />
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

          {useStackedComposer ? (
            <>
              <ComposerEditor
                className={cn("w-full", showEmptyState && "-mt-0.5")}
                textareaClassName={cn("py-0 text-[15px] leading-7", hasComposerPreviews && "min-h-8")}
                promptInputRef={promptInputRef}
                promptInput={promptInput}
                placeholder={composerPlaceholder}
                onCompositionStart={onPromptCompositionStart}
                onCompositionEnd={onPromptCompositionEnd}
                onChange={onPromptChange}
                onKeyDown={onPromptKeyDown}
                onPaste={onPromptPaste}
                onContextMenu={onPromptContextMenu}
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
                  buttonClassName="-ml-2 translate-y-1"
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
                onContextMenu={onPromptContextMenu}
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
