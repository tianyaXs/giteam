import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Animated, Easing, InteractionManager } from 'react-native';
import * as Network from 'expo-network';
import {
  buildHostOrder,
  clampRadarPoint,
  inferDiscoveryPrefixes,
  inferSeedLastSegment,
  pickRadarPoint,
  probeHealthFast,
  resolvePortFromSeed,
  type DiscoveredDevice
} from '../../discovery';
import { loadDiscoverCache, saveDiscoverCache, type DiscoverCacheDevice } from '../../storage/discoverCache';
import { savePairCodeMap } from '../../storage/pairCodeMap';
import { toText } from '../../lib/text';
import type { DiscoverListRow } from '../../screens/DiscoverListScreen';

const DISCOVER_OFFLINE_AFTER_MS = 45000;
const DISCOVER_OFFLINE_MISS_THRESHOLD = 3;
const DISCOVER_KEEPALIVE_HOSTS_PER_SWEEP = 48;
const DISCOVER_SWEEP_HARDSTOP_MS = 2200;
const DISCOVER_WORKER_LIMIT = 8;
const DISCOVER_POST_PROCESS_CHUNK = 12;
const DISCOVER_LOG_LIMIT = 220;
const DISCOVER_CACHE_RENDER_LIMIT = 120;
const DEFAULT_RADAR_BOX = { width: 260, height: 260 };

type DiscoverLogLevel = 'info' | 'error';
type DiscoverLogRow = { ts: number; level: DiscoverLogLevel; msg: string };

type UseDiscoverControllerParams = {
  serverUrl: string;
  pairCodeMapRef: MutableRefObject<Record<string, string>>;
  setStatus: (value: string) => void;
  pushConnLog: (message: string, level?: DiscoverLogLevel) => void;
  connectDiscoveredDevice: (item: DiscoveredDevice, codeOverride?: string) => Promise<void>;
};

export function deviceKeyOf(d: { host: string; port: number } | null | undefined): string {
  if (!d) return '';
  const host = toText((d as any).host).trim();
  const port = Number((d as any).port || 0) || 0;
  return host && port ? `${host}:${port}` : '';
}

function isSameDiscoverRenderList(prev: DiscoverCacheDevice[], next: DiscoverCacheDevice[]): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (a.id !== b.id || a.offline !== b.offline || a.x !== b.x || a.y !== b.y || a.baseUrl !== b.baseUrl || a.noAuth !== b.noAuth) {
      return false;
    }
  }
  return true;
}

function pickPrefixFromText(seed: string): string {
  const text = String(seed || '').trim();
  if (!text) return '';
  try {
    const withScheme = text.startsWith('http://') || text.startsWith('https://') ? text : `http://${text}`;
    const host = new URL(withScheme).hostname;
    const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
  } catch {
    const host = text.split('/')[0]?.split(':')[0] || '';
    const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
  }
}

function sortCachedDevices(rows: DiscoverCacheDevice[]): DiscoverCacheDevice[] {
  return rows
    .sort((a, b) => {
      if (a.offline !== b.offline) return a.offline ? 1 : -1;
      return a.host.localeCompare(b.host, 'en');
    })
    .slice(0, DISCOVER_CACHE_RENDER_LIMIT);
}

export function useDiscoverController(params: UseDiscoverControllerParams) {
  const { serverUrl, pairCodeMapRef, setStatus, pushConnLog, connectDiscoveredDevice } = params;
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverStageReady, setDiscoverStageReady] = useState(false);
  const [discoverDevices, setDiscoverDevices] = useState<DiscoverCacheDevice[]>([]);
  const [discoveringUi, setDiscoveringUi] = useState(false);
  const [pairPromptOpen, setPairPromptOpen] = useState(false);
  const [pairPromptDevice, setPairPromptDevice] = useState<DiscoveredDevice | null>(null);
  const [pairPromptValue, setPairPromptValue] = useState('');
  const [connectingDiscoverId, setConnectingDiscoverId] = useState('');
  const [discoverLogs, setDiscoverLogs] = useState<DiscoverLogRow[]>([]);

  const discoverRunRef = useRef(0);
  const discoverAbortRef = useRef<AbortController | null>(null);
  const discoveringRef = useRef(false);
  const discoverPointRef = useRef<Record<string, { x: number; y: number }>>({});
  const discoverCacheRef = useRef<Record<string, DiscoverCacheDevice>>({});
  const discoverMissRef = useRef<Record<string, number>>({});
  const discoverSweepOffsetRef = useRef(0);
  const discoverPriorityDoneRef = useRef<Set<string>>(new Set());
  const discoverSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discoverPendingSaveRef = useRef<DiscoverCacheDevice[] | null>(null);
  const localIpv4PrefixRef = useRef<{ prefix: string; ip: string; at: number } | null>(null);
  const connectProgressAnim = useRef(new Animated.Value(0)).current;

  const deviceRows = useMemo<DiscoverListRow[]>(
    () =>
      discoverDevices.map((d) => ({
        id: d.id,
        host: d.host,
        port: d.port,
        noAuth: d.noAuth,
        offline: d.offline
      })),
    [discoverDevices]
  );

  const connectProgressScaleX = useMemo(
    () => connectProgressAnim.interpolate({ inputRange: [0, 1], outputRange: [0.12, 1] }),
    [connectProgressAnim]
  );

  const pushDiscoverLog = useCallback(
    (message: string, level: DiscoverLogLevel = 'info') => {
      const msg = toText(message).trim();
      if (!msg) return;
      const row = { ts: Date.now(), level, msg };
      setDiscoverLogs((prev) => (prev.length >= DISCOVER_LOG_LIMIT ? [...prev.slice(prev.length - (DISCOVER_LOG_LIMIT - 1)), row] : [...prev, row]));
      pushConnLog(`[discover] ${msg}`, level);
    },
    [pushConnLog]
  );

  const scheduleDiscoverCacheSave = useCallback((rows: DiscoverCacheDevice[], signal?: AbortSignal) => {
    discoverPendingSaveRef.current = rows;
    if (discoverSaveTimerRef.current) {
      clearTimeout(discoverSaveTimerRef.current);
      discoverSaveTimerRef.current = null;
    }
    discoverSaveTimerRef.current = setTimeout(() => {
      discoverSaveTimerRef.current = null;
      const pending = discoverPendingSaveRef.current;
      discoverPendingSaveRef.current = null;
      if (!pending || signal?.aborted) return;
      try {
        InteractionManager.runAfterInteractions(() => {
          try {
            saveDiscoverCache(pending);
          } catch {
            // ignore
          }
        });
      } catch {
        try {
          saveDiscoverCache(pending);
        } catch {
          // ignore
        }
      }
    }, 450);
  }, []);

  const getLocalIpv4Prefix = useCallback(async (): Promise<{ prefix: string; ip: string } | null> => {
    try {
      const cached = localIpv4PrefixRef.current;
      const now = Date.now();
      if (cached && now - cached.at < 15000) return { prefix: cached.prefix, ip: cached.ip };
      const ip = String(await Network.getIpAddressAsync()).trim();
      const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
      if (!m) return null;
      const [a, b, c, d] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
      if (![a, b, c, d].every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) return null;
      const isPrivate = a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
      if (!isPrivate) return null;
      const prefix = `${a}.${b}.${c}`;
      localIpv4PrefixRef.current = { prefix, ip, at: now };
      return { prefix, ip };
    } catch {
      return null;
    }
  }, []);

  const startDiscover = useCallback(async () => {
    discoverAbortRef.current?.abort();
    const abortCtrl = new AbortController();
    discoverAbortRef.current = abortCtrl;
    const runId = Date.now();
    discoverRunRef.current = runId;
    discoveringRef.current = true;
    setDiscoveringUi(true);
    const hardStopAt = Date.now() + DISCOVER_SWEEP_HARDSTOP_MS;
    const local = await getLocalIpv4Prefix();
    const prefixFromSeed = pickPrefixFromText(serverUrl);
    const prefixFromCache = (() => {
      const rows = Object.values(discoverCacheRef.current || {});
      if (rows.length === 0) return '';
      const best = rows.slice().sort((a, b) => (Number(b.lastSeen || 0) || 0) - (Number(a.lastSeen || 0) || 0))[0];
      return best?.host ? pickPrefixFromText(best.host) : '';
    })();
    const chosenPrefix = local?.prefix || prefixFromSeed || prefixFromCache || inferDiscoveryPrefixes(serverUrl)[0] || '';
    const prefixes = chosenPrefix ? [chosenPrefix] : [];
    const port = resolvePortFromSeed(serverUrl, 5100);
    const seedLast = inferSeedLastSegment(serverUrl);
    const hostOrder = buildHostOrder(seedLast);
    pushDiscoverLog(`开始扫描 localIp=${local?.ip || 'n/a'} prefixes=${prefixes.join(',')} port=${port} seedLast=${seedLast} workers<=${DISCOVER_WORKER_LIMIT}`);
    const hosts: string[] = [];
    for (const pre of prefixes) {
      for (const i of hostOrder) hosts.push(`${pre}.${i}`);
    }
    if (hosts.length === 0) {
      pushDiscoverLog('扫描队列为空（未推断出网段前缀）', 'error');
      discoveringRef.current = false;
      setDiscoveringUi(false);
      return;
    }

    const hostSet = new Set(hosts);
    const cachedHosts = Object.values(discoverCacheRef.current)
      .filter((d) => d.port === port && hostSet.has(d.host) && !discoverPriorityDoneRef.current.has(d.host))
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((d) => d.host);
    const cachedHostSet = new Set(cachedHosts);
    const keepaliveHosts = Object.values(discoverCacheRef.current)
      .filter((d) => d.port === port && hostSet.has(d.host) && !cachedHostSet.has(d.host))
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, DISCOVER_KEEPALIVE_HOSTS_PER_SWEEP)
      .map((d) => d.host);
    const keepaliveHostSet = new Set(keepaliveHosts);
    const allCachedHostSet = new Set(
      Object.values(discoverCacheRef.current)
        .filter((d) => d.port === port && hostSet.has(d.host))
        .map((d) => d.host)
    );
    const offset = discoverSweepOffsetRef.current % hosts.length;
    const rotatedHosts = offset > 0 ? [...hosts.slice(offset), ...hosts.slice(0, offset)] : hosts;
    const queueHosts = [
      ...cachedHosts,
      ...keepaliveHosts,
      ...rotatedHosts.filter((h) => !allCachedHostSet.has(h) && !cachedHostSet.has(h) && !keepaliveHostSet.has(h))
    ];
    for (const h of cachedHosts) discoverPriorityDoneRef.current.add(h);

    let cursor = 0;
    const workers = Math.min(DISCOVER_WORKER_LIMIT, queueHosts.length);
    const found = new Map<string, { host: string; port: number; noAuth: boolean; baseUrl: string }>();
    const runWorker = async () => {
      while (cursor < queueHosts.length && discoverRunRef.current === runId && Date.now() < hardStopAt) {
        if (abortCtrl.signal.aborted) return;
        const host = queueHosts[cursor++];
        const candidate = `http://${host}:${port}`;
        let healthInfo: any | null = null;
        try {
          healthInfo = await probeHealthFast(candidate, 760, abortCtrl.signal);
        } catch (e) {
          pushDiscoverLog(`probe 异常 host=${host} err=${toText(e)}`, 'error');
        }
        if (!healthInfo) continue;
        const key = `${host}:${port}`;
        if (found.has(key)) continue;
        found.set(key, { host, port, noAuth: Boolean(healthInfo?.auth?.noAuth), baseUrl: candidate });
        pushDiscoverLog(`命中 ${key} noAuth=${Boolean(healthInfo?.auth?.noAuth)}`);
      }
    };

    try {
      await Promise.all(Array.from({ length: workers }, () => runWorker()));
      if (discoverRunRef.current !== runId || abortCtrl.signal.aborted) return;
      discoverSweepOffsetRef.current = (offset + Math.max(1, cursor)) % hosts.length;
      const rows = [...found.values()].sort((a, b) => a.host.localeCompare(b.host, 'en'));
      const now = Date.now();
      const foundIds = new Set<string>();
      pushDiscoverLog(
        rows.length === 0
          ? `本轮未发现设备（已探测 ${Math.min(cursor, queueHosts.length)}/${queueHosts.length} host，超时=${Date.now() >= hardStopAt ? '是' : '否'}）`
          : `本轮发现 ${rows.length} 台设备`
      );

      for (let i = 0; i < rows.length; i += 1) {
        if (i > 0 && i % DISCOVER_POST_PROCESS_CHUNK === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (discoverRunRef.current !== runId || abortCtrl.signal.aborted) return;
        }
        const r = rows[i];
        const id = `${r.host}:${r.port}`;
        foundIds.add(id);
        const prev = discoverCacheRef.current[id];
        const point =
          discoverPointRef.current[id] ||
          (prev
            ? { x: prev.x, y: prev.y }
            : clampRadarPoint(
                pickRadarPoint(DEFAULT_RADAR_BOX.width, DEFAULT_RADAR_BOX.height, Object.keys(discoverCacheRef.current).length + 1),
                DEFAULT_RADAR_BOX.width,
                DEFAULT_RADAR_BOX.height,
                34
              ));
        discoverPointRef.current[id] = point;
        discoverCacheRef.current[id] = {
          id,
          baseUrl: r.baseUrl,
          host: r.host,
          port: r.port,
          noAuth: r.noAuth,
          x: point.x,
          y: point.y,
          lastSeen: now,
          offline: false
        };
        discoverMissRef.current[id] = 0;
      }

      if (!abortCtrl.signal.aborted && rows.length > 0) {
        const nextFoundOnly = rows
          .map((r) => discoverCacheRef.current[`${r.host}:${r.port}`])
          .filter(Boolean)
          .sort((a, b) => a.host.localeCompare(b.host, 'en'));
        setDiscoverDevices((prev) => (isSameDiscoverRenderList(prev, nextFoundOnly) ? prev : nextFoundOnly));
        scheduleDiscoverCacheSave(nextFoundOnly, abortCtrl.signal);
      }

      const snapshotRunId = runId;
      const snapshotFoundIds = new Set(foundIds);
      void Promise.resolve(
        InteractionManager.runAfterInteractions(() => {
          if (discoverRunRef.current !== snapshotRunId || abortCtrl.signal.aborted) return;
          const cacheEntries = Object.entries(discoverCacheRef.current);
          const now2 = Date.now();
          for (const [id, d] of cacheEntries) {
            if (snapshotFoundIds.has(id)) continue;
            const miss = (discoverMissRef.current[id] || 0) + 1;
            discoverMissRef.current[id] = miss;
            const stale = now2 - (Number(d.lastSeen || 0) || 0) > DISCOVER_OFFLINE_AFTER_MS;
            const shouldOffline = stale && miss >= DISCOVER_OFFLINE_MISS_THRESHOLD;
            if (d.offline !== shouldOffline) discoverCacheRef.current[id] = { ...d, offline: shouldOffline };
          }
        })
      ).catch(() => {
        // ignore
      });

      if (rows.length === 0) {
        const next = sortCachedDevices(Object.values(discoverCacheRef.current));
        if (abortCtrl.signal.aborted) return;
        setDiscoverDevices((prev) => (isSameDiscoverRenderList(prev, next) ? prev : next));
        scheduleDiscoverCacheSave(next, abortCtrl.signal);
      }
    } catch (e) {
      pushDiscoverLog(`扫描流程异常：${toText(e)}`, 'error');
    } finally {
      if (discoverAbortRef.current === abortCtrl) discoverAbortRef.current = null;
      if (discoverRunRef.current === runId) discoveringRef.current = false;
      setDiscoveringUi(false);
    }
  }, [getLocalIpv4Prefix, pushDiscoverLog, scheduleDiscoverCacheSave, serverUrl]);

  const openDiscover = useCallback(() => {
    discoverPriorityDoneRef.current = new Set();
    setDiscoverStageReady(false);
    setDiscoverLogs([]);
    pushDiscoverLog('打开发现设备界面');
    const cached = sortCachedDevices(Object.values(discoverCacheRef.current));
    if (cached.length > 0) setDiscoverDevices(cached);
    discoverSweepOffsetRef.current = 0;
    setDiscoverOpen(true);
    InteractionManager.runAfterInteractions(() => setDiscoverStageReady(true));
  }, [pushDiscoverLog]);

  const closeDiscover = useCallback(() => {
    if (discoverSaveTimerRef.current) {
      clearTimeout(discoverSaveTimerRef.current);
      discoverSaveTimerRef.current = null;
    }
    discoverPendingSaveRef.current = null;
    discoverAbortRef.current?.abort();
    discoverAbortRef.current = null;
    discoverRunRef.current = 0;
    discoverPointRef.current = {};
    discoverSweepOffsetRef.current = 0;
    discoverPriorityDoneRef.current = new Set();
    discoverMissRef.current = {};
    setDiscoverStageReady(false);
    discoveringRef.current = false;
    pushDiscoverLog('关闭发现设备界面');
    setDiscoverOpen(false);
  }, [pushDiscoverLog]);

  const openPairPrompt = useCallback(
    (item: DiscoveredDevice) => {
      setPairPromptDevice(item);
      const key = deviceKeyOf(item);
      const cached = key ? toText(pairCodeMapRef.current[key]).trim() : '';
      setPairPromptValue(cached || '');
      setPairPromptOpen(true);
    },
    [pairCodeMapRef]
  );

  const clearPairCodeForDevice = useCallback(
    (item: { host: string; port: number } | null | undefined) => {
      const key = deviceKeyOf(item);
      if (!key || !(key in (pairCodeMapRef.current || {}))) return;
      const next = { ...(pairCodeMapRef.current || {}) };
      delete next[key];
      pairCodeMapRef.current = next;
      void savePairCodeMap(next);
    },
    [pairCodeMapRef]
  );

  const reopenPairPromptForDevice = useCallback(
    (item: DiscoveredDevice, statusText: string) => {
      clearPairCodeForDevice(item);
      setPairPromptDevice(item);
      setPairPromptValue('');
      setPairPromptOpen(true);
      setStatus(statusText);
    },
    [clearPairCodeForDevice, setStatus]
  );

  const connectWithProgress = useCallback(
    async (item: DiscoveredDevice, codeOverride?: string) => {
      if (connectingDiscoverId === item.id) return;
      setConnectingDiscoverId(item.id);
      connectProgressAnim.setValue(0);
      await new Promise<void>((resolve) => {
        Animated.timing(connectProgressAnim, {
          toValue: 1,
          duration: 620,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true
        }).start(() => resolve());
      });
      try {
        await connectDiscoveredDevice(item, codeOverride);
      } finally {
        setConnectingDiscoverId('');
        connectProgressAnim.setValue(0);
      }
    },
    [connectDiscoveredDevice, connectingDiscoverId, connectProgressAnim]
  );

  const handleConnectPress = useCallback(
    (item: DiscoverListRow) => {
      if (item.offline) return;
      const found = discoverDevices.find((d) => d.id === item.id) || null;
      if (!found) return;
      if (!item.noAuth) {
        const cached = toText(pairCodeMapRef.current[`${item.host}:${item.port}`]).trim();
        if (!cached) {
          openPairPrompt(found);
          return;
        }
      }
      void connectWithProgress(found);
    },
    [connectWithProgress, discoverDevices, openPairPrompt, pairCodeMapRef]
  );

  const cancelPairPrompt = useCallback(() => {
    setPairPromptOpen(false);
    setPairPromptDevice(null);
  }, []);

  const confirmPairPrompt = useCallback(() => {
    const code = pairPromptValue.trim();
    if (!code) {
      setStatus('请输入授权码');
      return;
    }
    const dev = pairPromptDevice;
    const key = deviceKeyOf(dev);
    if (key) {
      const next = { ...(pairCodeMapRef.current || {}) };
      next[key] = code;
      pairCodeMapRef.current = next;
      try {
        savePairCodeMap(next);
      } catch {
        // ignore
      }
    }
    setPairPromptOpen(false);
    setPairPromptDevice(null);
    if (dev) void connectWithProgress(dev, code);
  }, [connectWithProgress, pairCodeMapRef, pairPromptDevice, pairPromptValue, setStatus]);

  useEffect(() => {
    let alive = true;
    try {
      const rows = loadDiscoverCache();
      if (!alive) return;
      const map: Record<string, DiscoverCacheDevice> = {};
      rows.forEach((d) => {
        map[d.id] = d;
        discoverPointRef.current[d.id] = { x: d.x, y: d.y };
        discoverMissRef.current[d.id] = 0;
      });
      discoverCacheRef.current = map;
    } catch {
      // ignore
    }
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!discoverOpen || !discoverStageReady) return;
    let closed = false;
    const loop = async () => {
      while (!closed) {
        if (!discoveringRef.current) await startDiscover();
        if (closed) return;
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    };
    void loop();
    return () => {
      closed = true;
    };
  }, [discoverOpen, discoverStageReady, startDiscover]);

  return {
    discoverOpen,
    discoveringUi,
    deviceRows,
    connectingDiscoverId,
    connectProgressScaleX,
    pairPromptOpen: pairPromptOpen && !!pairPromptDevice,
    pairPromptHostPort: pairPromptDevice ? `${pairPromptDevice.host}:${pairPromptDevice.port}` : '',
    pairPromptValue,
    discoverLogs,
    openDiscover,
    closeDiscover,
    startDiscover,
    reopenPairPromptForDevice,
    handleConnectPress,
    setPairPromptValue,
    cancelPairPrompt,
    confirmPairPrompt
  };
}
