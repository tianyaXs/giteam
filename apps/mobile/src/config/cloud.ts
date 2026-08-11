import Constants from 'expo-constants';

/** Open-source / missing-env fallback — not a production endpoint. */
export const FALLBACK_CLOUD_BASE_URL = 'http://127.0.0.1:8787';

/**
 * Build-time default cloud base URL for 云端 mode.
 * Prefer EXPO_PUBLIC_DEFAULT_CLOUD_BASE_URL via apps/mobile/.env (gitignored).
 */
export function getDefaultCloudBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as { defaultCloudBaseUrl?: string } | undefined;
  const fromExtra = toText(extra?.defaultCloudBaseUrl);
  const fromEnv = toText(process.env.EXPO_PUBLIC_DEFAULT_CLOUD_BASE_URL);
  const raw = fromExtra || fromEnv || FALLBACK_CLOUD_BASE_URL;
  return raw.replace(/\/$/, '');
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
