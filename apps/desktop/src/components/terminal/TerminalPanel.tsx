import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { ListIcon, PlusIcon, SquareTerminalIcon, Trash2Icon, XIcon } from "lucide-react";
import type { TerminalTabState } from "../../lib/terminalState";
import { Button } from "../ui/button";

function getTerminalDisplayTitle(tab?: TerminalTabState): string {
  const raw = String(tab?.title || "").trim();
  if (!raw || /^终端\s*\d+$/i.test(raw) || /^terminal\s*\d+$/i.test(raw)) return "zsh";
  return raw;
}

type TerminalPanelProps = {
  tabs: TerminalTabState[];
  activeTabId: string;
  activeTab?: TerminalTabState;
  sidebarVisible: boolean;
  theme: "dark" | "light";
  onToggleSidebar: () => void;
  onCreateTab: () => void;
  onCloseTab: (tabId: string) => void;
  onSelectTab: (tabId: string) => void;
  onClearActiveTab: () => void | Promise<void>;
  onInput: (tabId: string, data: string) => void | Promise<void>;
};

export function TerminalPanel({
  tabs,
  activeTabId,
  activeTab,
  sidebarVisible,
  theme,
  onToggleSidebar,
  onCreateTab,
  onCloseTab,
  onSelectTab,
  onClearActiveTab,
  onInput
}: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const activeTabIdRef = useRef(activeTabId);
  const writtenLengthByTabRef = useRef<Record<string, number>>({});
  const displayedTabIdRef = useRef("");
  const startupWriteTimersRef = useRef<Record<string, number>>({});
  const onInputRef = useRef(onInput);
  const activeTitle = getTerminalDisplayTitle(activeTab);
  const terminalCountLabel = `${tabs.length} ${tabs.length === 1 ? "Terminal" : "Terminals"}`;

  activeTabIdRef.current = activeTabId;
  onInputRef.current = onInput;

  const terminalTheme = useMemo(() => (
    theme === "dark"
      ? {
        background: "#0b0f14",
        foreground: "#d6deeb",
        cursor: "#d6deeb",
        selectionBackground: "#2d4f78",
        black: "#111827",
        red: "#f87171",
        green: "#8bd49c",
        yellow: "#f5d67b",
        blue: "#82aaff",
        magenta: "#c792ea",
        cyan: "#89ddff",
        white: "#d6deeb"
      }
      : {
        background: "#ffffff",
        foreground: "#1f2937",
        cursor: "#1f2937",
        selectionBackground: "#cfe4ff",
        black: "#111827",
        red: "#dc2626",
        green: "#15803d",
        yellow: "#a16207",
        blue: "#2563eb",
        magenta: "#9333ea",
        cyan: "#0891b2",
        white: "#f8fafc"
      }
  ), [theme]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "block",
      disableStdin: false,
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.28,
      macOptionIsMeta: true,
      scrollback: 6000,
      theme: terminalTheme
    });

    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const inputDisposable = terminal.onData((data) => {
      const tabId = activeTabIdRef.current;
      if (!tabId) return;
      void onInputRef.current(tabId, data);
    });

    const resize = () => {
      try {
        fitAddon.fit();
      } catch {
        // xterm can throw while its host is temporarily hidden during pane transitions.
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    requestAnimationFrame(resize);

    return () => {
      ro.disconnect();
      for (const timer of Object.values(startupWriteTimersRef.current)) {
        window.clearTimeout(timer);
      }
      startupWriteTimersRef.current = {};
      inputDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;
    terminalRef.current.options.theme = terminalTheme;
  }, [terminalTheme]);

  useEffect(() => {
    for (const tab of tabs) {
      if (writtenLengthByTabRef.current[tab.id] !== undefined) continue;
      writtenLengthByTabRef.current[tab.id] = 0;
    }
  }, [tabs]);

  useLayoutEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !activeTab) return;
    const output = activeTab.output || "";
    const writtenLength = writtenLengthByTabRef.current[activeTab.id] ?? 0;
    const writeStartupFrame = () => {
      terminal.reset();
      terminal.write(output);
      writtenLengthByTabRef.current[activeTab.id] = output.length;
      displayedTabIdRef.current = activeTab.id;
      delete startupWriteTimersRef.current[activeTab.id];
    };

    if (displayedTabIdRef.current !== activeTab.id) {
      if (!output) {
        terminal.reset();
        writtenLengthByTabRef.current[activeTab.id] = 0;
        displayedTabIdRef.current = activeTab.id;
        return;
      }
      const existingTimer = startupWriteTimersRef.current[activeTab.id];
      if (existingTimer) window.clearTimeout(existingTimer);
      startupWriteTimersRef.current[activeTab.id] = window.setTimeout(writeStartupFrame, 45);
      return;
    }

    if (writtenLength > output.length) {
      terminal.reset();
      terminal.write(output);
      writtenLengthByTabRef.current[activeTab.id] = output.length;
      return;
    }

    if (writtenLength === 0) {
      const existingTimer = startupWriteTimersRef.current[activeTab.id];
      if (existingTimer) window.clearTimeout(existingTimer);
      startupWriteTimersRef.current[activeTab.id] = window.setTimeout(writeStartupFrame, 45);
    } else if (output.length > writtenLength) {
      const existingTimer = startupWriteTimersRef.current[activeTab.id];
      if (existingTimer) {
        window.clearTimeout(existingTimer);
        startupWriteTimersRef.current[activeTab.id] = window.setTimeout(writeStartupFrame, 45);
        return;
      }
      terminal.write(output.slice(writtenLength));
      writtenLengthByTabRef.current[activeTab.id] = output.length;
    }
  }, [activeTab?.id, activeTab?.output]);

  useEffect(() => {
    terminalRef.current?.focus();
    requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // ignore hidden-pane fit failures
      }
    });
  }, [activeTabId, sidebarVisible]);

  return (
    <div className="gt-panel-stack gt-panel-stack-terminal">
      <div className={sidebarVisible ? "gt-terminal-header has-sidebar" : "gt-terminal-header"}>
        {sidebarVisible ? (
          <div className="gt-terminal-header-rail">
            <Button className="gt-terminal-icon-btn" onClick={onToggleSidebar} title="隐藏终端列表" variant="ghost" size="icon">
              <ListIcon />
            </Button>
            <span className="gt-terminal-sidebar-meta">{terminalCountLabel}</span>
            <Button className="gt-terminal-icon-btn" onClick={onCreateTab} title="新建终端" variant="ghost" size="icon">
              <PlusIcon />
            </Button>
          </div>
        ) : null}
        <div className="gt-terminal-header-main">
          {!sidebarVisible ? (
            <Button className="gt-terminal-icon-btn active" onClick={onToggleSidebar} title="显示终端列表" variant="ghost" size="icon">
              <ListIcon />
            </Button>
          ) : null}
          <span className="gt-terminal-label">{activeTitle}</span>
          <Button className="gt-terminal-icon-btn gt-terminal-clear-btn" onClick={() => void onClearActiveTab()} title="清空终端" variant="ghost" size="icon">
            <Trash2Icon />
          </Button>
        </div>
      </div>

      <div className={sidebarVisible ? "gt-terminal-layout" : "gt-terminal-layout sidebar-hidden"}>
        {sidebarVisible ? (
          <aside className="gt-terminal-sidebar">
            <div className="gt-terminal-sidebar-list">
              {tabs.map((tab) => (
                <div key={`terminal-side-${tab.id}`} className={tab.id === activeTabId ? "gt-terminal-side-item active" : "gt-terminal-side-item"}>
                  <Button className="gt-terminal-side-item-trigger" onClick={() => onSelectTab(tab.id)} variant="ghost">
                    <span className="gt-terminal-side-item-icon" aria-hidden="true">
                      <SquareTerminalIcon />
                    </span>
                    <span className="gt-terminal-side-item-title">{getTerminalDisplayTitle(tab)}</span>
                  </Button>
                  {tabs.length > 1 ? (
                    <Button
                      className="gt-terminal-side-item-close"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onCloseTab(tab.id);
                      }}
                      aria-label={`关闭终端 ${tab.title}`}
                      variant="ghost"
                      size="icon"
                    >
                      <XIcon />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </aside>
        ) : null}
        <div className="gt-terminal-body">
          <div className="gt-terminal-xterm-host" ref={hostRef} />
        </div>
      </div>
    </div>
  );
}
