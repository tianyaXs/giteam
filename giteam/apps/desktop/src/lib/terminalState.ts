export type TerminalTabState = {
  id: string;
  title: string;
  input: string;
  output: string;
  seq: number;
  alive: boolean;
  cwd: string;
  history: string[];
  historyIndex: number;
  historyDraft: string;
  completionItems: string[];
  completionIndex: number;
  completionToken: string;
};

const TERMINAL_TABS_STORAGE_KEY = "giteam.terminal-tabs.v1";

export function createTerminalTabState(id: string, title: string, cwd = ""): TerminalTabState {
  return {
    id,
    title,
    input: "",
    output: "",
    seq: 0,
    alive: false,
    cwd,
    history: [],
    historyIndex: -1,
    historyDraft: "",
    completionItems: [],
    completionIndex: 0,
    completionToken: ""
  };
}

export function recordTerminalCommand(tab: TerminalTabState, command: string): TerminalTabState {
  return {
    ...tab,
    history: [command, ...tab.history.filter((item) => item !== command)].slice(0, 80),
    historyIndex: -1,
    historyDraft: "",
    input: "",
    completionItems: [],
    completionIndex: 0,
    completionToken: ""
  };
}

export function appendTerminalError(tab: TerminalTabState, message: string): TerminalTabState {
  return {
    ...tab,
    output: `${tab.output}${tab.output.endsWith("\n") || !tab.output ? "" : "\n"}[error] ${message}\n`
  };
}

export function readTerminalTabSnapshot(): { tabs: TerminalTabState[]; activeId: string; counter: number } | null {
  try {
    const raw = window.localStorage.getItem(TERMINAL_TABS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tabs?: Array<Partial<TerminalTabState>>; activeId?: string; counter?: number };
    const tabs = (Array.isArray(parsed.tabs) ? parsed.tabs : [])
      .filter((tab) => typeof tab.id === "string" && tab.id.trim())
      .slice(0, 8)
      .map((tab, idx) => ({
        ...createTerminalTabState(String(tab.id), String(tab.title || `终端 ${idx + 1}`), String(tab.cwd || "")),
        input: String(tab.input || ""),
        history: Array.isArray(tab.history) ? tab.history.map(String).slice(0, 80) : []
      }));
    if (tabs.length === 0) return null;
    const activeId = tabs.some((tab) => tab.id === parsed.activeId) ? String(parsed.activeId) : tabs[0].id;
    const counter = Math.max(Number(parsed.counter || tabs.length + 1), tabs.length + 1, 2);
    return { tabs, activeId, counter };
  } catch {
    return null;
  }
}

export function writeTerminalTabSnapshot(activeId: string, counter: number, tabs: TerminalTabState[]): void {
  try {
    window.localStorage.setItem(TERMINAL_TABS_STORAGE_KEY, JSON.stringify({
      activeId,
      counter,
      tabs: tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        cwd: tab.cwd,
        input: tab.input,
        history: tab.history.slice(0, 80)
      }))
    }));
  } catch {
    // ignore terminal snapshot persistence failures
  }
}
