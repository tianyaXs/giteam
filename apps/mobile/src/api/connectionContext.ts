/** Process-wide cloud routing extras for agent HTTP/SSE clients. */

import type { ConnectionRoute } from '../lib/connectionMode';

let activeDeviceId = '';
let activeAccessKey = '';
let connectionMode: ConnectionRoute = 'local';

export function getConnectionMode(): ConnectionRoute {
  return connectionMode;
}

export function setConnectionMode(mode: ConnectionRoute | 'custom') {
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
