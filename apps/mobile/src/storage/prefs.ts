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
  notebookTheme: 'paper' | 'slate';
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
  notebookTheme: 'paper'
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
      notebookTheme: (merged as any).notebookTheme === 'slate' ? 'slate' : 'paper'
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
