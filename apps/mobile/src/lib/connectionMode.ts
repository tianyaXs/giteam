/** Mobile connection entry modes (UI + prefs). */
export type ConnectionMode = 'local' | 'cloud' | 'custom';

/** HTTP routing: custom uses the same direct control path as local. */
export type ConnectionRoute = 'local' | 'cloud';

export function parseConnectionMode(value: unknown): ConnectionMode {
  if (value === 'cloud' || value === 'custom' || value === 'local') return value;
  return 'local';
}

export function toConnectionRoute(mode: ConnectionMode): ConnectionRoute {
  return mode === 'cloud' ? 'cloud' : 'local';
}

export const CONNECTION_MODE_OPTIONS: Array<{
  id: ConnectionMode;
  title: string;
  description: string;
}> = [
  {
    id: 'local',
    title: '局域网',
    description: '局域网连接'
  },
  {
    id: 'cloud',
    title: '云端',
    description: '云端中继'
  },
  {
    id: 'custom',
    title: '私有',
    description: '私有部署'
  }
];
