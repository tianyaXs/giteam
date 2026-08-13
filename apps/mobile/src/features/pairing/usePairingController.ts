import { scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import { Platform, Vibration } from 'react-native';
import {
  health,
  NO_AUTH_TOKEN,
  pairAuth,
  redeemCloudAccess,
  type CloudDeviceInfo,
  type CloudRedeemError
} from '../../api/controlApi';
import {
  setActiveAccessKey,
  setActiveDeviceId,
  setConnectionMode
} from '../../api/connectionContext';
import type { DiscoveredDevice } from '../../discovery';
import { toText } from '../../lib/text';
import {
  buildConnectionBaseUrlCandidates,
  normalizeBaseUrlForClient,
  resolveReachableCloudBaseUrl
} from '../../lib/url';
import { getDefaultCloudBaseUrl } from '../../config/cloud';
import type { ConnectionMode } from '../../lib/connectionMode';

export { getDefaultCloudBaseUrl };

function defaultMobileClientName(): string {
  if (Platform.OS === 'ios') return 'iPhone';
  if (Platform.OS === 'android') return 'Android';
  return '移动设备';
}

type PairPayload = {
  mode?: string;
  baseUrl?: string;
  cloudBaseUrl?: string;
  pairCode?: string;
  code?: string;
  accessKey?: string;
  workspaceId?: string;
  deviceId?: string;
  authMode?: string;
  repoPath?: string;
  repoPaths?: string[];
  currentRepoPath?: string;
};

type ProjectOption = {
  id: string;
  worktree: string;
  name: string;
};

type ConnectOptions = {
  preferredRepoPath?: string;
  payloadRepoPaths?: string[];
  discoveredDevice?: DiscoveredDevice;
};

type UsePairingControllerParams = {
  preferHttps: boolean;
  serverUrlInput: string;
  pairCode: string;
  connectionMode: ConnectionMode;
  accessKey: string;
  deviceId: string;
  setBusy: (value: boolean) => void;
  setStatus: (value: string) => void;
  setServerUrl: (value: string) => void;
  setServerUrlInput: (value: string) => void;
  setPairCode: (value: string) => void;
  setToken: (value: string) => void;
  setRepoPath: (value: string) => void;
  setProjects: (value: ProjectOption[]) => void;
  setConnectionModeState: (value: ConnectionMode) => void;
  setAccessKey: (value: string) => void;
  setDeviceId: (value: string) => void;
  pushConnLog: (message: string, level?: 'info' | 'error') => void;
  refreshProjectsCatalog: (opts?: { baseUrl?: string; token?: string; preferredRepoPath?: string }) => Promise<unknown>;
  toProjectOptionsFromPaths: (paths: string[]) => ProjectOption[];
  onCloseDiscoverRef: MutableRefObject<(() => void) | null>;
  onDiscoveredPairRequiredRef: MutableRefObject<((item: DiscoveredDevice, statusText: string) => void) | null>;
  openAlbumPickerForQrScanRef: MutableRefObject<(() => Promise<void>) | undefined>;
};

function parsePairPayload(input: string): PairPayload | null {
  const text = input.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as PairPayload;
  } catch {
    try {
      const url = new URL(text);
      return {
        mode: url.searchParams.get('mode') || undefined,
        baseUrl: `${url.protocol}//${url.host}`,
        cloudBaseUrl: url.searchParams.get('cloudBaseUrl') || undefined,
        pairCode: url.searchParams.get('pairCode') || url.searchParams.get('code') || undefined,
        accessKey: url.searchParams.get('accessKey') || undefined,
        workspaceId: url.searchParams.get('workspaceId') || undefined,
        deviceId: url.searchParams.get('deviceId') || undefined,
        repoPath: url.searchParams.get('repoPath') || undefined
      };
    } catch {
      return null;
    }
  }
}

function getRepoPathsFromPairPayload(payload: PairPayload): string[] {
  const current = toText(payload.currentRepoPath).trim();
  if (current) return [current];
  const legacySingle = toText(payload.repoPath).trim();
  if (legacySingle) return [legacySingle];
  const fromList = Array.isArray(payload.repoPaths) ? payload.repoPaths.map((x) => toText(x).trim()).filter(Boolean) : [];
  return fromList.length > 0 ? [fromList[0]] : [];
}

function stripUrlScheme(value: string): string {
  return toText(value).trim().replace(/^https?:\/\//i, '');
}

function isLikelyDevToolUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    if (host !== 'localhost' && host !== '127.0.0.1') return false;
    return ['8081', '8082', '19000', '19001', '19006'].includes(port);
  } catch {
    return false;
  }
}

export function usePairingController(params: UsePairingControllerParams) {
  const {
    onCloseDiscoverRef,
    onDiscoveredPairRequiredRef,
    openAlbumPickerForQrScanRef,
    pairCode,
    accessKey,
    connectionMode,
    deviceId,
    pushConnLog,
    refreshProjectsCatalog,
    serverUrlInput,
    setAccessKey,
    setBusy,
    setConnectionModeState,
    setDeviceId,
    setPairCode,
    setProjects,
    setRepoPath,
    setServerUrl,
    setServerUrlInput,
    setStatus,
    setToken,
    toProjectOptionsFromPaths
  } = params;
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerLocked, setScannerLocked] = useState(false);
  const [scannerReady, setScannerReady] = useState(false);
  const [scanHitCount, setScanHitCount] = useState(0);
  const [lastScanAt, setLastScanAt] = useState(0);
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  const [pendingDevices, setPendingDevices] = useState<CloudDeviceInfo[]>([]);
  const [pendingCloudBaseUrl, setPendingCloudBaseUrl] = useState('');
  const [pendingAccessKey, setPendingAccessKey] = useState('');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scannerLockedRef = useRef(false);

  const setScannerLockedBoth = useCallback((value: boolean) => {
    scannerLockedRef.current = value;
    setScannerLocked(value);
  }, []);

  const finishCloudConnect = useCallback(
    async (args: {
      cloudBaseUrl: string;
      accessKey: string;
      token: string;
      deviceId: string;
      preferredRepoPath?: string;
      payloadRepoPaths?: string[];
    }) => {
      const resolvedUrl = normalizeBaseUrlForClient(args.cloudBaseUrl);
      setConnectionMode('cloud');
      setConnectionModeState('cloud');
      setActiveAccessKey(args.accessKey);
      setActiveDeviceId(args.deviceId);
      setAccessKey(args.accessKey);
      setDeviceId(args.deviceId);
      setServerUrl(resolvedUrl);
      setServerUrlInput(stripUrlScheme(resolvedUrl));
      setPairCode('');
      setToken(args.token);
      // 必须先清掉旧工作区，否则 repoPath 为空但 projects 仍有值时，
      // 启动副作用会跳过仓库列表刷新，界面会一直停在「正在连接」。
      setProjects([]);
      setRepoPath('');
      if (args.payloadRepoPaths && args.payloadRepoPaths.length > 0) {
        const fromPayload = toProjectOptionsFromPaths(args.payloadRepoPaths);
        setProjects(fromPayload);
        const preferred = toText(args.preferredRepoPath).trim() || fromPayload[0]?.worktree || '';
        if (preferred) setRepoPath(preferred);
      } else {
        await refreshProjectsCatalog({
          baseUrl: resolvedUrl,
          token: args.token,
          preferredRepoPath: args.preferredRepoPath
        });
      }
      Vibration.vibrate([0, 60, 40, 80]);
      setStatus('云端认证成功，开始新会话');
      setScannerOpen(false);
      setDevicePickerOpen(false);
      onCloseDiscoverRef.current?.();
    },
    [
      onCloseDiscoverRef,
      refreshProjectsCatalog,
      setAccessKey,
      setConnectionModeState,
      setDeviceId,
      setPairCode,
      setProjects,
      setRepoPath,
      setServerUrl,
      setServerUrlInput,
      setStatus,
      setToken,
      toProjectOptionsFromPaths
    ]
  );

  const connectWithCloudAccessKey = useCallback(
    async (
      cloudBaseUrlInput: string,
      accessKeyInput: string,
      deviceIdInput?: string,
      opts?: ConnectOptions
    ) => {
      const cloudBaseUrl = resolveReachableCloudBaseUrl(
        toText(cloudBaseUrlInput).trim() || getDefaultCloudBaseUrl(),
        getDefaultCloudBaseUrl()
      );
      const key = toText(accessKeyInput).trim();
      const preferredDeviceId = toText(deviceIdInput || '').trim();
      if (!key) {
        setStatus('请填写云端连接密钥');
        return;
      }
      setBusy(true);
      try {
        pushConnLog(
          `cloud redeem url=${cloudBaseUrl} key=yes device=${preferredDeviceId || 'auto'}`
        );
        let redeemed;
        const redeemOnce = async (deviceId?: string) =>
          redeemCloudAccess({
            cloudBaseUrl,
            accessKey: key,
            deviceId: deviceId || undefined,
            clientName: defaultMobileClientName()
          });

        const redeemWithRetry = async (deviceId?: string) => {
          let lastErr: unknown;
          for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
              const result = await redeemOnce(deviceId);
              const online = (result.devices || []).filter((d) => d.online);
              if (online.length > 0) return result;
              const offlineErr = new Error(
                '电脑端云端中继未连接：请在桌面端设置 → 服务确认「中继已连接」后再试'
              ) as CloudRedeemError;
              offlineErr.code = 'no_device_online';
              offlineErr.devices = result.devices;
              lastErr = offlineErr;
            } catch (err) {
              const e = err as CloudRedeemError;
              lastErr = err;
              const code = toText(e.code);
              // 新建 Key 后隧道握手可能慢半拍，短暂重试。
              if (code !== 'no_device_online' && code !== 'device_offline') {
                throw err;
              }
            }
            if (attempt < 4) {
              pushConnLog(`cloud redeem wait relay attempt=${attempt + 1}`, 'info');
              setStatus('等待电脑端中继上线…');
              await new Promise((r) => setTimeout(r, 700 + attempt * 300));
            }
          }
          throw lastErr;
        };

        try {
          redeemed = await redeemWithRetry(preferredDeviceId || undefined);
        } catch (firstErr) {
          // 本地/二维码里的 deviceId 可能属于旧 workspace；清掉后让网关自动选在线设备。
          const first = firstErr as CloudRedeemError;
          const hint = `${toText(first.code)} ${toText(first)}`;
          if (
            preferredDeviceId &&
            /deviceId not in workspace|device not in workspace/i.test(hint)
          ) {
            pushConnLog(
              `cloud redeem stale deviceId=${preferredDeviceId}; retry auto-select`,
              'info'
            );
            setDeviceId('');
            redeemed = await redeemWithRetry(undefined);
          } else {
            throw firstErr;
          }
        }
        const onlineDevices = (redeemed.devices || []).filter((d) => d.online);
        if (onlineDevices.length === 0) {
          const offlineErr = new Error(
            '电脑端云端中继未连接：请在桌面端设置 → 服务确认「中继已连接」后再试'
          ) as CloudRedeemError;
          offlineErr.code = 'no_device_online';
          offlineErr.devices = redeemed.devices;
          throw offlineErr;
        }
        // 必须与 JWT 内 deviceId 一致，否则桌面显示已连接但代理打到错误设备。
        const selectedOnline =
          onlineDevices.find((d) => d.id === redeemed.deviceId) || null;
        if (!selectedOnline) {
          const mismatch = new Error(
            '云端返回的设备已离线，请关闭二维码后重开再扫一次'
          ) as CloudRedeemError;
          mismatch.code = 'device_offline';
          mismatch.devices = redeemed.devices;
          throw mismatch;
        }
        await finishCloudConnect({
          cloudBaseUrl,
          accessKey: key,
          token: redeemed.token,
          deviceId: selectedOnline.id,
          preferredRepoPath: opts?.preferredRepoPath,
          payloadRepoPaths: opts?.payloadRepoPaths
        });
      } catch (e) {
        Vibration.vibrate(220);
        const err = e as CloudRedeemError;
        const code = toText(err.code);
        pushConnLog(`cloud redeem error code=${code} ${toText(err)}`, 'error');
        if (code === 'device_selection_required' && Array.isArray(err.devices) && err.devices.length) {
          setPendingCloudBaseUrl(cloudBaseUrl);
          setPendingAccessKey(key);
          setPendingDevices(err.devices);
          setDevicePickerOpen(true);
          setStatus('检测到多台在线设备，请选择一台连接');
        } else if (code === 'device_offline' || code === 'no_device_online') {
          setStatus(
            '电脑端云端中继未连接：请在桌面端设置 → 服务确认「中继已连接」，并确认用的是同一把 Key'
          );
        } else if (code === 'invalid_access_key') {
          setStatus('连接密钥无效，请检查后重试');
        } else if (/deviceId not in workspace|device not in workspace/i.test(toText(err))) {
          setStatus('设备记录已失效，请重新扫码或只用密钥连接');
        } else {
          setStatus(toText(err) || '云端连接失败');
        }
        setScannerLockedBoth(false);
      } finally {
        setBusy(false);
      }
    },
    [finishCloudConnect, pushConnLog, setBusy, setDeviceId, setScannerLockedBoth, setStatus]
  );

  const connectWithAddressAndCode = useCallback(
    async (inputBaseUrl: string, inputCode: string, opts?: ConnectOptions) => {
      const urlCandidates = buildConnectionBaseUrlCandidates(toText(inputBaseUrl).trim());
      const nextUrl = urlCandidates[0] || '';
      const nextCode = toText(inputCode).trim();
      const mode = opts?.payloadRepoPaths ? 'payload' : 'manual';
      if (!nextUrl) {
        setStatus('请填写你的服务地址');
        return;
      }
      setBusy(true);
      try {
        let resolvedUrl = nextUrl;
        let ping: Awaited<ReturnType<typeof health>> | null = null;
        let lastProbeError = '';
        for (let index = 0; index < urlCandidates.length; index += 1) {
          const candidate = urlCandidates[index];
          try {
            if (index > 0) {
              setStatus('HTTP 连接失败，正在尝试 HTTPS...');
            }
            pushConnLog(`auth connect mode=${mode} url=${candidate} code=${nextCode ? 'yes' : 'no'}`);
            ping = await health(candidate);
            resolvedUrl = candidate;
            break;
          } catch (error) {
            lastProbeError = toText(error);
            pushConnLog(`auth probe error url=${candidate} ${lastProbeError}`, 'error');
          }
        }
        if (!ping) {
          throw new Error(lastProbeError || '无法连接到服务地址');
        }
        // Cloud health (mode=cloud) should go through redeem, not local pair.
        if (String((ping as any)?.mode || '').toLowerCase() === 'cloud') {
          setBusy(false);
          // 探测到云端入口时同样不传本地缓存 deviceId，避免跨 workspace 报错
          await connectWithCloudAccessKey(resolvedUrl, nextCode || accessKey, '', opts);
          return;
        }
        pushConnLog(`health ok service=${toText((ping as any)?.service?.host)}:${toText((ping as any)?.service?.port)}`);
        const serverNoAuth = Boolean((ping as any)?.auth?.noAuth);
        if (!serverNoAuth && !nextCode) {
          setStatus('该设备需要验证码，请填写验证码后再连接');
          pushConnLog('pair code required by server (need user input)', 'info');
          return;
        }
        let nextToken = NO_AUTH_TOKEN;
        if (!serverNoAuth && nextCode) {
          const res = await pairAuth(resolvedUrl, nextCode);
          nextToken = toText(res.token).trim();
        }
        setConnectionMode('local');
        setConnectionModeState(connectionMode === 'custom' ? 'custom' : 'local');
        setActiveAccessKey('');
        setActiveDeviceId('');
        setAccessKey('');
        setDeviceId('');
        setServerUrl(resolvedUrl);
        setServerUrlInput(stripUrlScheme(resolvedUrl));
        setPairCode(nextCode);
        setToken(nextToken);
        setProjects([]);
        setRepoPath('');
        if (opts?.payloadRepoPaths && opts.payloadRepoPaths.length > 0) {
          const fromPayload = toProjectOptionsFromPaths(opts.payloadRepoPaths);
          setProjects(fromPayload);
          const preferred = toText(opts.preferredRepoPath).trim() || fromPayload[0].worktree;
          if (preferred) setRepoPath(preferred);
          pushConnLog(`project list from payload count=${fromPayload.length}`);
        } else {
          await refreshProjectsCatalog({ baseUrl: resolvedUrl, token: nextToken, preferredRepoPath: opts?.preferredRepoPath });
        }
        Vibration.vibrate([0, 60, 40, 80]);
        setStatus('认证成功，开始新会话');
        setScannerOpen(false);
        onCloseDiscoverRef.current?.();
      } catch (e) {
        Vibration.vibrate(220);
        const errText = toText(e);
        pushConnLog(`auth connect error ${errText}`, 'error');
        const pairCodeRequired = /pair code required|required by server|需要验证码/i.test(errText);
        const pairCodeRejected = /pair code|expired|invalid|验证码|过期/i.test(errText);
        if (opts?.discoveredDevice && (pairCodeRequired || pairCodeRejected)) {
          onDiscoveredPairRequiredRef.current?.(
            opts.discoveredDevice,
            pairCodeRejected ? '历史验证码已失效，请重新输入验证码' : '该设备需要验证码，请输入验证码后连接'
          );
        } else if (!nextCode && /missing bearer token|invalid bearer token|401/i.test(errText)) {
          setStatus('服务端当前需要验证码，请填写验证码后重试');
        } else if (pairCodeRequired) {
          setStatus('该设备需要验证码，请在首页填写验证码后重试');
        } else if (pairCodeRejected) {
          setStatus('验证码无效或已过期，请检查后重试');
        } else {
          setStatus(errText || '连接失败，请检查服务地址后重试');
        }
        setScannerLockedBoth(false);
      } finally {
        setBusy(false);
      }
    },
    [
      accessKey,
      connectionMode,
      connectWithCloudAccessKey,
      onCloseDiscoverRef,
      onDiscoveredPairRequiredRef,
      pushConnLog,
      refreshProjectsCatalog,
      setAccessKey,
      setBusy,
      setConnectionModeState,
      setDeviceId,
      setPairCode,
      setProjects,
      setRepoPath,
      setScannerLockedBoth,
      setServerUrl,
      setServerUrlInput,
      setStatus,
      setToken,
      toProjectOptionsFromPaths
    ]
  );

  const applyPayloadAndPair = useCallback(
    async (raw: string) => {
      pushConnLog(`pair payload input len=${raw.trim().length}`);
      setStatus('二维码已识别，正在校验...');
      const payload = parsePairPayload(raw);
      if (!payload) {
        pushConnLog('pair payload invalid JSON/URL', 'error');
        Vibration.vibrate(180);
        setStatus('二维码内容格式无效');
        setScannerLockedBoth(false);
        return;
      }
      const payloadMode = String(payload.mode || '').trim().toLowerCase();
      if (payloadMode === 'cloud' || payload.accessKey) {
        const cloudBaseUrl = resolveReachableCloudBaseUrl(
          toText(payload.cloudBaseUrl).trim() ||
            toText(payload.baseUrl).trim() ||
            getDefaultCloudBaseUrl(),
          getDefaultCloudBaseUrl()
        );
        const key = toText(payload.accessKey).trim();
        if (!key) {
          setStatus('云端二维码缺少连接密钥');
          setScannerLockedBoth(false);
          return;
        }
        // 不传 QR 里的 deviceId：集群 QR 常带离线/陈旧设备，交给 redeem 自动选在线桌面
        await connectWithCloudAccessKey(cloudBaseUrl, key, '', {
          preferredRepoPath: toText(payload.repoPath).trim(),
          payloadRepoPaths: getRepoPathsFromPairPayload(payload)
        });
        return;
      }

      const nextUrlRaw = String(payload.baseUrl || '').trim();
      const nextUrl = normalizeBaseUrlForClient(nextUrlRaw);
      if (isLikelyDevToolUrl(nextUrl)) {
        pushConnLog(`pair payload looks like dev server url=${nextUrl}`, 'error');
        Vibration.vibrate(180);
        setStatus('扫到的是开发工具地址（如 Expo），请扫桌面端 Giteam 的配对二维码');
        setScannerLockedBoth(false);
        return;
      }
      const mode = String(payload.authMode || '').trim().toLowerCase();
      const nextCode = mode === 'none' ? '' : String(payload.pairCode || payload.code || '').trim();
      const nextRepo = String(payload.repoPath || '').trim();
      const nextRepoPaths = getRepoPathsFromPairPayload(payload);
      if (!nextUrl) {
        setStatus('二维码缺少服务地址');
        setScannerLockedBoth(false);
        return;
      }
      await connectWithAddressAndCode(nextUrlRaw || nextUrl, nextCode, {
        preferredRepoPath: nextRepo,
        payloadRepoPaths: nextRepoPaths
      });
    },
    [connectWithAddressAndCode, connectWithCloudAccessKey, pushConnLog, setScannerLockedBoth, setStatus]
  );

  const onOpenScanner = useCallback(async () => {
    if (!cameraPermission?.granted) {
      const req = await requestCameraPermission();
      if (!req.granted) {
        pushConnLog('camera permission denied', 'error');
        setStatus('相机权限被拒绝，请在系统设置中允许访问相机');
        return;
      }
    }
    setScannerReady(false);
    pushConnLog('scanner opened');
    setStatus('扫码器已打开，等待识别二维码...');
    setScannerLockedBoth(false);
    setScannerOpen(true);
  }, [cameraPermission?.granted, pushConnLog, requestCameraPermission, setScannerLockedBoth, setStatus]);

  const scanQrFromImageUri = useCallback(
    async (uri: string) => {
      try {
        setScannerLockedBoth(true);
        setStatus('正在识别相册二维码...');
        pushConnLog(`scanFromURL start uri=${uri.slice(0, 120)}`);
        const rows: any[] = await scanFromURLAsync(uri, ['qr'] as any);
        pushConnLog(`scanFromURL result count=${rows.length}`);
        if (!rows.length) {
          Vibration.vibrate(180);
          setScannerLockedBoth(false);
          setStatus('图片中未识别到二维码，请换一张清晰图片重试');
          return;
        }
        const data = String(rows[0]?.data || '').trim();
        if (!data) {
          Vibration.vibrate(180);
          setScannerLockedBoth(false);
          setStatus('二维码内容为空，请重新选择图片');
          return;
        }
        setScanHitCount((v) => v + 1);
        setLastScanAt(Date.now());
        Vibration.vibrate(30);
        await applyPayloadAndPair(data);
      } catch (e) {
        const msg = `相册识别失败: ${String(e)}`;
        pushConnLog(msg, 'error');
        setStatus(msg);
        setScannerLockedBoth(false);
      }
    },
    [applyPayloadAndPair, pushConnLog, setScannerLockedBoth, setStatus]
  );

  const onPickQrFromAlbum = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
        base64: false,
        defaultTab: 'photos',
        legacy: false
      });
      if (result.canceled || !result.assets?.[0]?.uri) {
        return;
      }
      await scanQrFromImageUri(result.assets[0].uri);
    } catch (e) {
      setStatus(`打开系统相册失败: ${String(e)}`);
      pushConnLog(`open system album error ${String(e)}`, 'error');
    }
  }, [pushConnLog, scanQrFromImageUri, setStatus]);

  const onBarcodeScanned = useCallback(
    (result: any) => {
      if (scannerLockedRef.current) return;
      setScannerLockedBoth(true);
      Vibration.vibrate(30);
      setScanHitCount((v) => v + 1);
      setLastScanAt(Date.now());
      const data = String(result?.data || '').trim();
      setStatus('已捕获二维码，正在解析...');
      pushConnLog(`qr scanned len=${data.length}`);
      if (!data) {
        pushConnLog('qr scan empty payload', 'error');
        setStatus('未识别到有效二维码内容，请重新对准二维码');
        setScannerLockedBoth(false);
        return;
      }
      void applyPayloadAndPair(data);
    },
    [applyPayloadAndPair, pushConnLog, setScannerLockedBoth, setStatus]
  );

  const onAuthSubmit = useCallback(async () => {
    if (connectionMode === 'cloud') {
      // 手填密钥不要带本地缓存的旧 deviceId（常属于别的 workspace → device not in workspace）
      await connectWithCloudAccessKey(getDefaultCloudBaseUrl(), accessKey || pairCode, '');
      return;
    }
    if (connectionMode === 'local' && !toText(serverUrlInput).trim()) {
      setStatus('请填写服务地址，或扫码自动填入');
      return;
    }
    await connectWithAddressAndCode(serverUrlInput, pairCode);
  }, [
    accessKey,
    connectWithAddressAndCode,
    connectWithCloudAccessKey,
    connectionMode,
    pairCode,
    serverUrlInput,
    setStatus
  ]);

  const onSelectCloudDevice = useCallback(
    async (selectedDeviceId: string) => {
      await connectWithCloudAccessKey(pendingCloudBaseUrl, pendingAccessKey, selectedDeviceId);
    },
    [connectWithCloudAccessKey, pendingAccessKey, pendingCloudBaseUrl]
  );

  const onCloseScanner = useCallback(() => {
    setScannerLockedBoth(false);
    setScannerReady(false);
    setScannerOpen(false);
  }, [setScannerLockedBoth]);

  const onScannerReady = useCallback(() => {
    setScannerReady(true);
    pushConnLog('camera ready');
  }, [pushConnLog]);

  const onScannerMountError = useCallback(
    (e: any) => {
      pushConnLog(`camera mount error ${String(e)}`, 'error');
      setStatus(`相机启动失败: ${String(e)}`);
    },
    [pushConnLog, setStatus]
  );

  const onRescan = useCallback(() => {
    setScannerReady(false);
    setScannerLockedBoth(false);
    setStatus('已重置扫描器，请重新对准二维码');
  }, [setScannerLockedBoth, setStatus]);

  // Keep album picker ref wired for callers that still use it.
  openAlbumPickerForQrScanRef.current = onPickQrFromAlbum;

  return {
    scannerOpen,
    scannerLocked,
    scannerReady,
    scanHitCount,
    lastScanAt,
    devicePickerOpen,
    pendingDevices,
    setDevicePickerOpen,
    connectWithAddressAndCode,
    connectWithCloudAccessKey,
    onAuthSubmit,
    onSelectCloudDevice,
    onOpenScanner,
    onPickQrFromAlbum,
    scanQrFromImageUri,
    onBarcodeScanned,
    onCloseScanner,
    onScannerReady,
    onScannerMountError,
    onRescan
  };
}
