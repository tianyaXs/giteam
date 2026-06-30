import { useEffect, useState } from 'react';
import { getOpencodeCommands } from '../../api/controlApi';
import { toText } from '../../lib/text';

export type OpencodeSlashCommand = {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  source: 'builtin' | 'command' | 'skill' | 'mcp';
};

export function useSlashCommandCatalog(params: {
  repoPath: string;
  serverUrl: string;
  token: string;
}) {
  const { repoPath, serverUrl, token } = params;
  const [slashCommands, setSlashCommands] = useState<OpencodeSlashCommand[]>([]);

  useEffect(() => {
    const repo = toText(repoPath).trim();
    if (!repo || !serverUrl || !token) {
      setSlashCommands([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getOpencodeCommands({ baseUrl: serverUrl, token, repoPath: repo });
        if (cancelled) return;
        const commands: OpencodeSlashCommand[] = (Array.isArray(rows) ? rows : [])
          .map((item: any): OpencodeSlashCommand | null => {
            const name = String(item?.name || item?.command || item?.id || '').replace(/^\//, '').trim();
            if (!name) return null;
            const sourceRaw = String(item?.source || item?.type || 'command').toLowerCase();
            const source: OpencodeSlashCommand['source'] = sourceRaw.includes('skill')
              ? 'skill'
              : sourceRaw.includes('mcp')
                ? 'mcp'
                : 'command';
            return {
              id: `opencode-${source}-${name}`,
              trigger: name,
              title: String(item?.title || item?.description || name),
              description: String(item?.description || ''),
              source
            };
          })
          .filter(Boolean) as OpencodeSlashCommand[];
        setSlashCommands(commands);
      } catch {
        setSlashCommands([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoPath, serverUrl, token]);

  return slashCommands;
}
