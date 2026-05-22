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

export function extractModelOptionsFromConfig(raw: any): ModelOption[] {
  const out = new Map<string, ModelOption>();
  const mobileState = raw?.giteamMobileModelState && typeof raw.giteamMobileModelState === 'object' ? raw.giteamMobileModelState : {};
  const hiddenModels = new Set<string>(
    Array.isArray(mobileState?.hiddenModels) ? mobileState.hiddenModels.map((x: any) => String(x || '').trim()).filter(Boolean) : []
  );
  const modelLabels = mobileState?.modelLabels && typeof mobileState.modelLabels === 'object' ? mobileState.modelLabels : {};
  const addMobileModel = (value: any) => {
    const id = String(value || '').trim();
    if (!id || !id.includes('/') || hiddenModels.has(id) || out.has(id)) return;
    const idx = id.indexOf('/');
    const label = String((modelLabels as any)?.[id] || id.slice(idx + 1) || id).trim();
    out.set(id, { id, provider: id.slice(0, idx), label });
  };
  const availableModels = Array.isArray(mobileState?.availableModels) ? mobileState.availableModels : [];
  const enabledModels = Array.isArray(mobileState?.enabledModels) ? mobileState.enabledModels : [];
  for (const item of availableModels) addMobileModel(item);
  for (const item of enabledModels) addMobileModel(item);
  addMobileModel(mobileState?.activeModel);
  if (out.size > 0) return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));

  const providerMap = raw && typeof raw === 'object' && raw.provider && typeof raw.provider === 'object' ? raw.provider : {};
  const disabled = new Set(
    Array.isArray(raw?.disabled_providers) ? raw.disabled_providers.map((x: any) => String(x || '').trim()).filter(Boolean) : []
  );
  for (const [providerId, providerNode] of Object.entries(providerMap as Record<string, any>)) {
    const pid = String(providerId || '').trim();
    if (!pid || disabled.has(pid)) continue;
    const models = providerNode && typeof providerNode === 'object' && providerNode.models && typeof providerNode.models === 'object'
      ? providerNode.models
      : {};
    for (const [modelId, modelNode] of Object.entries(models as Record<string, any>)) {
      const mid = String(modelId || '').trim();
      if (!mid) continue;
      const id = `${pid}/${mid}`;
      const label = String((modelNode as any)?.name || mid).trim() || mid;
      out.set(id, { id, label, provider: pid });
    }
  }
  const configured = String(raw?.model || '').trim();
  if (configured && configured.includes('/') && !out.has(configured)) {
    const idx = configured.indexOf('/');
    out.set(configured, { id: configured, provider: configured.slice(0, idx), label: configured.slice(idx + 1) || configured });
  }
  for (const hidden of hiddenModels) out.delete(hidden);
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function normalizeMcpStatusMap(raw: any): Record<string, any> {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw.mcp && typeof raw.mcp === 'object' && !Array.isArray(raw.mcp)
      ? raw.mcp
      : raw.mcpServers && typeof raw.mcpServers === 'object' && !Array.isArray(raw.mcpServers)
        ? raw.mcpServers
        : raw)
    : {};
  const out: Record<string, any> = {};
  if (Array.isArray(raw?.items) || Array.isArray(raw?.servers)) {
    const rows = Array.isArray(raw?.items) ? raw.items : raw.servers;
    for (const item of rows) {
      const name = toText(item?.name || item?.id).trim();
      if (name) out[name] = item;
    }
    return out;
  }
  for (const [key, value] of Object.entries(source as Record<string, any>)) {
    if (key === 'mcp' || key === 'mcpServers' || key === '$schema') continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    out[key] = value;
  }
  return out;
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
