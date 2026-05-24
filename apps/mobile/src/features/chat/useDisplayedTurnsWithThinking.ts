import { useMemo } from 'react';
import { toText } from '../../lib/text';
import type { MobileChatMessage, MobileRenderedTurn, SessionStatusInfo } from '../../types';
import type { OpenCodeStreamStoreRefs } from '../messages/opencodeStore';

type StreamDebug = (label: string, payload?: Record<string, unknown>) => void;

type ToolAction = {
  tool: string;
  detail: string;
  status: 'running' | 'completed' | 'error';
};

type ExploringState = {
  // 当前正在执行的工具
  currentActions: ToolAction[];
  // 已完成的工具统计
  completedCounts: {
    read: number;
    search: number;
    list: number;
    total: number;
  };
  // 最近的工具执行详情（用于显示）
  recentActions: ToolAction[];
};

function isContextLikeTool(tool: string): boolean {
  return tool === 'read' || tool === 'list' || tool === 'glob' || tool === 'grep' || tool === 'search';
}

function compactDetail(detail: string): string {
  if (!detail.includes('/')) return detail;
  const parts = detail.split('/');
  if (parts.length <= 2) return detail;
  return '.../' + parts.slice(-2).join('/');
}

function getExploringState(stores: OpenCodeStreamStoreRefs | undefined, sessionId: string): ExploringState {
  const emptyState: ExploringState = {
    currentActions: [],
    completedCounts: { read: 0, search: 0, list: 0, total: 0 },
    recentActions: []
  };
  
  if (!stores || !sessionId) return emptyState;
  const partsByMessage = stores.part.current[sessionId] || {};
  
  const currentActions: ToolAction[] = [];
  const recentActions: ToolAction[] = [];
  const completedCounts = { read: 0, search: 0, list: 0, total: 0 };
  
  Object.values(partsByMessage).forEach((bucket: any) => {
    if (!bucket?.byId) return;
    Object.values(bucket.byId).forEach((part: any) => {
      const type = toText(part?.type).trim();
      if (type !== 'tool') return;
      
      const tool = toText(part?.tool).trim().toLowerCase();
      if (!isContextLikeTool(tool)) return;
      const state = part?.state || {};
      const status = toText(state?.status).trim().toLowerCase();
      const input = state?.input || {};
      const metadata = state?.metadata || part?.metadata || {};
      
      // 获取工具详情
      let detail = '';
      if (tool === 'read') {
        detail = toText(input?.filePath || metadata?.filePath || input?.path || metadata?.path).trim();
      } else if (tool === 'list') {
        detail = toText(input?.path || metadata?.path || input?.filePath || metadata?.filePath).trim();
      } else {
        detail = toText(input?.pattern || metadata?.pattern || input?.query || metadata?.query || input?.path || metadata?.path).trim();
      }
      
      detail = compactDetail(detail);
      
      const action: ToolAction = {
        tool: tool,
        detail: detail || tool,
        status: status === 'running' || status === 'pending' ? 'running' : status === 'error' ? 'error' : 'completed'
      };
      
      if (action.status === 'running') {
        currentActions.push(action);
      } else {
        // 统计已完成的
        completedCounts.total += 1;
        if (tool === 'read') completedCounts.read += 1;
        else if (tool === 'list') completedCounts.list += 1;
        else completedCounts.search += 1;
      }
      
      recentActions.push(action);
    });
  });
  
  return {
    currentActions: currentActions.slice(0, 3), // 最多显示3个正在执行的工具
    completedCounts,
    recentActions: recentActions.slice(-5) // 最近5个
  };
}

function turnHasAssistantRenderableContent(turn: MobileRenderedTurn): boolean {
  return turn.items.some((item) => {
    if (item.kind === 'think') return !!toText(item.card?.text).trim();
    if (item.kind === 'context') return true;
    if (item.kind === 'event' || item.kind === 'todo' || item.kind === 'question') return true;
    if (item.kind === 'chat' && item.message.role === 'assistant') {
      return !!toText(item.message.text).trim();
    }
    return false;
  });
}

function shouldShowThinkingPlaceholder(params: {
  currentSessionStatus: SessionStatusInfo;
  messages: MobileChatMessage[];
  renderedTurns: MobileRenderedTurn[];
  sessionWorking: boolean;
  streamDebug?: StreamDebug;
}) {
  const {
    currentSessionStatus,
    messages,
    renderedTurns,
    sessionWorking,
    streamDebug
  } = params;

  if (!sessionWorking) return false;
  if (currentSessionStatus.type === 'retry') return false;
  for (let turnIdx = renderedTurns.length - 1; turnIdx >= 0; turnIdx -= 1) {
    const turn = renderedTurns[turnIdx];
    if (turn.items.some((item) => item.kind === 'error')) return false;
    if (turn.userMessage) {
      const show = !turnHasAssistantRenderableContent(turn);
      streamDebug?.('pending.placeholder.check', {
        turnId: turn.id,
        show,
        hasAssistantText: !show,
        itemKinds: turn.items.map((item: any) => item.kind).join(','),
        sessionWorking,
        status: currentSessionStatus.type
      });
      return show;
    }
  }
  if (messages.length <= 0) return true;
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return true;
  for (let i = lastUserIdx + 1; i < messages.length; i += 1) {
    if (messages[i].role === 'assistant' && messages[i].text.trim()) return false;
  }
  streamDebug?.('pending.placeholder.fallback', {
    show: true,
    reason: 'no assistant text after last user',
    messages: messages.length
  });
  return true;
}

export function useDisplayedTurnsWithThinking(params: {
  currentSessionStatus: SessionStatusInfo;
  messages: MobileChatMessage[];
  renderedTurns: MobileRenderedTurn[];
  sessionWorking: boolean;
  sessionId?: string;
  getOpenCodeStreamStores?: () => OpenCodeStreamStoreRefs | undefined;
  streamDebug?: StreamDebug;
}) {
  const {
    currentSessionStatus,
    messages,
    renderedTurns,
    sessionWorking,
    sessionId,
    getOpenCodeStreamStores,
    streamDebug
  } = params;

  const showThinkingPlaceholder = useMemo(() => shouldShowThinkingPlaceholder({
    currentSessionStatus,
    messages,
    renderedTurns,
    sessionWorking,
    streamDebug
  }), [currentSessionStatus, messages, renderedTurns, sessionWorking, streamDebug]);

  const exploringState = useMemo(() => {
    if (!sessionWorking || !sessionId) {
      return {
        currentActions: [],
        completedCounts: { read: 0, search: 0, list: 0, total: 0 },
        recentActions: []
      };
    }
    return getExploringState(getOpenCodeStreamStores?.(), sessionId);
  }, [sessionWorking, sessionId, getOpenCodeStreamStores, renderedTurns.length, messages.length]);

  const displayedTurns = useMemo(() => {
    // 不再添加 think item 到 turn 中，避免重复渲染
    // 探索中状态将由 UI 层根据 showThinkingPlaceholder 和 activePartCounts 单独渲染
    return renderedTurns;
  }, [renderedTurns]);

  return {
    displayedTurns,
    showThinkingPlaceholder,
    exploringState
  };
}
