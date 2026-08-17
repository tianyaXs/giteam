import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { SHERPA_ASR_MODEL_SIZE_HINT_BYTES } from '../../lib/speech/sherpaAsrConfig';
import {
  cancelSherpaAsrModelDownload,
  deleteSherpaAsrLocalModel,
  downloadSherpaAsrModel,
  isSherpaAsrDownloadInFlight,
  isSherpaAsrLocalModelReady
} from '../../lib/speech/sherpaAsrLocalStore';
import { isSherpaAsrModelAvailable } from '../../lib/speech/sherpaAsrModel';
import { resolveSpeechInputMode } from '../../lib/speech/speechInputStrategy';
import {
  loadSpeechInputPrefs,
  notifySpeechInputChanged,
  setSpeechInputEnabled,
  subscribeSpeechInputPrefs
} from '../../storage/speechInputPrefs';

export type SpeechInputSettingStatus =
  | 'unavailable'
  | 'native_ready'
  | 'need_download'
  | 'downloading'
  | 'ready';

export type SpeechInputSettingState = {
  /** 偏好：离线模型下载完成后为 true；移除后为 false */
  enabled: boolean;
  modelReady: boolean;
  /** 聊天栏是否展示语音入口 */
  voiceUiAvailable: boolean;
  /** Android 离线需下载；iOS 等为系统听写 */
  needsDownload: boolean;
  status: SpeechInputSettingStatus;
  downloading: boolean;
  /** 0–100 */
  progressPercent: number;
  sizeHintMb: number;
  errorMessage: string | null;
  startDownload: () => void;
  cancelDownload: () => void;
  removeModel: () => void;
  retryDownload: () => void;
};

function needsModelDownload(): boolean {
  return resolveSpeechInputMode() === 'offline';
}

function computeStatus(params: {
  modelReady: boolean;
  downloading: boolean;
}): SpeechInputSettingStatus {
  if (Platform.OS === 'web') return 'unavailable';
  if (params.downloading) return 'downloading';
  if (!needsModelDownload()) return 'native_ready';
  if (!params.modelReady) return 'need_download';
  return 'ready';
}

/**
 * 设置页 + Composer：语音为「下载 / 移除」模型，下载完成默认开启。
 */
export function useSpeechInputSetting(): SpeechInputSettingState {
  const [enabled, setEnabled] = useState(() => loadSpeechInputPrefs().enabled);
  const [modelReady, setModelReady] = useState(false);
  const [downloading, setDownloading] = useState(() => isSherpaAsrDownloadInFlight());
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const downloadGenRef = useRef(0);

  const refreshModelReady = useCallback(async () => {
    if (!needsModelDownload()) {
      setModelReady(true);
      // 系统听写无需下载：保持可用
      if (!loadSpeechInputPrefs().enabled) {
        setSpeechInputEnabled(true);
        setEnabled(true);
      }
      return true;
    }
    const ready = await isSherpaAsrModelAvailable();
    setModelReady(ready);
    // 已下载则默认开启（兼容旧数据：模型在本地但 prefs 关闭）
    if (ready && !loadSpeechInputPrefs().enabled) {
      setSpeechInputEnabled(true);
      setEnabled(true);
    }
    return ready;
  }, []);

  useEffect(() => {
    return subscribeSpeechInputPrefs(() => {
      setEnabled(loadSpeechInputPrefs().enabled);
    });
  }, []);

  useEffect(() => {
    void refreshModelReady();
  }, [refreshModelReady]);

  const startDownload = useCallback(async () => {
    if (!needsModelDownload()) {
      setSpeechInputEnabled(true);
      setEnabled(true);
      return true;
    }
    if (await isSherpaAsrLocalModelReady()) {
      setModelReady(true);
      setProgressPercent(100);
      setSpeechInputEnabled(true);
      setEnabled(true);
      notifySpeechInputChanged();
      return true;
    }

    const gen = ++downloadGenRef.current;
    setDownloading(true);
    setErrorMessage(null);
    setProgressPercent(0);
    try {
      await downloadSherpaAsrModel({
        onProgress: (p) => {
          if (downloadGenRef.current !== gen) return;
          setProgressPercent(p.percent);
        }
      });
      if (downloadGenRef.current !== gen) return false;
      setModelReady(true);
      setProgressPercent(100);
      setSpeechInputEnabled(true);
      setEnabled(true);
      notifySpeechInputChanged();
      return true;
    } catch (error) {
      if (downloadGenRef.current !== gen) return false;
      const message = error instanceof Error ? error.message : String(error);
      if (message !== 'download-cancelled') {
        setErrorMessage('下载失败，请重试');
      }
      setModelReady(false);
      notifySpeechInputChanged();
      return false;
    } finally {
      if (downloadGenRef.current === gen) {
        setDownloading(false);
      }
    }
  }, []);

  const cancelDownload = useCallback(() => {
    void cancelSherpaAsrModelDownload();
    downloadGenRef.current += 1;
    setDownloading(false);
    setProgressPercent(0);
    setErrorMessage(null);
  }, []);

  const removeModel = useCallback(() => {
    void (async () => {
      void cancelSherpaAsrModelDownload();
      downloadGenRef.current += 1;
      setDownloading(false);
      setProgressPercent(0);
      setErrorMessage(null);
      await deleteSherpaAsrLocalModel();
      setModelReady(false);
      setSpeechInputEnabled(false);
      setEnabled(false);
      notifySpeechInputChanged();
    })();
  }, []);

  const retryDownload = useCallback(() => {
    setErrorMessage(null);
    void startDownload();
  }, [startDownload]);

  const status = computeStatus({ modelReady, downloading });
  const voiceUiAvailable =
    Platform.OS !== 'web' &&
    (needsModelDownload() ? modelReady && enabled : true);

  return {
    enabled,
    modelReady,
    voiceUiAvailable,
    needsDownload: needsModelDownload(),
    status,
    downloading,
    progressPercent,
    sizeHintMb: Math.round(SHERPA_ASR_MODEL_SIZE_HINT_BYTES / (1024 * 1024)),
    errorMessage,
    startDownload: () => {
      void startDownload();
    },
    cancelDownload,
    removeModel,
    retryDownload
  };
}

/** Composer 轻量订阅：是否显示语音入口。 */
export function useSpeechInputVoiceUiAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  const refresh = useCallback(async () => {
    if (Platform.OS === 'web') {
      setAvailable(false);
      return;
    }
    if (!needsModelDownload()) {
      setAvailable(true);
      return;
    }
    const prefs = loadSpeechInputPrefs();
    if (!prefs.enabled) {
      setAvailable(false);
      return;
    }
    setAvailable(await isSherpaAsrModelAvailable());
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeSpeechInputPrefs(() => {
      void refresh();
    });
  }, [refresh]);

  return available;
}
