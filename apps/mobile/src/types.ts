export type PairAuthResponse = {
  token: string;
  tokenType: string;
};

export type PromptResponse = {
  accepted: boolean;
  sessionId: string;
};

export type HealthResponse = {
  ok: boolean;
  opencodeServiceBase?: string;
  service?: {
    enabled: boolean;
    host: string;
    port: number;
  };
};

export type SessionStatusInfo =
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'retry'; attempt: number; message: string; next: number };

export type SseEvent = {
  event: string;
  data: string;
  at: number;
};

export type MobileChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt?: number;
};

export type MobileThinkCard = {
  id: string;
  title: string;
  text: string;
  createdAt?: number;
  finished: boolean;
};

export type MobileEventCard = {
  id: string;
  title: string;
  detail: string;
  mode: string;
  status: string;
  output?: string;
  taskSessionId?: string;
  taskSubagent?: string;
  createdAt?: number;
};

export type MobileContextCard = {
  id: string;
  title: string;
  summary: string;
  createdAt?: number;
  tools: MobileEventCard[];
};

export type MobileErrorCard = {
  id: string;
  title: string;
  text: string;
  createdAt?: number;
  code?: string;
};

export type MobileDividerCard = {
  id: string;
  label: string;
  createdAt?: number;
};

export type MobileTimelineItem =
  | {
      kind: 'chat';
      createdAt: number;
      message: MobileChatMessage;
    }
  | {
      kind: 'think';
      createdAt: number;
      card: MobileThinkCard;
    }
  | {
      kind: 'event';
      createdAt: number;
      event: MobileEventCard;
    }
  | {
      kind: 'context';
      createdAt: number;
      context: MobileContextCard;
    }
  | {
      kind: 'divider';
      createdAt: number;
      divider: MobileDividerCard;
    }
  | {
      kind: 'error';
      createdAt: number;
      error: MobileErrorCard;
    };

export type MobileRenderedTurn = {
  id: string;
  createdAt: number;
  userMessage?: MobileChatMessage;
  items: MobileTimelineItem[];
  signature: string;
};

export type ParsedConversation = {
  chatMessages: MobileChatMessage[];
  timeline: MobileTimelineItem[];
  writing: boolean;
  hasError: boolean;
};
