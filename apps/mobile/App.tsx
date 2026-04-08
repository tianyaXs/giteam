import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View
} from 'react-native';
import { scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import { Camera as LegacyCamera, CameraType } from 'expo-camera/legacy';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import EventSource from 'react-native-sse';
import Markdown from '@ronradtke/react-native-markdown-display';
import * as Clipboard from 'expo-clipboard';
import {
  abortSession,
  buildStreamUrl,
  getClientRepositories,
  getMessages,
  getOpencodeConfig,
  getSessions,
  health,
  pairAuth,
  sendPrompt
} from './src/api/controlApi';
import { parseConversation } from './src/messageParser';
import type { MobileChatMessage, MobileTimelineItem } from './src/types';

const PREF_KEY = 'giteam.mobile.v3';

const SUGGESTIONS = [
  '请先检查当前会话上下文，再继续回答',
  '把这个任务拆成 3 个步骤并开始执行',
  '帮我总结刚刚执行结果和下一步行动'
];

const INITIAL_SESSION_LIMIT = 80;
const SESSION_LIMIT_STEP = 120;
const SESSION_LIMIT_MAX = 2000;

type Prefs = {
  serverUrl: string;
  pairCode: string;
  repoPath: string;
  repoPaths: string[];
  token: string;
  sessionId: string;
  model: string;
};

type SessionItem = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
};

type ModelOption = {
  id: string;
  label: string;
  provider: string;
};

type ProjectOption = {
  id: string;
  worktree: string;
  name: string;
};

type ConnLogItem = {
  ts: number;
  level: 'info' | 'error';
  message: string;
};

type PairPayload = {
  baseUrl?: string;
  pairCode?: string;
  code?: string;
  repoPath?: string;
  repoPaths?: string[];
  currentRepoPath?: string;
};

type RenderBoundaryProps = {
  name: string;
  children: React.ReactNode;
};

type RenderBoundaryState = {
  error: string;
};

const DEFAULT_PREFS: Prefs = {
  serverUrl: '',
  pairCode: '',
  repoPath: '',
  repoPaths: [],
  token: '',
  sessionId: '',
  model: ''
};

class RenderBoundary extends React.Component<RenderBoundaryProps, RenderBoundaryState> {
  constructor(props: RenderBoundaryProps) {
    super(props);
    this.state = { error: '' };
  }

  static getDerivedStateFromError(err: unknown): RenderBoundaryState {
    return { error: toText(err) || '渲染异常' };
  }

  componentDidCatch(err: unknown) {
    // Keep a clear console marker so runtime issues can be traced quickly.
    // eslint-disable-next-line no-console
    console.error(`[RenderBoundary:${this.props.name}]`, err);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.boundaryWrap}>
        <Text style={styles.boundaryTitle}>渲染已降级</Text>
        <Text style={styles.boundaryText}>{this.state.error}</Text>
      </View>
    );
  }
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return String(value);
  } catch {
    return '';
  }
}

function renderMarkdown(text: unknown, tone: 'user' | 'assistant' | 'think'): React.ReactNode {
  const src = toText(text);
  const isUser = tone === 'user';
  const isThink = tone === 'think';
  return (
    <Markdown
      style={{
        body: { color: isUser ? '#f5f7fb' : isThink ? '#5e6e84' : '#2f3948', fontSize: 15, lineHeight: 22 },
        paragraph: { marginTop: 0, marginBottom: 8 },
        heading1: { color: isUser ? '#f5f7fb' : '#27384d', fontSize: 18, fontWeight: '700' },
        heading2: { color: isUser ? '#f5f7fb' : '#2f415a', fontSize: 16, fontWeight: '700' },
        heading3: { color: isUser ? '#f5f7fb' : '#3a4e66', fontSize: 15, fontWeight: '700' },
        bullet_list: { marginVertical: 4 },
        ordered_list: { marginVertical: 4 },
        list_item: { color: isUser ? '#f5f7fb' : '#3c4a5f' },
        code_inline: {
          color: isUser ? '#f5f7fb' : '#243247',
          backgroundColor: isUser ? '#334155' : '#edf2f8',
          borderRadius: 4
        },
        code_block: {
          color: isUser ? '#f5f7fb' : '#243247',
          backgroundColor: isUser ? '#334155' : '#edf2f8',
          borderRadius: 8,
          padding: 8
        },
        fence: {
          color: isUser ? '#f5f7fb' : '#243247',
          backgroundColor: isUser ? '#334155' : '#edf2f8',
          borderRadius: 8,
          padding: 8
        },
        blockquote: {
          borderLeftColor: isUser ? '#94a3b8' : '#ccd7e6',
          borderLeftWidth: 3,
          paddingLeft: 10
        }
      }}
    >
      {src}
    </Markdown>
  );
}

async function loadPrefs(): Promise<Prefs> {
  try {
    if (Platform.OS === 'web') {
      const raw = window.localStorage.getItem(PREF_KEY);
      if (!raw) return DEFAULT_PREFS;
      const merged = { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
      return {
        serverUrl: toText(merged.serverUrl),
        pairCode: toText(merged.pairCode),
        repoPath: toText(merged.repoPath),
        repoPaths: Array.isArray((merged as any).repoPaths) ? (merged as any).repoPaths.map((x: any) => toText(x)).filter(Boolean) : [],
        token: toText(merged.token),
        sessionId: toText(merged.sessionId),
        model: toText(merged.model)
      };
    }
    const raw = await AsyncStorage.getItem(PREF_KEY);
    if (!raw) return DEFAULT_PREFS;
    const merged = { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
    return {
      serverUrl: toText(merged.serverUrl),
      pairCode: toText(merged.pairCode),
      repoPath: toText(merged.repoPath),
      repoPaths: Array.isArray((merged as any).repoPaths) ? (merged as any).repoPaths.map((x: any) => toText(x)).filter(Boolean) : [],
      token: toText(merged.token),
      sessionId: toText(merged.sessionId),
      model: toText(merged.model)
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

async function savePrefs(next: Prefs): Promise<void> {
  try {
    const raw = JSON.stringify(next);
    if (Platform.OS === 'web') {
      window.localStorage.setItem(PREF_KEY, raw);
      return;
    }
    await AsyncStorage.setItem(PREF_KEY, raw);
  } catch {
    // ignore
  }
}

function parsePairPayload(input: string): PairPayload | null {
  const text = input.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as PairPayload;
  } catch {
    try {
      const url = new URL(text);
      return {
        baseUrl: `${url.protocol}//${url.host}`,
        pairCode: url.searchParams.get('pairCode') || url.searchParams.get('code') || undefined,
        repoPath: url.searchParams.get('repoPath') || undefined
      };
    } catch {
      return null;
    }
  }
}

function normalizeBaseUrlForClient(rawBaseUrl: string): string {
  const raw = rawBaseUrl.trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `http://${raw}`);
    const host = parsed.hostname;
    const reservedBenchmark = /^198\.(1[89])\./.test(host);
    const needsWebHostReplace =
      Platform.OS === 'web' &&
      (host === '0.0.0.0' || host === '127.0.0.1' || host === 'localhost' || reservedBenchmark);
    if (needsWebHostReplace && typeof window !== 'undefined') {
      parsed.hostname = window.location.hostname;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return raw;
  }
}

function summarizePreview(messages: MobileChatMessage[]): string {
  const assistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.text.trim());
  if (assistant) return assistant.text.slice(0, 42);
  const user = [...messages].reverse().find((m) => m.role === 'user' && m.text.trim());
  return user ? user.text.slice(0, 42) : '新会话';
}

function projectNameFromPath(worktree: string): string {
  const text = toText(worktree).trim();
  if (!text) return '未命名项目';
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : text;
}

function formatClock(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const ss = `${d.getSeconds()}`.padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function extractModelOptionsFromConfig(raw: any): ModelOption[] {
  const out = new Map<string, ModelOption>();
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
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function toProjectOptionsFromPaths(paths: string[]): ProjectOption[] {
  const uniq = Array.from(new Set(paths.map((x) => toText(x).trim()).filter(Boolean)));
  return uniq.map((p) => ({
    id: p,
    worktree: p,
    name: projectNameFromPath(p)
  }));
}

function getRepoPathsFromPairPayload(payload: PairPayload): string[] {
  const current = toText(payload.currentRepoPath).trim();
  if (current) return [current];
  const legacySingle = toText(payload.repoPath).trim();
  if (legacySingle) return [legacySingle];
  const fromList = Array.isArray(payload.repoPaths) ? payload.repoPaths.map((x) => toText(x).trim()).filter(Boolean) : [];
  return fromList.length > 0 ? [fromList[0]] : [];
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('准备就绪');

  const [serverUrl, setServerUrl] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [token, setToken] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelCatalogBusy, setModelCatalogBusy] = useState(false);
  const [modelCatalogStatus, setModelCatalogStatus] = useState('');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectCatalogBusy, setProjectCatalogBusy] = useState(false);
  const [projectPathInput, setProjectPathInput] = useState('');
  const [connLogs, setConnLogs] = useState<ConnLogItem[]>([]);

  const [pairPayloadInput, setPairPayloadInput] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerLocked, setScannerLocked] = useState(false);
  const [scannerReady, setScannerReady] = useState(false);
  const [scanHitCount, setScanHitCount] = useState(0);
  const [lastScanAt, setLastScanAt] = useState(0);

  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<MobileChatMessage[]>([]);
  const [timeline, setTimeline] = useState<MobileTimelineItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [thinkingPulse, setThinkingPulse] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionLimits, setSessionLimits] = useState<Record<string, number>>({});
  const [sessionHasMore, setSessionHasMore] = useState<Record<string, boolean>>({});
  const [loadingOlder, setLoadingOlder] = useState(false);

  const streamRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef('');
  const streamSessionRef = useRef('');
  const messageScrollRef = useRef<ScrollView | null>(null);
  const suppressAutoScrollRef = useRef(false);
  const allowAutoScrollRef = useRef(true);
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const authed = useMemo(() => token.trim().length > 0, [token]);
  const statusText = toText(status);
  const connLogText = useMemo(
    () => connLogs.map((row) => `[${formatClock(row.ts)}] ${toText(row.message)}`).join('\n'),
    [connLogs]
  );

  function pushConnLog(message: string, level: 'info' | 'error' = 'info') {
    const text = toText(message).trim();
    if (!text) return;
    const row: ConnLogItem = { ts: Date.now(), level, message: text };
    setConnLogs((prev) => [...prev.slice(-79), row]);
    const tag = level === 'error' ? 'error' : 'log';
    // eslint-disable-next-line no-console
    console[tag](`[mobile-conn] ${new Date(row.ts).toISOString()} ${row.message}`);
  }

  async function copyText(raw: string, okMsg: string) {
    const text = toText(raw);
    if (!text.trim()) return;
    try {
      await Clipboard.setStringAsync(text);
      setStatus(okMsg);
      pushConnLog(okMsg);
    } catch (e) {
      const msg = `复制失败: ${String(e)}`;
      setStatus(msg);
      pushConnLog(msg, 'error');
    }
  }

  useEffect(() => {
    let alive = true;
    loadPrefs().then((prefs) => {
      if (!alive) return;
      setServerUrl(prefs.serverUrl);
      setPairCode(prefs.pairCode);
      setRepoPath(prefs.repoPath);
      setProjects(toProjectOptionsFromPaths(prefs.repoPaths || []));
      setToken(prefs.token);
      setSessionId(prefs.sessionId);
      sessionIdRef.current = prefs.sessionId;
      setModel(prefs.model || '');
      setLoaded(true);
    });
    return () => {
      alive = false;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void savePrefs({
      serverUrl,
      pairCode,
      repoPath,
      repoPaths: projects.map((p) => p.worktree),
      token,
      sessionId,
      model
    });
  }, [loaded, serverUrl, pairCode, repoPath, projects, token, sessionId, model]);

  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => setThinkingPulse((v) => !v), 480);
    return () => clearInterval(timer);
  }, [streaming]);

  useEffect(() => {
    if (!loaded || !authed || !sessionId || !repoPath) return;
    void refreshMessages(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, authed, sessionId, repoPath]);

  useEffect(() => {
    if (!loaded || !authed || !repoPath) return;
    void refreshModelCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, authed, repoPath, serverUrl, token]);

  useEffect(() => {
    if (!loaded || !authed || !repoPath) return;
    void refreshSessionsFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, authed, repoPath, serverUrl, token]);

  useEffect(() => {
    if (!loaded || !authed || !serverUrl || projects.length > 0) return;
    void refreshProjectsCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, authed, serverUrl, token, projects.length]);

  function stopStream() {
    if (streamRef.current) {
      pushConnLog('SSE close');
      streamRef.current.close();
      streamRef.current = null;
    }
    streamSessionRef.current = '';
    setStreaming(false);
  }

  function setActiveSession(nextSessionId: string) {
    const sid = toText(nextSessionId).trim();
    sessionIdRef.current = sid;
    setSessionId(sid);
    // Switching session should not auto-scroll with animation.
    allowAutoScrollRef.current = false;
    if (sid) {
      // Always reset message window when switching sessions:
      // load recent messages first, then expand history via pull-to-refresh.
      setSessionLimits((prev) => ({ ...prev, [sid]: INITIAL_SESSION_LIMIT }));
    }
  }

  function openDrawer() {
    setDrawerOpen(true);
    Animated.timing(drawerAnim, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }

  function closeDrawer() {
    Animated.timing(drawerAnim, {
      toValue: 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start(() => setDrawerOpen(false));
  }

  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_evt, g) => {
          if (Math.abs(g.dx) < 14 || Math.abs(g.dx) < Math.abs(g.dy)) return false;
          if (!drawerOpen) return g.dx > 0;
          return g.dx < 0;
        },
        onPanResponderRelease: (_evt, g) => {
          if (!drawerOpen && g.dx > 56) {
            openDrawer();
            return;
          }
          if (drawerOpen && g.dx < -56) {
            closeDrawer();
          }
        }
      }),
    [drawerOpen]
  );

  function upsertSession(nextSessionId: string, nextMessages: MobileChatMessage[]) {
    if (!nextSessionId) return;
    const title = nextMessages.find((m) => m.role === 'user' && m.text.trim())?.text.slice(0, 24) || '新会话';
    const preview = summarizePreview(nextMessages);
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== nextSessionId);
      return [{ id: nextSessionId, title, preview, updatedAt: Date.now() }, ...filtered].slice(0, 50);
    });
  }

  async function refreshSessionsFromServer(targetRepoPath?: string) {
    const repo = toText(targetRepoPath || repoPath).trim();
    if (!authed || !repo) return;
    try {
      pushConnLog(`GET sessions repo=${repo}`);
      const rows = await getSessions({
        baseUrl: serverUrl,
        token,
        repoPath: repo,
        limit: 200
      });
      pushConnLog(`GET sessions ok count=${rows.length}`);
      setSessions((prev) => {
        const previewMap = new Map(prev.map((x) => [x.id, x.preview]));
        return rows.map((s) => ({
          id: s.id,
          title: s.title || '新会话',
          preview: previewMap.get(s.id) || '',
          updatedAt: Number(s.updatedAt || 0) || Date.now()
        }));
      });
    } catch (e) {
      pushConnLog(`GET sessions error ${String(e)}`, 'error');
      setStatus((prev) => (prev.includes('sessions failed') ? prev : `会话同步失败: ${String(e)}`));
    }
  }

  async function refreshMessages(targetSessionId: string, opts?: { limit?: number; loadingOlder?: boolean }) {
    if (!authed || !repoPath || !targetSessionId) return;
    const requestedLimit = Math.max(
      20,
      Math.min(SESSION_LIMIT_MAX, Number(opts?.limit || sessionLimits[targetSessionId] || INITIAL_SESSION_LIMIT))
    );
    try {
      pushConnLog(`GET messages sid=${targetSessionId} limit=${requestedLimit}`);
      let raw: any[] = [];
      try {
        raw = await getMessages({
          baseUrl: serverUrl,
          token,
          repoPath,
          sessionId: targetSessionId,
          limit: requestedLimit
        });
      } catch (e1) {
        const fallbackLimit = Math.min(160, requestedLimit);
        pushConnLog(`GET messages retry sid=${targetSessionId} limit=${fallbackLimit} cause=${String(e1)}`, 'error');
        raw = await getMessages({
          baseUrl: serverUrl,
          token,
          repoPath,
          sessionId: targetSessionId,
          limit: fallbackLimit
        });
      }
      const next = parseConversation(raw);
      pushConnLog(`GET messages ok sid=${targetSessionId} rows=${raw.length}`);
      setSessionLimits((prev) => ({ ...prev, [targetSessionId]: requestedLimit }));
      setSessionHasMore((prev) => ({
        ...prev,
        [targetSessionId]: raw.length >= requestedLimit && requestedLimit < SESSION_LIMIT_MAX
      }));
      // Ignore stale async responses from non-active sessions.
      if (sessionIdRef.current && targetSessionId !== sessionIdRef.current) {
        upsertSession(targetSessionId, next.chatMessages);
        return;
      }
      setMessages(next.chatMessages);
      setTimeline(next.timeline);
      upsertSession(targetSessionId, next.chatMessages);
      if (!next.writing) {
        setStreaming(false);
        setStatus((prev) => (toText(prev).includes('流式响应中') ? '' : prev));
      }
    } catch (e) {
      pushConnLog(`GET messages error ${String(e)}`, 'error');
      setStatus(String(e));
    } finally {
      if (opts?.loadingOlder) {
        setLoadingOlder(false);
      }
    }
  }

  async function onLoadOlderMessages() {
    const sid = toText(sessionId).trim();
    if (!sid || loadingOlder) return;
    const current = Number(sessionLimits[sid] || INITIAL_SESSION_LIMIT);
    const nextLimit = Math.min(SESSION_LIMIT_MAX, current + SESSION_LIMIT_STEP);
    if (nextLimit <= current) return;
    setLoadingOlder(true);
    suppressAutoScrollRef.current = true;
    setStatus(`加载更早历史消息... (${nextLimit})`);
    await refreshMessages(sid, { limit: nextLimit, loadingOlder: true });
    setTimeout(() => {
      suppressAutoScrollRef.current = false;
    }, 300);
  }

  async function refreshModelCatalog(targetRepoPath?: string) {
    const repo = toText(targetRepoPath || repoPath).trim();
    if (!authed || !repo || !serverUrl) return;
    setModelCatalogBusy(true);
    try {
      pushConnLog(`GET config repo=${repo}`);
      const cfg = await getOpencodeConfig({ baseUrl: serverUrl, token, repoPath: repo });
      const options = extractModelOptionsFromConfig(cfg);
      setModelOptions(options);
      if (options.length > 0) {
        setModelCatalogStatus(`已加载 ${options.length} 个可用模型`);
      } else {
        setModelCatalogStatus('未发现可用模型（请检查服务端 provider 配置）');
      }
      const configured = String(cfg?.model || '').trim();
      if (configured && configured.includes('/')) {
        setModel((prev) => {
          const p = prev.trim();
          if (!p || !p.includes('/')) return configured;
          return p;
        });
      }
      pushConnLog(`GET config ok models=${options.length}`);
    } catch (e) {
      pushConnLog(`GET config error ${String(e)}`, 'error');
      setModelCatalogStatus(`模型列表读取失败: ${String(e)}`);
    } finally {
      setModelCatalogBusy(false);
    }
  }

  async function refreshProjectsCatalog(opts?: { baseUrl?: string; token?: string; preferredRepoPath?: string }) {
    const base = toText(opts?.baseUrl || serverUrl).trim();
    const tk = toText(opts?.token || token).trim();
    if (!base || !tk) return;
    setProjectCatalogBusy(true);
    try {
      pushConnLog('GET repository list');
      const rows = await getClientRepositories({ baseUrl: base, token: tk });
      const nextProjects = rows.map((x) => ({
        id: x.id || x.path,
        worktree: x.path,
        name: toText(x.name) || projectNameFromPath(x.path)
      }));
      setProjects(nextProjects);
      let nextRepo = toText(opts?.preferredRepoPath).trim();
      if (nextRepo && !nextProjects.some((p) => p.worktree === nextRepo)) {
        nextRepo = '';
      }
      if (!nextRepo && nextProjects.length > 0) nextRepo = nextProjects[0].worktree;
      if (nextRepo) {
        setRepoPath(nextRepo);
      }
      pushConnLog(`GET repository list ok count=${nextProjects.length}`);
    } catch (e) {
      pushConnLog(`GET repository list error ${String(e)}`, 'error');
    } finally {
      setProjectCatalogBusy(false);
    }
  }

  async function onSwitchProject(nextRepoPath: string) {
    const next = toText(nextRepoPath).trim();
    if (!next) return;
    const current = toText(repoPath).trim();
    if (current === next) return;
    stopStream();
    setRepoPath(next);
    setActiveSession('');
    setMessages([]);
    setTimeline([]);
    setSessions([]);
    setSessionLimits({});
    setSessionHasMore({});
    allowAutoScrollRef.current = false;
    setStatus(`已切换项目: ${projectNameFromPath(next)}`);
    await refreshModelCatalog(next);
    await refreshSessionsFromServer(next);
    setProjectPathInput(next);
  }

  function startStream(targetSessionId: string) {
    stopStream();
    if (!authed || !serverUrl || !repoPath || !targetSessionId) return;
    streamSessionRef.current = targetSessionId;
    const url = buildStreamUrl({
      baseUrl: serverUrl,
      repoPath,
      sessionId: targetSessionId,
      intervalMs: 700
    });

    const es = new EventSource(url, {
      headers: { Authorization: `Bearer ${token}` }
    } as any);
    pushConnLog(`SSE connect ${url}`);
    let lastSyncAt = 0;
    const syncFromServer = () => {
      if (streamSessionRef.current !== targetSessionId || sessionIdRef.current !== targetSessionId) return;
      const now = Date.now();
      if (now - lastSyncAt < 700) return;
      lastSyncAt = now;
      void refreshMessages(targetSessionId);
    };

    es.addEventListener('open', () => {
      pushConnLog('SSE open');
      setStreaming(true);
      syncFromServer();
    });
    es.addEventListener('error', (e: any) => {
      setStreaming(false);
      try {
        const detail = typeof e?.data === 'string' ? e.data : JSON.stringify(e);
        pushConnLog(`SSE error ${toText(detail) || 'unknown'}`, 'error');
        if (detail?.includes('invalid bearer token') && pairCode.trim()) {
          pushConnLog('SSE auto pairAuth retry');
          void pairAuth(serverUrl, pairCode)
            .then((renewed) => {
              setToken(renewed.token);
              pushConnLog('SSE auto pairAuth retry ok');
              setStatus('已自动刷新授权，请重试');
            })
            .catch((err) => {
              pushConnLog(`SSE auto pairAuth retry error ${String(err)}`, 'error');
              setStatus(String(err));
            });
        } else {
          setStatus(detail ? `流断开: ${detail}` : '流断开');
        }
      } catch {
        pushConnLog('SSE error parse failed', 'error');
        setStatus('流断开');
      }
    });
    es.addEventListener('messages' as any, () => {
      // Keep SSE as a trigger only. Use `/messages` as the render source of truth.
      syncFromServer();
    });
    es.addEventListener('heartbeat' as any, () => {
      pushConnLog('SSE heartbeat');
      syncFromServer();
    });
    es.addEventListener('end' as any, () => {
      pushConnLog('SSE end');
      syncFromServer();
      setStreaming(false);
      setStatus('本轮回复完成');
    });

    streamRef.current = es;
  }

  const showThinkingPlaceholder = useMemo(() => {
    if (!streaming) return false;
    if (messages.length <= 0) return true;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return true;
    for (let i = lastUserIdx + 1; i < messages.length; i += 1) {
      if (messages[i].role === 'assistant' && messages[i].text.trim()) return false;
    }
    return true;
  }, [messages, streaming]);

  const lastThinkIndex = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      if (timeline[i].kind === 'think') return i;
    }
    return -1;
  }, [timeline]);

  async function applyPayloadAndPair(raw: string) {
    pushConnLog(`pair payload input len=${raw.trim().length}`);
    setStatus('二维码已识别，正在校验...');
    const payload = parsePairPayload(raw);
    if (!payload) {
      pushConnLog('pair payload invalid JSON/URL', 'error');
      Vibration.vibrate(180);
      setStatus('二维码内容格式无效');
      setScannerLocked(false);
      return;
    }
    const nextUrl = normalizeBaseUrlForClient(String(payload.baseUrl || '').trim());
    const nextCode = String(payload.pairCode || payload.code || '').trim();
    const nextRepo = String(payload.repoPath || '').trim();
    const nextRepoPaths = getRepoPathsFromPairPayload(payload);

    if (!nextUrl || !nextCode) {
      pushConnLog(`pair payload missing fields baseUrl=${nextUrl ? 'yes' : 'no'} code=${nextCode ? 'yes' : 'no'}`, 'error');
      Vibration.vibrate(180);
      setStatus('二维码缺少地址或验证码');
      setScannerLocked(false);
      return;
    }

    setBusy(true);
    try {
      pushConnLog(`health check ${nextUrl}/api/v1/health`);
      const ping = await health(nextUrl);
      pushConnLog(`health ok service=${toText((ping as any)?.service?.host)}:${toText((ping as any)?.service?.port)}`);
      setServerUrl(nextUrl);
      setPairCode(nextCode);
      pushConnLog(`pair auth start code=${nextCode}`);
      const res = await pairAuth(nextUrl, nextCode);
      setToken(res.token);
      setRepoPath('');
      if (nextRepoPaths.length > 0) {
        const fromPayload = toProjectOptionsFromPaths(nextRepoPaths);
        setProjects(fromPayload);
        const preferred = toText(payload.currentRepoPath).trim() || nextRepo || fromPayload[0].worktree;
        if (preferred) setRepoPath(preferred);
        pushConnLog(`project list from payload count=${fromPayload.length}`);
      } else {
        await refreshProjectsCatalog({ baseUrl: nextUrl, token: res.token, preferredRepoPath: nextRepo });
      }
      Vibration.vibrate([0, 60, 40, 80]);
      pushConnLog('pair auth ok');
      setStatus('授权成功，开始新会话');
      setScannerOpen(false);
      setPairPayloadInput('');
    } catch (e) {
      Vibration.vibrate(220);
      pushConnLog(`pair flow error ${String(e)}`, 'error');
      setStatus(String(e));
      setScannerLocked(false);
    } finally {
      setBusy(false);
    }
  }

  async function onOpenScanner() {
    if (Platform.OS === 'web') {
      pushConnLog('open scanner on web blocked');
      setStatus('Web 端请粘贴二维码 payload');
      return;
    }
    if (!cameraPermission?.granted) {
      const req = await requestCameraPermission();
      if (!req.granted) {
        pushConnLog('camera permission denied', 'error');
        setStatus('相机权限被拒绝');
        return;
      }
    }
    setScannerReady(false);
    pushConnLog('scanner opened');
    setStatus('扫码器已打开，等待识别二维码...');
    setScannerLocked(false);
    setScannerOpen(true);
  }

  async function onPickQrFromAlbum() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        const msg = '相册权限被拒绝';
        setStatus(msg);
        pushConnLog(msg, 'error');
        return;
      }
      const pick = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1
      });
      if (pick.canceled || !pick.assets?.[0]?.uri) {
        setStatus('已取消选择图片');
        return;
      }
      const uri = String(pick.assets[0].uri || '').trim();
      if (!uri) {
        setStatus('未拿到图片 URI');
        return;
      }
      setScannerLocked(true);
      setStatus('正在识别相册二维码...');
      pushConnLog(`scanFromURL start uri=${uri.slice(0, 120)}`);
      const rows: any[] = await scanFromURLAsync(uri, ['qr'] as any);
      pushConnLog(`scanFromURL result count=${rows.length}`);
      if (!rows.length) {
        Vibration.vibrate(180);
        setScannerLocked(false);
        setStatus('图片中未识别到二维码');
        return;
      }
      const first = rows[0];
      const data = String(first?.data || '').trim();
      if (!data) {
        Vibration.vibrate(180);
        setScannerLocked(false);
        setStatus('二维码内容为空');
        return;
      }
      setScanHitCount((v) => v + 1);
      setLastScanAt(Date.now());
      Vibration.vibrate(30);
      await applyPayloadAndPair(data);
    } catch (e) {
      const msg = `相册识别失败: ${String(e)}`;
      setStatus(msg);
      pushConnLog(msg, 'error');
      setScannerLocked(false);
    }
  }

  function onBarcodeScanned(result: any) {
    if (scannerLocked) return;
    setScannerLocked(true);
    Vibration.vibrate(30);
    setScanHitCount((v) => v + 1);
    setLastScanAt(Date.now());
    const data = String(result?.data || '').trim();
    setStatus('已捕获二维码，正在解析...');
    pushConnLog(`qr scanned len=${data.length}`);
    if (!data) {
      pushConnLog('qr scan empty payload', 'error');
      setStatus('未识别到有效二维码内容');
      setScannerLocked(false);
      return;
    }
    void applyPayloadAndPair(data);
  }

  async function onSendPrompt(customPrompt?: string) {
    const payloadPrompt = (customPrompt ?? prompt).trim();
    if (!authed) {
      setStatus('请先授权');
      return;
    }
    if (!repoPath.trim()) {
      setStatus('未选择项目，请在左侧抽屉切换项目');
      return;
    }
    if (!payloadPrompt) {
      setStatus('请输入消息');
      return;
    }
    setBusy(true);
    // Sending in current session should keep view pinned to latest output.
    allowAutoScrollRef.current = true;
    try {
      const normalizedModel = model.trim();
      const requestModel = normalizedModel && normalizedModel.includes('/') ? normalizedModel : undefined;
      pushConnLog(`POST prompt sid=${sessionId || '(new)'} model=${requestModel || '(default)'}`);
      const res = await sendPrompt({
        baseUrl: serverUrl,
        token,
        repoPath,
        prompt: payloadPrompt,
        sessionId: sessionId || undefined,
        model: requestModel
      });
      setActiveSession(res.sessionId);
      setPrompt('');
      await refreshMessages(res.sessionId);
      await refreshSessionsFromServer();
      startStream(res.sessionId);
      pushConnLog(`POST prompt ok sid=${res.sessionId}`);
      setStatus('已发送');
    } catch (e) {
      const msg = String(e);
      pushConnLog(`POST prompt error ${msg}`, 'error');
      if (msg.includes('invalid bearer token') && pairCode.trim()) {
        try {
          pushConnLog('prompt auto pairAuth retry');
          const renewed = await pairAuth(serverUrl, pairCode);
          setToken(renewed.token);
          pushConnLog('prompt auto pairAuth retry ok');
          setStatus('已刷新授权，请重试发送');
        } catch (retryErr) {
          pushConnLog(`prompt auto pairAuth retry error ${String(retryErr)}`, 'error');
          setStatus(String(retryErr));
        }
      } else {
        setStatus(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onAbort() {
    if (!authed || !sessionId) {
      setStatus('没有可中断的会话');
      return;
    }
    setBusy(true);
    try {
      pushConnLog(`POST abort sid=${sessionId}`);
      await abortSession({
        baseUrl: serverUrl,
        token,
        repoPath,
        sessionId
      });
      setStatus('已请求中断');
      await refreshMessages(sessionId);
      pushConnLog('POST abort ok');
    } catch (e) {
      pushConnLog(`POST abort error ${String(e)}`, 'error');
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  function onNewSession() {
    stopStream();
    setActiveSession('');
    allowAutoScrollRef.current = true;
    setMessages([]);
    setTimeline([]);
    setStatus('新会话已创建');
  }

  function onResetAuth() {
    stopStream();
    setToken('');
    setRepoPath('');
    setProjects([]);
    setActiveSession('');
    setMessages([]);
    setTimeline([]);
    setStatus('已退出授权');
    pushConnLog('reset auth');
  }

  if (!loaded) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centerWrap}>
          <ActivityIndicator color="#cfe6ff" />
          <Text style={styles.centerText}>加载中...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (scannerOpen) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.scannerWrap}>
          <Text style={styles.title}>扫码连接桌面端</Text>
          <Text style={styles.subtitle}>扫描设置页中的二维码即可授权</Text>
          <Text style={styles.scannerHintText}>
            {scannerReady ? (scannerLocked ? '已识别，处理中...' : '识别器已就绪，请将二维码放入框内') : '正在初始化相机...'}
          </Text>
          <Text style={styles.scannerHintText}>
            识别回调次数: {scanHitCount} {lastScanAt ? `· 最近: ${formatClock(lastScanAt)}` : ''}
          </Text>
          <Text style={styles.scannerHintText}>如果实时扫描无反应，可点“相册识别”作为兜底。</Text>
          <View style={styles.scannerFrame}>
            <LegacyCamera
              style={StyleSheet.absoluteFill}
              type={CameraType.back}
              barCodeScannerSettings={{ barCodeTypes: ['qr'] as any }}
              onCameraReady={() => {
                setScannerReady(true);
                pushConnLog('camera ready');
              }}
              onMountError={(e: any) => {
                const msg = `camera mount error: ${toText(e?.message || e)}`;
                pushConnLog(msg, 'error');
                setStatus(msg);
              }}
              onBarCodeScanned={onBarcodeScanned}
            />
          </View>
          <View style={styles.row}>
            <Pressable style={styles.btnSoft} onPress={() => setScannerOpen(false)}>
              <Text style={styles.btnSoftText}>取消</Text>
            </Pressable>
            <Pressable style={styles.btnSoft} onPress={() => void onPickQrFromAlbum()}>
              <Text style={styles.btnSoftText}>相册识别</Text>
            </Pressable>
            <Pressable
              style={styles.btnSoft}
              onPress={() => {
                setScannerLocked(false);
                setStatus('请继续扫码');
              }}
            >
              <Text style={styles.btnSoftText}>重新扫描</Text>
            </Pressable>
          </View>
          <Text style={styles.scannerStatusText}>{toText(status)}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!authed) {
    return (
      <SafeAreaView style={styles.safe}>
        <RenderBoundary name="auth-screen">
          <StatusBar barStyle="dark-content" />
          <ScrollView style={styles.authScroll} contentContainerStyle={styles.authContainer}>
          <View style={styles.brandRow}>
            <Text style={styles.authTitle}>Giteam</Text>
          </View>
          <Text style={styles.authSub}>扫码即可完成授权并开始对话</Text>

          <Pressable style={styles.scanHeroBtn} onPress={onOpenScanner}>
            <Text style={styles.scanHeroBtnText}>扫码连接</Text>
          </Pressable>

          <View style={styles.authHintBox}>
            <Text style={styles.authHint}>1. 打开桌面端设置</Text>
            <Text style={styles.authHint}>2. 展示 Mobile Control 二维码</Text>
            <Text style={styles.authHint}>3. 使用手机扫码完成授权</Text>
          </View>

          <View style={styles.fallbackCard}>
            <Text style={styles.fallbackTitle}>无法扫码？粘贴 payload</Text>
            <TextInput
              style={styles.fallbackInput}
              value={pairPayloadInput}
              onChangeText={setPairPayloadInput}
              autoCapitalize="none"
              multiline
              placeholder='{"baseUrl":"http://192.168.1.23:4100","pairCode":"123456"}'
              placeholderTextColor="#96a0ad"
            />
            <Pressable style={styles.fallbackBtn} onPress={() => void applyPayloadAndPair(pairPayloadInput)}>
              <Text style={styles.fallbackBtnText}>应用并授权</Text>
            </Pressable>
          </View>

          <View style={styles.authStatusBox}>
            {busy ? <ActivityIndicator color="#54657c" /> : null}
            <Text selectable style={styles.authStatusText}>{statusText}</Text>
            <Pressable style={styles.connLogCopyBtn} onPress={() => void copyText(statusText, '状态已复制')}>
              <Text style={styles.connLogCopyBtnText}>复制状态</Text>
            </Pressable>
          </View>
          <View style={styles.connLogBox}>
            <View style={styles.connLogHead}>
              <Text style={styles.connLogTitle}>连接诊断日志</Text>
              <View style={styles.connLogActions}>
                <Pressable style={styles.connLogCopyBtn} onPress={() => void copyText(connLogText, '日志已复制')}>
                  <Text style={styles.connLogCopyBtnText}>复制</Text>
                </Pressable>
                <Pressable style={styles.connLogClearBtn} onPress={() => setConnLogs([])}>
                  <Text style={styles.connLogClearBtnText}>清空</Text>
                </Pressable>
              </View>
            </View>
            <ScrollView style={styles.connLogScroll} contentContainerStyle={styles.connLogList}>
              {connLogs.length === 0 ? <Text style={styles.connLogEmpty}>暂无日志</Text> : null}
              {connLogs.map((row) => (
                <Text selectable key={`${row.ts}-${row.message}`} style={row.level === 'error' ? styles.connLogRowErr : styles.connLogRow}>
                  [{formatClock(row.ts)}] {toText(row.message)}
                </Text>
              ))}
            </ScrollView>
          </View>
          </ScrollView>
        </RenderBoundary>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.chatSafe} {...(Platform.OS === 'web' ? {} : swipeResponder.panHandlers)}>
      <RenderBoundary name="chat-screen">
        <StatusBar barStyle="dark-content" />

      <View style={styles.topBar}>
        <Pressable style={styles.iconBtn} onPress={openDrawer}>
          <Text style={styles.iconTxt}>≡</Text>
        </Pressable>
        <View style={styles.topBrand}>
          <Text style={styles.topTitle}>Giteam</Text>
        </View>
        <View style={styles.topRightGroup}>
          <Pressable style={styles.iconBtn} onPress={onNewSession}>
            <Text style={styles.iconTxt}>＋</Text>
          </Pressable>
          <Pressable style={styles.iconBtn} onPress={onResetAuth}>
            <Text style={styles.iconTxt}>↻</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.chatStatusBar}>
        <Text selectable style={styles.chatStatusText}>{statusText}</Text>
        <Pressable style={styles.chatStatusCopyBtn} onPress={() => void copyText(statusText, '状态已复制')}>
          <Text style={styles.chatStatusCopyTxt}>复制</Text>
        </Pressable>
      </View>

      <View style={styles.chatBodyWrap}>
        {timeline.length === 0 ? (
          <View style={styles.blankWrap}>
            <Text style={styles.blankTitle}>Giteam</Text>
            <Text style={styles.blankSub}>为你答疑、办事、创作，随时找我聊天</Text>
            <View style={styles.suggestList}>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} style={styles.suggestChip} onPress={() => void onSendPrompt(s)}>
                  <Text style={styles.suggestText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <ScrollView
            ref={messageScrollRef}
            style={styles.msgScroll}
            contentContainerStyle={styles.msgList}
            refreshControl={
              <RefreshControl
                refreshing={loadingOlder}
                onRefresh={() => void onLoadOlderMessages()}
                tintColor="#8fa3be"
              />
            }
            onContentSizeChange={() => {
              if (suppressAutoScrollRef.current) return;
              if (!allowAutoScrollRef.current) return;
              requestAnimationFrame(() => messageScrollRef.current?.scrollToEnd({ animated: true }));
            }}
          >
            {sessionId && sessionHasMore[sessionId] ? (
              <View style={styles.historyHintWrap}>
                <Text style={styles.historyHintText}>下拉加载更早历史消息</Text>
              </View>
            ) : null}
            {timeline.map((item, idx) => {
              if (item.kind === 'context') {
                const ctx = item.context;
                return (
                  <View key={ctx.id} style={styles.contextWrap}>
                    <View style={styles.contextCard}>
                      <Text style={styles.contextTitle}>{ctx.title}</Text>
                      <Text style={styles.contextSummary}>{toText(ctx.summary)}</Text>
                      <View style={styles.contextTools}>
                        {ctx.tools.map((event) => {
                          const running = event.status === 'running' || event.status === 'pending';
                          return (
                            <View key={event.id} style={styles.contextToolRow}>
                              <View style={[styles.eventDot, running ? styles.eventDotRun : null]} />
                              <Text style={styles.contextToolTitle}>{toText(event.title)}</Text>
                              {event.mode ? <Text style={styles.eventMode}>{toText(event.mode)}</Text> : null}
                              {event.detail ? <Text numberOfLines={1} style={styles.contextToolDetail}>{toText(event.detail)}</Text> : null}
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                );
              }
              if (item.kind === 'event') {
                const event = item.event;
                const running = event.status === 'running' || event.status === 'pending';
                return (
                  <View key={event.id} style={styles.eventWrap}>
                    <View style={styles.eventCard}>
                      <View style={styles.eventHead}>
                        <View style={[styles.eventDot, running ? styles.eventDotRun : null]} />
                        <Text style={styles.eventTitle}>{toText(event.title)}</Text>
                        {event.mode ? <Text style={styles.eventMode}>{toText(event.mode)}</Text> : null}
                        <Text style={styles.eventTime}>{formatClock(event.createdAt)}</Text>
                      </View>
                      {event.detail ? <Text style={styles.eventDetail}>{toText(event.detail)}</Text> : null}
                      {event.taskSessionId ? (
                        <Text style={styles.eventMeta}>
                          {event.taskSubagent ? `@${toText(event.taskSubagent)} · ` : ''}task: {toText(event.taskSessionId)}
                        </Text>
                      ) : null}
                      {event.output ? <Text style={styles.eventOutput}>{toText(event.output)}</Text> : null}
                    </View>
                  </View>
                );
              }
              if (item.kind === 'think') {
                const keepOpen = !streaming || idx === lastThinkIndex;
                return (
                  <View key={item.card.id} style={styles.thinkWrap}>
                    <View style={styles.thinkCard}>
                      <Text style={styles.thinkTitle}>{item.card.title}</Text>
                      {keepOpen ? (
                        <View>{renderMarkdown(toText(item.card.text), 'think')}</View>
                      ) : (
                        <Text style={styles.thinkCollapsed}>{toText(item.card.text)}</Text>
                      )}
                    </View>
                  </View>
                );
              }
              const m = item.message;
              return (
                <View key={m.id} style={m.role === 'user' ? styles.bubbleUserWrap : styles.bubbleAssistantWrap}>
                  <View style={m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}>
                    <View>{renderMarkdown(toText(m.text || '...'), m.role === 'user' ? 'user' : 'assistant')}</View>
                  </View>
                </View>
              );
            })}
            {showThinkingPlaceholder ? (
              <View style={styles.thinkingWrap}>
                <View style={styles.thinkingCard}>
                  <View style={styles.thinkingDots}>
                    <View style={[styles.thinkingDot, thinkingPulse ? styles.thinkingDotOn : null]} />
                    <View style={[styles.thinkingDot, !thinkingPulse ? styles.thinkingDotOn : null]} />
                    <View style={styles.thinkingDot} />
                  </View>
                  <Text style={styles.thinkingLabel}>Thinking</Text>
                </View>
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>

      <View style={styles.inputDock}>
        <View style={styles.inputRow}>
            <TextInput
              style={styles.inputMain}
              value={toText(prompt)}
              onChangeText={setPrompt}
              placeholder="发消息..."
              placeholderTextColor="#9aa5b3"
              multiline
          />
          <Pressable
            style={streaming || busy ? styles.actionBtnStop : styles.actionBtnSend}
            onPress={streaming || busy ? onAbort : () => void onSendPrompt()}
            disabled={streaming || busy ? !sessionId : !prompt.trim()}
          >
            <Text style={streaming || busy ? styles.actionBtnStopTxt : styles.actionBtnSendTxt}>
              {streaming || busy ? '■' : '→'}
            </Text>
          </Pressable>
        </View>
      </View>

        {drawerOpen ? (
        <View style={styles.drawerMask}>
          <Animated.View
            style={[
              styles.drawerPanel,
              { transform: [{ translateX: drawerAnim.interpolate({ inputRange: [0, 1], outputRange: [-320, 0] }) }] }
            ]}
          >
            <View style={styles.drawerHead}>
              <Text style={styles.drawerTitle}>会话</Text>
              <Pressable style={styles.drawerNewBtn} onPress={() => { onNewSession(); closeDrawer(); }}>
                <Text style={styles.drawerNewTxt}>新建对话</Text>
              </Pressable>
            </View>
            <View style={styles.drawerProjectWrap}>
              <View style={styles.drawerModelHead}>
                <Text style={styles.drawerModelLabel}>项目</Text>
                <Pressable style={styles.drawerModelRefreshBtn} onPress={() => void refreshProjectsCatalog()} disabled={projectCatalogBusy}>
                  <Text style={styles.drawerModelRefreshTxt}>{projectCatalogBusy ? '加载中…' : '刷新'}</Text>
                </Pressable>
              </View>
              <Text numberOfLines={1} style={styles.drawerProjectCurrent}>
                当前: {repoPath ? `${projectNameFromPath(repoPath)} (${repoPath})` : '未选择'}
              </Text>
              {projects.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.drawerModelChipRow}>
                  {projects.map((p) => {
                    const active = repoPath.trim() === p.worktree.trim();
                    return (
                      <Pressable key={p.id} style={active ? styles.drawerModelChipActive : styles.drawerModelChip} onPress={() => void onSwitchProject(p.worktree)}>
                        <Text style={active ? styles.drawerModelChipTextActive : styles.drawerModelChipText}>{toText(p.name)}</Text>
                        <Text style={active ? styles.drawerModelChipSubActive : styles.drawerModelChipSub}>{toText(p.worktree)}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : (
                <Text style={styles.drawerProjectCurrent}>暂无可切换项目</Text>
              )}
              <View style={styles.drawerProjectInputRow}>
                <TextInput
                  style={styles.drawerProjectInput}
                  value={projectPathInput}
                  onChangeText={setProjectPathInput}
                  autoCapitalize="none"
                  placeholder="/path/to/project"
                  placeholderTextColor="#9ca7b5"
                />
                <Pressable
                  style={styles.drawerProjectSwitchBtn}
                  onPress={() => void onSwitchProject(projectPathInput)}
                  disabled={!projectPathInput.trim()}
                >
                  <Text style={styles.drawerProjectSwitchBtnText}>切换</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.drawerModelWrap}>
              <View style={styles.drawerModelHead}>
                <Text style={styles.drawerModelLabel}>模型</Text>
                <Pressable style={styles.drawerModelRefreshBtn} onPress={() => void refreshModelCatalog()} disabled={modelCatalogBusy}>
                  <Text style={styles.drawerModelRefreshTxt}>{modelCatalogBusy ? '加载中…' : '刷新'}</Text>
                </Pressable>
              </View>
              <TextInput
                style={styles.drawerModelInput}
                value={toText(model)}
                onChangeText={setModel}
                autoCapitalize="none"
                placeholder="provider/model"
                placeholderTextColor="#9ca7b5"
              />
              <Text numberOfLines={2} style={styles.drawerModelStatus}>{toText(modelCatalogStatus || '从列表选择，或手动输入 provider/model')}</Text>
              {modelOptions.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.drawerModelChipRow}>
                  {modelOptions.map((opt) => {
                    const active = model.trim() === opt.id;
                    return (
                      <Pressable key={opt.id} style={active ? styles.drawerModelChipActive : styles.drawerModelChip} onPress={() => setModel(opt.id)}>
                        <Text style={active ? styles.drawerModelChipTextActive : styles.drawerModelChipText}>{toText(opt.label)}</Text>
                        <Text style={active ? styles.drawerModelChipSubActive : styles.drawerModelChipSub}>{toText(opt.provider)}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}
            </View>
            <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerList}>
              {sessions.map((s) => (
                <Pressable
                  key={s.id}
                  style={s.id === sessionId ? styles.drawerItemActive : styles.drawerItem}
                  onPress={() => {
                    stopStream();
                    setActiveSession(s.id);
                    void refreshMessages(s.id, { limit: INITIAL_SESSION_LIMIT });
                    closeDrawer();
                  }}
                >
                  <Text style={styles.drawerItemTitle}>{toText(s.title || '新会话')}</Text>
                  <Text style={styles.drawerItemPreview}>{toText(s.preview || '...')}</Text>
                </Pressable>
              ))}
              {sessions.length === 0 ? <Text style={styles.drawerEmpty}>暂无会话</Text> : null}
            </ScrollView>
          </Animated.View>
          <Animated.View
            style={[
              styles.drawerBackdrop,
              { opacity: drawerAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) }
            ]}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
          </Animated.View>
        </View>
        ) : null}
      </RenderBoundary>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7f8fa' },
  chatSafe: { flex: 1, backgroundColor: '#f7f8fa' },

  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  centerText: { color: '#4a5565' },
  title: { color: '#1f2630', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#6f7c8f', fontSize: 14 },

  authScroll: { flex: 1 },
  authContainer: { padding: 20, gap: 14, paddingBottom: 40 },
  brandRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center' },
  authTitle: { fontSize: 32, fontWeight: '700', color: '#1f2630' },
  authSub: { color: '#6f7c8f', fontSize: 16 },
  scanHeroBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center'
  },
  scanHeroBtnText: { color: '#f9fafb', fontWeight: '700', fontSize: 16 },
  authHintBox: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e6e8ec',
    gap: 4
  },
  authHint: { color: '#5f6a7a' },
  fallbackCard: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e6e8ec',
    gap: 8
  },
  fallbackTitle: { color: '#303744', fontWeight: '600' },
  fallbackInput: {
    minHeight: 92,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dfe3e8',
    backgroundColor: '#f9fafb',
    padding: 10,
    color: '#263041',
    textAlignVertical: 'top'
  },
  fallbackBtn: {
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2937'
  },
  fallbackBtnText: { color: '#fff', fontWeight: '600' },
  authStatusBox: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e5eb',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  authStatusText: { color: '#5f6b7c', flex: 1 },
  connLogActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  connLogCopyBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9e1ec',
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#f8fafc'
  },
  connLogCopyBtnText: { color: '#44566f', fontSize: 12, fontWeight: '600' },
  connLogBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e5eb',
    backgroundColor: '#ffffff',
    padding: 10,
    gap: 8
  },
  connLogHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  connLogTitle: { color: '#344458', fontWeight: '700', fontSize: 13 },
  connLogClearBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9e1ec',
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  connLogClearBtnText: { color: '#516176', fontSize: 12, fontWeight: '600' },
  connLogScroll: { maxHeight: 160 },
  connLogList: { gap: 4 },
  connLogEmpty: { color: '#8895a7', fontSize: 12 },
  connLogRow: { color: '#4f5f74', fontSize: 12, lineHeight: 16 },
  connLogRowErr: { color: '#9a3b3b', fontSize: 12, lineHeight: 16 },

  scannerWrap: { flex: 1, padding: 14, gap: 10 },
  scannerHintText: { color: '#5a6a80', fontSize: 13 },
  scannerFrame: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#dde3ea',
    backgroundColor: '#fff'
  },

  topBar: {
    height: 58,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  topBrand: { flexDirection: 'row', alignItems: 'center' },
  topTitle: { fontSize: 20, color: '#202734', fontWeight: '700' },
  topRightGroup: { flexDirection: 'row', gap: 6 },
  chatStatusBar: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 6,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start'
  },
  chatStatusText: {
    color: '#6f7c8f',
    fontSize: 12,
    lineHeight: 17,
    flex: 1
  },
  chatStatusCopyBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9e1ec',
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#f8fafc'
  },
  chatStatusCopyTxt: { color: '#536278', fontSize: 11, fontWeight: '600' },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef1f5'
  },
  iconTxt: { color: '#394455', fontWeight: '700' },

  chatBodyWrap: { flex: 1, paddingHorizontal: 16 },
  blankWrap: { marginTop: 26, gap: 10 },
  blankTitle: { fontSize: 40, fontWeight: '700', color: '#c7ced8' },
  blankSub: { color: '#7e8898', fontSize: 18 },
  suggestList: { gap: 10, marginTop: 8 },
  suggestChip: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e6e9ee',
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignSelf: 'flex-start'
  },
  suggestText: { color: '#545f6f', fontSize: 14 },

  msgScroll: { flex: 1 },
  msgList: { gap: 10, paddingTop: 8, paddingBottom: 120 },
  historyHintWrap: { alignItems: 'center', paddingTop: 4, paddingBottom: 2 },
  historyHintText: { color: '#7c8aa0', fontSize: 12 },
  thinkWrap: { alignItems: 'flex-start' },
  contextWrap: { alignItems: 'flex-start' },
  contextCard: {
    maxWidth: '96%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5eaf2',
    backgroundColor: '#f9fbff',
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6
  },
  contextTitle: { color: '#2f415a', fontSize: 12, fontWeight: '700' },
  contextSummary: { color: '#65758a', fontSize: 12, lineHeight: 18 },
  contextTools: { gap: 5 },
  contextToolRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contextToolTitle: { color: '#2d3a4d', fontSize: 12, fontWeight: '600' },
  contextToolDetail: { color: '#73839a', fontSize: 11, flex: 1 },
  eventWrap: { alignItems: 'flex-start' },
  eventCard: {
    maxWidth: '96%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9edf3',
    backgroundColor: '#ffffff',
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6
  },
  eventHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  eventDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#9da9ba' },
  eventDotRun: { backgroundColor: '#4f7aaf' },
  eventTitle: { color: '#2d3a4d', fontSize: 13, fontWeight: '600' },
  eventMode: { color: '#5f7898', fontSize: 12, fontWeight: '500' },
  eventTime: { marginLeft: 'auto', color: '#8a95a6', fontSize: 11 },
  eventDetail: { color: '#667487', fontSize: 12, lineHeight: 18 },
  eventMeta: { color: '#667a94', fontSize: 11 },
  eventOutput: { color: '#4f5e72', fontSize: 12, lineHeight: 18 },
  thinkCard: {
    maxWidth: '92%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9edf3',
    backgroundColor: '#f9fbff',
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 4
  },
  thinkTitle: { color: '#576579', fontSize: 12, fontWeight: '600' },
  thinkText: { color: '#5e6e84', fontSize: 13, lineHeight: 19 },
  thinkCollapsed: { color: '#6f7f95', fontSize: 12, lineHeight: 18 },
  mdText: { fontSize: 15, lineHeight: 20 },
  mdInlineRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 0 },
  mdSegText: { fontSize: 15, lineHeight: 20 },
  mdHeading: { fontSize: 16, lineHeight: 22, fontWeight: '700', marginBottom: 4 },
  mdInlineCode: { borderRadius: 4, paddingHorizontal: 4, fontSize: 13 },
  mdCodeBlock: { borderRadius: 8, backgroundColor: '#eef3f8', padding: 8 },
  mdCodeText: { fontSize: 12, lineHeight: 18 },
  mdBulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  mdBulletDot: { fontSize: 14, lineHeight: 20 },
  thinkingWrap: { alignItems: 'flex-start' },
  thinkingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e7ebf2',
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    paddingHorizontal: 12
  },
  thinkingDots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  thinkingDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: '#c7d0de' },
  thinkingDotOn: { backgroundColor: '#6b7f98' },
  thinkingLabel: { color: '#667a94', fontSize: 12, fontWeight: '500' },
  bubbleUserWrap: { alignItems: 'flex-end' },
  bubbleAssistantWrap: { alignItems: 'flex-start' },
  bubbleUser: {
    maxWidth: '84%',
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: '#1f2937'
  },
  bubbleAssistant: {
    maxWidth: '84%',
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e6e9ee'
  },
  bubbleUserText: { color: '#f5f7fb', lineHeight: 20 },
  bubbleAssistantText: { color: '#2f3948', lineHeight: 20 },

  inputDock: {
    marginHorizontal: 12,
    marginBottom: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e0e5ec',
    backgroundColor: '#ffffff',
    minHeight: 58,
    paddingLeft: 12,
    paddingRight: 10,
    paddingTop: 8,
    paddingBottom: 8,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputMain: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 2,
    color: '#273041',
    textAlignVertical: 'center',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {})
  },
  actionBtnStop: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eceff3'
  },
  actionBtnSend: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2937'
  },
  actionBtnStopTxt: { color: '#5c6779', fontSize: 12, fontWeight: '700' },
  actionBtnSendTxt: { color: '#fff', fontSize: 18, fontWeight: '700' },

  drawerMask: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row'
  },
  drawerBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.2)' },
  drawerPanel: {
    width: '76%',
    maxWidth: 340,
    backgroundColor: '#fbfcfe',
    borderRightWidth: 1,
    borderColor: '#e6eaf1',
    paddingTop: 44,
    paddingHorizontal: 14,
    paddingBottom: 12
  },
  drawerHead: { gap: 10, marginBottom: 12 },
  drawerProjectWrap: {
    gap: 8,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e4eaf2',
    backgroundColor: '#ffffff',
    padding: 10
  },
  drawerProjectCurrent: { color: '#6a788d', fontSize: 12 },
  drawerProjectInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  drawerProjectInput: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe2eb',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    color: '#243247',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {})
  },
  drawerProjectSwitchBtn: {
    height: 34,
    minWidth: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d4deec',
    backgroundColor: '#eef3fa',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  drawerProjectSwitchBtnText: { color: '#314359', fontSize: 12, fontWeight: '600' },
  drawerModelWrap: {
    gap: 8,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e4eaf2',
    backgroundColor: '#ffffff',
    padding: 10
  },
  drawerModelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  drawerModelLabel: { color: '#4a5a70', fontSize: 12, fontWeight: '600' },
  drawerModelInput: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dbe2eb',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    color: '#243247'
  },
  drawerModelRefreshBtn: {
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe2eb',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 9,
    justifyContent: 'center'
  },
  drawerModelRefreshTxt: { color: '#314359', fontSize: 12, fontWeight: '600' },
  drawerModelStatus: { color: '#6a788d', fontSize: 12 },
  drawerModelChipRow: { gap: 8, paddingTop: 2, paddingBottom: 2 },
  drawerModelChip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dbe2eb',
    backgroundColor: '#ffffff',
    paddingVertical: 6,
    paddingHorizontal: 8,
    minWidth: 96,
    gap: 2
  },
  drawerModelChipActive: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c5d9f8',
    backgroundColor: '#eaf1fb',
    paddingVertical: 6,
    paddingHorizontal: 8,
    minWidth: 96,
    gap: 2
  },
  drawerModelChipText: { color: '#28384e', fontSize: 12, fontWeight: '600' },
  drawerModelChipTextActive: { color: '#1f3659', fontSize: 12, fontWeight: '700' },
  drawerModelChipSub: { color: '#74839a', fontSize: 11 },
  drawerModelChipSubActive: { color: '#446895', fontSize: 11 },
  drawerTitle: { color: '#1f2734', fontWeight: '700', fontSize: 28 },
  drawerNewBtn: {
    borderRadius: 12,
    backgroundColor: '#eceff3',
    paddingVertical: 10,
    alignItems: 'center'
  },
  drawerNewTxt: { color: '#2d3848', fontWeight: '600' },
  drawerScroll: { flex: 1 },
  drawerList: { gap: 8, paddingBottom: 30 },
  drawerItem: {
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e4e8ee',
    padding: 10,
    gap: 4
  },
  drawerItemActive: {
    borderRadius: 10,
    backgroundColor: '#eaf1fb',
    borderWidth: 1,
    borderColor: '#cddff8',
    padding: 10,
    gap: 4
  },
  drawerItemTitle: { color: '#202834', fontWeight: '600' },
  drawerItemPreview: { color: '#66758a', fontSize: 12 },
  drawerEmpty: { color: '#7d8897', marginTop: 10 },

  row: { flexDirection: 'row', gap: 8 },
  boundaryWrap: {
    margin: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#efcaca',
    backgroundColor: '#fff7f7',
    gap: 6
  },
  boundaryTitle: { color: '#8a2f2f', fontWeight: '700' },
  boundaryText: { color: '#6f3b3b', fontSize: 12 },
  btnSoft: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8edf3'
  },
  btnSoftText: { color: '#39485d', fontWeight: '600' },
  scannerStatusText: { color: '#4d5e76', fontSize: 13, lineHeight: 18 }
});
