/** Cluster-internal hostnames that phones / laptop tunnels cannot resolve. */
const INTERNAL_CLOUD_HOSTS = new Set(['giteam-cloud', 'giteam-cloud-gateway', 'localhost', '127.0.0.1']);

export function normalizeBaseUrlForClient(rawBaseUrl: string, opts?: { defaultScheme?: 'http' | 'https' }): string {
  let raw = rawBaseUrl.trim();
  if (!raw) return '';
  // 容忍粘贴「giteam-cloud:http://…/login」或带路径的管理台地址
  raw = raw.replace(/^giteam-cloud:\s*/i, '');
  try {
    const scheme = opts?.defaultScheme === 'https' ? 'https' : 'http';
    const parsed = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `${scheme}://${raw}`);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return raw;
  }
}

/** Prefer public default when QR/server embeds an unreachable cluster URL. */
export function resolveReachableCloudBaseUrl(
  candidate: string,
  fallbackPublicUrl: string
): string {
  const normalized = normalizeBaseUrlForClient(candidate);
  const fallback = normalizeBaseUrlForClient(fallbackPublicUrl);
  if (!normalized) return fallback;
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    if (INTERNAL_CLOUD_HOSTS.has(host)) return fallback || normalized;
  } catch {
    return fallback || normalized;
  }
  return normalized;
}

export function buildConnectionBaseUrlCandidates(rawBaseUrl: string): string[] {
  const raw = rawBaseUrl.trim();
  if (!raw) return [];

  const hasHttps = /^https:\/\//i.test(raw);
  if (hasHttps) {
    const normalized = normalizeBaseUrlForClient(raw);
    return normalized ? [normalized] : [];
  }

  const withoutScheme = raw.replace(/^https?:\/\//i, '');
  const primaryHttp = normalizeBaseUrlForClient(withoutScheme, { defaultScheme: 'http' });
  const fallbackHttps = normalizeBaseUrlForClient(withoutScheme, { defaultScheme: 'https' });

  return Array.from(new Set([primaryHttp, fallbackHttps].filter(Boolean)));
}
