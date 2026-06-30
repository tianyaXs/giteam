export function parseReadToolOutput(raw: string): { path: string; type: string; content: string } | null {
  const src = raw || "";
  if (!src.includes("<path>") || !src.includes("</path>")) return null;
  const path = (src.match(/<path>([\s\S]*?)<\/path>/)?.[1] || "").trim();
  const type = (src.match(/<type>([\s\S]*?)<\/type>/)?.[1] || "").trim();
  const content = (src.match(/<content>([\s\S]*?)<\/content>/)?.[1] || "").replace(/\s+$/, "");
  if (!path && !content) return null;
  return { path, type, content };
}

export function withLineNumbers(text: string, maxLines = 400): string {
  const lines = (text || "").split(/\r?\n/);
  const slice = lines.length > maxLines ? lines.slice(0, maxLines) : lines;
  const width = String(slice.length).length;
  const body = slice.map((line, index) => `${String(index + 1).padStart(width, " ")}│${line}`).join("\n");
  return lines.length > maxLines ? `${body}\n…（仅展示前 ${maxLines} 行，共 ${lines.length} 行）` : body;
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  if (years > 0) return `${years}y`;
  if (months > 0) return `${months}mo`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return "now";
}

export function firstLetter(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}
