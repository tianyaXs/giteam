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
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
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
    <div className="opencode-composer-main">
      {props.slashOpen && props.slashSuggestions.length > 0 ? (
        <div className="opencode-slash-popover">
          {props.slashSuggestions.map((command, index) => (
            <Button
              key={command.id}
              className={index === props.slashActiveIndex ? "opencode-slash-item active" : "opencode-slash-item"}
              onMouseEnter={() => props.onHoverSlashSuggestion(index)}
              onClick={() => props.onActivateSlashCommand(command)}
              variant="ghost"
            >
              <span className="opencode-slash-trigger">/{command.trigger}</span>
              <span className="opencode-slash-title">{command.title}</span>
              {command.description ? <span className="opencode-slash-desc">{command.description}</span> : null}
              <span className={`opencode-slash-badge ${command.source}`}>{command.source}</span>
            </Button>
          ))}
        </div>
      ) : null}

      <div className="opencode-input-shell opencode-composer-editor">
        <Textarea
          ref={props.promptInputRef as RefObject<HTMLTextAreaElement>}
          className="opencode-input"
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
            className={props.attachmentMenuOpen ? "opencode-image-btn open" : "opencode-image-btn"}
            aria-label={props.attachmentMenuOpen ? "关闭附件菜单" : "添加附件"}
            aria-expanded={props.attachmentMenuOpen}
            title="添加附件"
            variant="ghost"
            size="icon"
          >
            <span className="opencode-image-btn-icon">
              {props.attachmentMenuOpen ? <CloseIcon width={16} height={16} /> : <PlusIcon width={16} height={16} />}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="opencode-attachment-menu">
          <DropdownMenuGroup>
            <DropdownMenuItem className="opencode-attachment-menu-item" onClick={props.onOpenAttachmentPicker}>
              <span className="opencode-attachment-menu-icon" aria-hidden="true"><ImageIcon width={18} height={18} /></span>
              <span className="opencode-attachment-menu-label">上传图片或文档</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={props.attachmentInputRef as RefObject<HTMLInputElement>}
        type="file"
        accept={props.attachmentInputAccept}
        multiple
        style={{ display: "none" }}
        onChange={props.onAttachmentInputChange}
      />
    </>
  );
}

function ComposerConfigButton(props: ComposerConfigButtonProps) {
  return (
    <div className="opencode-model-picker-wrap opencode-config-inline" ref={props.modelPickerRef as RefObject<HTMLDivElement>}>
      <Button
        className="opencode-config-trigger"
        aria-haspopup="dialog"
        aria-expanded={props.showModelPicker}
        onClick={props.onToggleModelPicker}
        title="配置 Agent、Auto 和模型"
        variant="ghost"
      >
        <span className="opencode-config-trigger-copy">
          <span className="opencode-config-trigger-model is-compact">{props.configSummaryLabel}</span>
        </span>
        <span className="opencode-config-caret" aria-hidden="true"><ChevronDownIcon width={14} height={14} /></span>
      </Button>
      {props.showModelPicker ? (
        <div className="opencode-model-picker opencode-config-panel">
          <Input
            className="path-input opencode-model-search"
            placeholder="Search models"
            value={props.modelPickerSearch}
            onChange={(event) => props.onModelPickerSearchChange(event.target.value)}
          />
          <div className="opencode-config-menu-group" aria-label="Agent 模式">
            {OPENCODE_COMPOSER_AGENT_OPTIONS.map((agent) => (
              <Button
                key={agent.name}
                aria-pressed={props.activeAgent === agent.name}
                className={props.activeAgent === agent.name ? "opencode-config-menu-row selected" : "opencode-config-menu-row"}
                onClick={() => props.onApplyAgent(agent.name)}
                title={agent.title}
                variant="ghost"
              >
                <span>{agent.label}</span>
                {props.activeAgent === agent.name ? <span className="opencode-model-option-check"><CheckIcon width={16} height={16} /></span> : null}
              </Button>
            ))}
          </div>
          <div className="opencode-config-menu-row opencode-config-toggle">
            <span>Auto</span>
            <Switch
              checked={props.autoAcceptPermissions}
              className="opencode-config-switch"
              aria-label="自动接受权限"
              onCheckedChange={() => props.onToggleAutoAcceptPermissions()}
            />
          </div>
          <div className="opencode-config-divider" />
          <ScrollArea className="opencode-model-list-col">
            {props.configuredModelCandidates.length === 0 ? (
              <div className="opencode-model-empty">
                <strong>暂无已配置模型</strong>
                <span>连接提供商或添加自定义模型后，这里会显示可用项。</span>
              </div>
            ) : (
              props.configuredModelCandidates.map((modelRef) => {
                const display = props.getModelDisplay(modelRef);
                return (
                  <Button
                    key={`saved-model-${modelRef}`}
                    className={modelRef === props.activeModel ? "opencode-model-option selected" : "opencode-model-option"}
                    onClick={() => props.onApplyModel(modelRef)}
                    title={modelRef}
                    variant="ghost"
                  >
                    <span className="opencode-model-option-copy">
                      <span className="opencode-model-option-title">{display.label || modelRef}</span>
                      <span className="opencode-model-option-meta">
                        <span className="opencode-model-option-provider">{display.provider || "Provider"}</span>
                      </span>
                    </span>
                    {modelRef === props.activeModel ? <span className="opencode-model-option-check"><CheckIcon width={16} height={16} /></span> : null}
                  </Button>
                );
              })
            )}
          </ScrollArea>
          <div className="opencode-model-picker-foot">
            <Button type="button" className="opencode-model-picker-config" onClick={props.onOpenModelSettings} variant="ghost">
              <span>Add Models</span>
              <span className="opencode-model-picker-config-tail">⌘</span>
            </Button>
          </div>
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
  return (
    <Button
      className={activeSessionBusy ? "opencode-run-btn opencode-composer-send opencode-stop-btn" : "opencode-run-btn opencode-composer-send"}
      disabled={!activeSessionBusy && !canSubmit}
      onClick={onPrimaryAction}
      aria-label={activeSessionBusy ? "停止" : "发送"}
      variant="default"
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
    <div className="opencode-input-row">
      <div className="gt-chat-composer-wrap">
        {showSessionProgressBar && todoDockVisible && activeTodos.length > 0 ? (
          <div className="gt-opencode-todo-dock">
            <Button
              className="gt-opencode-todo-dock-head"
              onClick={onToggleTodoDockCollapsed}
              aria-expanded={!todoDockCollapsed}
              variant="ghost"
            >
              <span className="gt-opencode-todo-dock-progress">
                已完成 {todoProgress.done} 个任务（共 {todoProgress.total} 个）
              </span>
              <span className="gt-opencode-todo-dock-preview">
                {todoDockCollapsed ? todoProgress.active?.content || "" : ""}
              </span>
              <span className={todoDockCollapsed ? "gt-opencode-todo-dock-chevron is-collapsed" : "gt-opencode-todo-dock-chevron"} aria-hidden="true">
                <span />
                <span />
              </span>
            </Button>
            {!todoDockCollapsed ? (
              <div className="gt-opencode-todo-dock-list">
                {activeTodos.map((todo) => (
                  <div key={todo.id} className={`gt-opencode-todo-item is-${todo.status}`}>
                    <span className="gt-opencode-todo-item-check" aria-hidden="true">
                      {todo.status === "completed" ? (
                        <CheckIcon />
                      ) : todo.status === "in_progress" ? (
                        <span className="gt-opencode-todo-thinking">
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : (
                        ""
                      )}
                    </span>
                    <span className="gt-opencode-todo-item-content">{todo.content}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {permissions.length > 0 ? (
          <div className="gt-permission-dock" role="status" aria-live="polite">
            <div className="gt-permission-dock-head">
              <div className="gt-permission-dock-head-main">
                <span className="gt-permission-dock-badge">请求授权</span>
              </div>
            </div>
            {visiblePermissions.map((request) => (
              <div key={request.id} className="gt-permission-card">
                <div className="gt-permission-main">
                  <div className="gt-permission-main-top">
                    <strong>{request.permission || "permission"}</strong>
                    {request.tool?.callID ? <small className="gt-permission-call-id">{request.tool.callID}</small> : null}
                  </div>
                  <div className="gt-permission-meta-row">
                    <span className="gt-permission-meta-label">作用范围</span>
                    <code className="gt-permission-meta-value">{formatPermissionPatterns(request.patterns || [])}</code>
                  </div>
                </div>
                <div className="gt-permission-actions">
                  <Button
                    className="gt-permission-action gt-permission-action-secondary"
                    onClick={() => onReplyPermission(request.id, "once")}
                    variant="outline"
                    size="sm"
                  >
                    本次允许
                  </Button>
                  <Button
                    className="gt-permission-action gt-permission-action-primary"
                    onClick={() => onReplyPermission(request.id, "always")}
                    variant="contrast"
                    size="sm"
                  >
                    总是允许
                  </Button>
                  <Button
                    className="gt-permission-action gt-permission-action-danger"
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
              <Button type="button" className="gt-permission-dock-more" onClick={onOpenPermissionsPanel} variant="ghost">
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
          <div className="gt-empty-composer-title">What should we build in {selectedRepoName || "Giteam"}?</div>
        ) : null}

        <div className={showEmptyState ? "opencode-composer opencode-composer-v2 is-empty-state" : "opencode-composer opencode-composer-v2"}>
          {showJumpLatest ? (
            <Button
              className="opencode-jump-latest-btn"
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
            <div className="opencode-composer-chips">
              {attachments.length > 0 ? (
                <div className="opencode-attachments">
                  {attachments.map((attachment) => (
                    <div key={attachment.id} className={isImageAttachment(attachment) ? "opencode-attachment-chip is-image" : "opencode-attachment-chip is-file"}>
                      {isImageAttachment(attachment) ? (
                        <img src={attachment.dataUrl} alt={attachment.filename} className="opencode-attachment-thumb" />
                      ) : (
                        <span className="opencode-attachment-filetype">{getAttachmentBadgeLabel(attachment)}</span>
                      )}
                      <span className="opencode-attachment-name" title={attachment.filename}>{attachment.filename}</span>
                      <Button
                        className="opencode-attachment-remove"
                        onClick={() => onRemoveAttachment(attachment.id)}
                        aria-label={`移除 ${attachment.filename}`}
                        variant="ghost"
                        size="icon"
                      >
                        <CloseIcon width={16} height={16} />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              {mcpPromptRefs.length > 0 ? (
                <div className="opencode-mcp-reference-chips">
                  {mcpPromptRefs.map((name) => (
                    <div key={name} className="opencode-mcp-reference-chip">
                      <span>{name}</span>
                      <Button type="button" onClick={() => onRemoveMcpPromptRef(name)} aria-label={`移除 ${name} MCP 引用`} variant="ghost" size="icon">
                        <CloseIcon width={14} height={14} />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

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

          <div className="opencode-composer-actions">
            <div className="opencode-composer-actions-left">
              <ComposerAttachmentButton
                attachmentMenuOpen={attachmentMenuOpen}
                onToggleAttachmentMenu={onToggleAttachmentMenu}
                attachmentInputRef={attachmentInputRef}
                attachmentInputAccept={attachmentInputAccept}
                onOpenAttachmentPicker={onOpenAttachmentPicker}
                onAttachmentInputChange={onAttachmentInputChange}
              />
            </div>

            <div className="opencode-composer-actions-right">
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
        </div>
      </div>
    </div>
  );
}
