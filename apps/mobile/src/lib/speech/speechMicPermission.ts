import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync
} from 'expo-audio';
import { Linking, Platform } from 'react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { logSpeechInput } from './speechInputDebug';
import { resolveSpeechInputMode } from './speechInputStrategy';

export type SpeechMicPermission =
  | 'granted'
  | 'denied'
  | 'settings'
  | 'restricted';

/** native 用 speech-recognition 权限；Sherpa 用录音权限。 */
export async function ensureSpeechMicPermission(): Promise<SpeechMicPermission> {
  if (Platform.OS === 'web') return 'denied';

  if (resolveSpeechInputMode() === 'offline') {
    const current = await getRecordingPermissionsAsync();
    logSpeechInput('permission.recorder.current', {
      granted: current.granted,
      status: current.status,
      canAskAgain: current.canAskAgain
    });
    if (current.granted) return 'granted';
    const requested = await requestRecordingPermissionsAsync();
    logSpeechInput('permission.recorder.result', {
      granted: requested.granted,
      canAskAgain: requested.canAskAgain
    });
    if (requested.granted) return 'granted';
    return requested.canAskAgain ? 'denied' : 'settings';
  }

  const current = await ExpoSpeechRecognitionModule.getPermissionsAsync();
  if (current.restricted) return 'restricted';
  if (current.granted) return 'granted';
  const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (result.restricted) return 'restricted';
  if (!result.granted) return result.canAskAgain ? 'denied' : 'settings';
  return 'granted';
}

export function openSpeechSettings(): void {
  try {
    void Linking.openSettings();
  } catch {
    // ignore
  }
}

export async function activateSpeechAudioSession(): Promise<void> {
  if (Platform.OS === 'web') return;
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    interruptionMode: 'doNotMix',
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false
  });
}

export async function deactivateSpeechAudioSession(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false
    });
  } catch {
    // ignore
  }
}
