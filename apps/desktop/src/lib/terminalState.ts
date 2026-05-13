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

export type TerminalCompletionGroup = "Directories" | "Files" | "Commands";

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

export function sanitizeTerminalOutput(text: string): string {
  const cleaned = text
    .replace(/\x1B\[[0-9;]*D/g, "\r")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B\][^\x07]*(\x07|\x1B\\)/g, "")
    .replace(/\x1B[P^_][\s\S]*?\x1B\\/g, "")
    .replace(/\u009b[0-?]*[ -/]*[@-~]/g, "")
    .replace(/�\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/^.*openclaw\.zsh:\d+:\s*command not found:\s*compdef\n?/gm, "");

  const lines = [""];
  let col = 0;
  for (const ch of cleaned) {
    if (ch === "\b" || ch === "\u007f") {
      if (col > 0) col -= 1;
      continue;
    }
    if (ch === "\r") {
      col = 0;
      continue;
    }
    if (ch === "\n") {
      lines.push("");
      col = 0;
      continue;
    }
    const current = lines.length - 1;
    const line = lines[current] || "";
    if (col >= line.length) {
      lines[current] = `${line}${" ".repeat(col - line.length)}${ch}`;
    } else {
      lines[current] = `${line.slice(0, col)}${ch}${line.slice(col + 1)}`;
    }
    col += 1;
  }
  return lines.join("\n");
}

export function splitTerminalOutputForInput(text: string): { body: string; prompt: string } {
  const source = text || "";
  const lines = source.split("\n");
  let idx = lines.length - 1;
  while (idx >= 0 && !lines[idx]?.trim()) idx -= 1;
  if (idx < 0) return { body: "", prompt: "" };
  const last = lines[idx] || "";
  const looksLikePrompt = /[#$%]\s*$/.test(last) || /\)\s+[^\n]*\s[%#$]\s*$/.test(last);
  if (!looksLikePrompt) return { body: source, prompt: "" };
  const bodyLines = lines.slice(0, idx).filter((line) => !/^\s*%\s*$/.test(line || ""));
  const body = bodyLines.join("\n");
  return { body, prompt: last };
}

export function escapeTerminalCompletionValue(value: string): string {
  return value.replace(/([\s\\"'`$])/g, "\\$1");
}

export function applyTerminalCompletionCandidate(input: string, token: string, candidate: string): string {
  if (!token) return input;
  const replacement = candidate.endsWith("/")
    ? escapeTerminalCompletionValue(candidate)
    : `${escapeTerminalCompletionValue(candidate)} `;
  const keep = input.length - token.length;
  return `${input.slice(0, Math.max(0, keep))}${replacement}`;
}

export function getTerminalCompletionGroup(input: string, item: string): TerminalCompletionGroup {
  const beforeToken = input.slice(0, Math.max(0, input.length - (input.split(/\s+/).pop() || "").length)).trim();
  if (!beforeToken) return "Commands";
  return item.endsWith("/") ? "Directories" : "Files";
}
