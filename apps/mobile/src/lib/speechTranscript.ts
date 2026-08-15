export type SpeechTranscriptState = {
  committed: string;
  session: string;
};

export function createSpeechTranscriptState(initial = ''): SpeechTranscriptState {
  return { committed: initial, session: '' };
}

/** Strip BPE-style spaces between CJK characters while keeping English word gaps. */
export function normalizeAsrTranscript(text: string): string {
  if (!text) return '';
  let normalized = text.replace(/\u3000/g, ' ');
  normalized = normalized.replace(
    /([\u3400-\u4dbf\u4e00-\u9fff])\s+(?=[\u3400-\u4dbf\u4e00-\u9fff])/g,
    '$1'
  );
  return normalized.replace(/\s{2,}/g, ' ').trimStart();
}

export function applySpeechResult(
  state: SpeechTranscriptState,
  transcript: string,
  isFinal: boolean
): SpeechTranscriptState {
  const normalized = normalizeAsrTranscript(transcript);
  if (!normalized) return state;
  if (isFinal) {
    return { committed: state.committed + normalized, session: '' };
  }
  return { committed: state.committed, session: normalized };
}

export function composeSpeechTranscript(state: SpeechTranscriptState): string {
  return state.committed + state.session;
}

export function extractTranscriptFromResults(
  results: Array<{ transcript?: string; segments?: Array<{ segment?: string }> }> | undefined
): string {
  const primary = results?.[0]?.transcript ?? '';
  if (primary.trim().length > 0) return primary;
  return results?.[0]?.segments?.map((segment) => segment.segment || '').join('') ?? '';
}

export function mapSpeechErrorCode(error: string): string {
  if (error === 'not-allowed') return 'permission';
  if (error === 'service-not-allowed' || error === 'language-not-supported') return 'unavailable';
  if (error === 'audio-capture' || error === 'interrupted') return 'microphone';
  if (error === 'network') return 'network';
  if (error === 'busy') return 'busy';
  return 'failed';
}

export function humanizeSpeechError(code: string): string {
  switch (code) {
    case 'permission':
      return '需要麦克风与语音识别权限';
    case 'settings':
      return '请在系统设置中开启麦克风与语音识别权限';
    case 'restricted':
      return '设备限制了语音识别';
    case 'unavailable':
      return '当前设备不支持语音识别';
    case 'microphone':
      return '无法打开麦克风';
    case 'network':
      return '语音识别网络异常';
    case 'busy':
      return '语音识别正忙，请稍后再试';
    case 'offline-failed':
      return '端侧语音识别启动失败';
    case 'model-download':
      return '语音模型下载失败，请检查网络后重试';
    case 'no-results':
      return '没有听清，请重试';
    default:
      return '语音识别失败';
  }
}
