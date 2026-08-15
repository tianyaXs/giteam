import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { SHERPA_ASR_MODEL_SIZE_HINT_BYTES } from '../../lib/speech/sherpaAsrConfig';
import {
  cancelSherpaAsrModelDownload,
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
  | 'off'
  | 'need_download'
  | 'downloading'
  | 'ready';

export type SpeechInputSettingState = {
  /** 设置开关是否打开 */
  enabled: boolean;
  /** 模型是否已在本地（或 bundled） */
  modelReady: boolean;
  /** 聊天栏是否展示语音入口 */
  voiceUiAvailable: boolean;
  status: SpeechInputSettingStatus;
  downloading: boolean;
  /** 0–100 */
  progressPercent: number;
  progressLabel: string;
  sizeHintMb: number;
  errorMessage: string | null;
  toggle: () => void;
  retryDownload: () => void;
};

function needsModelDownload(): boolean {
  return resolveSpeechInputMode() === 'offline';
}

function computeStatus(params: {
  enabled: boolean;
  modelReady: boolean;
  downloading: boolean;
}): SpeechInputSettingStatus {
  if (params.downloading) return 'downloading';
  if (!needsModelDownload()) {
    return params.enabled ? 'ready' : 'off';
  }
  if (!params.enabled) return 'off';
  if (!params.modelReady) return 'need_download';
  return 'ready';
}

/**
 * 设置页 + Composer 共用：语音输入开关与按需下载状态。
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
      return true;
    }
    const ready = await isSherpaAsrModelAvailable();
    setModelReady(ready);
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
    if (!needsModelDownload()) return true;
    if (await isSherpaAsrLocalModelReady()) {
      setModelReady(true);
      setProgressPercent(100);
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
      notifySpeechInputChanged();
      return true;
    } catch (error) {
      if (downloadGenRef.current !== gen) return false;
      const message = error instanceof Error ? error.message : String(error);
      if (message !== 'download-cancelled') {
        setErrorMessage('语音模型下载失败，请检查网络后重试');
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

  const toggle = useCallback(() => {
    const next = !loadSpeechInputPrefs().enabled;
    if (!next) {
      void cancelSherpaAsrModelDownload();
      downloadGenRef.current += 1;
      setDownloading(false);
      setSpeechInputEnabled(false);
      setEnabled(false);
      setErrorMessage(null);
      return;
    }

    setSpeechInputEnabled(true);
    setEnabled(true);
    if (!needsModelDownload()) return;
    void (async () => {
      const ok = await startDownload();
      if (!ok) {
        // 下载失败则关掉开关，避免半开状态
        setSpeechInputEnabled(false);
        setEnabled(false);
      }
    })();
  }, [startDownload]);

  const retryDownload = useCallback(() => {
    if (!loadSpeechInputPrefs().enabled) {
      setSpeechInputEnabled(true);
      setEnabled(true);
    }
    void (async () => {
      const ok = await startDownload();
      if (!ok) {
        setSpeechInputEnabled(false);
        setEnabled(false);
      }
    })();
  }, [startDownload]);

  const voiceUiAvailable =
    enabled && (needsModelDownload() ? modelReady : true) && Platform.OS !== 'web';

  const status = computeStatus({ enabled, modelReady, downloading });

  let progressLabel = '';
  if (status === 'downloading') {
    progressLabel = `正在下载语音模型… ${progressPercent}%`;
  } else if (status === 'need_download') {
    progressLabel = '等待下载语音模型';
  } else if (errorMessage) {
    progressLabel = errorMessage;
  } else if (enabled && modelReady) {
    progressLabel = '已就绪';
  } else if (!enabled && modelReady) {
    progressLabel = '已下载，点击开启';
  } else {
    progressLabel = `约 ${Math.round(SHERPA_ASR_MODEL_SIZE_HINT_BYTES / (1024 * 1024))} MB，按需下载`;
  }

  return {
    enabled,
    modelReady,
    voiceUiAvailable,
    status,
    downloading,
    progressPercent,
    progressLabel,
    sizeHintMb: Math.round(SHERPA_ASR_MODEL_SIZE_HINT_BYTES / (1024 * 1024)),
    errorMessage,
    toggle,
    retryDownload
  };
}

/** Composer 轻量订阅：是否显示语音入口。 */
export function useSpeechInputVoiceUiAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  const refresh = useCallback(async () => {
    const prefs = loadSpeechInputPrefs();
    if (!prefs.enabled) {
      setAvailable(false);
      return;
    }
    if (!needsModelDownload()) {
      setAvailable(true);
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
