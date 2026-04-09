export type DiscoveredDevice = {
  id: string;
  baseUrl: string;
  host: string;
  port: number;
  noAuth: boolean;
  x: number;
  y: number;
};

export function pickRadarPoint(width: number, height: number, idx: number): { x: number; y: number } {
  const cx = width / 2;
  const cy = height / 2;
  const angle = (idx * 47) % 360;
  const radius = Math.max(42, Math.min(width, height) * (0.2 + ((idx * 13) % 30) / 100));
  const rad = (angle * Math.PI) / 180;
  return {
    x: cx + Math.cos(rad) * radius,
    y: cy + Math.sin(rad) * radius
  };
}

export function clampRadarPoint(
  point: { x: number; y: number },
  width: number,
  height: number,
  padding = 30
): { x: number; y: number } {
  const cx = width / 2;
  const cy = height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const maxRadius = Math.max(10, Math.min(width, height) / 2 - padding);
  if (distance <= maxRadius) return point;
  const ratio = maxRadius / distance;
  return {
    x: cx + dx * ratio,
    y: cy + dy * ratio
  };
}

export function inferDiscoveryPrefixes(seed: string): string[] {
  const out: string[] = [];
  const text = String(seed || '').trim();
  const host = (() => {
    if (!text) return '';
    try {
      const withScheme = text.startsWith('http://') || text.startsWith('https://') ? text : `http://${text}`;
      return new URL(withScheme).hostname;
    } catch {
      return text.split(':')[0] || '';
    }
  })();
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
  if (m) out.push(`${m[1]}.${m[2]}.${m[3]}`);
  const defaults = ['192.168.1', '192.168.50', '10.0.0'];
  for (const p of defaults) {
    if (!out.includes(p)) out.push(p);
  }
  return out.slice(0, 2);
}

export function inferSeedLastSegment(seed: string): number {
  const text = String(seed || '').trim();
  if (!text) return 0;
  try {
    const withScheme = text.startsWith('http://') || text.startsWith('https://') ? text : `http://${text}`;
    const host = new URL(withScheme).hostname;
    const m = host.match(/^\d+\.\d+\.\d+\.(\d+)$/);
    const n = m ? Number(m[1]) : 0;
    return Number.isFinite(n) && n >= 1 && n <= 254 ? n : 0;
  } catch {
    return 0;
  }
}

export function resolvePortFromSeed(seed: string, fallback = 4100): number {
  const text = String(seed || '').trim();
  if (!text) return fallback;
  try {
    const u = new URL(text.startsWith('http://') || text.startsWith('https://') ? text : `http://${text}`);
    return Number(u.port || fallback) || fallback;
  } catch {
    const m = text.match(/:(\d{2,5})$/);
    return m ? Number(m[1]) : fallback;
  }
}

export function buildHostOrder(seedLast: number): number[] {
  const out: number[] = [];
  if (seedLast > 0) {
    out.push(seedLast);
    for (let d = 1; d <= 253; d += 1) {
      const left = seedLast - d;
      const right = seedLast + d;
      if (left >= 1) out.push(left);
      if (right <= 254) out.push(right);
    }
    return out;
  }
  for (let i = 1; i <= 254; i += 1) out.push(i);
  return out;
}

export async function probeHealthFast(baseUrl: string, timeoutMs = 760, signal?: AbortSignal): Promise<any | null> {
  if (signal?.aborted) return null;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const onAbort = () => ctrl?.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/health`, {
      method: 'GET',
      ...(ctrl ? { signal: ctrl.signal } : {})
    });
    if (!res.ok) return null;
    const raw = await res.text();
    const json = JSON.parse(raw);
    if (!json?.ok) return null;
    return json;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
