/**
 * Android 端侧离线整句 ASR（按住说话）。
 * SenseVoice int8：中/英/日/韩/粤 + ITN，适合松手后一次完整识别。
 * 默认不打进 APK，由设置页按需从 HF 镜像下载。
 */
export const SHERPA_OFFLINE_ASR_MODEL_ID =
  'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09' as const;

export const SHERPA_OFFLINE_ASR_MODEL_ASSET_PATH =
  `models/${SHERPA_OFFLINE_ASR_MODEL_ID}` as const;

/** @deprecated 兼容旧引用；现为离线 SenseVoice。 */
export const SHERPA_STREAMING_ASR_MODEL_ID = SHERPA_OFFLINE_ASR_MODEL_ID;
/** @deprecated */
export const SHERPA_STREAMING_ASR_MODEL_ASSET_PATH = SHERPA_OFFLINE_ASR_MODEL_ASSET_PATH;

export const SHERPA_ASR_SAMPLE_RATE = 16_000;

export const SHERPA_ASR_MODEL_DISK_BUDGET_BYTES = 280 * 1024 * 1024;

/** 设置页展示用的大致体积（SenseVoice int8 ≈ 226MB）。 */
export const SHERPA_ASR_MODEL_SIZE_HINT_BYTES = 226 * 1024 * 1024;

export const SHERPA_ASR_HF_REPO = `csukuangfj/${SHERPA_OFFLINE_ASR_MODEL_ID}`;

export const SHERPA_ASR_HF_MIRROR = 'https://hf-mirror.com';

export const SHERPA_ASR_MODEL_FILES = ['tokens.txt', 'model.int8.onnx'] as const;
