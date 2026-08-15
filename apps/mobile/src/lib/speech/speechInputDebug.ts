type SpeechInputDebugDetails = Record<string, unknown>;

const enabled = typeof __DEV__ !== 'undefined' && __DEV__;

export function logSpeechInput(event: string, details?: SpeechInputDebugDetails): void {
  if (!enabled) return;
  if (details) {
    console.log(`[speech] ${event}`, details);
  } else {
    console.log(`[speech] ${event}`);
  }
}
