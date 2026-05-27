export type StatusSession = { title: string; quote?: string; meta?: string };
export type ParsedStatus = { headline?: string; project?: string; sessions: StatusSession[] };
export type TranscriptMessage = { role: "User" | "Assistant"; content: string };
export type ParsedAgentContext = {
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

export function parseStatusText(raw: string): ParsedStatus {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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

export function parseAgentContextText(raw: string): ParsedAgentContext {
  const lines = raw.split(/\r?\n/);
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
    .split(/\r?\n/)
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
