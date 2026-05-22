import { useCallback, useMemo } from 'react';
import { toText } from '../../lib/text';

type QuickSkillRef = {
  key: string;
  name: string;
  subtitle: string;
  itemCount: number;
};

type QuickMcpRef = {
  key: string;
  name: string;
  subtitle: string;
  state: string;
};

function skillScopeLabel(scope: string): string {
  const normalized = toText(scope).trim().toLowerCase();
  if (normalized === 'global') return '全局';
  if (normalized === 'project') return '当前项目';
  return '可引用';
}

function mcpStateLabel(value: unknown): string {
  const normalized = toText(value).trim().toLowerCase();
  if (!normalized) return '可用';
  if (normalized.includes('connect')) return '已连接';
  if (normalized.includes('run')) return '运行中';
  if (normalized.includes('config')) return '已配置';
  if (normalized.includes('auth')) return '待授权';
  if (normalized.includes('error') || normalized.includes('fail')) return '异常';
  return '可用';
}

function dedupeQuickSkillRefs(rows: any[]): QuickSkillRef[] {
  const byName = new Map<string, QuickSkillRef>();
  rows.forEach((skill, idx) => {
    const name = toText(
      skill?.sourceGroup ||
      skill?.name ||
      skill?.title ||
      skill?.id ||
      skill?.spec ||
      (typeof skill === 'string' ? skill : null) ||
      `Skill ${idx + 1}`
    ).trim();
    if (!name) return;
    const prev = byName.get(name);
    if (prev) {
      prev.itemCount += 1;
      return;
    }
    const subtitle = skillScopeLabel(skill?.scope);
    byName.set(name, { key: name, name, subtitle, itemCount: 1 });
  });
  return Array.from(byName.values());
}

function dedupeQuickMcpRefs(rows: Array<{ name: string; status: any }>): QuickMcpRef[] {
  const byName = new Map<string, QuickMcpRef>();
  rows.forEach(({ name, status }) => {
    const label = toText(name).trim();
    if (!label || byName.has(label)) return;
    const typeRaw = toText(status?.type || status?.config?.type || status?.transport || '');
    const type = typeRaw ? typeRaw.toUpperCase() : 'MCP';
    const state = mcpStateLabel(status?.status || status?.state || (status?.connected ? 'connected' : 'configured'));
    byName.set(label, {
      key: label,
      name: label,
      subtitle: type,
      state
    });
  });
  return Array.from(byName.values());
}

export function useRightDrawerController(props: {
  installedSkills: any[];
  installedMcpServers: Array<{ name: string; status: any }>;
  closeDrawer: () => void;
  setPrompt: (value: string | ((prev: string) => string)) => void;
}) {
  const { closeDrawer, installedMcpServers, installedSkills, setPrompt } = props;

  const quickSkillRefs = useMemo(() => dedupeQuickSkillRefs(installedSkills), [installedSkills]);
  const quickMcpRefs = useMemo(() => dedupeQuickMcpRefs(installedMcpServers), [installedMcpServers]);
  const visibleQuickSkillRefs = useMemo(() => quickSkillRefs.slice(0, 8), [quickSkillRefs]);
  const visibleQuickMcpRefs = useMemo(() => quickMcpRefs.slice(0, 6), [quickMcpRefs]);

  const insertQuickReference = useCallback((text: string) => {
    const next = toText(text).trim();
    if (!next) return;
    closeDrawer();
    setPrompt((prev) => {
      const current = toText(prev).trim();
      if (!current) return next;
      if (current.includes(next)) return prev;
      return `${current}\n${next}`;
    });
  }, [closeDrawer, setPrompt]);

  return {
    visibleQuickSkillRefs,
    visibleQuickMcpRefs,
    insertQuickReference
  };
}
