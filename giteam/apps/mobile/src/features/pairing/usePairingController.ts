import { scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import { Platform, Vibration } from 'react-native';
import { health, NO_AUTH_TOKEN, pairAuth } from '../../api/controlApi';
import type { DiscoveredDevice } from '../../discovery';
import { toText } from '../../lib/text';
import { buildConnectionBaseUrlCandidates, normalizeBaseUrlForClient } from '../../lib/url';

type PairPayload = {
  baseUrl?: string;
  pairCode?: string;
  code?: string;
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
  setBusy: (value: boolean) => void;
  setStatus: (value: string) => void;
  setServerUrl: (value: string) => void;
  setServerUrlInput: (value: string) => void;
  setPairCode: (value: string) => void;
  setToken: (value: string) => void;
  setRepoPath: (value: string) => void;
  setProjects: (value: ProjectOption[]) => void;
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
        baseUrl: `${url.protocol}//${url.host}`,
        pairCode: url.searchParams.get('pairCode') || url.searchParams.get('code') || undefined,
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
    pushConnLog,
    refreshProjectsCatalog,
    serverUrlInput,
    setBusy,
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
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scannerLockedRef = useRef(false);

  const setScannerLockedBoth = useCallback((value: boolean) => {
    scannerLockedRef.current = value;
    setScannerLocked(value);
  }, []);

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
        setServerUrl(resolvedUrl);
        setServerUrlInput(stripUrlScheme(resolvedUrl));
        setPairCode(nextCode);
        setToken(nextToken);
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
      onCloseDiscoverRef,
      onDiscoveredPairRequiredRef,
      pushConnLog,
      refreshProjectsCatalog,
      setBusy,
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
    [connectWithAddressAndCode, pushConnLog, setScannerLockedBoth, setStatus]
  );

  const onOpenScanner = useCallback(async () => {
    if (Platform.OS === 'web') {
      pushConnLog('open scanner on web blocked');
      setStatus('Web 端暂不支持扫码，请在手机端使用扫码连接');
      return;
    }
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
    await connectWithAddressAndCode(serverUrlInput, pairCode);
  }, [connectWithAddressAndCode, pairCode, serverUrlInput]);

  const onCloseScanner = useCallback(() => {
    setScannerOpen(false);
  }, []);

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

  return {
    scannerOpen,
    scannerLocked,
    scannerReady,
    scanHitCount,
    lastScanAt,
    connectWithAddressAndCode,
    onAuthSubmit,
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
