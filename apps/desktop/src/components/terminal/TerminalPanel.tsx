import type { CSSProperties, KeyboardEvent, RefObject } from "react";
import { Fragment } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, MenuIcon, PlusIcon } from "../icons";
import {
  getTerminalCompletionGroup,
  type TerminalTabState
} from "../../lib/terminalState";

type TerminalTabPatch = Partial<TerminalTabState> | ((prev: TerminalTabState) => TerminalTabState);

type TerminalView = {
  body: string;
  prompt: string;
};

type TerminalPanelProps = {
  tabs: TerminalTabState[];
  activeTabId: string;
  activeTab?: TerminalTabState;
  activeView: TerminalView;
  ghostText: string;
  sidebarVisible: boolean;
  inputNearTop: boolean;
  bodyRef: RefObject<HTMLDivElement>;
  logRef: RefObject<HTMLDivElement>;
  inputShellRef: RefObject<HTMLDivElement>;
  inputRef: RefObject<HTMLTextAreaElement>;
  hasTextSelection: () => boolean;
  markTextSelecting: (selecting: boolean) => void;
  flushBufferedOutput: (tabId?: string) => void;
  onToggleSidebar: () => void;
  onCreateTab: () => void;
  onCloseTab: (tabId: string) => void;
  onSelectTab: (tabId: string) => void;
  onClearActiveTab: () => void | Promise<void>;
  onUpdateTab: (tabId: string, patch: TerminalTabPatch) => void;
  onRunCommand: () => void | Promise<void>;
  onBrowseHistory: (tabId: string, direction: "older" | "newer") => void;
  onApplyCompletion: (tab: TerminalTabState) => void | Promise<void>;
  onSelectCompletion: (tab: TerminalTabState, index: number) => void;
  onInterrupt: (tab: TerminalTabState) => void | Promise<void>;
};

export function TerminalPanel({
  tabs,
  activeTabId,
  activeTab,
  activeView,
  ghostText,
  sidebarVisible,
  inputNearTop,
  bodyRef,
  logRef,
  inputShellRef,
  inputRef,
  hasTextSelection,
  markTextSelecting,
  flushBufferedOutput,
  onToggleSidebar,
  onCreateTab,
  onCloseTab,
  onSelectTab,
  onClearActiveTab,
  onUpdateTab,
  onRunCommand,
  onBrowseHistory,
  onApplyCompletion,
  onSelectCompletion,
  onInterrupt
}: TerminalPanelProps) {
  const activeInput = activeTab?.input || "";

  function finishTextSelection() {
    window.setTimeout(() => {
      if (hasTextSelection()) return;
      markTextSelecting(false);
      flushBufferedOutput(activeTabId);
    }, 0);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!activeTab) return;
    if (event.key === "Escape") {
      onUpdateTab(activeTab.id, { completionItems: [], completionIndex: 0, completionToken: "" });
      return;
    }
    if (activeTab.completionItems.length > 0 && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      onUpdateTab(activeTab.id, (prev) => ({
        ...prev,
        completionIndex: event.key === "ArrowUp"
          ? (prev.completionIndex - 1 + prev.completionItems.length) % prev.completionItems.length
          : (prev.completionIndex + 1) % prev.completionItems.length
      }));
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void onRunCommand();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onBrowseHistory(activeTab.id, "older");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onBrowseHistory(activeTab.id, "newer");
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      void onApplyCompletion(activeTab);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && !activeTab.input.trim()) {
      event.preventDefault();
      void onInterrupt(activeTab);
    }
  }

  return (
    <div className="gt-panel-stack gt-panel-stack-terminal">
      <div className="gt-terminal-header">
        <button
          type="button"
          className={sidebarVisible ? "chip" : "chip active"}
          onClick={onToggleSidebar}
          title={sidebarVisible ? "隐藏终端列表" : "显示终端列表"}
        >
          <MenuIcon />
        </button>
        <span className="gt-terminal-label">zsh</span>
        <div className="gt-terminal-actions">
          <button className="chip" onClick={() => void onClearActiveTab()}>Clear</button>
        </div>
      </div>
      <div className={sidebarVisible ? "gt-terminal-layout" : "gt-terminal-layout sidebar-hidden"}>
        {sidebarVisible ? (
          <aside className="gt-terminal-sidebar">
            <div className="gt-terminal-sidebar-head">
              <strong>{tabs.length} Terminals</strong>
              <button type="button" className="chip" onClick={onCreateTab} title="新建终端"><PlusIcon /></button>
            </div>
            <div className="gt-terminal-sidebar-list">
              {tabs.map((tab) => (
                <button
                  key={`terminal-side-${tab.id}`}
                  type="button"
                  className={tab.id === activeTabId ? "gt-terminal-side-item active" : "gt-terminal-side-item"}
                  onClick={() => onSelectTab(tab.id)}
                >
                  <span className="gt-terminal-side-item-title">{tab.title}</span>
                  {tabs.length > 1 ? (
                    <span
                      className="gt-terminal-side-item-close"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onCloseTab(tab.id);
                      }}
                      aria-hidden="true"
                    >
                      <CloseIcon width={14} height={14} />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </aside>
        ) : null}
        <div
          className="gt-terminal-body"
          ref={bodyRef}
          onClick={() => {
            if (hasTextSelection()) return;
            inputRef.current?.focus();
          }}
        >
          <div
            ref={logRef}
            className="gt-terminal-console"
            onMouseDown={(event) => {
              if ((event.target as HTMLElement).closest(".gt-terminal-output")) markTextSelecting(true);
            }}
            onMouseUp={finishTextSelection}
            onCopy={finishTextSelection}
          >
            <pre className="gt-terminal-output">{activeView.body || ""}</pre>
            <div className="gt-terminal-inline-input">
              <span className="gt-terminal-prompt">{activeView.prompt || ""}</span>
              <div className="gt-terminal-input-shell" ref={inputShellRef}>
                <textarea
                  ref={inputRef}
                  className="gt-terminal-input"
                  rows={1}
                  value={activeInput}
                  onChange={(event) => {
                    if (!activeTab) return;
                    onUpdateTab(activeTab.id, (prev) => ({
                      ...prev,
                      input: event.target.value,
                      historyIndex: -1,
                      historyDraft: event.target.value,
                      completionItems: [],
                      completionIndex: 0,
                      completionToken: ""
                    }));
                  }}
                  onKeyDown={handleInputKeyDown}
                  placeholder=""
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                />
                {ghostText ? (
                  <span
                    className="gt-terminal-ghost"
                    style={{ left: `${Math.max(0, activeInput.length) * 7.05}px` }}
                  >
                    {ghostText}
                  </span>
                ) : null}
                <TerminalCompletionPopover
                  activeTab={activeTab}
                  inputNearTop={inputNearTop}
                  inputShellRef={inputShellRef}
                  onSelectCompletion={onSelectCompletion}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TerminalCompletionPopover({
  activeTab,
  inputNearTop,
  inputShellRef,
  onSelectCompletion
}: {
  activeTab?: TerminalTabState;
  inputNearTop: boolean;
  inputShellRef: RefObject<HTMLDivElement>;
  onSelectCompletion: (tab: TerminalTabState, index: number) => void;
}) {
  if (!activeTab?.completionItems?.length) return null;

  const items = activeTab.completionItems;
  const idx = activeTab.completionIndex;
  const popoverContent = (
    <div className={`gt-terminal-completion-popover${inputNearTop ? " is-below" : ""}`}>
      {items.map((item, i) => {
        const group = getTerminalCompletionGroup(activeTab.input, item);
        const prev = i > 0 ? getTerminalCompletionGroup(activeTab.input, items[i - 1]) : "";
        return (
          <Fragment key={`terminal-completion-wrap-${item}-${i}`}>
            {group !== prev ? <div className="gt-terminal-completion-group">{group}</div> : null}
            <button
              type="button"
              className={i === idx ? "gt-terminal-completion-item active" : "gt-terminal-completion-item"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelectCompletion(activeTab, i)}
            >
              <span>{item}</span>
              {i === idx ? <kbd>TAB</kbd> : null}
            </button>
          </Fragment>
        );
      })}
    </div>
  );

  if (!inputNearTop) return popoverContent;

  const inputRect = inputShellRef.current?.getBoundingClientRect();
  const style: CSSProperties = inputRect ? {
    position: "fixed",
    left: inputRect.left,
    top: inputRect.bottom + 6,
    minWidth: Math.min(420, inputRect.width),
    maxWidth: Math.min(560, inputRect.width),
    zIndex: 9999
  } : {};
  return createPortal(
    <div style={style}>{popoverContent}</div>,
    document.body
  );
}
