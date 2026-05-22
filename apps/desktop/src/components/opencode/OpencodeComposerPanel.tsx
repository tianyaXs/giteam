import type {
  ChangeEventHandler,
  ClipboardEventHandler,
  KeyboardEventHandler,
  RefObject
} from "react";
import { OPENCODE_COMPOSER_AGENT_OPTIONS } from "../../lib/opencodeComposerSettings";
import type { OpencodeImageAttachment } from "../../lib/imageAttachments";
import type { OpencodePermissionReply, OpencodePermissionRequest } from "../../lib/opencodePermissions";
import type { OpencodeTodoItem } from "../../lib/opencodeSessions";
import type { QuestionAnswer, QuestionRequest, RepositoryEntry } from "../../lib/types";
import { QuestionDock } from "../QuestionDock";
import { SendIcon } from "../common/AppChromeIcons";
import {
  ArrowDownIcon,
  CheckIcon,
  CloseIcon,
  FolderIcon,
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
  imageAttachments: OpencodeImageAttachment[];
  mcpPromptRefs: string[];
  onRemoveImageAttachment: (id: string) => void;
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
  attachmentMenuOpen: boolean;
  onToggleAttachmentMenu: () => void;
  imageInputRef: RefObject<HTMLInputElement | null>;
  onOpenImagePicker: () => void;
  onImageInputChange: ChangeEventHandler<HTMLInputElement>;
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
  repos: RepositoryEntry[];
  selectedRepoId: string;
  onSelectRepo: (repo: RepositoryEntry) => void;
};

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
    imageAttachments,
    mcpPromptRefs,
    onRemoveImageAttachment,
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
    attachmentMenuOpen,
    onToggleAttachmentMenu,
    imageInputRef,
    onOpenImagePicker,
    onImageInputChange,
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
    onPrimaryAction,
    repos,
    selectedRepoId,
    onSelectRepo
  } = props;

  const activeAgentLabel = OPENCODE_COMPOSER_AGENT_OPTIONS.find((item) => item.name === activeAgent)?.label || "Build";
  const activeModelDisplay = getModelDisplay(activeModel || "");

  return (
    <div className="opencode-input-row">
      <div className="gt-chat-composer-wrap">
        {showSessionProgressBar && todoDockVisible && activeTodos.length > 0 ? (
          <div className="gt-opencode-todo-dock">
            <button
              type="button"
              className="gt-opencode-todo-dock-head"
              onClick={onToggleTodoDockCollapsed}
              aria-expanded={!todoDockCollapsed}
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
            </button>
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
          <div className="gt-permission-dock">
            <div className="gt-permission-dock-head">
              <span>授权请求</span>
              <button type="button" className="chip" onClick={onOpenPermissionsPanel}>详情</button>
            </div>
            {permissions.slice(0, 2).map((request) => (
              <div key={request.id} className="gt-permission-card">
                <div className="gt-permission-main">
                  <strong>{request.permission || "permission"}</strong>
                  <span>{(request.patterns || []).join(", ") || "*"}</span>
                  {request.tool?.callID ? <small>{request.tool.callID}</small> : null}
                </div>
                <div className="gt-permission-actions">
                  <button type="button" className="chip" onClick={() => onReplyPermission(request.id, "once")}>本次允许</button>
                  <button type="button" className="chip primary" onClick={() => onReplyPermission(request.id, "always")}>总是允许</button>
                  <button type="button" className="chip danger" onClick={() => onReplyPermission(request.id, "reject")}>拒绝</button>
                </div>
              </div>
            ))}
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

        <div className="opencode-composer">
          {showJumpLatest ? (
            <button
              type="button"
              className="opencode-jump-latest-btn"
              onClick={onJumpLatest}
              aria-label="拉到最新"
              title="拉到最新"
            >
              <ArrowDownIcon />
            </button>
          ) : null}

          {imageAttachments.length > 0 || mcpPromptRefs.length > 0 ? (
            <div className="opencode-composer-chips">
              {imageAttachments.length > 0 ? (
                <div className="opencode-attachments">
                  {imageAttachments.map((image) => (
                    <div key={image.id} className="opencode-attachment-chip">
                      <img src={image.dataUrl} alt={image.filename} className="opencode-attachment-thumb" />
                      <span className="opencode-attachment-name">{image.filename}</span>
                      <button
                        type="button"
                        className="opencode-attachment-remove"
                        onClick={() => onRemoveImageAttachment(image.id)}
                        aria-label="移除图片"
                      >
                        <CloseIcon width={16} height={16} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {mcpPromptRefs.length > 0 ? (
                <div className="opencode-mcp-reference-chips">
                  {mcpPromptRefs.map((name) => (
                    <div key={name} className="opencode-mcp-reference-chip">
                      <span>{name}</span>
                      <button type="button" onClick={() => onRemoveMcpPromptRef(name)} aria-label={`移除 ${name} MCP 引用`}>
                        <CloseIcon width={14} height={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="opencode-composer-main">
            {slashOpen && slashSuggestions.length > 0 ? (
              <div className="opencode-slash-popover">
                {slashSuggestions.map((command, index) => (
                  <button
                    key={command.id}
                    type="button"
                    className={index === slashActiveIndex ? "opencode-slash-item active" : "opencode-slash-item"}
                    onMouseEnter={() => onHoverSlashSuggestion(index)}
                    onClick={() => onActivateSlashCommand(command)}
                  >
                    <span className="opencode-slash-trigger">/{command.trigger}</span>
                    <span className="opencode-slash-title">{command.title}</span>
                    {command.description ? <span className="opencode-slash-desc">{command.description}</span> : null}
                    <span className={`opencode-slash-badge ${command.source}`}>{command.source}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="opencode-input-shell opencode-composer-editor">
              <textarea
                ref={promptInputRef as RefObject<HTMLTextAreaElement>}
                className="opencode-input"
                placeholder="要做什么？"
                value={promptInput}
                onCompositionStart={onPromptCompositionStart}
                onCompositionEnd={onPromptCompositionEnd}
                onChange={onPromptChange}
                onKeyDown={onPromptKeyDown}
                onPaste={onPromptPaste}
                rows={1}
              />
            </div>
          </div>

          <div className="opencode-composer-actions">
            <div className="opencode-composer-actions-left">
              <div className="opencode-attachment-menu-wrap">
                <button
                  type="button"
                  className={attachmentMenuOpen ? "opencode-image-btn open" : "opencode-image-btn"}
                  onClick={onToggleAttachmentMenu}
                  aria-label={attachmentMenuOpen ? "关闭附件菜单" : "添加附件"}
                  aria-expanded={attachmentMenuOpen}
                  title="添加附件"
                >
                  <span className="opencode-image-btn-icon">{attachmentMenuOpen ? <CloseIcon width={16} height={16} /> : <PlusIcon width={16} height={16} />}</span>
                </button>
                {attachmentMenuOpen ? (
                  <div className="opencode-attachment-menu">
                    <button type="button" className="opencode-attachment-menu-item" onClick={onOpenImagePicker}>
                      <span className="opencode-attachment-menu-icon" aria-hidden="true"><ImageIcon width={18} height={18} /></span>
                      <span>上传图片</span>
                    </button>
                  </div>
                ) : null}
              </div>
              <input
                ref={imageInputRef as RefObject<HTMLInputElement>}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={onImageInputChange}
              />
            </div>

            <div className="opencode-composer-actions-right">
              <div className="opencode-model-picker-wrap opencode-config-inline" ref={modelPickerRef as RefObject<HTMLDivElement>}>
                <button
                  type="button"
                  className="opencode-config-trigger"
                  aria-haspopup="dialog"
                  aria-expanded={showModelPicker}
                  onClick={onToggleModelPicker}
                  title="配置 Agent、Auto 和模型"
                >
                  <span className="opencode-config-trigger-copy">
                    <span className="opencode-config-trigger-mode">{activeAgentLabel}</span>
                    <span className="opencode-config-trigger-model">{activeModelDisplay.label || "Auto"}</span>
                  </span>
                </button>
                {showModelPicker ? (
                  <div className="opencode-model-picker opencode-config-panel">
                    <input
                      className="path-input opencode-model-search"
                      placeholder="Search models"
                      value={modelPickerSearch}
                      onChange={(event) => onModelPickerSearchChange(event.target.value)}
                    />
                    <div className="opencode-config-menu-group" aria-label="Agent 模式">
                      {OPENCODE_COMPOSER_AGENT_OPTIONS.map((agent) => (
                        <button
                          key={agent.name}
                          type="button"
                          aria-pressed={activeAgent === agent.name}
                          className={activeAgent === agent.name ? "opencode-config-menu-row selected" : "opencode-config-menu-row"}
                          onClick={() => onApplyAgent(agent.name)}
                          title={agent.title}
                        >
                          <span>{agent.label}</span>
                          {activeAgent === agent.name ? <span className="opencode-model-option-check"><CheckIcon width={16} height={16} /></span> : null}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className={autoAcceptPermissions ? "opencode-config-menu-row opencode-config-toggle active" : "opencode-config-menu-row opencode-config-toggle"}
                      aria-pressed={autoAcceptPermissions}
                      onClick={onToggleAutoAcceptPermissions}
                    >
                      <span>Auto</span>
                      <span className="opencode-config-switch" aria-hidden="true" />
                    </button>
                    <div className="opencode-config-divider" />
                    <div className="opencode-model-list-col">
                      {configuredModelCandidates.length === 0 ? (
                        <div className="opencode-model-empty">
                          <strong>暂无已配置模型</strong>
                          <span>连接提供商或添加自定义模型后，这里会显示可用项。</span>
                        </div>
                      ) : (
                        configuredModelCandidates.map((modelRef) => {
                          const display = getModelDisplay(modelRef);
                          return (
                            <button
                              type="button"
                              key={`saved-model-${modelRef}`}
                              className={modelRef === activeModel ? "opencode-model-option selected" : "opencode-model-option"}
                              onClick={() => onApplyModel(modelRef)}
                              title={modelRef}
                            >
                              <span className="opencode-model-option-copy">
                                <span className="opencode-model-option-title">{display.label || modelRef}</span>
                                <span className="opencode-model-option-meta">
                                  <span className="opencode-model-option-provider">{display.provider || "Provider"}</span>
                                </span>
                              </span>
                              {modelRef === activeModel ? <span className="opencode-model-option-check"><CheckIcon width={16} height={16} /></span> : null}
                            </button>
                          );
                        })
                      )}
                    </div>
                    <div className="opencode-model-picker-foot">
                      <button type="button" className="opencode-model-picker-config" onClick={onOpenModelSettings}>
                        <span>Add Models</span>
                        <span className="opencode-model-picker-config-tail">⌘</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <button
                className={activeSessionBusy ? "opencode-run-btn opencode-composer-send opencode-stop-btn" : "opencode-run-btn opencode-composer-send"}
                disabled={!activeSessionBusy && !canSubmit}
                onClick={onPrimaryAction}
                aria-label={activeSessionBusy ? "停止" : "发送"}
              >
                <SendIcon busy={activeSessionBusy} />
              </button>
            </div>
          </div>
        </div>

        {showEmptyState && repos.length > 0 ? (
          <div className="gt-empty-composer-meta">
            <div className="gt-empty-composer-repo-picker">
              {repos.map((repo) => (
                <button
                  key={repo.id}
                  className={selectedRepoId === repo.id ? "gt-empty-composer-repo-chip active" : "gt-empty-composer-repo-chip"}
                  onClick={() => onSelectRepo(repo)}
                >
                  <span className="gt-empty-composer-repo-icon"><FolderIcon /></span>
                  <span className="gt-empty-composer-repo-name">{repo.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
