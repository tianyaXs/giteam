import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { explainCommit, explainCommitShort, getEntireStatusDetailed } from "./lib/entireAdapter";
import {
  gitPull,
  gitPush,
  getBranchCommits,
  getCommitGraph,
  getCommitChangedFiles,
  getCommitFilePatch,
  getLocalBranches
} from "./lib/gitAdapter";
import { parseExplainCommit } from "./lib/explainParser";
import { runReviewForCommit } from "./lib/reviewOrchestrator";
import {
  addRepository,
  listRepositories,
  loadReviewActions,
  loadReviewRecords,
  pickRepositoryFolder,
  removeRepository,
  saveReviewAction,
  saveReviewRecord
} from "./lib/storage";
import type {
  GitBranchSummary,
  GitCommitSummary,
  GitGraphNode,
  RepositoryEntry,
  ReviewAction,
  ReviewActionType,
  ReviewRecord
} from "./lib/types";
import { Workbench } from "./layout/Workbench";
import type { PanelPlacement } from "./layout/Workbench";

type DetailTab = "diff" | "context" | "findings";
type Theme = "dark" | "light";
type DiffRowKind = "meta" | "add" | "del" | "ctx";
type DiffRow = { kind: DiffRowKind; left: string; right: string };
type StatusSession = { title: string; quote?: string; meta?: string };
type ParsedStatus = { headline?: string; project?: string; sessions: StatusSession[] };
type TranscriptMessage = { role: "User" | "Assistant"; content: string };
type ParsedAgentContext = {
  checkpoint?: string;
  session?: string;
  created?: string;
  author?: string;
  commits?: string;
  intent?: string;
  outcome?: string;
  filesRaw?: string;
  files: string[];
  transcript: TranscriptMessage[];
};

function makeId(): string {
  return Math.random().toString(16).slice(2, 14);
}

function firstLetter(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function toDiffRows(patch: string): DiffRow[] {
  if (!patch.trim()) return [];
  const rows: DiffRow[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("@@")) {
      rows.push({ kind: "meta", left: line, right: line });
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++")) {
      rows.push({ kind: "meta", left: line, right: line });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "add", left: "", right: line.slice(1) });
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ kind: "del", left: line.slice(1), right: "" });
      continue;
    }
    rows.push({
      kind: "ctx",
      left: line.startsWith(" ") ? line.slice(1) : line,
      right: line.startsWith(" ") ? line.slice(1) : line
    });
  }
  return rows;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(`[^`\n]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    if (start > last) {
      nodes.push(text.slice(last, start));
    }
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={`code-${i++}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[")) {
      const split = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (split) {
        nodes.push(
          <a key={`link-${i++}`} href={split[2]} target="_blank" rel="noreferrer">
            {split[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={`strong-${i++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(<del key={`del-${i++}`}>{token.slice(2, -2)}</del>);
    } else if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) {
      nodes.push(<em key={`em-${i++}`}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(token);
    }
    last = start + token.length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes.length > 0 ? nodes : [text];
}

function MarkdownLite(props: { source: string }) {
  const text = props.source.replace(/\r\n/g, "\n").replace(/\\n/g, "\n").trim();
  if (!text) return <p className="muted">等待上下文加载...</p>;

  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre key={`pre-${key++}`} className="md-code">
          {lang ? <span className="md-code-lang">{lang}</span> : null}
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      const cls = `md-h${level}`;
      blocks.push(
        <p key={`h-${key++}`} className={cls}>
          {renderInlineMarkdown(heading[2])}
        </p>
      );
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote key={`q-${key++}`} className="md-quote">
          {quoteLines.map((q, idx) => (
            <p key={`qp-${idx}`}>{renderInlineMarkdown(q)}</p>
          ))}
        </blockquote>
      );
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${key++}`} className="md-list">
          {items.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${key++}`} className="md-list">
          {items.map((item, idx) => (
            <li key={`oli-${idx}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("```") &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^[-*+]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`p-${key++}`} className="md-p">
        {renderInlineMarkdown(para.join(" "))}
      </p>
    );
  }
  return <div className="markdown-lite">{blocks}</div>;
}

function parseStatusText(raw: string): ParsedStatus {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: ParsedStatus = { sessions: [] };
  out.headline = lines.find((l) => l.startsWith("●")) ?? undefined;
  out.project = lines.find((l) => l.startsWith("Project")) ?? undefined;

  const activeIdx = lines.findIndex((l) => /Active Sessions/i.test(l));
  if (activeIdx >= 0) {
    const sessionLines = lines.slice(activeIdx + 1);
    let current: StatusSession | null = null;
    const uuidLike = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
    for (const line of sessionLines) {
      if (uuidLike.test(line)) {
        if (current) out.sessions.push(current);
        current = { title: line };
        continue;
      }
      if (!current) continue;
      if (line.startsWith(">")) {
        current.quote = line.replace(/^>\s*/, "").replace(/^"|"$/g, "");
      } else if (/started|active|tokens/i.test(line)) {
        current.meta = line;
      }
    }
    if (current) out.sessions.push(current);
  }
  return out;
}

function pickSegment(raw: string, label: string, nextLabels: string[]): string | undefined {
  const start = raw.indexOf(`${label}:`);
  if (start < 0) return undefined;
  const from = start + label.length + 1;
  let end = raw.length;
  for (const n of nextLabels) {
    const idx = raw.indexOf(`${n}:`, from);
    if (idx >= 0 && idx < end) end = idx;
  }
  return raw.slice(from, end).trim() || undefined;
}

function parseTranscript(raw: string): TranscriptMessage[] {
  const out: TranscriptMessage[] = [];
  const source = raw.replace(/\r\n/g, "\n");
  const marker = /(?:^|\n)\s*(?:\[(User|Assistant)\]|(User|Assistant)\s*:)\s*/gi;
  const matches = [...source.matchAll(marker)];
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const roleRaw = (m[1] || m[2] || "").toLowerCase();
    const role: "User" | "Assistant" = roleRaw === "user" ? "User" : "Assistant";
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? source.length) : source.length;
    const content = source.slice(start, end).trim();
    if (content) out.push({ role, content });
  }
  return out;
}

function parseAgentContextText(raw: string): ParsedAgentContext {
  const lines = raw.split("\n");
  const header = lines.find((l) => /Checkpoint:|Session:|Created:|Author:/i.test(l)) ?? "";
  const field = (name: string) => {
    const labels = ["Checkpoint", "Session", "Created", "Author"];
    const idx = header.indexOf(`${name}:`);
    if (idx < 0) return undefined;
    const from = idx + name.length + 1;
    let end = header.length;
    for (const l of labels) {
      if (l === name) continue;
      const p = header.indexOf(`${l}:`, from);
      if (p >= 0 && p < end) end = p;
    }
    return header.slice(from, end).trim() || undefined;
  };

  const commits = pickSegment(raw, "Commits", ["Intent", "Outcome", "Files", "Transcript (checkpoint scope)"]);
  const intent = pickSegment(raw, "Intent", ["Outcome", "Files", "Transcript (checkpoint scope)"]);
  const outcome = pickSegment(raw, "Outcome", ["Files", "Transcript (checkpoint scope)"]);
  const filesSeg = pickSegment(raw, "Files", ["Transcript (checkpoint scope)"]) ?? "";
  const filesRaw = filesSeg.trim();
  const transcriptSeg = pickSegment(raw, "Transcript (checkpoint scope)", []) ?? "";
  const files = filesSeg
    .split("\n")
    .map((l) => l.replace(/^\(\d+\)\s*/, "").replace(/^-\s*/, "").trim())
    .filter((l) => l && !/^\(\d+\)$/.test(l) && !/^\(\d+\)\s*$/.test(l) && !/^Files?$/i.test(l));

  return {
    checkpoint: field("Checkpoint"),
    session: field("Session"),
    created: field("Created"),
    author: field("Author"),
    commits,
    intent,
    outcome,
    filesRaw,
    files,
    transcript: parseTranscript(transcriptSeg)
  };
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const value = window.localStorage.getItem("giteam.theme");
    return value === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("giteam.theme", theme);
    void invoke("set_window_theme", { theme }).catch(() => {
      // Ignore if running outside Tauri runtime.
    });
  }, [theme]);

  return [theme, () => setTheme((prev) => (prev === "dark" ? "light" : "dark"))];
}

function parseRefs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const inner = trimmed.startsWith("(") && trimmed.endsWith(")")
    ? trimmed.slice(1, -1)
    : trimmed;
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function branchFromRef(ref: string, branches: GitBranchSummary[]): string | null {
  const r = ref.trim();
  if (!r) return null;
  if (r.startsWith("tag:")) return null;
  if (r.includes("->")) {
    const rhs = r.split("->")[1]?.trim();
    if (rhs && branches.some((b) => b.name === rhs)) return rhs;
    return null;
  }
  if (branches.some((b) => b.name === r)) return r;
  return null;
}

type LaneLayoutRow = {
  sha: string;
  parents: string[];
  col: number;
  colorIdx: number;
};

const LANE_COLORS = [
  "#F6C445", // yellow
  "#8A5CF6", // purple
  "#2DD4BF", // teal
  "#60A5FA", // blue
  "#FB7185", // pink
  "#34D399", // green
  "#F97316" // orange
];

function laneColor(col: number): string {
  return LANE_COLORS[col % LANE_COLORS.length];
}

type LaneSnapshot = Array<{ sha: string; colorIdx: number }>;
type LaneLayout = {
  rows: LaneLayoutRow[];
  // Lanes before applying row's commit->parents transition.
  before: LaneSnapshot[];
  // Lanes after applying row's commit->parents transition (used for edges to next row).
  after: LaneSnapshot[];
  maxLanes: number;
};

function computeLaneLayout(rows: GitGraphNode[]): LaneLayout {
  const commits = rows.filter((r) => !r.isConnector && !!r.sha);
  const remaining = new Set(commits.map((c) => c.sha));

  const lanes: Array<{ sha: string; colorIdx: number }> = [];
  let nextColor = 0;

  const outRows: LaneLayoutRow[] = [];
  const before: LaneSnapshot[] = [];
  const after: LaneSnapshot[] = [];
  let maxLanes = 0;

  for (const c of commits) {
    remaining.delete(c.sha);

    // Snapshot BEFORE mutation: used for rails at this row and to locate current commit lane.
    before.push(lanes.map((l) => ({ sha: l.sha, colorIdx: l.colorIdx })));
    maxLanes = Math.max(maxLanes, lanes.length);

    let col = lanes.findIndex((l) => l.sha === c.sha);
    if (col < 0) {
      // Append new lanes at the end to keep layout stable (less "jumping").
      lanes.push({ sha: c.sha, colorIdx: nextColor++ });
      col = lanes.length - 1;
    }

    const colorIdx = lanes[col]?.colorIdx ?? 0;
    outRows.push({ sha: c.sha, parents: c.parents ?? [], col, colorIdx });

    // Update lanes for next rows:
    // - Keep the same lane/color when flowing into first parent.
    // - Allocate new lanes/colors for secondary parents (merge).
    const parents = (c.parents ?? []).filter(Boolean);
    if (parents.length === 0) {
      lanes.splice(col, 1);
    } else {
      lanes[col] = { sha: parents[0], colorIdx };
      for (let i = 1; i < parents.length; i += 1) {
        lanes.splice(col + i, 0, { sha: parents[i], colorIdx: nextColor++ });
      }
    }

    // Drop lanes that will never appear again (keeps graph compact but not jumpy).
    for (let i = lanes.length - 1; i >= 0; i -= 1) {
      const s = lanes[i]?.sha ?? "";
      if (!remaining.has(s)) lanes.splice(i, 1);
    }

    // Snapshot AFTER mutation: used to draw edges from this row to the next row.
    after.push(lanes.map((l) => ({ sha: l.sha, colorIdx: l.colorIdx })));
    maxLanes = Math.max(maxLanes, lanes.length);
  }

  return { rows: outRows, before, after, maxLanes };
}

function BranchGraphLanes(props: {
  rows: GitGraphNode[];
  rowHeight: number;
  laneGap: number;
  selectedSha: string;
}) {
  const commits = props.rows.filter((r) => !r.isConnector && !!r.sha);
  const layout = useMemo(() => computeLaneLayout(commits), [commits]);
  const rowH = props.rowHeight;
  const laneAreaW = 140; // keep in sync with CSS placeholder width
  const maxCol = Math.max(0, ...layout.rows.map((r) => r.col));
  const laneCount = Math.max(1, maxCol + 1);
  // Always fit lanes into the left gutter so it never overlaps text.
  const laneGap = Math.max(8, Math.floor((laneAreaW - 20) / laneCount));

  const width = laneAreaW;
  const height = Math.max(1, commits.length * rowH);

  // Edges should be drawn as local transitions between adjacent rows:
  // commit at row i connects to its parent lanes at row i+1 (after snapshot).
  // To reduce visual noise (match VSCode/gitk), we only draw:
  // - first-parent edge when it changes columns
  // - merge edges (2nd+ parent) always
  const edges: Array<{ d: string; colorIdx: number; kind: "first" | "merge"; toX: number; toY: number }> = [];
  layout.rows.forEach((r, rowIdx) => {
    const fromX = r.col * laneGap + 10;
    const fromY = rowIdx * rowH + rowH / 2;
    const next = layout.after[rowIdx] ?? [];
    const parents = (r.parents ?? []).filter(Boolean);
    parents.forEach((p, i) => {
      const toCol = next.findIndex((l) => l.sha === p);
      if (toCol < 0) return;
      const toX = toCol * laneGap + 10;
      const toY = (rowIdx + 1) * rowH + rowH / 2;
      const kind: "first" | "merge" = i === 0 ? "first" : "merge";
      if (kind === "first" && toCol === r.col) {
        // Vertical continuation is already implied by rails; don't draw extra curve.
        return;
      }
      const dx = toX - fromX;
      // Softer, more "gitk-like" curves.
      const c1x = fromX + dx * 0.35;
      const c2x = toX - dx * 0.35;
      const c1y = fromY + rowH * 0.55;
      const c2y = toY - rowH * 0.55;
      const d = `M ${fromX} ${fromY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${toX} ${toY}`;
      edges.push({ d, colorIdx: r.colorIdx, kind, toX, toY });
    });
  });

  return (
    <svg className="branch-lanes" width={width} height={height} aria-hidden="true">
      <g className="branch-lanes-rails">
        {layout.before.slice(0, commits.length).map((snap, rowIdx) => {
          const y0 = rowIdx * rowH;
          return snap.map((l, colIdx) => {
            const x = colIdx * laneGap + 10;
            return (
              <line
                key={`rail-${rowIdx}-${colIdx}-${l.sha}`}
                x1={x}
                y1={y0}
                x2={x}
                y2={y0 + rowH}
                style={{ stroke: laneColor(l.colorIdx), opacity: 0.18, strokeWidth: 2 }}
              />
            );
          });
        })}
      </g>
      <g className="branch-lanes-edges">
        {edges.map((e, idx) => {
          const color = laneColor(e.colorIdx);
          return (
            <path
              key={`e-${idx}`}
              d={e.d}
              fill="none"
              style={{
                stroke: color,
                opacity: e.kind === "merge" ? 0.3 : 0.85,
                strokeWidth: e.kind === "merge" ? 1.5 : 2.4
              }}
            />
          );
        })}
      </g>
      <g className="branch-lanes-junctions">
        {edges.map((e, idx) => {
          const color = laneColor(e.colorIdx);
          const r = e.kind === "merge" ? 2.8 : 3.2;
          return (
            <circle
              key={`j-${idx}`}
              cx={e.toX}
              cy={e.toY}
              r={r}
              style={{
                fill: color,
                opacity: e.kind === "merge" ? 0.55 : 0.75
              }}
            />
          );
        })}
      </g>
      <g className="branch-lanes-nodes">
        {layout.rows.map((r, idx) => {
          const x = r.col * laneGap + 10;
          const y = idx * rowH + rowH / 2;
          const color = laneColor(r.colorIdx);
          const selected = props.selectedSha === r.sha;
          return (
            <circle
              key={`n-${r.sha}`}
              cx={x}
              cy={y}
              r={selected ? 6 : 5}
              style={{
                stroke: color,
                fill: color,
                strokeWidth: selected ? 2.5 : 2
              }}
            />
          );
        })}
      </g>
    </svg>
  );
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [panelPlacement, setPanelPlacement] = useState<PanelPlacement>("hidden");
  const [showSettings, setShowSettings] = useState(false);
  const [showGraphPopover, setShowGraphPopover] = useState(false);
  const [repoContextMenu, setRepoContextMenu] = useState<{ x: number; y: number; repo: RepositoryEntry } | null>(null);
  const [commitContextMenu, setCommitContextMenu] = useState<{ x: number; y: number; sha: string } | null>(null);

  // Panel is fused into the center reading area.

  const [repos, setRepos] = useState<RepositoryEntry[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<RepositoryEntry | null>(null);

  const [branches, setBranches] = useState<GitBranchSummary[]>([]);
  const [commitGraph, setCommitGraph] = useState<GitGraphNode[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [commits, setCommits] = useState<GitCommitSummary[]>([]);
  const [selectedCommit, setSelectedCommit] = useState("");

  const [changedFiles, setChangedFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [selectedFilePatch, setSelectedFilePatch] = useState("");
  const [selectedExplain, setSelectedExplain] = useState("");
  const [statusText, setStatusText] = useState("");

  const [records, setRecords] = useState<ReviewRecord[]>([]);
  const [actions, setActions] = useState<ReviewAction[]>([]);

  const [detailTab, setDetailTab] = useState<DetailTab>("diff");
  const [busy, setBusy] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("Ready");

  const repoPath = selectedRepo?.path ?? "";
  const selectedParsed = selectedExplain ? parseExplainCommit(selectedExplain) : undefined;
  const parsedStatus = useMemo(() => parseStatusText(statusText || ""), [statusText]);
  const parsedAgentContext = useMemo(() => parseAgentContextText(selectedExplain || ""), [selectedExplain]);
  const selectedReview = useMemo(
    () => records.find((r) => r.commitSha === selectedCommit),
    [records, selectedCommit]
  );
  const diffRows = useMemo(() => toDiffRows(selectedFilePatch), [selectedFilePatch]);

  function ensureRepoSelected(): boolean {
    if (!selectedRepo) {
      setError("请先导入并选择一个仓库。");
      return false;
    }
    return true;
  }

  async function refreshRepositories() {
    const all = await listRepositories();
    setRepos(all);
    if (all.length > 0 && !selectedRepo) setSelectedRepo(all[0]);
  }

  async function importRepository(pathFromPrompt: string): Promise<boolean> {
    setError("");
    const path = pathFromPrompt.trim();
    if (!path) {
      setError("请先选择本地仓库文件夹。");
      return false;
    }
    setBusy(true);
    setOverlayBusy(true);
    setMessage("正在导入仓库...");
    try {
      const entry = await addRepository(path);
      await refreshRepositories();
      setSelectedRepo(entry);
      setMessage(`已导入仓库: ${entry.name}`);
      return true;
    } catch (e) {
      setError(String(e));
      setMessage("导入失败");
      return false;
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  async function pickAndImportRepository() {
    if (busy) return;
    setError("");
    setMessage("请选择本地仓库文件夹...");
    try {
      const path = await pickRepositoryFolder();
      if (!path) {
        setMessage("已取消导入");
        return;
      }
      await importRepository(path);
    } catch (e) {
      setError(String(e));
      setMessage("选择目录失败");
    }
  }

  async function closeRepository(entry: RepositoryEntry) {
    setRepoContextMenu(null);
    setBusy(true);
    setError("");
    setMessage(`Closing: ${entry.name}...`);
    try {
      await removeRepository(entry.id);
      const all = await listRepositories();
      setRepos(all);
      if (selectedRepo?.id === entry.id) {
        setSelectedRepo(all[0] ?? null);
      } else if (selectedRepo && !all.some((r) => r.id === selectedRepo.id)) {
        setSelectedRepo(all[0] ?? null);
      }
      setMessage(`Closed: ${entry.name}`);
    } catch (e) {
      setError(String(e));
      setMessage("Close failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
  }

  async function copyCommitId(sha: string) {
    setCommitContextMenu(null);
    try {
      await copyText(sha);
      setMessage(`Copied commit id: ${sha.slice(0, 8)}`);
    } catch (e) {
      setError(String(e));
      setMessage("Copy failed");
    }
  }

  function openRepoContextMenu(x: number, y: number, repo: RepositoryEntry) {
    const menuW = 132;
    const menuH = 44;
    const cx = Math.min(x, window.innerWidth - menuW - 8);
    const cy = Math.min(y, window.innerHeight - menuH - 8);
    setRepoContextMenu({
      x: Math.max(8, cx),
      y: Math.max(8, cy),
      repo
    });
  }

  async function refreshStatus() {
    if (!ensureRepoSelected()) return;
    setError("");
    setMessage("读取 entire 状态...");
    try {
      const res = await getEntireStatusDetailed(repoPath);
      setStatusText(res.raw);
      setMessage("状态已更新");
    } catch (e) {
      setError(String(e));
      setMessage("读取状态失败");
    }
  }

  async function refreshBranchesAndCommits() {
    if (!ensureRepoSelected()) return;
    setError("");
    setMessage("加载分支与提交...");
    try {
      const branchList = await getLocalBranches(repoPath);
      const graphRows = await getCommitGraph(repoPath, 140);
      setBranches(branchList);
      setCommitGraph(graphRows);
      const current = branchList.find((b) => b.isCurrent)?.name ?? branchList[0]?.name ?? "";
      const target = branchList.some((b) => b.name === selectedBranch) ? selectedBranch : current;
      setSelectedBranch(target);
      if (!target) {
        setCommits([]);
        setSelectedCommit("");
        setMessage("未找到可用本地分支");
        return;
      }
      const rows = await getBranchCommits(repoPath, target, 80);
      setCommits(rows);
      setSelectedCommit(rows[0]?.sha ?? "");
      setMessage(rows.length > 0 ? "分支与提交已更新" : `分支 ${target} 暂无提交可显示`);
    } catch (e) {
      setError(String(e));
      setMessage("加载分支/提交失败");
    }
  }

  async function refreshReviewData() {
    if (!ensureRepoSelected()) return;
    const [reviewRows, actionRows] = await Promise.all([
      loadReviewRecords(repoPath),
      loadReviewActions(repoPath)
    ]);
    setRecords(reviewRows);
    setActions(actionRows);
  }

  async function refreshCommitContext(commitSha: string) {
    if (!ensureRepoSelected() || !commitSha) return;
    setError("");
    setMessage("加载提交上下文...");
    try {
      const [files, explainRes] = await Promise.all([
        getCommitChangedFiles(repoPath, commitSha),
        explainCommitShort(commitSha, repoPath)
      ]);
      setChangedFiles(files);
      setSelectedFile(files[0] ?? "");
      setSelectedExplain(explainRes.raw);
      setDetailTab("context");
      if (files.length > 0) {
        const patch = await getCommitFilePatch(repoPath, commitSha, files[0]);
        setSelectedFilePatch(patch);
      } else {
        setSelectedFilePatch("该提交没有文件变更。");
      }
      const parsed = parseExplainCommit(explainRes.raw);
      setMessage(parsed.hasCheckpoint ? "已快速加载上下文摘要，可继续加载完整上下文。" : "该提交未关联 Entire checkpoint。");
    } catch (e) {
      setError(String(e));
      setMessage("加载上下文失败");
      setChangedFiles([]);
      setSelectedFile("");
      setSelectedFilePatch("");
    }
  }

  async function refreshFilePatch(filePath: string) {
    if (!ensureRepoSelected() || !selectedCommit || !filePath) return;
    setError("");
    setMessage(`加载文件 patch: ${filePath}`);
    try {
      const patch = await getCommitFilePatch(repoPath, selectedCommit, filePath);
      setSelectedFilePatch(patch);
      setDetailTab("diff");
      setMessage("文件 patch 已加载");
    } catch (e) {
      setError(String(e));
      setMessage("加载文件 patch 失败");
      setSelectedFilePatch("");
    }
  }

  async function loadFullAgentContext() {
    if (!ensureRepoSelected() || !selectedCommit) return;
    setBusy(true);
    setOverlayBusy(true);
    setError("");
    setMessage("加载完整上下文（无 pager 模式）...");
    try {
      const res = await explainCommit(selectedCommit, repoPath);
      setSelectedExplain(res.raw);
      setDetailTab("context");
      setMessage(`完整上下文已加载（${res.raw.length} chars）`);
    } catch (e) {
      setError(String(e));
      setMessage("完整上下文加载失败");
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  async function runSelectedReview() {
    if (!ensureRepoSelected() || !selectedCommit) return;
    setBusy(true);
    setOverlayBusy(true);
    setError("");
    setMessage("执行 review...");
    try {
      const record = await runReviewForCommit(selectedCommit, repoPath);
      await saveReviewRecord(record);
      await refreshReviewData();
      setMessage(`review 已完成: ${record.commitSha.slice(0, 8)}`);
    } catch (e) {
      setError(String(e));
      setMessage("review 失败");
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  async function markFinding(reviewId: string, findingId: string, action: ReviewActionType) {
    if (!ensureRepoSelected()) return;
    try {
      await saveReviewAction({
        id: makeId(),
        repoPath,
        reviewId,
        findingId,
        action,
        createdAt: new Date().toISOString()
      });
      await refreshReviewData();
      setMessage(`已标记 ${action}`);
    } catch (e) {
      setError(String(e));
      setMessage("标记失败");
    }
  }

  function latestAction(reviewId: string, findingId: string): ReviewAction | undefined {
    return actions.find((a) => a.reviewId === reviewId && a.findingId === findingId);
  }

  async function chooseBranch(branchName: string) {
    if (!selectedRepo) return;
    setSelectedBranch(branchName);
    try {
      const rows = await getBranchCommits(selectedRepo.path, branchName, 80);
      setCommits(rows);
      setSelectedCommit(rows[0]?.sha ?? "");
      setMessage(`已切换分支: ${branchName}`);
    } catch (e) {
      setError(String(e));
      setMessage("切换分支失败");
    }
  }

  async function refreshScm() {
    if (!ensureRepoSelected()) return;
    setBusy(true);
    setOverlayBusy(true);
    setError("");
    setMessage("刷新提交与状态...");
    try {
      const [statusRes, branchList, graphRows, reviewRows, actionRows] = await Promise.all([
        getEntireStatusDetailed(repoPath),
        getLocalBranches(repoPath),
        getCommitGraph(repoPath, 140),
        loadReviewRecords(repoPath),
        loadReviewActions(repoPath)
      ]);
      setStatusText(statusRes.raw);
      setBranches(branchList);
      setCommitGraph(graphRows);
      setRecords(reviewRows);
      setActions(actionRows);
      const current = branchList.find((b) => b.isCurrent)?.name ?? branchList[0]?.name ?? "";
      const target = branchList.some((b) => b.name === selectedBranch) ? selectedBranch : current;
      setSelectedBranch(target);
      if (!target) {
        setCommits([]);
        setSelectedCommit("");
      } else {
        const rows = await getBranchCommits(repoPath, target, 80);
        setCommits(rows);
        setSelectedCommit(rows[0]?.sha ?? "");
      }
      setMessage("刷新完成");
    } catch (e) {
      setError(String(e));
      setMessage("刷新失败");
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  async function pullLatest() {
    if (!ensureRepoSelected()) return;
    setBusy(true);
    setOverlayBusy(true);
    setError("");
    setMessage("执行 git pull...");
    try {
      const out = await gitPull(repoPath);
      setStatusText((prev) => [prev, `\n$ git pull --ff-only\n${out}`].filter(Boolean).join("\n"));
      await refreshBranchesAndCommits();
      setMessage("拉取完成");
    } catch (e) {
      setError(String(e));
      setMessage("拉取失败");
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  async function pushCurrent() {
    if (!ensureRepoSelected()) return;
    setBusy(true);
    setOverlayBusy(true);
    setError("");
    setMessage("执行 git push...");
    try {
      const out = await gitPush(repoPath);
      setStatusText((prev) => [prev, `\n$ git push\n${out}`].filter(Boolean).join("\n"));
      setMessage("推送完成");
    } catch (e) {
      setError(String(e));
      setMessage("推送失败");
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  useEffect(() => {
    void refreshRepositories().catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!selectedRepo) return;
    setError("");
    setMessage(`已选择仓库: ${selectedRepo.name}`);
    void Promise.all([refreshStatus(), refreshBranchesAndCommits(), refreshReviewData()]).catch((e) => {
      setError(String(e));
      setMessage("仓库数据加载失败");
    });
  }, [selectedRepo?.id]);

  useEffect(() => {
    if (!selectedCommit) return;
    void refreshCommitContext(selectedCommit);
  }, [selectedCommit]);

  useEffect(() => {
    if (!repoContextMenu && !commitContextMenu) return;
    const dismiss = () => {
      setRepoContextMenu(null);
      setCommitContextMenu(null);
    };
    window.addEventListener("click", dismiss);
    window.addEventListener("contextmenu", dismiss);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("contextmenu", dismiss);
    };
  }, [repoContextMenu, commitContextMenu]);

  useEffect(() => {
    const onNativeContextMenu = (evt: MouseEvent) => {
      const target = evt.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest(".wb-repo-ico[data-repo-id]") as HTMLElement | null;
      if (!btn) return;
      const repoId = btn.dataset.repoId;
      if (!repoId) return;
      const repo = repos.find((r) => r.id === repoId);
      if (!repo) return;

      evt.preventDefault();
      evt.stopPropagation();
      openRepoContextMenu(evt.clientX, evt.clientY, repo);
    };

    window.addEventListener("contextmenu", onNativeContextMenu, { capture: true });
    return () => window.removeEventListener("contextmenu", onNativeContextMenu, { capture: true });
  }, [repos]);

  const activityBar = (
    <div
      className="wb-activity-inner"
      onContextMenuCapture={(e) => {
        const target = e.target as HTMLElement | null;
        const btn = target?.closest(".wb-repo-ico[data-repo-id]") as HTMLElement | null;
        if (!btn) return;
        const repoId = btn.dataset.repoId;
        if (!repoId) return;
        const repo = repos.find((r) => r.id === repoId);
        if (!repo) return;
        e.preventDefault();
        e.stopPropagation();
        openRepoContextMenu(e.clientX, e.clientY, repo);
      }}
    >
      <div className="wb-activity-top">
        <div className="wb-repo-icons" aria-label="Repositories">
          {repos.map((r) => {
            const active = selectedRepo?.id === r.id;
            return (
              <button
                key={r.id}
                className={active ? "wb-repo-ico active" : "wb-repo-ico"}
                data-repo-id={r.id}
                title={`${r.name}\n${r.path}`}
                onClick={() => {
                  if (busy) return;
                  setSelectedRepo(r);
                }}
              >
                {firstLetter(r.name)}
              </button>
            );
          })}

          <button
            className="wb-repo-ico add"
            title="导入项目"
            onClick={() => void pickAndImportRepository()}
            disabled={busy}
          >
            +
          </button>
        </div>
      </div>
      <div className="wb-activity-bottom">
        <button
          className="wb-act-btn"
          title="Settings"
          onClick={() => setShowSettings(true)}
        >
          <span className="wb-act-ico">⚙</span>
        </button>
      </div>
    </div>
  );

  const sideBar = (
    <div className="wb-sidebar-inner">
      <div className="wb-sidebar-section">
        <div className="wb-commits-head">
          <div className="wb-sidebar-title">COMMITS</div>
          <div className="wb-commits-toolbar">
            <button className="scm-btn primary scm-icon-btn" onClick={() => void refreshScm()} disabled={busy} title="Refresh">
              ⟳
            </button>
            <details className="scm-more">
              <summary className="scm-btn scm-icon-btn" title="More">
                ⋯
              </summary>
              <div className="scm-menu">
                <button
                  className="scm-menu-item"
                  onClick={(e) => {
                    const box = e.currentTarget.closest("details");
                    if (box) box.removeAttribute("open");
                    void pullLatest();
                  }}
                  disabled={busy}
                  title="git pull --ff-only"
                >
                  Pull
                </button>
                <button
                  className="scm-menu-item"
                  onClick={(e) => {
                    const box = e.currentTarget.closest("details");
                    if (box) box.removeAttribute("open");
                    void pushCurrent();
                  }}
                  disabled={busy}
                  title="git push"
                >
                  Push
                </button>
              </div>
            </details>
          </div>
        </div>
        <div className="wb-commits-pane">
          <div className="commit-list wb-commits-list">
            {commits.map((c) => (
              <button
                key={c.sha}
                className={selectedCommit === c.sha ? "commit-item selected" : "commit-item"}
                onClick={() => {
                  if (busy) return;
                  setSelectedCommit(c.sha);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const x = Math.min(e.clientX, window.innerWidth - 168);
                  const y = Math.min(e.clientY, window.innerHeight - 60);
                  setCommitContextMenu({ x: Math.max(8, x), y: Math.max(8, y), sha: c.sha });
                }}
              >
                <p>{c.subject}</p>
                <p className="small muted">{c.author}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const editor = (
    <div className="wb-editor-inner">
      <div className="wb-editor-header">
        <div className="wb-breadcrumbs">
          <strong>{selectedRepo?.name ?? "No Project"}</strong>
          <span className="muted">/</span>
          <span className="muted">{selectedBranch || "—"}</span>
        </div>
      </div>

      <div className="wb-editor-content">
        <div className="wb-col wb-col-center">
          <div className="panel">
            <div className="wb-editor-reading-head">
              <div className="tab-row wb-reading-tabs">
                <button
                  className={detailTab === "context" ? "tab active" : "tab"}
                  onClick={() => setDetailTab("context")}
                >
                  Agent Context
                </button>
                <button className={detailTab === "diff" ? "tab active" : "tab"} onClick={() => setDetailTab("diff")}>
                  Diff
                </button>
                <button
                  className={detailTab === "findings" ? "tab active" : "tab"}
                  onClick={() => setDetailTab("findings")}
                >
                  Findings
                </button>
                <button className="chip" onClick={() => void runSelectedReview()} disabled={busy || !selectedCommit}>
                  Review
                </button>
              </div>
              {selectedFile ? <div className="wb-reading-sub muted">{selectedFile}</div> : null}
            </div>

            <div className="wb-reading-body">
              {detailTab === "diff" ? (
                <div className="diff-view">
                  <div className="diff-header">
                    <span>Old</span>
                    <span>New</span>
                  </div>
                  <div className="diff-body">
                    {diffRows.length === 0 ? <div className="diff-empty">选择文件后显示差异对比</div> : null}
                    {diffRows.map((r, i) => (
                      <div key={`${i}-${r.kind}`} className={`diff-row ${r.kind}`}>
                        <div className="cell old">{r.left}</div>
                        <div className="cell new">{r.right}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : detailTab === "context" ? (
                <div className="wb-context wb-reading-scroll">
                  <div className="context-section-card">
                    <div className="context-section-head">
                      <strong>Project Status</strong>
                      <span className="small muted">entire status --detailed</span>
                    </div>
                    {statusText ? (
                      <div className="status-structured">
                        <div className="status-pill-row">
                          {parsedStatus.headline ? <span className="status-pill">{parsedStatus.headline}</span> : null}
                          {parsedStatus.project ? <span className="status-pill">{parsedStatus.project}</span> : null}
                        </div>
                        {parsedStatus.sessions.length > 0 ? (
                          <div className="status-session-list">
                            {parsedStatus.sessions.map((s, idx) => (
                              <div key={`${s.title}-${idx}`} className="status-session-card">
                                <div className="status-session-title">{s.title}</div>
                                {s.quote ? <p className="small muted">"{s.quote}"</p> : null}
                                {s.meta ? <p className="small muted">{s.meta}</p> : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <pre className="status-embedded-pre">{statusText}</pre>
                        )}
                      </div>
                    ) : (
                      <pre className="status-embedded-pre">No status output yet.</pre>
                    )}
                  </div>

                  <div className="context-section-card">
                    <div className="context-section-head">
                      <strong>Agent Context</strong>
                      <span className="small muted">entire explain --commit --no-pager</span>
                    </div>
                  {selectedParsed ? (
                    <p className="small muted">
                      checkpoint={selectedParsed.checkpointId ?? "none"} · session={selectedParsed.sessionId ?? "none"} ·
                      tokens={selectedParsed.tokens ?? "n/a"}
                    </p>
                  ) : null}
                  <div className="agent-meta-grid">
                    {parsedAgentContext.checkpoint ? <span className="meta-chip">Checkpoint: {parsedAgentContext.checkpoint}</span> : null}
                    {parsedAgentContext.session ? <span className="meta-chip">Session: {parsedAgentContext.session}</span> : null}
                    {parsedAgentContext.created ? <span className="meta-chip">Created: {parsedAgentContext.created}</span> : null}
                    {parsedAgentContext.author ? <span className="meta-chip">Author: {parsedAgentContext.author}</span> : null}
                  </div>
                  {parsedAgentContext.commits ? (
                    <div className="context-block">
                      <div className="context-block-title">Commits</div>
                      <p className="small">{parsedAgentContext.commits}</p>
                    </div>
                  ) : null}
                  {parsedAgentContext.intent ? (
                    <div className="context-block">
                      <div className="context-block-title">Intent</div>
                      <MarkdownLite source={parsedAgentContext.intent} />
                    </div>
                  ) : null}
                  {(parsedAgentContext.filesRaw || parsedAgentContext.files.length > 0) ? (
                    <div className="context-block">
                      <div className="context-block-title">Files</div>
                      <MarkdownLite
                        source={
                          parsedAgentContext.files.length > 0
                            ? parsedAgentContext.files.map((f) => `- \`${f}\``).join("\n")
                            : (parsedAgentContext.filesRaw ?? "")
                        }
                      />
                    </div>
                  ) : null}
                  {parsedAgentContext.transcript.length > 0 ? (
                    <div className="context-block">
                      <div className="context-block-title">Transcript</div>
                      <div className="transcript-list">
                        {parsedAgentContext.transcript.map((m, idx) => (
                          <div key={`${m.role}-${idx}`} className={m.role === "User" ? "transcript-msg user" : "transcript-msg assistant"}>
                            <div className="transcript-role">{m.role}</div>
                            <MarkdownLite source={m.content} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="context-actions">
                    <button className="chip" onClick={() => void loadFullAgentContext()} disabled={busy || !selectedCommit}>
                      Load full context
                    </button>
                  </div>
                  {!parsedAgentContext.transcript.length && !parsedAgentContext.intent ? <MarkdownLite source={selectedExplain} /> : null}
                  </div>
                </div>
              ) : (
                <div className="wb-reading-scroll">
                  {!selectedReview ? <p className="small muted">当前提交暂无 review</p> : null}
                  {selectedReview?.findings.map((f) => {
                    const act = latestAction(selectedReview.id, f.id);
                    return (
                      <div key={f.id} className="finding-item">
                        <p>
                          <strong>{f.severity.toUpperCase()}</strong> {f.file}
                        </p>
                        <p>{f.summary}</p>
                        <div className="toolbar">
                          <button className="chip" onClick={() => void markFinding(selectedReview.id, f.id, "accept")}>
                            accept
                          </button>
                          <button className="chip" onClick={() => void markFinding(selectedReview.id, f.id, "dismiss")}>
                            dismiss
                          </button>
                          <button className="chip" onClick={() => void markFinding(selectedReview.id, f.id, "todo")}>
                            todo
                          </button>
                        </div>
                        <p className="small muted">latest action: {act ? `${act.action} @ ${act.createdAt}` : "none"}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="wb-col wb-col-right">
          <div className="panel">
            <h3>Changed Files</h3>
            <div className="file-list">
              {changedFiles.map((f) => (
                <button
                  key={f}
                  className={selectedFile === f ? "file-item selected" : "file-item"}
                  onClick={() => {
                    setSelectedFile(f);
                    void refreshFilePatch(f);
                  }}
                >
                  <span className="file-dot" />
                  <span>{f}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const panel = <div className="wb-panel-inner" />;

  return (
    <>
      <Workbench
        activityBar={activityBar}
        sideBar={sideBar}
        editor={editor}
        panel={panel}
        statusBar={
          <div className="wb-status-inner">
            <div className="wb-status-group">
              <button className="wb-status-btn" title="当前仓库/分支">
                {(selectedRepo?.name ?? "No Project") + " · " + (selectedBranch || "—")}
              </button>
              <button
                className={showGraphPopover ? "wb-status-btn active" : "wb-status-btn"}
                title="Graph"
                onClick={() => setShowGraphPopover((v) => !v)}
              >
                ⎇
              </button>
            </div>
            <div className="wb-status-group" />
          </div>
        }
        panelPlacement={panelPlacement}
      />

      {overlayBusy ? (
        <div className="ui-busy-layer" role="status" aria-live="polite">
          <div className="ui-busy-card">
            <span className="ui-busy-spinner" aria-hidden="true" />
            <div className="ui-busy-copy">{message || "Loading..."}</div>
            <div className="ui-busy-track" aria-hidden="true">
              <span className="ui-busy-bar" />
            </div>
          </div>
        </div>
      ) : null}

      {showGraphPopover ? (
        <div className="wb-graph-popover" role="dialog" aria-label="Graph" onClick={(e) => e.stopPropagation()}>
          <div className="wb-graph-popover-head">
            <strong>Graph</strong>
            <button className="chip" onClick={() => setShowGraphPopover(false)}>
              Close
            </button>
          </div>
          <div className="wb-graph-popover-body">
            <div className="branch-tree branch-tree-lanes" style={{ maxHeight: 360 }}>
              <BranchGraphLanes rows={commitGraph} rowHeight={30} laneGap={14} selectedSha={selectedCommit} />
              {commitGraph
                .filter((g) => !g.isConnector && !!g.sha)
                .map((g, idx) => (
                  <button
                    key={`${g.sha}-${idx}`}
                    className={selectedCommit === g.sha ? "graph-row selected" : "graph-row"}
                    onClick={() => setSelectedCommit(g.sha)}
                  >
                    <span className="graph-ascii graph-ascii-placeholder" aria-hidden="true" />
                    <span className="graph-main">
                      <span className="graph-subject">{g.subject || "(no subject)"}</span>
                      <span className="graph-meta">
                        {g.sha.slice(0, 8)} · {g.author} · {g.date}
                      </span>
                    </span>
                    <span className="graph-refs">
                      {parseRefs(g.refs).map((r) => (
                        <span key={`${g.sha}-${r}`} className="graph-ref-btn" aria-hidden="true">
                          {r}
                        </span>
                      ))}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      ) : null}

      {showSettings ? (
        <div className="modal-mask" onClick={() => setShowSettings(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Settings</h3>
            <p className="small muted">Theme and layout preferences</p>

            <div className="settings-grid">
              <div className="settings-row">
                <div className="settings-label">Theme</div>
                <div className="toolbar">
                  <button className="chip" onClick={toggleTheme} title="Toggle theme">
                    {theme === "dark" ? "Dark" : "Light"}
                  </button>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-label">Panel placement</div>
                <div className="toolbar">
                  <button
                    className={panelPlacement === "bottom" ? "chip active" : "chip"}
                    onClick={() => setPanelPlacement("bottom")}
                  >
                    Bottom
                  </button>
                  <button
                    className={panelPlacement === "right" ? "chip active" : "chip"}
                    onClick={() => setPanelPlacement("right")}
                  >
                    Right
                  </button>
                  <button
                    className={panelPlacement === "hidden" ? "chip active" : "chip"}
                    onClick={() => setPanelPlacement("hidden")}
                  >
                    Hidden
                  </button>
                </div>
              </div>
            </div>

            <div className="toolbar" style={{ justifyContent: "flex-end" }}>
              <button className="chip" onClick={() => setShowSettings(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {repoContextMenu ? (
        <div className="repo-context-layer" onClick={() => setRepoContextMenu(null)}>
          <div
            className="repo-context-menu"
            style={{ left: repoContextMenu.x, top: repoContextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="repo-context-item"
              onClick={() => void closeRepository(repoContextMenu.repo)}
              disabled={busy}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {commitContextMenu ? (
        <div className="repo-context-layer" onClick={() => setCommitContextMenu(null)}>
          <div
            className="repo-context-menu"
            style={{ left: commitContextMenu.x, top: commitContextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="repo-context-item" onClick={() => void copyCommitId(commitContextMenu.sha)}>
              Copy commit id
            </button>
          </div>
        </div>
      ) : null}

    </>
  );
}
