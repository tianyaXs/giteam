import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { ListIcon, PlusIcon, SquareTerminalIcon, Trash2Icon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalTabState } from "../../lib/terminalState";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { useCodeFontSize } from "../../lib/useAppearanceFontSize";

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
  onResize?: (tabId: string, cols: number, rows: number) => void | Promise<void>;
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
  onInput,
  onResize
}: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const activeTabIdRef = useRef(activeTabId);
  const writtenLengthByTabRef = useRef<Record<string, number>>({});
  const displayedTabIdRef = useRef("");
  const startupWriteTimersRef = useRef<Record<string, number>>({});
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const lastPtySizeRef = useRef({ cols: 0, rows: 0 });
  const resizeTimerRef = useRef<number | null>(null);
  const codeFontSize = useCodeFontSize();
  const activeTitle = getTerminalDisplayTitle(activeTab);
  const terminalCountLabel = `${tabs.length} ${tabs.length === 1 ? "Terminal" : "Terminals"}`;

  activeTabIdRef.current = activeTabId;
  onInputRef.current = onInput;
  onResizeRef.current = onResize;

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
      // 优先 Menlo：对 box-drawing / block 字符度量更稳；避免 SF Mono 在部分字符上半宽不一致。
      fontFamily: 'Menlo, Monaco, "SF Mono", "Cascadia Mono", Consolas, "Liberation Mono", monospace',
      fontSize: codeFontSize,
      // ASCII art / 安装横幅依赖相邻单元格无间隙；>1 会出现框线错位、字符走形。
      lineHeight: 1,
      letterSpacing: 0,
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

    const syncPtySize = (cols: number, rows: number) => {
      if (cols < 20 || rows < 8) return;
      if (lastPtySizeRef.current.cols === cols && lastPtySizeRef.current.rows === rows) return;
      // 防抖：避免拖拽时连续 stty 刷屏；尺寸落定后再同步到 PTY。
      if (resizeTimerRef.current) window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = window.setTimeout(() => {
        if (lastPtySizeRef.current.cols === cols && lastPtySizeRef.current.rows === rows) return;
        lastPtySizeRef.current = { cols, rows };
        const tabId = activeTabIdRef.current;
        if (!tabId || !onResizeRef.current) return;
        void onResizeRef.current(tabId, cols, rows);
      }, 360);
    };

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      syncPtySize(cols, rows);
    });

    const resize = () => {
      try {
        fitAddon.fit();
        syncPtySize(terminal.cols, terminal.rows);
      } catch {
        // xterm can throw while its host is temporarily hidden during pane transitions.
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    requestAnimationFrame(resize);

    return () => {
      ro.disconnect();
      if (resizeTimerRef.current) window.clearTimeout(resizeTimerRef.current);
      for (const timer of Object.values(startupWriteTimersRef.current)) {
        window.clearTimeout(timer);
      }
      startupWriteTimersRef.current = {};
      inputDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;
    terminalRef.current.options.theme = terminalTheme;
  }, [terminalTheme]);

  // 代码字号变化：更新终端字号并重排，使设置即时生效。
  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;
    terminal.options.fontSize = codeFontSize;
    try {
      fitAddon.fit();
    } catch {
      // 字号变更后重排可能因宿主隐藏而抛错，忽略。
    }
  }, [codeFontSize]);

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
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
      <div
        className={cn(
          "grid min-h-[34px] border-b border-border/60 bg-background",
          sidebarVisible ? "grid-cols-[minmax(0,1fr)] xl:grid-cols-[196px_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]"
        )}
      >
        {sidebarVisible ? (
          <div className="hidden min-h-[34px] min-w-0 items-center gap-1.5 border-r border-border/60 bg-card/60 px-2.5 xl:flex">
            <Button className="size-6 rounded-sm text-muted-foreground" onClick={onToggleSidebar} title="隐藏终端列表" variant="ghost" size="icon">
              <ListIcon />
            </Button>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium tabular-nums text-muted-foreground">{terminalCountLabel}</span>
            <Button className="size-6 rounded-sm text-muted-foreground" onClick={onCreateTab} title="新建终端" variant="ghost" size="icon">
              <PlusIcon />
            </Button>
          </div>
        ) : null}
        <div className="flex min-h-[34px] min-w-0 items-center gap-1.5 bg-background px-2.5">
          {!sidebarVisible ? (
            <Button className="size-6 rounded-sm text-foreground" onClick={onToggleSidebar} title="显示终端列表" variant="ghost" size="icon">
              <ListIcon />
            </Button>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{activeTitle}</span>
          <Button className="ml-auto size-6 rounded-sm text-muted-foreground" onClick={() => void onClearActiveTab()} title="清空终端" variant="ghost" size="icon">
            <Trash2Icon />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "grid h-full min-h-0 bg-background",
          sidebarVisible ? "grid-cols-[minmax(0,1fr)] xl:grid-cols-[196px_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]"
        )}
      >
        {sidebarVisible ? (
          <Card className="hidden min-h-0 w-[196px] flex-col overflow-hidden rounded-none border-0 border-r border-border/60 bg-card/60 shadow-none xl:flex">
            <div className="grid gap-1 overflow-auto p-1.5">
              {tabs.map((tab) => (
                <div
                  key={`terminal-side-${tab.id}`}
                  className={cn(
                    "group/terminal flex min-h-8 items-center overflow-hidden rounded-lg border border-transparent text-foreground transition-colors hover:bg-accent/70",
                    tab.id === activeTabId && "border-border bg-muted"
                  )}
                >
                  <Button
                    className="min-h-[30px] min-w-0 flex-1 justify-start gap-2 rounded-[inherit] bg-transparent px-2.5 py-1 text-xs font-medium hover:bg-transparent"
                    onClick={() => onSelectTab(tab.id)}
                    variant="ghost"
                  >
                    <span className="inline-flex shrink-0 items-center justify-center text-muted-foreground" aria-hidden="true">
                      <SquareTerminalIcon />
                    </span>
                    <span className="min-w-0 truncate">{getTerminalDisplayTitle(tab)}</span>
                  </Button>
                  {tabs.length > 1 ? (
                    <Button
                      className="mr-1 size-5 rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover/terminal:opacity-100 group-focus-within/terminal:opacity-100 data-[active=true]:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onCloseTab(tab.id);
                      }}
                      aria-label={`关闭终端 ${tab.title}`}
                      data-active={tab.id === activeTabId}
                      variant="ghost"
                      size="icon"
                    >
                      <XIcon />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        ) : null}
        <div className="min-h-0 min-w-0 overflow-hidden bg-background">
          <div className="terminal-xterm-host h-full w-full overflow-hidden bg-background p-2.5 px-3" ref={hostRef} />
        </div>
      </div>
    </div>
  );
}
