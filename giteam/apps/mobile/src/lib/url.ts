import { Platform } from 'react-native';

export function normalizeBaseUrlForClient(rawBaseUrl: string, opts?: { defaultScheme?: 'http' | 'https' }): string {
  const raw = rawBaseUrl.trim();
  if (!raw) return '';
  try {
    const scheme = opts?.defaultScheme === 'https' ? 'https' : 'http';
    const parsed = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `${scheme}://${raw}`);
    const host = parsed.hostname;
    const reservedBenchmark = /^198\.(1[89])\./.test(host);
    const needsWebHostReplace =
      Platform.OS === 'web' && (host === '0.0.0.0' || host === '127.0.0.1' || host === 'localhost' || reservedBenchmark);
    if (needsWebHostReplace && typeof window !== 'undefined') {
      parsed.hostname = window.location.hostname;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return raw;
  }
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
