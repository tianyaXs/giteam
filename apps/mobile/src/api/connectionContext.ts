/** Process-wide cloud routing extras for agent HTTP/SSE clients. */

let activeDeviceId = '';
let activeAccessKey = '';
let connectionMode: 'local' | 'cloud' = 'local';

export function getConnectionMode(): 'local' | 'cloud' {
  return connectionMode;
}

export function setConnectionMode(mode: 'local' | 'cloud') {
  connectionMode = mode === 'cloud' ? 'cloud' : 'local';
}

export function getActiveDeviceId(): string {
  return activeDeviceId;
}

export function setActiveDeviceId(deviceId: string) {
  activeDeviceId = String(deviceId || '').trim();
}

export function getActiveAccessKey(): string {
  return activeAccessKey;
}

export function setActiveAccessKey(accessKey: string) {
  activeAccessKey = String(accessKey || '').trim();
}

export function clearCloudConnectionExtras() {
  activeDeviceId = '';
  activeAccessKey = '';
  connectionMode = 'local';
}
