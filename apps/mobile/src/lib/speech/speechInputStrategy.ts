import { Platform } from 'react-native';

export type SpeechInputMode = 'native' | 'offline';

/** Android 一律端侧 Sherpa；iOS / 其它走系统 STT。 */
export function resolveSpeechInputMode(): SpeechInputMode {
  return Platform.OS === 'android' ? 'offline' : 'native';
}
