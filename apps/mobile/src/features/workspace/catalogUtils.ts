import { toText } from '../../lib/text';

export type ModelOption = {
  id: string;
  label: string;
  provider: string;
};

export type ProjectOption = {
  id: string;
  worktree: string;
  name: string;
};

export function projectNameFromPath(worktree: string): string {
  const text = toText(worktree).trim();
  if (!text) return '未命名项目';
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : text;
}

export function toProjectOptionsFromPaths(paths: string[]): ProjectOption[] {
  const uniq = Array.from(new Set(paths.map((x) => toText(x).trim()).filter(Boolean)));
  return sanitizeProjectOptions(uniq.map((p) => ({
    id: p,
    worktree: p,
    name: projectNameFromPath(p)
  })));
}

export function sanitizeProjectOptions(items: ProjectOption[]): ProjectOption[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const worktree = toText(item.worktree).trim();
    const name = toText(item.name || projectNameFromPath(worktree)).trim();
    if (!worktree || !name || worktree === '/' || name === '/') return false;
    if (seen.has(worktree)) return false;
    seen.add(worktree);
    return true;
  }).map((item) => ({
    ...item,
    name: toText(item.name || projectNameFromPath(item.worktree)).trim()
  }));
}

export function stripUrlScheme(value: string): string {
  return value.replace(/^https?:\/\//i, '');
}
