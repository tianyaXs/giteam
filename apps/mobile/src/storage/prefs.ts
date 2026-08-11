import { mmkvGetString, mmkvSetString } from './mmkv';
import { toText } from '../lib/text';

export const PREF_KEY = 'giteam.mobile.v3';

export type Prefs = {
  serverUrl: string;
  serverUrlTouched: boolean;
  preferHttps: boolean;
  pairCode: string;
  repoPath: string;
  repoPaths: string[];
  token: string;
  sessionId: string;
  model: string;
  agent: 'build' | 'plan';
  autoAcceptPermissions: boolean;
  /** local = LAN control; cloud = relay gateway */
  connectionMode: 'local' | 'cloud';
  accessKey: string;
  deviceId: string;
};

export const DEFAULT_PREFS: Prefs = {
  serverUrl: '',
  serverUrlTouched: false,
  preferHttps: false,
  pairCode: '',
  repoPath: '',
  repoPaths: [],
  token: '',
  sessionId: '',
  model: '',
  agent: 'build',
  autoAcceptPermissions: false,
  connectionMode: 'local',
  accessKey: '',
  deviceId: ''
};

export function loadPrefs(): Prefs {
  try {
    const raw = mmkvGetString(PREF_KEY);
    if (!raw) return DEFAULT_PREFS;
    const merged = { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
    const touched = Boolean((merged as any).serverUrlTouched);
    return {
      serverUrl: touched ? toText(merged.serverUrl) : '',
      serverUrlTouched: touched,
      preferHttps: Boolean((merged as any).preferHttps),
      pairCode: toText(merged.pairCode),
      repoPath: toText(merged.repoPath),
      repoPaths: Array.isArray((merged as any).repoPaths) ? (merged as any).repoPaths.map((x: any) => toText(x)).filter(Boolean) : [],
      token: toText(merged.token),
      sessionId: toText(merged.sessionId),
      model: toText(merged.model),
      agent: (merged as any).agent === 'plan' ? 'plan' : 'build',
      autoAcceptPermissions: Boolean((merged as any).autoAcceptPermissions),
      connectionMode: (merged as any).connectionMode === 'cloud' ? 'cloud' : 'local',
      accessKey: toText((merged as any).accessKey),
      deviceId: toText((merged as any).deviceId)
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(next: Prefs): void {
  try {
    const raw = JSON.stringify(next);
    mmkvSetString(PREF_KEY, raw);
  } catch {
    // ignore
  }
}
