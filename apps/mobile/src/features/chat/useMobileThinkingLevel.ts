import { useCallback, useEffect, useRef, useState } from 'react';
import { createMobileAgentClient } from '../../api/agent/client';
import {
  MobileThinkingLevel,
  normalizeMobileThinkingLevel
} from '../../components/chat/thinkingLevels';
import { mmkvGetString, mmkvSetString } from '../../storage/mmkv';

const STORAGE_KEY = 'giteam.mobile.thinking-level';

function readStoredLevel(): MobileThinkingLevel {
  return normalizeMobileThinkingLevel(mmkvGetString(STORAGE_KEY));
}

/**
 * 推理强度：本地持久化 + 有会话时同步到 agent setThinking。
 */
export function useMobileThinkingLevel(params: {
  sessionId: string;
  serverUrl: string;
  token?: string | null;
}) {
  const { sessionId, serverUrl, token } = params;
  const [thinkingLevel, setThinkingLevelState] = useState<MobileThinkingLevel>(readStoredLevel);
  const levelRef = useRef(thinkingLevel);
  levelRef.current = thinkingLevel;

  const persistToSession = useCallback(
    async (sid: string, level: MobileThinkingLevel) => {
      if (!sid || !serverUrl) return;
      try {
        await createMobileAgentClient({
          baseUrl: serverUrl,
          token: String(token || '')
        }).setThinking(sid, level);
      } catch {
        // 本地已更新，服务端失败不阻塞
      }
    },
    [serverUrl, token]
  );

  const setThinkingLevel = useCallback(
    (level: MobileThinkingLevel) => {
      const next = normalizeMobileThinkingLevel(level);
      setThinkingLevelState(next);
      levelRef.current = next;
      try {
        mmkvSetString(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      const sid = String(sessionId || '').trim();
      if (sid) void persistToSession(sid, next);
    },
    [persistToSession, sessionId]
  );

  // 切换会话时把当前档位推到新会话
  useEffect(() => {
    const sid = String(sessionId || '').trim();
    if (!sid) return;
    void persistToSession(sid, levelRef.current);
  }, [persistToSession, sessionId]);

  return { thinkingLevel, setThinkingLevel };
}
