import { useMemo } from 'react';
import { toText } from '../../lib/text';

type SessionItemLike = {
  id: string;
  title: string;
  preview: string;
};

type MessageLike = {
  role: string;
  text: string;
};

export function useSessionHeaderState(props: {
  sessions: SessionItemLike[];
  sessionId: string;
  sessionSwitchingTo: string;
  messages: MessageLike[];
  renderedTurnsLength: number;
  pickSessionDisplayTitle: (item: Pick<SessionItemLike, 'title' | 'preview' | 'id'>, fallbackMessages?: any[]) => string;
  isPlaceholderSessionTitle: (value: string) => boolean;
}) {
  const {
    isPlaceholderSessionTitle,
    messages,
    pickSessionDisplayTitle,
    renderedTurnsLength,
    sessionId,
    sessionSwitchingTo,
    sessions
  } = props;

  const currentSessionTitle = useMemo(() => {
    const active = sessions.find((item) => item.id === sessionId);
    if (active) return pickSessionDisplayTitle(active, messages);
    const fallback = messages.find((item) => item.role === 'user' && toText(item.text).trim());
    return fallback ? toText(fallback.text).slice(0, 24) : 'newsession';
  }, [messages, pickSessionDisplayTitle, sessionId, sessions]);

  const sessionSwitchingTitle = useMemo(() => {
    const active = sessions.find((item) => item.id === sessionSwitchingTo);
    return active ? pickSessionDisplayTitle(active) : '正在切换会话';
  }, [pickSessionDisplayTitle, sessionSwitchingTo, sessions]);

  const showNotebookSessionTitle = useMemo(
    () => !sessionSwitchingTo && (renderedTurnsLength > 0 || !isPlaceholderSessionTitle(currentSessionTitle)),
    [currentSessionTitle, isPlaceholderSessionTitle, renderedTurnsLength, sessionSwitchingTo]
  );

  return {
    currentSessionTitle,
    sessionSwitchingTitle,
    showNotebookSessionTitle
  };
}
