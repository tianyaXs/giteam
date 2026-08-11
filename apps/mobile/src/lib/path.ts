import { toText } from './text';

/** 与桌面端一致：trim；额外去掉尾部斜杠，减少 repoPath 匹配漏会话。 */
export function normalizeWorkspacePath(path: string): string {
  return toText(path).trim().replace(/[\\/]+$/, '');
}
