import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  InteractionManager,
  LayoutChangeEvent,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Drawer } from 'react-native-drawer-layout';
import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as Network from 'expo-network';
import EventSource from 'react-native-sse';
import { FlashList, FlashListRef, useLayoutState } from '@shopify/flash-list';
import { useMarkdown } from 'react-native-marked';
import type { MarkedStyles } from 'react-native-marked';
import { DiscoverListScreen } from './src/screens/DiscoverListScreen';
import type { DiscoverListRow } from './src/screens/DiscoverListScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { toText } from './src/lib/text';
import { formatClock } from './src/lib/time';
import { normalizeBaseUrlForClient } from './src/lib/url';
import { DEFAULT_PREFS, loadPrefs, savePrefs } from './src/storage/prefs';
import type { Prefs } from './src/storage/prefs';
import { loadDiscoverCache, saveDiscoverCache } from './src/storage/discoverCache';
import type { DiscoverCacheDevice } from './src/storage/discoverCache';
import { loadPairCodeMap, savePairCodeMap } from './src/storage/pairCodeMap';
import { loadSessionCache, saveSessionCache } from './src/storage/sessionCache';
import { loadQuestionDismissals, saveQuestionDismissal } from './src/storage/questionDismissals';
import {
  abortSession,
  buildStreamUrl,
  createSession,
  getClientRepositories,
  getCurrentProject,
  getMessages,
  getOpencodeConfig,
  getPendingQuestions,
  getProjects,
  getSessionStatus,
  getSessions,
  health,
  NO_AUTH_TOKEN,
  pairAuth,
  rejectQuestion,
  replyQuestion,
  sendPrompt
} from './src/api/controlApi';
import {
  computeVisibleTurnCount,
  fetchWithRetry
} from './src/features/messages/history';
import {
  buildTurnWindow,
  inspectTurnWindow,
  mergeMessageRows
} from './src/features/messages/turns';
import {
  buildHostOrder,
  clampRadarPoint,
  inferDiscoveryPrefixes,
  inferSeedLastSegment,
  pickRadarPoint,
  probeHealthFast,
  resolvePortFromSeed
} from './src/discovery';
import type { DiscoveredDevice } from './src/discovery';
import type { MobileChatMessage, MobileRenderedTurn, MobileTodoCard, SessionStatusInfo, QuestionRequest, MobileQuestionCard } from './src/types';
import { QuestionDock } from './src/components/QuestionDock';

// keys + storage moved to src/storage/*

const INITIAL_SESSION_LIMIT = 1;
const OLDER_SESSION_LIMIT = 1;
const INITIAL_MESSAGE_FETCH_LIMIT = 8;
const OLDER_MESSAGE_FETCH_LIMIT = 8;
const DISCOVER_OFFLINE_AFTER_MS = 45000;
const DISCOVER_OFFLINE_MISS_THRESHOLD = 3;
const DISCOVER_KEEPALIVE_HOSTS_PER_SWEEP = 48;
const DISCOVER_SWEEP_HARDSTOP_MS = 2200;
const DISCOVER_WORKER_LIMIT = 8;
const DISCOVER_POST_PROCESS_CHUNK = 12;
const DISCOVER_LOG_LIMIT = 220;
// DiscoverCacheDevice type lives in src/storage/discoverCache

type SessionItem = {
  id: string;
  title: string;
  preview: string;
  /** 用于排序：优先服务端 updatedAt，缺失时用 createdAt，避免每次刷新用 Date.now() 导致顺序乱跳 */
  updatedAt: number;
  createdAt?: number;
};

type OptimisticUserMessage = {
  id: string;
  text: string;
  createdAt: number;
};

/** 会话列表稳定排序：时间降序，相同时间用 id 字典序（避免服务端/合并顺序不稳定） */
function stableSortSessionItems(items: SessionItem[]): SessionItem[] {
  return [...items].sort((a, b) => {
    const ua = Number(a.updatedAt) || 0;
    const ub = Number(b.updatedAt) || 0;
    if (ub !== ua) return ub - ua;
    const ca = Number(a.createdAt || 0) || 0;
    const cb = Number(b.createdAt || 0) || 0;
    if (cb !== ca) return cb - ca;
    return a.id.localeCompare(b.id);
  });
}

type ModelOption = {
  id: string;
  label: string;
  provider: string;
};

type QuestionSubmitState = {
  status: 'submitting' | 'submitted' | 'failed';
  error?: string;
};

type ProjectOption = {
  id: string;
  worktree: string;
  name: string;
};

type RefreshMessagesResult = {
  nextCursor: string;
  incomingCount: number;
  mergedCount: number;
  prevMergedCount: number;
  totalTurnCount: number;
};

type PairPayload = {
  baseUrl?: string;
  pairCode?: string;
  code?: string;
  authMode?: string;
  repoPath?: string;
  repoPaths?: string[];
  currentRepoPath?: string;
};

type RenderBoundaryProps = {
  name: string;
  children: React.ReactNode;
};

type RenderBoundaryState = {
  error: string;
};

const CameraViewCompat: any = CameraView;

// DEFAULT_PREFS moved to src/storage/prefs

class RenderBoundary extends React.Component<RenderBoundaryProps, RenderBoundaryState> {
  constructor(props: RenderBoundaryProps) {
    super(props);
    this.state = { error: '' };
  }

  static getDerivedStateFromError(err: unknown): RenderBoundaryState {
    return { error: toText(err) || '渲染异常' };
  }

  componentDidCatch(err: unknown) {
    // Keep a clear console marker so runtime issues can be traced quickly.
    // eslint-disable-next-line no-console
    console.error(`[RenderBoundary:${this.props.name}]`, err);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.boundaryWrap}>
        <Text style={styles.boundaryTitle}>渲染已降级</Text>
        <Text style={styles.boundaryText}>{this.state.error}</Text>
      </View>
    );
  }
}

function GiteamLaunchMark() {
  return (
    <View style={styles.launchMarkWrap}>
      <Text style={styles.launchWordmark}>Giteam</Text>
    </View>
  );
}

// toText moved to src/lib/text

function renderMarkdown(text: unknown, tone: 'user' | 'assistant' | 'think'): React.ReactNode {
  return <MarkdownMessage text={toText(text)} tone={tone} />;
}

function MarkdownMessage(props: { text: string; tone: 'user' | 'assistant' | 'think' }) {
  const { text, tone } = props;
  const src = normalizeMarkdownForMobile(text);
  const isUser = tone === 'user';
  const isThink = tone === 'think';
  const textColor = isUser ? '#f8fafc' : isThink ? '#607089' : '#243244';
  const mutedColor = isUser ? '#cbd5e1' : isThink ? '#7d8ba0' : '#66758a';
  const headingColor = isUser ? '#ffffff' : isThink ? '#52657d' : '#162235';
  const codeBg = isUser ? 'rgba(15, 23, 42, 0.32)' : isThink ? '#eef3f8' : '#f1f6fb';
  const codeColor = isUser ? '#f8fafc' : '#142033';
  const markdownStyles = useMemo<MarkedStyles>(() => ({
    text: {
      color: textColor,
      fontSize: isThink ? 14 : 15,
      lineHeight: isThink ? 22 : 24,
      letterSpacing: 0.08,
      fontFamily: Platform.OS === 'android' ? 'sans-serif' : undefined
    },
    paragraph: { paddingVertical: 3, marginBottom: 3 },
    strong: { color: headingColor, fontWeight: '800' },
    em: { color: mutedColor, fontStyle: 'italic' },
    strikethrough: { color: mutedColor, textDecorationLine: 'line-through' },
    link: { color: isUser ? '#bfdbfe' : '#1768c2', fontWeight: '700', fontStyle: 'normal' },
    h1: { color: headingColor, fontSize: 20, lineHeight: 27, fontWeight: '800', marginTop: 8, marginBottom: 6, borderBottomWidth: 0 },
    h2: { color: headingColor, fontSize: 18, lineHeight: 25, fontWeight: '800', marginTop: 6, marginBottom: 5, borderBottomWidth: 0 },
    h3: { color: headingColor, fontSize: 16, lineHeight: 23, fontWeight: '800', marginTop: 5, marginBottom: 4 },
    h4: { color: headingColor, fontSize: 15, lineHeight: 22, fontWeight: '800', marginTop: 4, marginBottom: 3 },
    h5: { color: headingColor, fontSize: 14, lineHeight: 21, fontWeight: '800', marginTop: 4, marginBottom: 3 },
    h6: { color: mutedColor, fontSize: 13, lineHeight: 20, fontWeight: '800', marginTop: 4, marginBottom: 3 },
    list: { marginVertical: 4, paddingLeft: 2 },
    li: { color: textColor, fontSize: isThink ? 14 : 15, lineHeight: isThink ? 22 : 24, flexShrink: 1 },
    codespan: {
      color: codeColor,
      backgroundColor: codeBg,
      borderRadius: 6,
      paddingHorizontal: 5,
      paddingVertical: 2,
      fontSize: 13,
      fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
      fontStyle: 'normal',
      fontWeight: '500'
    },
    code: {
      backgroundColor: codeBg,
      borderRadius: 12,
      padding: 12,
      marginVertical: 8,
      minWidth: '100%'
    },
    blockquote: {
      backgroundColor: isUser ? 'rgba(15, 23, 42, 0.18)' : '#f6f9fc',
      borderLeftColor: isUser ? '#bfdbfe' : '#8fb6df',
      borderLeftWidth: 3,
      borderRadius: 10,
      paddingLeft: 12,
      paddingRight: 10,
      paddingVertical: 8,
      marginVertical: 8,
      opacity: 1
    },
    hr: { borderBottomColor: isUser ? 'rgba(226,232,240,0.35)' : '#dbe5ef', marginVertical: 10 },
    table: { borderColor: isUser ? 'rgba(226,232,240,0.35)' : '#d8e3ee', borderWidth: 1, borderRadius: 10, marginVertical: 8 },
    tableRow: { borderBottomColor: isUser ? 'rgba(226,232,240,0.18)' : '#e5edf5', borderBottomWidth: 1 },
    tableCell: { padding: 8 }
  }), [codeBg, codeColor, headingColor, isThink, isUser, mutedColor, textColor]);
  const elements = useMarkdown(src, {
    colorScheme: 'light',
    styles: markdownStyles,
    theme: {
      colors: {
        text: textColor,
        link: isUser ? '#bfdbfe' : '#1768c2',
        code: codeBg,
        border: isUser ? 'rgba(226,232,240,0.35)' : '#dbe5ef'
      }
    }
  });

  return (
    <View style={styles.markdownBlock}>
      {elements.map((element, index) => (
        <React.Fragment key={`md-${index}`}>{element}</React.Fragment>
      ))}
    </View>
  );
}

function todoMeta(card: MobileTodoCard) {
  const items = Array.isArray(card.items) ? card.items : [];
  const total = items.length;
  const done = items.filter((item) => item.status === 'completed').length;
  const active = items.find((item) => item.status === 'in_progress') || items.find((item) => item.status === 'pending') || items[items.length - 1] || null;
  return { total, done, active };
}

function TodoThinkingDots(props: { pulse: boolean }) {
  return (
    <View style={styles.todoThinkingDots}>
      <View style={[styles.todoThinkingDot, props.pulse ? styles.todoThinkingDotOn : null]} />
      <View style={[styles.todoThinkingDot, !props.pulse ? styles.todoThinkingDotMid : styles.todoThinkingDotSoft]} />
      <View style={[styles.todoThinkingDot, props.pulse ? styles.todoThinkingDotSoft : styles.todoThinkingDotOn]} />
    </View>
  );
}

function TodoStatusBadge(props: { status: 'pending' | 'in_progress' | 'completed' | 'cancelled'; pulse: boolean }) {
  if (props.status === 'completed') {
    return (
      <View style={styles.todoStatusCompleted}>
        <Text style={styles.todoStatusCompletedText}>✓</Text>
      </View>
    );
  }
  if (props.status === 'in_progress') {
    return (
      <View style={styles.todoStatusRunningContainer}>
        <View style={styles.todoStatusRunningPulse1} />
        <View style={styles.todoStatusRunningPulse2} />
        <View style={styles.todoStatusRunningCenter} />
      </View>
    );
  }
  if (props.status === 'cancelled') {
    return <View style={styles.todoStatusCancelled} />;
  }
  return <View style={styles.todoStatusPending} />;
}

function ThinkPreviewLines(props: { text: string; active: boolean }) {
  const lines = toText(props.text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const visible = lines.length ? lines.slice(-6) : ['正在整理上下文...', '分析可执行步骤...', '准备生成回复...'];
  const [lineIndex, setLineIndex] = useState(Math.max(0, visible.length - 1));
  const lineAnim = useRef(new Animated.Value(1)).current;
  const orbitAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setLineIndex(Math.max(0, visible.length - 1));
  }, [visible.length, props.text]);

  useEffect(() => {
    if (!props.active) {
      orbitAnim.stopAnimation();
      orbitAnim.setValue(0);
      return;
    }
    orbitAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(orbitAnim, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: true
      })
    );
    loop.start();
    return () => loop.stop();
  }, [orbitAnim, props.active]);

  useEffect(() => {
    if (!props.active || visible.length <= 1) return;
    const timer = setInterval(() => {
      Animated.timing(lineAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }).start(() => {
        setLineIndex((value) => (value + 1) % visible.length);
        lineAnim.setValue(0);
        Animated.timing(lineAnim, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true
        }).start();
      });
    }, 1050);
    return () => clearInterval(timer);
  }, [lineAnim, props.active, visible.length]);

  const currentLine = visible[Math.min(lineIndex, visible.length - 1)] || '正在整理思路...';
  const rotate = orbitAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={styles.thinkFlowRow}>
      <View style={styles.thinkFlowIconShell}>
        <Animated.View style={[styles.thinkFlowHalo, { transform: [{ rotate }] }]} />
        <View style={styles.thinkFlowLens} />
      </View>
      <View style={styles.thinkFlowPill}>
        <Animated.Text
          numberOfLines={1}
          style={[
            styles.thinkFlowLine,
            {
              opacity: lineAnim,
              transform: [{ translateY: lineAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }]
            }
          ]}
        >
          {currentLine}
        </Animated.Text>
      </View>
    </View>
  );
}

function normalizeMarkdownForMobile(input: string) {
  return toText(input);
}

function normalizeReasoningText(input: string) {
  return toText(input)
    .replace(/\*\*/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*•·]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const MobileTodoCardView = React.memo(function MobileTodoCardView(props: {
  card: MobileTodoCard;
  compact?: boolean;
  collapsed?: boolean;
  pulse: boolean;
  onToggle?: () => void;
  onClose?: () => void;
}) {
  const { card, compact, collapsed, pulse, onToggle, onClose } = props;
  const meta = todoMeta(card);
  const activeText = toText(meta.active?.content);
  const content = (
    <>
      <View style={compact ? styles.todoCardHeadCompact : styles.todoCardHead}>
        <View style={styles.todoCardHeadMain}>
          <View style={styles.todoTitleRow}>
            <Text style={styles.todoTitle}>任务进度</Text>
            <View style={card.finished ? styles.todoChipDone : styles.todoChipRunning}>
              <Text style={card.finished ? styles.todoChipDoneText : styles.todoChipRunningText}>
                {meta.done}/{meta.total}
              </Text>
            </View>
          </View>
          <Text numberOfLines={collapsed ? 1 : 2} style={styles.todoSummary}>
            {activeText ? `当前：${activeText}` : toText(card.summary || '任务进行中')}
          </Text>
          <View style={styles.todoProgressTrack}>
            <View style={[styles.todoProgressFill, { width: `${meta.total ? Math.round((meta.done / meta.total) * 100) : 0}%` }]} />
          </View>
        </View>
        <View style={styles.todoActions}>
          {onClose ? (
            <Pressable
              style={styles.todoCloseBtn}
              hitSlop={8}
              onPress={(evt: any) => {
                evt?.stopPropagation?.();
                onClose();
              }}
            >
              <Text style={styles.todoCloseText}>×</Text>
            </Pressable>
          ) : null}
          {onToggle ? (
            <View style={styles.todoToggleBtn}>
              <View style={[styles.todoArrow, collapsed && styles.todoArrowUp]} />
            </View>
          ) : null}
        </View>
      </View>
      {!collapsed ? (
        <View style={styles.todoList}>
          {card.items.map((item) => (
            <View key={item.id} style={styles.todoRow}>
              <TodoStatusBadge status={item.status} pulse={pulse} />
              <Text
                style={[
                  styles.todoRowText,
                  item.status === 'completed' ? styles.todoRowTextDone : null,
                  item.status === 'cancelled' ? styles.todoRowTextCancelled : null
                ]}
              >
                {toText(item.content)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );

  if (!onToggle) return <View style={compact ? styles.todoInlineCardCompact : styles.todoInlineCard}>{content}</View>;
  return (
    <Pressable style={compact ? styles.todoDockCompact : styles.todoDock} onPress={onToggle}>
      {content}
    </Pressable>
  );
});

const MobileTurnCell = React.memo(function MobileTurnCell(props: {
  turn: MobileRenderedTurn;
  streaming: boolean;
  isLastTurn: boolean;
  thinkingPulse: boolean;
  hasLiveQuestion: boolean;
  liveQuestions: MobileQuestionCard[];
  onQuestionReply: (requestId: string, answers: string[][]) => void;
  onCopyMessage: (text: string) => void;
  expandedTimelineQuestions: Set<string>;
  onToggleTimelineQuestion: (id: string) => void;
  expandedThinkCards: Set<string>;
  onToggleThinkCard: (id: string) => void;
  timelineQuestionTabs: Map<string, number>;
  onChangeTimelineTab: (questionId: string, tabIndex: number) => void;
}) {
  const { turn, streaming, isLastTurn, thinkingPulse, hasLiveQuestion, liveQuestions, onQuestionReply, onCopyMessage, expandedTimelineQuestions, onToggleTimelineQuestion, expandedThinkCards, onToggleThinkCard, timelineQuestionTabs, onChangeTimelineTab } = props;
  const [, setMeasuredHeight] = useLayoutState(0);
  return (
    <View
      style={styles.turnWrap}
      onLayout={(evt) => {
        const h = Math.ceil(Number(evt.nativeEvent.layout?.height || 0));
        if (h > 0) setMeasuredHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
      }}
    >
      {turn.userMessage ? (
        <View style={styles.bubbleUserWrap}>
          <Pressable style={styles.bubbleUser} onLongPress={() => onCopyMessage(toText(turn.userMessage?.text))} delayLongPress={280}>
            <Text style={styles.bubbleUserText}>{toText(turn.userMessage.text || '...')}</Text>
          </Pressable>
        </View>
      ) : null}
      {turn.items.map((item) => {
        if (item.kind === 'chat') {
          const m = item.message;
          if (m.role === 'user') return null;
          return (
            <View key={m.id} style={styles.bubbleAssistantWrap}>
              <Pressable style={styles.bubbleAssistant} onLongPress={() => onCopyMessage(toText(m.text))} delayLongPress={280}>
                <View style={styles.bubbleContent}>{renderMarkdown(toText(m.text || '...'), 'assistant')}</View>
              </Pressable>
            </View>
          );
        }
        if (item.kind === 'context') {
          const tools = Array.isArray(item.context.tools) ? item.context.tools : [];
          return (
            <View key={item.context.id} style={styles.contextWrap}>
              <View style={styles.contextCard}>
                <Text style={styles.contextTitle}>{toText(item.context.title || 'Context')}</Text>
                <Text style={styles.contextSummary}>{toText(item.context.summary || `tools: ${tools.length}`)}</Text>
                {tools.length > 0 ? (
                  <View style={styles.contextTools}>
                    {tools.slice(0, 3).map((t) => (
                      <View key={t.id} style={styles.contextToolRow}>
                        <Text style={styles.contextToolTitle}>{toText(t.title || 'tool')}</Text>
                        <Text numberOfLines={1} style={styles.contextToolDetail}>
                          {toText(t.detail || t.mode || t.status || '执行完成')}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          );
        }
        
        if (item.kind === 'event') {
          const st = toText(item.event.status).toLowerCase();
          const dotStyle = st === 'running' || st === 'pending' ? styles.eventDotRun : styles.eventDot;
          const detail = toText(item.event.detail || item.event.mode || item.event.status || '工具执行完成');
          return (
            <View key={item.event.id} style={styles.eventWrap}>
              <View style={styles.eventCard}>
                <View style={styles.eventHead}>
                  <View style={dotStyle} />
                  <Text style={styles.eventTitle}>{toText(item.event.title || 'Event')}</Text>
                  {toText(item.event.mode) ? <Text style={styles.eventMode}>{toText(item.event.mode)}</Text> : null}
                  <Text style={styles.eventTime}>{formatClock(item.event.createdAt)}</Text>
                </View>
                <Text style={styles.eventDetail}>{detail}</Text>
                {toText(item.event.output) ? <Text style={styles.eventOutput}>{toText(item.event.output)}</Text> : null}
              </View>
            </View>
          );
        }
        if (item.kind === 'question') {
          if (toText(item.question.status).toLowerCase() === 'running') return null;
          const questions = Array.isArray(item.question.questions) ? item.question.questions : [];
          let liveRequest = liveQuestions.find((req) => {
            const reqTool: { messageID?: string; callID?: string } = req.tool || {};
            const itemTool: { messageID?: string; callID?: string } = item.question.tool || {};
            if (reqTool.callID && itemTool.callID && reqTool.callID === itemTool.callID) return true;
            if (reqTool.messageID && itemTool.messageID && reqTool.messageID === itemTool.messageID) return true;
            return false;
          }) || null;
          const hasLiveDockRequest = !!liveRequest;
          // Fallback: if question is running and has callID but not in liveQuestions (opencode /question may return empty),
          // use callID as request_id so backend can fallback match via cache or opencode list.
          if (!liveRequest && item.question.status === 'running' && item.question.tool?.callID) {
            liveRequest = {
              id: item.question.tool.callID,
              title: '',
              status: 'running',
              questions: item.question.questions,
              interactive: true,
              tool: {
                messageID: item.question.tool.messageID || '',
                callID: item.question.tool.callID,
              },
            };
          }
          const canReply = !!liveRequest;
          if (hasLiveDockRequest) return null;
          const isExpanded = expandedTimelineQuestions.has(item.question.id);
          const firstQuestion = questions[0];
          const questionSummary = toText(firstQuestion?.question || firstQuestion?.header || '查看问题详情');
          const optionCount = questions.reduce((sum, q) => sum + (Array.isArray(q.options) ? q.options.length : 0) + (q.custom !== false ? 1 : 0), 0);
          return (
            <View key={item.question.id} style={styles.questionTimelineWrap}>
              <View style={styles.questionTimelineCard}>
                <Pressable
                  style={styles.questionTimelineHead}
                  onPress={() => {
                    if (canReply) return; // 活跃问题不可展开/折叠
                    onToggleTimelineQuestion(item.question.id);
                  }}
                >
                  <View style={styles.questionTimelineTitleWrap}>
                    <Text style={styles.questionTimelineTitle}>{toText(item.question.title || '问题')}</Text>
                    <Text numberOfLines={1} style={styles.questionTimelineSummary}>{questionSummary}</Text>
                  </View>
                  <View style={styles.questionTimelineHeadRight}>
                    <Text style={styles.questionTimelineBadge}>{(() => {
                      const status = toText(item.question.status).toLowerCase();
                      if (status === 'completed') return '已提交';
                      if (status === 'error') return '已忽略';
                      return '已过期';
                    })()}</Text>
                    {!canReply && (
                      <Text style={styles.questionTimelineToggle}>{isExpanded ? '▲' : '▼'}</Text>
                    )}
                  </View>
                </Pressable>
                {canReply ? (
                  <View style={styles.questionTimelineBody}>
                    <Text style={styles.questionTimelineHint}>请从底部弹窗回答此问题</Text>
                  </View>
                ) : isExpanded ? (
                  <View style={styles.questionTimelineBody}>
                    {questions.length > 1 ? (
                      <View style={styles.questionTimelineTabs}>
                        {questions.map((q, idx) => (
                          <Pressable
                            key={`${item.question.id}:tab:${idx}`}
                            style={[
                              styles.questionTimelineTab,
                              idx === (timelineQuestionTabs.get(item.question.id) || 0) && styles.questionTimelineTabActive
                            ]}
                            onPress={() => onChangeTimelineTab(item.question.id, idx)}
                          >
                            <Text style={[
                              styles.questionTimelineTabText,
                              idx === (timelineQuestionTabs.get(item.question.id) || 0) && styles.questionTimelineTabTextActive
                            ]}>{idx + 1}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    {(() => {
                      const currentTab = questions.length > 1 ? (timelineQuestionTabs.get(item.question.id) || 0) : 0;
                      const q = questions[currentTab];
                      if (!q) return null;
                      return (
                        <View key={`${item.question.id}:${currentTab}`} style={styles.questionTimelineBlock}>
                          {toText(q.header) ? <Text style={styles.questionTimelineHeader}>{toText(q.header)}</Text> : null}
                          <Text style={styles.questionTimelineText}>{toText(q.question || '请选择一个答案')}</Text>
                          <Text style={styles.questionTimelineHint}>{q.multiple ? '多选' : '单选'} · 已过期</Text>
                          {(Array.isArray(q.options) ? q.options : []).map((opt, optIndex) => (
                            <View
                              key={`${item.question.id}:${currentTab}:${optIndex}`}
                              style={styles.questionTimelineOption}
                            >
                              <View style={q.multiple ? styles.questionTimelineCheckbox : styles.questionTimelineRadio} />
                              <View style={styles.questionTimelineOptionBody}>
                                <Text style={styles.questionTimelineOptionLabel}>{toText(opt.label)}</Text>
                                {toText(opt.description) ? <Text style={styles.questionTimelineOptionDesc}>{toText(opt.description)}</Text> : null}
                              </View>
                            </View>
                          ))}
                          {q.custom !== false ? (
                            <View style={styles.questionTimelineOption}>
                              <View style={q.multiple ? styles.questionTimelineCheckbox : styles.questionTimelineRadio} />
                              <View style={styles.questionTimelineOptionBody}>
                                <Text style={styles.questionTimelineOptionLabel}>输入自己的答案</Text>
                                <Text style={styles.questionTimelineOptionDesc}>输入你的答案...</Text>
                              </View>
                            </View>
                          ) : null}
                        </View>
                      );
                    })()}
                    <Text style={styles.questionTimelineDisabled}>{questions.length} 个问题 · {optionCount} 个选项 · 仅查看</Text>
                  </View>
                ) : null}
              </View>
            </View>
          );
        }
        if (item.kind === 'divider') {
          return (
            <View key={item.divider.id} style={styles.dividerWrap}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerLabel}>{toText(item.divider.label || '会话已压缩')}</Text>
              <View style={styles.dividerLine} />
            </View>
          );
        }
        if (item.kind === 'error') {
          return (
            <View key={item.error.id} style={styles.errorWrap}>
              <View style={styles.errorCard}>
                <Text style={styles.errorTitle}>{toText(item.error.title || 'Run failed')}</Text>
                {toText(item.error.code) ? <Text style={styles.errorCode}>{toText(item.error.code)}</Text> : null}
                <View style={styles.bubbleContent}>{renderMarkdown(toText(item.error.text || 'Unknown error'), 'assistant')}</View>
              </View>
            </View>
          );
        }
        if (item.kind === 'think' || item.kind === 'todo') {
          const card = 'card' in item ? item.card : null;
          if (!card) return null;
          const isThinkExpanded = expandedThinkCards.has(card.id);
  const contentText = normalizeReasoningText(card.text);
          return (
              <View key={card.id} style={styles.thinkWrap}>
                <Pressable style={isThinkExpanded ? styles.thinkCardExpanded : styles.thinkCard} onPress={() => onToggleThinkCard(card.id)}>
                  {isThinkExpanded ? (
                    <>
                      <View style={styles.thinkExpandedHead}>
                        <Text style={styles.thinkExpandedTitle}>过程详情</Text>
                        <Text style={styles.thinkToggleText}>收起</Text>
                      </View>
                      <View style={styles.bubbleContent}>{renderMarkdown(contentText, 'think')}</View>
                    </>
                  ) : (
                    <ThinkPreviewLines text={contentText} active={streaming && isLastTurn} />
                  )}
                </Pressable>
            </View>
          );
        }
        return null;
      })}
    </View>
  );
}, (prev, next) => (
  prev.turn.id === next.turn.id
  && prev.turn.signature === next.turn.signature
  && prev.streaming === next.streaming
  && prev.isLastTurn === next.isLastTurn
  && prev.thinkingPulse === next.thinkingPulse
  && prev.hasLiveQuestion === next.hasLiveQuestion
  && prev.liveQuestions === next.liveQuestions
  && prev.onCopyMessage === next.onCopyMessage
  && prev.expandedTimelineQuestions === next.expandedTimelineQuestions
  && prev.onToggleTimelineQuestion === next.onToggleTimelineQuestion
  && prev.expandedThinkCards === next.expandedThinkCards
  && prev.onToggleThinkCard === next.onToggleThinkCard
  && prev.timelineQuestionTabs === next.timelineQuestionTabs
  && prev.onChangeTimelineTab === next.onChangeTimelineTab
));

// prefs + discover cache moved to src/storage/*

function parsePairPayload(input: string): PairPayload | null {
  const text = input.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as PairPayload;
  } catch {
    try {
      const url = new URL(text);
      return {
        baseUrl: `${url.protocol}//${url.host}`,
        pairCode: url.searchParams.get('pairCode') || url.searchParams.get('code') || undefined,
        repoPath: url.searchParams.get('repoPath') || undefined
      };
    } catch {
      return null;
    }
  }
}

// normalizeBaseUrlForClient moved to src/lib/url

function summarizePreview(messages: MobileChatMessage[]): string {
  const assistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.text.trim());
  if (assistant) return assistant.text.slice(0, 42);
  const user = [...messages].reverse().find((m) => m.role === 'user' && m.text.trim());
  return user ? user.text.slice(0, 42) : '新会话';
}

function formatRetryDelay(ms: number): string {
  const sec = Math.max(1, Math.ceil(ms / 1000));
  return `${sec}s 后重试`;
}

function projectNameFromPath(worktree: string): string {
  const text = toText(worktree).trim();
  if (!text) return '未命名项目';
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : text;
}

function buildProjectQuestionPool(projectName: string): string[] {
  const name = projectName || '当前项目';
  return [
    `请先概览 ${name} 的目录结构，并说明每个模块职责`,
    `这个项目如何本地运行？请给我最短启动步骤`,
    `帮我找出 ${name} 的核心业务流程入口`,
    `请总结 ${name} 使用的技术栈和关键依赖`,
    `定位这个项目里与接口请求最相关的代码位置`,
    `如果要在 ${name} 新增功能，建议从哪里改起`,
    `请检查 ${name} 当前最可能的风险点或待办项`,
    `帮我生成一份 ${name} 的新人上手说明`,
    `请把 ${name} 的主要数据流转路径梳理一下`
  ];
}

function pickRandomQuestions(pool: string[], count: number): string[] {
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr.slice(0, Math.max(0, Math.min(count, arr.length)));
}

// formatClock moved to src/lib/time

function extractModelOptionsFromConfig(raw: any): ModelOption[] {
  const out = new Map<string, ModelOption>();
  const providerMap = raw && typeof raw === 'object' && raw.provider && typeof raw.provider === 'object' ? raw.provider : {};
  const disabled = new Set(
    Array.isArray(raw?.disabled_providers) ? raw.disabled_providers.map((x: any) => String(x || '').trim()).filter(Boolean) : []
  );
  for (const [providerId, providerNode] of Object.entries(providerMap as Record<string, any>)) {
    const pid = String(providerId || '').trim();
    if (!pid || disabled.has(pid)) continue;
    const models = providerNode && typeof providerNode === 'object' && providerNode.models && typeof providerNode.models === 'object'
      ? providerNode.models
      : {};
    for (const [modelId, modelNode] of Object.entries(models as Record<string, any>)) {
      const mid = String(modelId || '').trim();
      if (!mid) continue;
      const id = `${pid}/${mid}`;
      const label = String((modelNode as any)?.name || mid).trim() || mid;
      out.set(id, { id, label, provider: pid });
    }
  }
  const configured = String(raw?.model || '').trim();
  if (configured && configured.includes('/') && !out.has(configured)) {
    const idx = configured.indexOf('/');
    out.set(configured, { id: configured, provider: configured.slice(0, idx), label: configured.slice(idx + 1) || configured });
  }
  const mobileState = raw?.giteamMobileModelState && typeof raw.giteamMobileModelState === 'object' ? raw.giteamMobileModelState : {};
  const hiddenModels = new Set<string>(
    Array.isArray(mobileState?.hiddenModels) ? mobileState.hiddenModels.map((x: any) => String(x || '').trim()).filter(Boolean) : []
  );
  const enabledModels = Array.isArray(mobileState?.enabledModels) ? mobileState.enabledModels : [];
  for (const item of enabledModels) {
    const id = String(item || '').trim();
    if (!id || !id.includes('/') || hiddenModels.has(id)) continue;
    const idx = id.indexOf('/');
    if (!out.has(id)) out.set(id, { id, provider: id.slice(0, idx), label: id.slice(idx + 1) || id });
  }
  const activeModel = String(mobileState?.activeModel || '').trim();
  if (activeModel && activeModel.includes('/') && !hiddenModels.has(activeModel) && !out.has(activeModel)) {
    const idx = activeModel.indexOf('/');
    out.set(activeModel, { id: activeModel, provider: activeModel.slice(0, idx), label: activeModel.slice(idx + 1) || activeModel });
  }
  for (const hidden of hiddenModels) out.delete(hidden);
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function toProjectOptionsFromPaths(paths: string[]): ProjectOption[] {
  const uniq = Array.from(new Set(paths.map((x) => toText(x).trim()).filter(Boolean)));
  return uniq.map((p) => ({
    id: p,
    worktree: p,
    name: projectNameFromPath(p)
  }));
}

function getRepoPathsFromPairPayload(payload: PairPayload): string[] {
  const current = toText(payload.currentRepoPath).trim();
  if (current) return [current];
  const legacySingle = toText(payload.repoPath).trim();
  if (legacySingle) return [legacySingle];
  const fromList = Array.isArray(payload.repoPaths) ? payload.repoPaths.map((x) => toText(x).trim()).filter(Boolean) : [];
  return fromList.length > 0 ? [fromList[0]] : [];
}

const AUTH_ASCII_BRANDS = [
  ` ██████  ██ ████████ ███████  █████  ███    ███ 
██       ██    ██    ██      ██   ██ ████  ████ 
██   ███ ██    ██    █████   ███████ ██ ████ ██ 
██    ██ ██    ██    ██      ██   ██ ██  ██  ██ 
 ██████  ██    ██    ███████ ██   ██ ██      ██ `,
  `   _____ _____ _______ ______          __  __ 
  / ____|_   _|__   __|  ____|   /\\   |  \\/  |
 | |  __  | |    | |  | |__     /  \\  | \\  / |
 | | |_ | | |    | |  |  __|   / /\\ \\ | |\\/| |
 | |__| |_| |_   | |  | |____ / ____ \\| |  | |
  \\_____|_____|  |_|  |______/_/    \\_\\_|  |_|`,
  `                                     
 _____ _____ _____ _____ _____ _____ 
|   __|     |_   _|   __|  _  |     |
|  |  |-   -| | | |   __|     | | | |
|_____|_____| |_| |_____|__|__|_|_|_|`,
  `   _________________________    __  ___
  / ____/  _/_  __/ ____/   |  /  |/  /
 / / __ / /  / / / __/ / /| | / /|_/ / 
/ /_/ // /  / / / /___/ ___ |/ /  / /  
\\____/___/ /_/ /_____/_/  |_/_/  /_/`,
  String.raw` ________  ___  _________  _______   ________  _____ ______      
|\   ____\|\  \|\___   ___\\  ___ \ |\   __  \|\   _ \  _   \    
\ \  \___|\ \  \|___ \  \_\ \   __/|\ \  \|\  \ \  \\\__\ \  \   
 \ \  \  __\ \  \   \ \  \ \ \  \_|/_\ \   __  \ \  \\|__| \  \  
  \ \  \|\  \ \  \   \ \  \ \ \  \_|\ \ \  \ \  \ \  \    \ \  \ 
   \ \_______\ \__\   \ \__\ \ \_______\ \__\ \__\ \__\    \ \__\
    \|_______|\|__|    \|__|  \|_______|\|__|\|__|\|__|     \|__|`,
  String.raw` ____    ______  ______  ____    ______              
/\  _\` /\__  _\/\__  _\/\  _\` /\  _  \  /'\_/\`    
\ \ \L\_\/_/\ \/\/_/\ \/\ \ \L\_\ \ \L\ \/\      \   
 \ \ \L_L  \ \ \   \ \ \ \ \  _\L\ \  __ \ \ \__\ \  
  \ \ \/, \ \_\ \__ \ \ \ \ \ \L\ \ \ \/\ \ \ \_/\ \ 
   \ \____/ /\_____\ \ \_\ \ \____/\ \_\ \_\ \_\\ \_\
    \/___/  \/_____/  \/_/  \/___/  \/_/\/_/\/_/ \/_/`
];

function pickRandomAuthAsciiBrand(): string {
  const idx = Math.floor(Math.random() * AUTH_ASCII_BRANDS.length);
  return AUTH_ASCII_BRANDS[idx] || AUTH_ASCII_BRANDS[0] || '';
}

function isSameDiscoverRenderList(prev: DiscoverCacheDevice[], next: DiscoverCacheDevice[]): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (
      a.id !== b.id ||
      a.offline !== b.offline ||
      a.x !== b.x ||
      a.y !== b.y ||
      a.baseUrl !== b.baseUrl ||
      a.noAuth !== b.noAuth
    ) {
      return false;
    }
  }
  return true;
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('准备就绪');
  const [authAsciiBrand, setAuthAsciiBrand] = useState(() => pickRandomAuthAsciiBrand());
  const [authAsciiRender, setAuthAsciiRender] = useState('');
  const [authAsciiBox, setAuthAsciiBox] = useState({ width: 0, height: 94 });

  const [serverUrl, setServerUrl] = useState('');
  const [serverUrlTouched, setServerUrlTouched] = useState(false);
  const [preferHttps, setPreferHttps] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [token, setToken] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelCatalogStatus, setModelCatalogStatus] = useState('');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [sessionSearch, setSessionSearch] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerLocked, setScannerLocked] = useState(false);
  const [scannerReady, setScannerReady] = useState(false);
  const [scanHitCount, setScanHitCount] = useState(0);
  const [lastScanAt, setLastScanAt] = useState(0);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverStageReady, setDiscoverStageReady] = useState(false);
  const [discoverDevices, setDiscoverDevices] = useState<DiscoverCacheDevice[]>([]);
  const [discoveringUi, setDiscoveringUi] = useState(false);
  const [pairPromptOpen, setPairPromptOpen] = useState(false);
  const [pairPromptDevice, setPairPromptDevice] = useState<DiscoveredDevice | null>(null);
  const [pairPromptValue, setPairPromptValue] = useState('');
  const [hoveredDeviceId, setHoveredDeviceId] = useState('');
  const [selectedDiscoverId, setSelectedDiscoverId] = useState('');
  const [connectingDiscoverId, setConnectingDiscoverId] = useState('');
  const [discoverOrbitDeg, setDiscoverOrbitDeg] = useState(0);
  const [radarBox, setRadarBox] = useState({ width: 260, height: 260 });
  const [discoverLogs, setDiscoverLogs] = useState<Array<{ ts: number; level: 'info' | 'error'; msg: string }>>([]);

  const [prompt, setPrompt] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [messages, setMessages] = useState<MobileChatMessage[]>([]);
  const [renderedTurns, setRenderedTurns] = useState<MobileRenderedTurn[]>([]);
  const [sessionStatusMap, setSessionStatusMap] = useState<Record<string, SessionStatusInfo>>({});
  const [streaming, setStreaming] = useState(false);
  const [thinkingPulse, setThinkingPulse] = useState(false);
  const [streamTopGlowVisible, setStreamTopGlowVisible] = useState(false);
  const [todoDockCollapsed, setTodoDockCollapsed] = useState(false);
  const [dismissedTodoCardId, setDismissedTodoCardId] = useState('');
  const [questionRequests, setQuestionRequests] = useState<QuestionRequest[]>([]);
  const [dismissedQuestions, setDismissedQuestions] = useState<Set<string>>(() => new Set());
  const [questionSubmitState, setQuestionSubmitState] = useState<Record<string, QuestionSubmitState>>({});
  const [expandedTimelineQuestions, setExpandedTimelineQuestions] = useState<Set<string>>(new Set());
  const [expandedThinkCards, setExpandedThinkCards] = useState<Set<string>>(new Set());
  const [timelineQuestionTabs, setTimelineQuestionTabs] = useState<Map<string, number>>(new Map());
  const [drawerSide, setDrawerSide] = useState<'left' | 'right' | ''>('');
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionNextCursor, setSessionNextCursor] = useState<Record<string, string>>({});
  const [sessionHasMore, setSessionHasMore] = useState<Record<string, boolean>>({});
  const [sessionHistoryRetryHint, setSessionHistoryRetryHint] = useState<Record<string, string>>({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [optimisticVersion, setOptimisticVersion] = useState(0);
  const [sessionDisplayedCount, setSessionDisplayedCount] = useState(5);
  const [showLatestJump, setShowLatestJump] = useState(false);
  const [inputDockHeight, setInputDockHeight] = useState(88);
  const [chatListResetKey, setChatListResetKey] = useState(0);

  const streamRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef('');
  const streamSessionRef = useRef('');
  const messageScrollRef = useRef<FlashListRef<MobileRenderedTurn> | null>(null);
  const forceScrollToLatestUntilRef = useRef(0);
  const latestJumpVisibleRef = useRef(false);
  const latestJumpLastChangeRef = useRef(0);
  const projectsRef = useRef<ProjectOption[]>([]);
  const sessionsRef = useRef<SessionItem[]>([]);
  const sessionCacheRef = useRef<Record<string, SessionItem[]>>({});
  const discoverDevicesRef = useRef<DiscoverCacheDevice[]>([]);
  const modelOptionsRef = useRef<ModelOption[]>([]);
  const sessionRawMapRef = useRef<Record<string, any[]>>({});
  const sessionOptimisticUserMapRef = useRef<Record<string, OptimisticUserMessage[]>>({});
  const optimisticUserIdAliasRef = useRef<Record<string, Record<string, string>>>({});
  const streamDeltaTextRef = useRef<Record<string, string>>({});
  const streamPartMapRef = useRef<Record<string, Record<string, any>>>({});
  const streamPartTypeRef = useRef<Record<string, 'text' | 'reasoning'>>({});
  const streamPartDeltaKeyRef = useRef<Record<string, string>>({});
  const sessionVisibleTurnCountRef = useRef<Record<string, number>>({});
  const sessionTotalTurnCountRef = useRef<Record<string, number>>({});
  const inflightMessageReqRef = useRef<Record<string, Promise<RefreshMessagesResult | undefined>>>({});
  const inflightSessionSyncRef = useRef<Record<string, Promise<any>>>({});
  const olderCursorBackoffRef = useRef<Record<string, { cursor: string; retryAt: number; failures: number }>>({});
  const messageScrollYRef = useRef(0);
  const messageViewportHRef = useRef(0);
  const messageContentHRef = useRef(0);
  const messageUserScrollingRef = useRef(false);
  const streamRunIdRef = useRef(0);
  const sessionStatusEpochRef = useRef(0);
  const discoverRunRef = useRef(0);
  const discoverAbortRef = useRef<AbortController | null>(null);
  const discoveringRef = useRef(false);
  // const selectedDiscoverIdRef = useRef(''); // 拖拽交互已移除
  const discoverPointRef = useRef<Record<string, { x: number; y: number }>>({});
  const discoverOrbitRef = useRef<Record<string, { phase: number; radius: number }>>({});
  const discoverCacheRef = useRef<Record<string, DiscoverCacheDevice>>({});
  const discoverMissRef = useRef<Record<string, number>>({});
  const discoverSweepOffsetRef = useRef(0);
  const discoverPriorityDoneRef = useRef<Set<string>>(new Set());
  const radarBoxRef = useRef({ width: 260, height: 260 });
  const discoverRevealRef = useRef<Record<string, Animated.Value>>({});
  const discoverRevealFallback = useRef(new Animated.Value(1)).current;
  const discoverSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discoverPendingSaveRef = useRef<DiscoverCacheDevice[] | null>(null);
  const pairCodeMapRef = useRef<Record<string, string>>({});
  // 发现页设备的布局参数（与屏幕尺寸解耦，避免尺寸变化/重渲染导致“乱跳”）
  const discoverLayoutRef = useRef<Record<string, { angle0: number; omega: number; radiusF: number; driftX: number; driftY: number }>>({});
  const discoverDriftRef = useRef<Record<string, Animated.Value>>({});
  const [discoverOrbitTick, setDiscoverOrbitTick] = useState(0);
  const radarPulse = useRef(new Animated.Value(0)).current;
  const deviceBob = useRef(new Animated.Value(0)).current;
  const connectProgressAnim = useRef(new Animated.Value(0)).current;
  const discoverCardAnim = useRef(new Animated.Value(0)).current;
  const leftDrawerPulse = useRef(new Animated.Value(1)).current;
  const rightDrawerPulse = useRef(new Animated.Value(1)).current;
  const workspaceAnim = useRef(new Animated.Value(0)).current;
  const streamTopGlowAnim = useRef(new Animated.Value(0)).current;
  const streamTopGlowLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const streamTopGlowActiveRef = useRef(false);
  const streamTopGlowHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launchOverlayOpacity = useRef(new Animated.Value(1)).current;
  const [launchOverlayVisible, setLaunchOverlayVisible] = useState(true);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const authed = useMemo(() => token.trim().length > 0, [token]);
  const streamTopGlowRequested = busy || streaming;
  const showStreamTopGlow = streamTopGlowVisible;

  const localIpv4PrefixRef = useRef<{ prefix: string; ip: string; at: number } | null>(null);

  async function getLocalIpv4Prefix(): Promise<{ prefix: string; ip: string } | null> {
    try {
      const cached = localIpv4PrefixRef.current;
      const now = Date.now();
      if (cached && now - cached.at < 15000) {
        return { prefix: cached.prefix, ip: cached.ip };
      }
      const ip = String(await Network.getIpAddressAsync()).trim();
      const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
      if (!m) return null;
      const a = Number(m[1]);
      const b = Number(m[2]);
      const c = Number(m[3]);
      const d = Number(m[4]);
      if (![a, b, c, d].every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) return null;
      // 仅考虑常见私网 IPv4，避免蜂窝网/异常地址误扫
      const isPrivate =
        a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
      if (!isPrivate) return null;
      const prefix = `${a}.${b}.${c}`;
      localIpv4PrefixRef.current = { prefix, ip, at: now };
      return { prefix, ip };
    } catch {
      return null;
    }
  }

  useEffect(() => {
    const g: any = globalThis as any;
    const ErrorUtilsAny = g?.ErrorUtils as any;
    if (!ErrorUtilsAny?.setGlobalHandler) return;
    const prev = ErrorUtilsAny.getGlobalHandler ? ErrorUtilsAny.getGlobalHandler() : null;
    ErrorUtilsAny.setGlobalHandler((err: any, isFatal?: boolean) => {
      try {
        const fatalText = isFatal ? 'FATAL' : 'NON-FATAL';
        pushDiscoverLog(`全局异常捕获(${fatalText})：${toText(err?.message || err)}`, 'error');
      } catch {
        // ignore
      }
      if (typeof prev === 'function') prev(err, isFatal);
    });
    return () => {
      // 还原 handler（避免热重载/多次挂载重复包装）
      if (typeof prev === 'function') ErrorUtilsAny.setGlobalHandler(prev);
    };
  }, []);

  useEffect(() => {
    if (!loaded || !launchOverlayVisible) return;
    const timer = setTimeout(() => {
      Animated.timing(launchOverlayOpacity, {
        toValue: 0,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }).start(() => setLaunchOverlayVisible(false));
    }, 260);
    return () => clearTimeout(timer);
  }, [launchOverlayOpacity, launchOverlayVisible, loaded]);

  const statusText = toText(status);
  const filteredSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    const source = q
      ? sessions.filter((s) => {
          const title = toText(s.title).toLowerCase();
          const preview = toText(s.preview).toLowerCase();
          return title.includes(q) || preview.includes(q) || s.id.toLowerCase().includes(q);
        })
      : sessions;
    if (q || source.length <= sessionDisplayedCount) return source;
    return source.slice(0, sessionDisplayedCount);
  }, [sessions, sessionSearch, sessionDisplayedCount]);
  const workspacePanelHeight = useMemo(() => {
    const count = Math.max(1, projects.length);
    const headerAndPadding = 88;
    const rowHeight = 50;
    const desired = headerAndPadding + count * rowHeight;
    return Math.max(180, Math.min(420, desired));
  }, [projects.length]);
  const authAsciiTextStyle = useMemo(() => {
    const raw = toText(authAsciiBrand);
    const lines = raw.split('\n');
    const lineCount = Math.max(1, lines.length);
    const maxChars = Math.max(1, ...lines.map((line) => line.length));
    const boxWidth = Math.max(1, authAsciiBox.width - 4);
    const boxHeight = Math.max(1, authAsciiBox.height);
    const baseFont = 10;
    const minFont = 6;
    const widthByFont = boxWidth / (maxChars * 0.6);
    const heightByFont = boxHeight / (lineCount * 1.2);
    const fontSize = Math.max(minFont, Math.min(baseFont, widthByFont, heightByFont));
    const lineHeight = Math.max(fontSize + 1, Math.round(fontSize * 1.2));
    return { fontSize, lineHeight };
  }, [authAsciiBrand, authAsciiBox.height, authAsciiBox.width]);
  const authAsciiDisplay = useMemo(
    () => toText(authAsciiRender || authAsciiBrand).replace(/ /g, '\u00A0'),
    [authAsciiRender, authAsciiBrand]
  );
  const selectedDiscoverDevice = useMemo(
    () => discoverDevices.find((d) => d.id === selectedDiscoverId) || null,
    [discoverDevices, selectedDiscoverId]
  );

  function pushConnLog(message: string, level: 'info' | 'error' = 'info') {
    const text = toText(message).trim();
    if (!text) return;
    const tag = level === 'error' ? 'error' : 'log';
    // eslint-disable-next-line no-console
    console[tag](`[mobile-conn] ${new Date().toISOString()} ${text}`);
  }

  function pushDiscoverLog(message: string, level: 'info' | 'error' = 'info') {
    const msg = toText(message).trim();
    if (!msg) return;
    const row = { ts: Date.now(), level, msg };
    setDiscoverLogs((prev) => {
      const next = prev.length >= DISCOVER_LOG_LIMIT ? [...prev.slice(prev.length - (DISCOVER_LOG_LIMIT - 1)), row] : [...prev, row];
      return next;
    });
    pushConnLog(`[discover] ${msg}`, level);
  }

  function deviceKeyOf(d: { host: string; port: number } | null | undefined): string {
    if (!d) return '';
    const host = toText((d as any).host).trim();
    const port = Number((d as any).port || 0) || 0;
    return host && port ? `${host}:${port}` : '';
  }

  // pair code map storage moved to src/storage/pairCodeMap

  function scheduleDiscoverCacheSave(rows: DiscoverCacheDevice[], signal?: AbortSignal) {
    discoverPendingSaveRef.current = rows;
    if (discoverSaveTimerRef.current) {
      clearTimeout(discoverSaveTimerRef.current);
      discoverSaveTimerRef.current = null;
    }
    discoverSaveTimerRef.current = setTimeout(() => {
      discoverSaveTimerRef.current = null;
      const pending = discoverPendingSaveRef.current;
      discoverPendingSaveRef.current = null;
      if (!pending) return;
      if (signal?.aborted) return;
      void Promise.resolve(InteractionManager.runAfterInteractions(() => saveDiscoverCache(pending))).catch(() => {
        if (signal?.aborted) return;
        void saveDiscoverCache(pending);
      });
    }, 450);
  }

  function ensureDiscoverLayout(id: string, idx: number) {
    if (discoverLayoutRef.current[id]) return discoverLayoutRef.current[id];
    // 以 idx 为种子生成稳定参数：靠近视觉中心的安全圆环内分布
    const angle0 = ((idx * 137) % 360) * (Math.PI / 180);
    // 每台设备一个很小的角速度（无规则缓慢旋转）
    const omega = (((idx * 29) % 21) - 10) / 1800; // rad/ms 约 -0.0055..0.0055
    // 半径范围落在“波纹圈”区域里（更集中）
    const radiusF = 0.16 + (((idx * 19) % 12) / 100); // 0.16 ~ 0.28
    const driftX = ((idx % 3) - 1) * (2 + (idx % 4)); // -6..6 px
    const driftY = (((idx + 1) % 3) - 1) * (2 + ((idx + 2) % 4)); // -6..6 px
    const row = { angle0, omega, radiusF, driftX, driftY };
    discoverLayoutRef.current[id] = row;

    if (!discoverDriftRef.current[id]) {
      const v = new Animated.Value(0);
      discoverDriftRef.current[id] = v;
      const duration = 4200 + ((idx * 317) % 2200);
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
        ])
      ).start();
    }
    return row;
  }

  useEffect(() => {
    if (!discoverOpen) return;
    // 轻量 tick：驱动“绕中心旋转”的位置更新
    const timer = setInterval(() => setDiscoverOrbitTick((v) => (v + 1) % 1000000), 90);
    return () => clearInterval(timer);
  }, [discoverOpen]);

  function onAuthAsciiSlotLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setAuthAsciiBox((prev) => {
      if (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) return prev;
      return { width, height };
    });
  }

  useEffect(() => {
    let alive = true;
    loadPrefs().then((prefs) => {
      if (!alive) return;
      setServerUrl(prefs.serverUrl);
      setServerUrlTouched(Boolean((prefs as any).serverUrlTouched));
      setPreferHttps(Boolean((prefs as any).preferHttps));
      setPairCode(prefs.pairCode);
      setRepoPath(prefs.repoPath);
      setProjects(toProjectOptionsFromPaths(prefs.repoPaths || []));
      setToken(prefs.token);
      setSessionId(prefs.sessionId);
      sessionIdRef.current = prefs.sessionId;
      setModel(prefs.model || '');
      setLoaded(true);
      const pname = projectNameFromPath(toText(prefs.repoPath));
      setSuggestions(pickRandomQuestions(buildProjectQuestionPool(pname), 3));
    });
    loadPairCodeMap().then((m) => {
      if (!alive) return;
      pairCodeMapRef.current = m || {};
    });
    return () => {
      alive = false;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    loadDiscoverCache().then((rows) => {
      if (!alive) return;
      const map: Record<string, DiscoverCacheDevice> = {};
      rows.forEach((d) => {
        map[d.id] = d;
        discoverPointRef.current[d.id] = { x: d.x, y: d.y };
        discoverMissRef.current[d.id] = 0;
      });
      discoverCacheRef.current = map;
    });
    loadSessionCache().then((cache) => {
      if (!alive) return;
      sessionCacheRef.current = cache;
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void savePrefs({
      serverUrl: serverUrlTouched ? serverUrl : '',
      serverUrlTouched,
      preferHttps,
      pairCode,
      repoPath,
      repoPaths: projects.map((p) => p.worktree),
      token,
      sessionId,
      model
    });
  }, [loaded, serverUrl, serverUrlTouched, preferHttps, pairCode, repoPath, projects, token, sessionId, model]);

  function onChangeServerUrl(value: string) {
    setServerUrlTouched(true);
    setServerUrl(value);
  }

  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => setThinkingPulse((v) => !v), 480);
    return () => clearInterval(timer);
  }, [streaming]);

  useEffect(() => {
    if (streamTopGlowHideTimerRef.current) {
      clearTimeout(streamTopGlowHideTimerRef.current);
      streamTopGlowHideTimerRef.current = null;
    }
    if (streamTopGlowRequested) {
      setStreamTopGlowVisible(true);
      return;
    }
    streamTopGlowHideTimerRef.current = setTimeout(() => {
      setStreamTopGlowVisible(false);
      streamTopGlowHideTimerRef.current = null;
    }, 520);
    return () => {
      if (streamTopGlowHideTimerRef.current) {
        clearTimeout(streamTopGlowHideTimerRef.current);
        streamTopGlowHideTimerRef.current = null;
      }
    };
  }, [streamTopGlowRequested]);

  useEffect(() => {
    if (!showStreamTopGlow) {
      if (!streamTopGlowActiveRef.current) return;
      streamTopGlowActiveRef.current = false;
      streamTopGlowLoopRef.current?.stop();
      streamTopGlowLoopRef.current = null;
      Animated.timing(streamTopGlowAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }).start();
      return;
    }
    if (streamTopGlowActiveRef.current || streamTopGlowLoopRef.current) return;
    streamTopGlowActiveRef.current = true;
    const loop = Animated.loop(
      Animated.timing(streamTopGlowAnim, {
        toValue: 1,
        duration: 1900,
        easing: Easing.linear,
        useNativeDriver: true
      })
    );
    streamTopGlowAnim.setValue(0);
    streamTopGlowLoopRef.current = loop;
    loop.start();
    return () => {
      if (!streamTopGlowActiveRef.current) {
        loop.stop();
        if (streamTopGlowLoopRef.current === loop) streamTopGlowLoopRef.current = null;
      }
    };
  }, [showStreamTopGlow, streamTopGlowAnim]);

  useEffect(() => {
    const sid = toText(sessionId).trim();
    if (!authed || !sid || !repoPath.trim()) return;
    void refreshPendingQuestions(sid);
    // Only poll when streaming or session is busy or we have live questions
    if (!streaming && sessionStatusMap[sid]?.type !== 'busy' && questionRequests.length === 0) return;
    const timer = setInterval(() => {
      void refreshPendingQuestions(sid);
    }, 1200);
    return () => clearInterval(timer);
  }, [authed, sessionId, repoPath, serverUrl, token, streaming, sessionStatusMap, questionRequests.length, dismissedQuestions]);

  useEffect(() => {
    const sid = toText(sessionId).trim();
    const repo = toText(repoPath).trim();
    if (!sid || !repo) {
      setDismissedQuestions(new Set());
      return;
    }
    let alive = true;
    loadQuestionDismissals(repo, sid).then((ids) => {
      if (!alive) return;
      setDismissedQuestions(ids);
    });
    return () => {
      alive = false;
    };
  }, [sessionId, repoPath]);

  useEffect(() => {
    if (!discoverOpen) return;
    radarPulse.setValue(0);
    deviceBob.setValue(0);
    // 平滑扫描：避免“瞬间归零”造成的波纹突变
    const pulse = Animated.loop(
      Animated.timing(radarPulse, {
        toValue: 1,
        duration: 2600,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true
      }),
      { resetBeforeIteration: true }
    );
    const bob = Animated.loop(
      Animated.sequence([
        Animated.timing(deviceBob, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(deviceBob, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        })
      ])
    );
    pulse.start();
    bob.start();
    return () => {
      pulse.stop();
      bob.stop();
    };
  }, [discoverOpen, deviceBob, radarPulse]);

  useEffect(() => {
    if (!discoverOpen) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const deg = (((Date.now() - started) / 1000) * 14) % 360;
      setDiscoverOrbitDeg(deg);
    }, 72);
    return () => clearInterval(timer);
  }, [discoverOpen]);

  useEffect(() => {
    if (!discoverOpen || !discoverStageReady) return;
    let closed = false;
    const loop = async () => {
      while (!closed) {
        if (!discoveringRef.current) {
          await startDiscover();
        }
        if (closed) return;
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    };
    void loop();
    return () => {
      closed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoverOpen, discoverStageReady, serverUrl, preferHttps, radarBox.width, radarBox.height]);

  useEffect(() => {
    if (!discoverOpen) return;
    const nextIds = new Set(discoverDevices.map((d) => d.id));
    for (const id of Object.keys(discoverRevealRef.current)) {
      if (!nextIds.has(id)) delete discoverRevealRef.current[id];
    }
    discoverDevices.forEach((d, idx) => {
      const existing = discoverRevealRef.current[d.id];
      if (existing) {
        // 避免扫描刷新时重复触发入场动画导致顿挫
        return;
      }
      const v = new Animated.Value(0);
      discoverRevealRef.current[d.id] = v;
      const hadCache = Boolean(discoverCacheRef.current[d.id]);
      if (hadCache) {
        v.setValue(1);
        return;
      }
      Animated.timing(v, {
        toValue: 1,
        duration: 240,
        delay: Math.min(120, idx * 40),
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }).start();
    });
  }, [discoverDevices, discoverOpen]);

  useEffect(() => {
    if (!selectedDiscoverId) return;
    if (discoverDevices.some((d) => d.id === selectedDiscoverId)) return;
    setSelectedDiscoverId('');
  }, [discoverDevices, selectedDiscoverId]);

  useEffect(() => {
    if (!selectedDiscoverId) {
      discoverCardAnim.setValue(0);
      setConnectingDiscoverId('');
      connectProgressAnim.setValue(0);
      return;
    }
    setConnectingDiscoverId('');
    connectProgressAnim.setValue(0);
    discoverCardAnim.setValue(0);
    Animated.timing(discoverCardAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [selectedDiscoverId, connectProgressAnim, discoverCardAnim]);

  // 去掉拖拽：保持“扫描 + 轻动态感”的简单交互模型

  useEffect(() => {
    if (authed) return;
    const text = toText(authAsciiBrand);
    if (!text) {
      setAuthAsciiRender('');
      return;
    }
    setAuthAsciiRender('');
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setAuthAsciiRender(text.slice(0, i));
      if (i >= text.length) clearInterval(timer);
    }, 8);
    return () => clearInterval(timer);
  }, [authed, authAsciiBrand]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    discoverDevicesRef.current = discoverDevices;
  }, [discoverDevices]);

  // selectedDiscoverIdRef 仅用于拖拽交互（已移除）

  useEffect(() => {
    radarBoxRef.current = radarBox;
  }, [radarBox]);

  useEffect(() => {
    modelOptionsRef.current = modelOptions;
  }, [modelOptions]);

  useEffect(() => {
    if (!loaded || !authed || !sessionId || !repoPath) return;
    void syncSessionMessages(sessionId, {
      limit: INITIAL_SESSION_LIMIT,
      fetchLimit: INITIAL_MESSAGE_FETCH_LIMIT
    });
    void syncSessionStatus(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, authed, sessionId, repoPath]);

  useEffect(() => {
    if (!loaded || !authed || !repoPath) return;
    void refreshModelCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, authed, repoPath, serverUrl, token]);

  useEffect(() => {
    if (!loaded || !authed || !repoPath) return;
    void refreshSessionsFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, authed, repoPath, serverUrl, token]);

  useEffect(() => {
    if (!loaded || !authed || !serverUrl || projects.length > 0) return;
    void refreshProjectsCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, authed, serverUrl, token, projects.length]);

  function stopStream() {
    streamRunIdRef.current += 1;
    sessionStatusEpochRef.current += 1;
    if (streamRef.current) {
      pushConnLog('SSE close');
      streamRef.current.close();
      streamRef.current = null;
    }
    streamSessionRef.current = '';
    setStreaming(false);
  }

  async function syncSessionStatus(targetSessionId?: string) {
    const sid = toText(targetSessionId || sessionIdRef.current).trim();
    if (!authed || !serverUrl || !repoPath) return undefined;
    const epoch = sessionStatusEpochRef.current;
    try {
      const next = await getSessionStatus({
        baseUrl: serverUrl,
        token,
        repoPath
      });
      if (epoch !== sessionStatusEpochRef.current) return undefined;
      setSessionStatusMap(next);
      if (!sid) return undefined;
      return next[sid] || { type: 'idle' as const };
    } catch {
      return undefined;
    }
  }

  function setActiveSession(nextSessionId: string) {
    const sid = toText(nextSessionId).trim();
    sessionIdRef.current = sid;
    setSessionId(sid);
    // Clear question state when switching sessions
    setQuestionRequests([]);
    setQuestionSubmitState({});
    if (!sid) {
      setSessionStatusMap({});
      return;
    }
    void syncSessionStatus(sid);
  }

  function triggerPulse(anim: Animated.Value) {
    anim.setValue(0.72);
    Animated.timing(anim, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true
    }).start();
  }

  function bumpOptimisticVersion() {
    setOptimisticVersion((v) => v + 1);
  }

  function upsertOptimisticUserMessage(targetSessionId: string, message: OptimisticUserMessage) {
    const sid = toText(targetSessionId).trim();
    if (!sid) return;
    const prev = Array.isArray(sessionOptimisticUserMapRef.current[sid]) ? sessionOptimisticUserMapRef.current[sid] : [];
    sessionOptimisticUserMapRef.current[sid] = [...prev.filter((item) => item.id !== message.id), message].sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
    );
    bumpOptimisticVersion();
  }

  function dropOptimisticUserMessage(targetSessionId: string, optimisticId: string) {
    const sid = toText(targetSessionId).trim();
    if (!sid || !optimisticId) return;
    const prev = Array.isArray(sessionOptimisticUserMapRef.current[sid]) ? sessionOptimisticUserMapRef.current[sid] : [];
    const next = prev.filter((item) => item.id !== optimisticId);
    if (next.length > 0) sessionOptimisticUserMapRef.current[sid] = next;
    else delete sessionOptimisticUserMapRef.current[sid];
    setMessages((prev) => prev.filter((item) => item.id !== optimisticId));
    setRenderedTurns((prev) => prev.filter((item) => item.id !== `turn:optimistic:${optimisticId}`));
    bumpOptimisticVersion();
  }

  function reconcileOptimisticUserMessages(targetSessionId: string, chatMessages: MobileChatMessage[]) {
    const sid = toText(targetSessionId).trim();
    const optimistic = Array.isArray(sessionOptimisticUserMapRef.current[sid]) ? sessionOptimisticUserMapRef.current[sid] : [];
    if (!sid || optimistic.length === 0) return optimistic;
    const serverUsers = chatMessages.filter((item) => item.role === 'user' && !!toText(item.text));
    const usedIds = new Set<string>();
    const remaining: OptimisticUserMessage[] = [];
    for (const local of optimistic) {
      const text = toText(local.text);
      const matched = serverUsers.find((item) => {
        if (usedIds.has(item.id)) return false;
        if (toText(item.text) !== text) return false;
        const delta = Math.abs((Number(item.createdAt || 0) || 0) - local.createdAt);
        return delta <= 10 * 60 * 1000;
      }) || serverUsers
        .filter((item) => !usedIds.has(item.id) && toText(item.text) === text)
        .sort((a, b) => {
          const da = Math.abs((Number(a.createdAt || 0) || 0) - local.createdAt);
          const db = Math.abs((Number(b.createdAt || 0) || 0) - local.createdAt);
          return da - db;
        })[0];
      if (matched) {
        optimisticUserIdAliasRef.current[sid] = {
          ...(optimisticUserIdAliasRef.current[sid] || {}),
          [matched.id]: local.id,
        };
        usedIds.add(matched.id);
        continue;
      }
      remaining.push(local);
    }
    if (remaining.length === optimistic.length) return optimistic;
    if (remaining.length > 0) sessionOptimisticUserMapRef.current[sid] = remaining;
    else delete sessionOptimisticUserMapRef.current[sid];
    bumpOptimisticVersion();
    return remaining;
  }

  function stabilizeServerUserTurnIds(targetSessionId: string, base: ReturnType<typeof buildTurnWindow>) {
    const sid = toText(targetSessionId).trim();
    const alias = optimisticUserIdAliasRef.current[sid] || {};
    if (!sid || Object.keys(alias).length === 0) return base;
    const remapMessage = (message: MobileChatMessage): MobileChatMessage => {
      const mapped = alias[message.id];
      return mapped ? { ...message, id: mapped } : message;
    };
    return {
      ...base,
      chatMessages: base.chatMessages.map(remapMessage),
      renderedTurns: base.renderedTurns.map((turn) => {
        const user = turn.userMessage ? remapMessage(turn.userMessage) : undefined;
        if (!user || user.id === turn.userMessage?.id) return turn;
        return {
          ...turn,
          id: `turn:optimistic:${user.id}`,
          userMessage: user,
          signature: turn.signature.replace(`user:${turn.userMessage?.id || ''}:`, `user:${user.id}:`),
        };
      }),
    };
  }

  function overlayOptimisticTurns(base: ReturnType<typeof buildTurnWindow>, optimistic: OptimisticUserMessage[]) {
    if (optimistic.length === 0) return base;
    const keepBaseTurns = base.visibleTurnCount > INITIAL_SESSION_LIMIT;
    const nextMessages = keepBaseTurns ? [...base.chatMessages] : [];
    const nextTurns = keepBaseTurns ? [...base.renderedTurns] : [];
    for (const item of optimistic) {
      nextMessages.push({ id: item.id, role: 'user', text: item.text, createdAt: item.createdAt });
      const streamedItems = keepBaseTurns ? [] : base.renderedTurns.flatMap((turn) => turn.items);
      nextTurns.push({
        id: `turn:optimistic:${item.id}`,
        createdAt: item.createdAt,
        userMessage: { id: item.id, role: 'user', text: item.text, createdAt: item.createdAt },
        items: streamedItems,
        signature: `optimistic:${item.id}:${item.text.length}:${streamedItems.map((streamed: any) => {
          if (streamed.kind === 'chat') return `${streamed.kind}:${streamed.message?.id}:${toText(streamed.message?.text).length}`;
          if (streamed.kind === 'event') return `${streamed.kind}:${streamed.event?.id}:${toText(streamed.event?.status)}`;
          if (streamed.kind === 'think') return `${streamed.kind}:${streamed.card?.id}:${toText(streamed.card?.text).length}`;
          if (streamed.kind === 'todo') return `${streamed.kind}:${streamed.todo?.id}:${streamed.todo?.finished ? 1 : 0}`;
          if (streamed.kind === 'question') return `${streamed.kind}:${streamed.question?.id}:${toText(streamed.question?.status)}`;
          return `${streamed.kind}:${streamed.createdAt || 0}`;
        }).join('|')}`
      });
    }
    return {
      ...base,
      chatMessages: nextMessages,
      renderedTurns: nextTurns,
      mergedCount: base.mergedCount + optimistic.length,
      visibleTurnCount: keepBaseTurns ? base.visibleTurnCount + optimistic.length : optimistic.length,
      totalTurnCount: base.totalTurnCount + optimistic.length,
      hasUserTurn: true
    };
  }

  function appendOptimisticTurnAndStick(message: OptimisticUserMessage) {
    setMessages([{ id: message.id, role: 'user', text: message.text, createdAt: message.createdAt }]);
    setRenderedTurns([
      {
        id: `turn:optimistic:${message.id}`,
        createdAt: message.createdAt,
        userMessage: { id: message.id, role: 'user', text: message.text, createdAt: message.createdAt },
        items: [],
        signature: `optimistic:${message.id}:${message.text.length}`
      }
    ]);
    sessionVisibleTurnCountRef.current[sessionIdRef.current] = INITIAL_SESSION_LIMIT;
    bumpOptimisticVersion();
  }

  function clearSessionOptimisticMessages(targetSessionId: string) {
    const sid = toText(targetSessionId).trim();
    if (!sid) return;
    const pending = sessionOptimisticUserMapRef.current[sid] || [];
    if (pending.length) {
      const ids = new Set(pending.map((item) => item.id));
      delete sessionOptimisticUserMapRef.current[sid];
      setMessages((prev) => prev.filter((item) => !ids.has(item.id)));
      setRenderedTurns((prev) => prev.filter((item) => !ids.has(item.id.replace(/^turn:optimistic:/, ''))));
      bumpOptimisticVersion();
    }
  }

  function scrollToLatest(animated: boolean) {
    const list = messageScrollRef.current;
    const bottomInset = Math.max(140, inputDockHeight + 44);
    const maxOffset = Math.max(0, messageContentHRef.current - messageViewportHRef.current + bottomInset);
    try {
      list?.scrollToOffset({ offset: maxOffset + 1200, animated });
      return;
    } catch {}
    try {
      list?.scrollToEnd({ animated });
    } catch {}
  }

  function jumpToLatest() {
    messageUserScrollingRef.current = false;
    forceScrollToLatestUntilRef.current = Date.now() + 900;
    latestJumpVisibleRef.current = false;
    latestJumpLastChangeRef.current = Date.now();
    setShowLatestJump(false);
    scrollToLatest(true);
    [80, 220, 420, 760, 1200].forEach((delay) => {
      setTimeout(() => scrollToLatest(false), delay);
    });
  }

  function openDrawer(side: 'left' | 'right') {
    if (drawerSide === side) return;
    setWorkspacePickerOpen(false);
    setDrawerSide(side);
    void InteractionManager.runAfterInteractions(() => {
      if (side === 'left') void refreshSessionsFromServer();
      else void refreshModelCatalog();
    });
  }

  function closeDrawer() {
    setDrawerSide('');
  }

  const renderLeftDrawerContent = useCallback(() => (
    <View style={styles.drawerPanelLeft}>
      <View style={styles.drawerHead}>
        <Text style={styles.drawerTitle}>会话</Text>
        <View style={styles.drawerMetaRow}>
          <Text style={styles.drawerMetaChip}>会话 {sessions.length}</Text>
        </View>
        <Pressable style={styles.drawerNewBtn} onPress={() => { onNewSession(); closeDrawer(); }}>
          <Text style={styles.drawerNewTxt}>新建对话</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerList}>
        <TextInput
          style={styles.drawerSessionSearch}
          value={sessionSearch}
          onChangeText={setSessionSearch}
          autoCapitalize="none"
          placeholder="搜索会话"
          placeholderTextColor="#9ca7b5"
        />
        <Animated.View style={{ opacity: leftDrawerPulse }}>
          {filteredSessions.map((s, idx) => {
            const preview = toText(s.preview).trim();
            return (
              <Pressable
                key={s.id}
                style={[
                  s.id === sessionId ? styles.drawerItemActive : styles.drawerItem,
                  idx < filteredSessions.length - 1 ? styles.drawerItemGap : null
                ]}
                onPress={() => {
                  stopStream();
                  setActiveSession(s.id);
                  closeDrawer();
                }}
              >
                <View style={styles.drawerItemHead}>
                  <Text numberOfLines={1} style={styles.drawerItemTitle}>{toText(s.title || '新会话')}</Text>
                  <Text style={styles.drawerItemTime}>{formatClock(s.updatedAt)}</Text>
                </View>
                {preview ? <Text numberOfLines={1} style={styles.drawerItemPreview}>{preview}</Text> : null}
              </Pressable>
            );
          })}
          {!sessionSearch.trim() && sessions.length > sessionDisplayedCount ? (
            <Pressable
              style={styles.drawerMoreBtn}
              onPress={() => setSessionDisplayedCount((p) => Math.min(p + 5, sessions.length))}
            >
              <Text style={styles.drawerMoreTxt}>… more</Text>
            </Pressable>
          ) : null}
        </Animated.View>
        {filteredSessions.length === 0 ? <Text style={styles.drawerEmpty}>暂无匹配会话</Text> : null}
      </ScrollView>
    </View>
  ), [sessions.length, sessionSearch, filteredSessions, sessionId, sessionDisplayedCount, leftDrawerPulse]);

  const renderRightDrawerContent = useCallback(() => (
    <View style={styles.drawerPanelRight}>
      <View style={styles.drawerHead}>
        <View style={styles.drawerHeadTop}>
          <Text style={styles.drawerTitle}>模型</Text>
          <Pressable
            style={styles.drawerLogoutBtn}
            onPress={() => {
              closeDrawer();
              onResetAuth();
            }}
          >
            <Image source={require('./src/assets/icons/logout.png')} style={styles.drawerLogoutImage} resizeMode="contain" />
          </Pressable>
        </View>
        <Text style={styles.drawerModelStatus}>{toText(modelCatalogStatus || '请选择可用模型')}</Text>
      </View>
      <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerList}>
        <Animated.View style={{ opacity: rightDrawerPulse }}>
          {modelOptions.map((opt, idx) => {
            const active = model.trim() === opt.id;
            return (
              <Pressable
                key={opt.id}
                style={[
                  active ? styles.drawerModelListItemActive : styles.drawerModelListItem,
                  idx < modelOptions.length - 1 ? styles.drawerItemGap : null
                ]}
                onPress={() => setModel(opt.id)}
              >
                <Text style={active ? styles.drawerModelListTitleActive : styles.drawerModelListTitle}>{toText(opt.label)}</Text>
                <Text style={active ? styles.drawerModelListSubActive : styles.drawerModelListSub}>{toText(opt.id)}</Text>
              </Pressable>
            );
          })}
        </Animated.View>
        {modelOptions.length === 0 ? <Text style={styles.drawerEmpty}>暂无可用模型</Text> : null}
      </ScrollView>
    </View>
  ), [modelCatalogStatus, modelOptions, model, rightDrawerPulse]);

  function openWorkspacePicker() {
    if (workspacePickerOpen) return;
    setDrawerSide('');
    setWorkspacePickerOpen(true);
    pushConnLog(`workspace picker opening projects=${projectsRef.current.length}`);
    workspaceAnim.setValue(0);
    Animated.timing(workspaceAnim, {
      toValue: 1,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
    void refreshProjectsCatalog();
  }

  function closeWorkspacePicker() {
    Animated.timing(workspaceAnim, {
      toValue: 0,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start(() => setWorkspacePickerOpen(false));
  }

  function upsertSession(nextSessionId: string, nextMessages: MobileChatMessage[]) {
    if (!nextSessionId) return;
    const title = nextMessages.find((m) => m.role === 'user' && m.text.trim())?.text.slice(0, 24) || '新会话';
    const preview = summarizePreview(nextMessages);
    setSessions((prev) => {
      const prevEntry = prev.find((s) => s.id === nextSessionId);
      const nextRow: SessionItem = {
        id: nextSessionId,
        title,
        preview,
        // 仅同步预览/标题，不改变排序时间戳，避免每次拉消息列表顺序跳动
        updatedAt: prevEntry?.updatedAt ?? Date.now(),
        createdAt: prevEntry?.createdAt
      };
      const base = prevEntry ? prev.map((s) => (s.id === nextSessionId ? nextRow : s)) : [nextRow, ...prev];
      return stableSortSessionItems(base).slice(0, 50);
    });
  }

  async function refreshSessionsFromServer(targetRepoPath?: string) {
    const repo = toText(targetRepoPath || repoPath).trim();
    if (!authed || !repo) return [] as SessionItem[];
    const cached = sessionCacheRef.current[repo];
    if (cached && cached.length > 0) {
      const prevIds = new Set(sessionsRef.current.map((x) => x.id));
      const hasNew = cached.some((x) => !prevIds.has(x.id));
      sessionsRef.current = cached;
      setSessions(cached);
      if (hasNew) triggerPulse(leftDrawerPulse);
    }
    try {
      pushConnLog(`GET sessions repo=${repo}`);
      const rows = await getSessions({
        baseUrl: serverUrl,
        token,
        repoPath: repo,
        limit: 200
      });
      pushConnLog(`GET sessions ok count=${rows.length}`);
      const nextSessions = stableSortSessionItems(
        rows.map((s) => {
          const createdAt = Number(s.createdAt || 0) || 0;
          const updatedAt = Number(s.updatedAt || 0) || createdAt;
          return {
            id: s.id,
            title: s.title || '新会话',
            preview: '',
            updatedAt,
            createdAt
          };
        })
      );
      const merged = setSessionsWithCacheMerge(repo, nextSessions, sessionsRef.current);
      sessionsRef.current = merged;
      sessionCacheRef.current = { ...sessionCacheRef.current, [repo]: merged };
      void saveSessionCache(sessionCacheRef.current);
      return merged;
    } catch (e) {
      pushConnLog(`GET sessions error ${String(e)}`, 'error');
      setStatus((prev) => (prev.includes('sessions failed') ? prev : `会话同步失败: ${String(e)}`));
      return sessionsRef.current;
    }
  }

  function setSessionsWithCacheMerge(repo: string, next: SessionItem[], prev: SessionItem[]): SessionItem[] {
    const previewMap = new Map(prev.map((x) => [x.id, x.preview]));
    const merged = next.map((s) => ({
      id: s.id,
      title: s.title,
      preview: previewMap.get(s.id) || '',
      updatedAt: s.updatedAt,
      createdAt: s.createdAt
    }));
    setSessions(merged);
    return merged;
  }

  function extractQuestionRequests(raw: any[], targetSessionId: string): QuestionRequest[] {
    const requests: QuestionRequest[] = [];
    const seenIds = new Set<string>();
    for (const row of raw) {
      const parts = Array.isArray(row?.parts) ? row.parts : [];
      for (const part of parts) {
        const partType = toText(part?.type).toLowerCase();
        if (partType !== 'tool') continue;
        const toolName = toText(part?.tool).toLowerCase();
        if (toolName !== 'question') continue;
        const state = part?.state || {};
        const status = toText(state?.status).toLowerCase();
        if (status !== 'pending' && status !== 'running') continue;
        const input = state?.input || {};
        const questions = input?.questions;
        if (!Array.isArray(questions) || questions.length === 0) continue;
        const callID = toText(state?.callID) || toText(part?.id);
        const messageID = toText(row?.info?.id);
        const requestId = callID || `question-${messageID}`;
        if (seenIds.has(requestId)) continue;
        seenIds.add(requestId);
        requests.push({
          id: requestId,
          sessionID: targetSessionId || sessionIdRef.current,
          questions: questions.map((q: any) => ({
            question: toText(q?.question),
            header: toText(q?.header) || undefined,
            options: Array.isArray(q?.options) ? q.options.map((opt: any) => ({
              label: toText(opt?.label),
              description: toText(opt?.description) || undefined,
            })).filter((opt: any) => opt.label) : [],
            multiple: q?.multiple === true,
            custom: q?.custom !== false,
          })),
          tool: callID && messageID ? { messageID, callID } : undefined,
        });
      }
    }
    return requests;
  }

  function applyTurnWindow(targetSessionId: string, visibleTurnCount: number, nextCursorHint?: string) {
    const merged = Array.isArray(sessionRawMapRef.current[targetSessionId]) ? sessionRawMapRef.current[targetSessionId] : [];
    const baseRendered = buildTurnWindow(merged, visibleTurnCount);
    const optimistic = reconcileOptimisticUserMessages(targetSessionId, baseRendered.chatMessages);
    const stableBaseRendered = stabilizeServerUserTurnIds(targetSessionId, baseRendered);
    const rendered = overlayOptimisticTurns(stableBaseRendered, optimistic);
    sessionVisibleTurnCountRef.current[targetSessionId] = rendered.visibleTurnCount;
    sessionTotalTurnCountRef.current[targetSessionId] = rendered.totalTurnCount;
    setMessages(rendered.chatMessages);
    setRenderedTurns(rendered.renderedTurns);
    upsertSession(targetSessionId, rendered.chatMessages);
    const nextCursor = toText(nextCursorHint ?? sessionNextCursor[targetSessionId]).trim();
    const hiddenInCache = rendered.totalTurnCount > rendered.visibleTurnCount;
    setSessionHasMore((prev) => ({ ...prev, [targetSessionId]: !!nextCursor || hiddenInCache }));
    return rendered;
  }

  function applyStreamMessageSnapshot(targetSessionId: string, payload: unknown) {
    if (targetSessionId !== sessionIdRef.current) return undefined;
    const incoming = Array.isArray(payload) ? payload : Array.isArray((payload as any)?.items) ? (payload as any).items : [];
    if (incoming.length === 0) return undefined;
    const prevRaw = sessionRawMapRef.current[targetSessionId] || [];
    const merged = mergeMessageRows(prevRaw, incoming);
    sessionRawMapRef.current[targetSessionId] = merged;
    const turnInfo = inspectTurnWindow(merged);
    const prevVisibleTurnCount = Math.max(0, Number(sessionVisibleTurnCountRef.current[targetSessionId] || 0));
    const nextVisibleTurnCount = computeVisibleTurnCount({
      prevVisibleTurnCount,
      totalTurnCount: turnInfo.totalTurnCount,
      requestedVisibleTurnCount: INITIAL_SESSION_LIMIT,
      initialTurnLimit: INITIAL_SESSION_LIMIT,
      olderTurnLimit: OLDER_SESSION_LIMIT,
      mode: 'default',
      userAtTop: false,
      hasNewHistoryFromCursor: false
    });
    const rendered = applyTurnWindow(targetSessionId, nextVisibleTurnCount);
    const nextQuestions = extractQuestionRequests(merged, targetSessionId).filter((req) => !dismissedQuestions.has(req.id));
    if (nextQuestions.length > 0) setQuestionRequests(nextQuestions);
    pushConnLog(`SSE messages sid=${targetSessionId} rows=${incoming.length} merged=${merged.length} turns=${turnInfo.totalTurnCount}`);
    return rendered;
  }

  function applyAssistantDelta(targetSessionId: string, payload: unknown) {
    if (targetSessionId !== sessionIdRef.current) return;
    const messageId = toText((payload as any)?.messageId || (payload as any)?.messageID).trim();
    const partId = toText((payload as any)?.partId).trim() || 'text';
    const delta = typeof (payload as any)?.delta === 'string' ? (payload as any).delta : '';
    const partTypeKey = `${targetSessionId}:${messageId}:${partId}`;
    const kind = streamPartTypeRef.current[partTypeKey] || (toText((payload as any)?.type).trim() === 'reasoning' ? 'reasoning' : 'text');
    if (!messageId || !delta) return;

    const key = normalizedDeltaKey(targetSessionId, messageId, partId, kind);
    streamPartDeltaKeyRef.current[partTypeKey] = key;
    const nextText = `${streamDeltaTextRef.current[key] || ''}${delta}`;
    streamDeltaTextRef.current[key] = nextText;
    const now = Date.now();
    upsertStreamPart(targetSessionId, messageId, {
      type: kind,
      id: partId,
      messageID: messageId,
      text: nextText
    }, now);
    renderStreamWindow(targetSessionId);
    setStreaming(true);
  }

  function normalizedDeltaKey(targetSessionId: string, messageId: string, partId: string, kind: 'text' | 'reasoning') {
    return `${targetSessionId}:${messageId}:${partId}:${kind}`;
  }

  function migrateStreamPartType(targetSessionId: string, messageId: string, partId: string, nextKind: 'text' | 'reasoning') {
    const partTypeKey = `${targetSessionId}:${messageId}:${partId}`;
    const prevDeltaKey = streamPartDeltaKeyRef.current[partTypeKey];
    const nextDeltaKey = normalizedDeltaKey(targetSessionId, messageId, partId, nextKind);
    streamPartTypeRef.current[partTypeKey] = nextKind;
    streamPartDeltaKeyRef.current[partTypeKey] = nextDeltaKey;
    if (prevDeltaKey && prevDeltaKey !== nextDeltaKey) {
      const prevText = streamDeltaTextRef.current[prevDeltaKey] || '';
      const nextText = streamDeltaTextRef.current[nextDeltaKey] || '';
      if (prevText && !nextText) streamDeltaTextRef.current[nextDeltaKey] = prevText;
      delete streamDeltaTextRef.current[prevDeltaKey];
    }
    const messageKey = `${targetSessionId}:${messageId}`;
    const partMap = streamPartMapRef.current[messageKey] || {};
    const current = partMap[partId];
    if (current) {
      const migratedText = streamDeltaTextRef.current[nextDeltaKey] || toText(current.text);
      streamPartMapRef.current[messageKey] = {
        ...partMap,
        [partId]: { ...current, type: nextKind, text: migratedText }
      };
      rewriteStreamMessageRow(targetSessionId, messageId);
    }
  }

  function renderStreamWindow(targetSessionId: string) {
    const totalTurns = Math.max(1, Number(sessionTotalTurnCountRef.current[targetSessionId] || INITIAL_SESSION_LIMIT));
    const visibleTurns = Math.max(INITIAL_SESSION_LIMIT, Number(sessionVisibleTurnCountRef.current[targetSessionId] || INITIAL_SESSION_LIMIT));
    applyTurnWindow(targetSessionId, Math.min(totalTurns, visibleTurns));
  }

  function upsertStreamPart(targetSessionId: string, messageId: string, part: any, createdAt: number = Date.now()) {
    const partId = toText(part?.id || part?.partID || part?.callID || `${part?.type || 'part'}:${Object.keys(streamPartMapRef.current[`${targetSessionId}:${messageId}`] || {}).length}`);
    if (!targetSessionId || !messageId || !partId) return;
    const key = `${targetSessionId}:${messageId}`;
    const current = streamPartMapRef.current[key] || {};
    const nextPart = { ...(current[partId] || {}), ...part, id: partId, messageID: messageId };
    streamPartMapRef.current[key] = { ...current, [partId]: nextPart };
    rewriteStreamMessageRow(targetSessionId, messageId, createdAt);
  }

  function rewriteStreamMessageRow(targetSessionId: string, messageId: string, createdAt: number = Date.now()) {
    const key = `${targetSessionId}:${messageId}`;
    const partMap = streamPartMapRef.current[key] || {};
    const parts = Object.values(streamPartMapRef.current[key]);
    const row = {
      info: {
        id: messageId,
        role: 'assistant',
        time: { created: createdAt }
      },
      parts
    };
    sessionRawMapRef.current[targetSessionId] = mergeMessageRows(sessionRawMapRef.current[targetSessionId] || [], [row]);
  }

  function applyAssistantPart(targetSessionId: string, payload: unknown) {
    if (targetSessionId !== sessionIdRef.current) return;
    const messageId = toText((payload as any)?.messageId || (payload as any)?.messageID).trim();
    const part = (payload as any)?.part;
    if (!messageId || !part || typeof part !== 'object') return;
    const partId = toText(part?.id || part?.partID || part?.callID).trim();
    const partType = toText(part?.type).trim();
    if (partId && (partType === 'text' || partType === 'reasoning')) {
      migrateStreamPartType(targetSessionId, messageId, partId, partType);
    }
    upsertStreamPart(targetSessionId, messageId, part);
    renderStreamWindow(targetSessionId);
    setStreaming(true);
  }

  function dismissQuestionRequest(requestId: string, targetSessionId: string = sessionIdRef.current) {
    const id = toText(requestId).trim();
    const sid = toText(targetSessionId).trim();
    const repo = toText(repoPath).trim();
    if (!id) return;
    setDismissedQuestions((prev) => new Set([...prev, id]));
    if (repo && sid) void saveQuestionDismissal(repo, sid, id);
  }

  async function refreshPendingQuestions(targetSessionId: string = sessionIdRef.current) {
    const sid = toText(targetSessionId).trim();
    if (!sid || !repoPath.trim()) {
      setQuestionRequests([]);
      return;
    }
    try {
      const requests = await getPendingQuestions({
        baseUrl: serverUrl,
        token,
        repoPath,
        sessionId: sid
      });
      pushConnLog(`question.list ok count=${requests.length} ids=${requests.map((r) => r.id).join(',')}`);
      // opencode /question can return cached + live copies of the same question. Prefer real que_* ids.
      const deduped = new Map<string, QuestionRequest>();
      for (const req of requests) {
        if (req.sessionID !== sid || dismissedQuestions.has(req.id)) continue;
        const tool: { messageID?: string; callID?: string } = req.tool || {};
        const key = tool.callID || tool.messageID || req.id;
        const existing = deduped.get(key);
        if (!existing || (req.id.startsWith('que_') && !existing.id.startsWith('que_'))) {
          deduped.set(key, req);
        }
      }
      const nextRequests = [...deduped.values()];
      setQuestionRequests(nextRequests);
      const liveIds = new Set(nextRequests.map((req) => req.id));
      setQuestionSubmitState((prev) => {
        const next: Record<string, QuestionSubmitState> = {};
        for (const [id, state] of Object.entries(prev)) {
          if (liveIds.has(id)) next[id] = state;
        }
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    } catch (e) {
      pushConnLog(`question.list error ${String(e)}`, 'error');
    }
  }

  function getOlderCursorBackoff(sessionKey: string, cursor: string): { retryAt: number; failures: number } | null {
    const current = olderCursorBackoffRef.current[sessionKey];
    if (!current) return null;
    if (current.cursor !== cursor) return null;
    if (current.retryAt <= Date.now()) return null;
    return { retryAt: current.retryAt, failures: current.failures };
  }

  function clearOlderCursorBackoff(sessionKey: string, cursor?: string) {
    const current = olderCursorBackoffRef.current[sessionKey];
    if (!current) return;
    if (cursor && current.cursor !== cursor) return;
    delete olderCursorBackoffRef.current[sessionKey];
    setSessionHistoryRetryHint((prev) => {
      if (!(sessionKey in prev)) return prev;
      const next = { ...prev };
      delete next[sessionKey];
      return next;
    });
  }

  function markOlderCursorFailure(sessionKey: string, cursor: string, error: unknown) {
    if (!cursor) return;
    const current = olderCursorBackoffRef.current[sessionKey];
    const failures = current && current.cursor === cursor ? current.failures + 1 : 1;
    const delayMs = Math.min(15000, 3000 * Math.max(1, failures));
    olderCursorBackoffRef.current[sessionKey] = {
      cursor,
      failures,
      retryAt: Date.now() + delayMs
    };
    setSessionHistoryRetryHint((prev) => ({
      ...prev,
      [sessionKey]: `历史加载失败，${formatRetryDelay(delayMs)}`
    }));
    pushConnLog(
      `GET messages backoff sid=${sessionKey} failures=${failures} delay=${delayMs} cursor=1 cause=${String(error)}`,
      'error'
    );
  }

  async function refreshMessages(
    targetSessionId: string,
    opts?: {
      limit?: number;
      fetchLimit?: number;
      before?: string;
      reason?: string;
    }
  ): Promise<RefreshMessagesResult | undefined> {
    if (!authed || !repoPath || !targetSessionId) return;
    const requestedLimit = Math.max(2, Number(opts?.limit || INITIAL_SESSION_LIMIT));
    const fetchLimit = Math.max(requestedLimit, Number(opts?.fetchLimit || 0));
    const before = toText(opts?.before).trim();
    const reqKey = `${targetSessionId}|${fetchLimit}|${before || '-'}`;
    const existing = inflightMessageReqRef.current[reqKey];
    if (existing) {
      return await existing;
    }
    const run = (async () => {
      try {
        pushConnLog(
          `GET messages sid=${targetSessionId} limit=${fetchLimit}${before ? ' before=cursor' : ''}${opts?.reason ? ` reason=${opts.reason}` : ''}`
        );
        const res = await fetchWithRetry({
          fetchLimit,
          hasBeforeCursor: !!before,
          fetchPage: (limit) =>
            getMessages({
              baseUrl: serverUrl,
              token,
              repoPath,
              sessionId: targetSessionId,
              limit,
              before: before || undefined
            }),
          onRetry: ({ limit, error }) => {
            pushConnLog(
              `GET messages retry sid=${targetSessionId} limit=${limit}${before ? ' before=cursor' : ''} cause=${String(error)}`,
              'error'
            );
          }
        });

        const incoming = Array.isArray(res.items) ? res.items : [];
        if (targetSessionId !== sessionIdRef.current) {
          return;
        }
        const prevRaw = sessionRawMapRef.current[targetSessionId] || [];
        const merged = mergeMessageRows(prevRaw, incoming);
        sessionRawMapRef.current[targetSessionId] = merged;
        const turnInfo = inspectTurnWindow(merged);
        const nextCursor = toText(res.nextCursor).trim();
        pushConnLog(
          `GET messages ok sid=${targetSessionId} rows=${incoming.length} merged=${merged.length} turns=${turnInfo.totalTurnCount} next=${nextCursor ? 1 : 0}`
        );
        if (before) {
          clearOlderCursorBackoff(targetSessionId, before);
        }
        setSessionNextCursor((prev) => ({ ...prev, [targetSessionId]: nextCursor }));
        return {
          nextCursor,
          incomingCount: incoming.length,
          mergedCount: merged.length,
          prevMergedCount: prevRaw.length,
          totalTurnCount: turnInfo.totalTurnCount
        };
      } catch (e) {
        if (before && opts?.reason === 'loadingOlder') {
          markOlderCursorFailure(targetSessionId, before, e);
        }
        pushConnLog(`GET messages error ${String(e)}`, 'error');
        setStatus(String(e));
        return undefined;
      }
    })();
    inflightMessageReqRef.current[reqKey] = run;
    try {
      return await run;
    } finally {
      if (inflightMessageReqRef.current[reqKey] === run) {
        delete inflightMessageReqRef.current[reqKey];
      }
    }
  }

  async function syncSessionMessages(
    targetSessionId: string,
    opts?: {
      limit?: number;
      fetchLimit?: number;
      loadingOlder?: boolean;
      before?: string;
      anchorStableKey?: string;
      forceVisibleCount?: number;
    }
  ) {
    const before = toText(opts?.before).trim();
    const mode = opts?.loadingOlder ? 'loadingOlder' : 'default';
    const syncKey = `${targetSessionId}|${mode}|${before || '-'}`;
    const existing = inflightSessionSyncRef.current[syncKey];
    if (existing) {
      return await existing;
    }

    const run = (async () => {
    const requestedVisibleTurnCount = Math.max(1, Number(opts?.limit || INITIAL_SESSION_LIMIT));
    const prevVisibleTurnCount = Math.max(0, Number(sessionVisibleTurnCountRef.current[targetSessionId] || 0));

    try {
      const res = await refreshMessages(targetSessionId, {
        limit: requestedVisibleTurnCount,
        fetchLimit: opts?.fetchLimit,
        before,
        reason: mode
      });
      const statusInfo = await syncSessionStatus(targetSessionId);
      if (!res || targetSessionId !== sessionIdRef.current) return undefined;

      const nextVisibleTurnCount = computeVisibleTurnCount({
        prevVisibleTurnCount,
        totalTurnCount: res.totalTurnCount,
        requestedVisibleTurnCount,
        initialTurnLimit: INITIAL_SESSION_LIMIT,
        olderTurnLimit: OLDER_SESSION_LIMIT,
        mode,
        forceVisibleTurnCount: opts?.forceVisibleCount,
        userAtTop: false,
        hasNewHistoryFromCursor: !!before && res.mergedCount > res.prevMergedCount
      });
      const rendered = applyTurnWindow(targetSessionId, nextVisibleTurnCount, res.nextCursor);

      const latestTurnHasError = (() => {
        const lastTurn = rendered.renderedTurns[rendered.renderedTurns.length - 1];
        if (!lastTurn) return false;
        return lastTurn.items.some((item) => item.kind === 'error');
      })();
      const statusIdle = !statusInfo || statusInfo.type === 'idle';
      if ((!rendered.writing && statusIdle) || latestTurnHasError) {
        setStreaming(false);
        setStatus((prev) => (toText(prev).includes('流式响应中') ? '' : prev));
      }
      return rendered;
    } finally {
      if (opts?.loadingOlder) {
        setLoadingOlder(false);
      }
    }
    })();
    inflightSessionSyncRef.current[syncKey] = run;
    try {
      return await run;
    } finally {
      if (inflightSessionSyncRef.current[syncKey] === run) {
        delete inflightSessionSyncRef.current[syncKey];
      }
    }
  }

  async function onLoadOlderMessages() {
    const sid = toText(sessionId).trim();
    if (!sid || loadingOlder) return;
    const cached = Math.max(0, Number(sessionTotalTurnCountRef.current[sid] || 0));
    const visible = Math.max(0, Number(sessionVisibleTurnCountRef.current[sid] || 0));
    if (cached > visible) {
      applyTurnWindow(sid, Math.min(cached, visible + OLDER_SESSION_LIMIT));
      return;
    }
    const cursor = toText(sessionNextCursor[sid]).trim();
    const backoff = cursor ? getOlderCursorBackoff(sid, cursor) : null;
    if (backoff) {
      setSessionHistoryRetryHint((prev) => ({
        ...prev,
        [sid]: `历史加载失败，${formatRetryDelay(backoff.retryAt - Date.now())}`
      }));
      return;
    }
    setLoadingOlder(true);
    if (cursor) {
      await syncSessionMessages(sid, {
        limit: OLDER_SESSION_LIMIT,
        fetchLimit: OLDER_MESSAGE_FETCH_LIMIT,
        before: cursor,
        loadingOlder: true
      });
    } else {
      setSessionHasMore((prev) => ({ ...prev, [sid]: cached > visible }));
      setLoadingOlder(false);
      return;
    }
  }

  function onMessageListScroll(y: number, viewportH?: number, contentH?: number) {
    messageScrollYRef.current = y;
    if (typeof viewportH === 'number' && Number.isFinite(viewportH)) {
      messageViewportHRef.current = viewportH;
    }
    if (typeof contentH === 'number' && Number.isFinite(contentH)) {
      messageContentHRef.current = contentH;
    }
    const distanceFromBottom = Math.max(0, messageContentHRef.current - messageViewportHRef.current - y);
    updateLatestJumpVisibility(distanceFromBottom);
  }

  function updateLatestJumpVisibility(distanceFromBottom: number, immediate = false) {
    const now = Date.now();
    const currentlyVisible = latestJumpVisibleRef.current;
    const shouldShow = distanceFromBottom > 112;
    const shouldHide = distanceFromBottom < 42 || Date.now() < forceScrollToLatestUntilRef.current;
    let next = currentlyVisible;
    if (currentlyVisible) {
      if (shouldHide) next = false;
    } else if (shouldShow) {
      next = true;
    }
    if (next === currentlyVisible) return;
    if (!immediate && now - latestJumpLastChangeRef.current < 220) return;
    latestJumpVisibleRef.current = next;
    latestJumpLastChangeRef.current = now;
    setShowLatestJump(next);
  }

  async function refreshModelCatalog(targetRepoPath?: string) {
    const repo = toText(targetRepoPath || repoPath).trim();
    if (!authed || !repo || !serverUrl) return;
    try {
      pushConnLog(`GET config repo=${repo}`);
      const cfg = await getOpencodeConfig({ baseUrl: serverUrl, token, repoPath: repo });
      const options = extractModelOptionsFromConfig(cfg);
      const prevIds = new Set(modelOptionsRef.current.map((x) => x.id));
      const hasNew = options.some((x) => !prevIds.has(x.id));
      setModelOptions(options);
      if (options.length > 0) {
        setModelCatalogStatus(`已加载 ${options.length} 个可用模型`);
      } else {
        setModelCatalogStatus('未发现可用模型（请检查服务端 provider 配置）');
      }
      const configured = String(cfg?.model || '').trim();
      const mobileActive = String(cfg?.giteamMobileModelState?.activeModel || '').trim();
      const preferred = mobileActive && mobileActive.includes('/') ? mobileActive : configured;
      if (preferred && preferred.includes('/')) {
        setModel((prev) => {
          const p = prev.trim();
          if (!p || !p.includes('/')) return preferred;
          return p;
        });
      }
      pushConnLog(`GET config ok models=${options.length}`);
      if (hasNew) triggerPulse(rightDrawerPulse);
    } catch (e) {
      pushConnLog(`GET config warn ${String(e)}`, 'info');
      setModelCatalogStatus('模型列表暂不可用，不影响会话收发');
    }
  }

  async function refreshProjectsCatalog(opts?: { baseUrl?: string; token?: string; preferredRepoPath?: string }) {
    const base = toText(opts?.baseUrl || serverUrl).trim();
    const tk = toText(opts?.token || token).trim();
    if (!base || !tk) return;
    try {
      pushConnLog('GET repository list');
      const rows = await getClientRepositories({ baseUrl: base, token: tk });
      let nextProjects = rows.map((x) => ({
        id: x.id || x.path,
        worktree: x.path,
        name: toText(x.name) || projectNameFromPath(x.path)
      }));
      if (nextProjects.length === 0) {
        pushConnLog('GET repository list empty, fallback to opencode project APIs');
        const [current, all] = await Promise.all([
          getCurrentProject({ baseUrl: base, token: tk }).catch(() => null),
          getProjects({ baseUrl: base, token: tk }).catch(() => [])
        ]);
        const merged = new Map<string, ProjectOption>();
        if (current?.worktree) {
          merged.set(current.worktree, {
            id: current.id || current.worktree,
            worktree: current.worktree,
            name: projectNameFromPath(current.worktree)
          });
        }
        for (const p of all) {
          if (!p.worktree) continue;
          merged.set(p.worktree, {
            id: p.id || p.worktree,
            worktree: p.worktree,
            name: projectNameFromPath(p.worktree)
          });
        }
        nextProjects = [...merged.values()];
      }
      const prevIds = new Set(projectsRef.current.map((x) => x.id));
      const hasNew = nextProjects.some((x) => !prevIds.has(x.id));
      setProjects(nextProjects);
      const currentRepo = toText(repoPath).trim();
      let nextRepo = toText(opts?.preferredRepoPath).trim();
      if (nextRepo && !nextProjects.some((p) => p.worktree === nextRepo)) {
        nextRepo = '';
      }
      // Keep current workspace stable on refresh; only fall back to first when current is empty.
      if (!nextRepo && currentRepo && nextProjects.some((p) => p.worktree === currentRepo)) {
        nextRepo = currentRepo;
      }
      if (!nextRepo && !currentRepo && nextProjects.length > 0) {
        nextRepo = nextProjects[0].worktree;
      }
      if (nextRepo && nextRepo !== currentRepo) {
        setRepoPath(nextRepo);
      }
      pushConnLog(`GET repository list ok count=${nextProjects.length}`);
      if (nextProjects.length === 0) {
        setStatus('未获取到可用工作空间，请检查桌面端仓库列表');
      }
      if (hasNew) triggerPulse(leftDrawerPulse);
    } catch (e) {
      pushConnLog(`GET repository list error ${String(e)}`, 'error');
      try {
        pushConnLog('GET repository list fallback(after error) to opencode project APIs');
        const [current, all] = await Promise.all([
          getCurrentProject({ baseUrl: base, token: tk }).catch(() => null),
          getProjects({ baseUrl: base, token: tk }).catch(() => [])
        ]);
        const merged = new Map<string, ProjectOption>();
        if (current?.worktree) {
          merged.set(current.worktree, {
            id: current.id || current.worktree,
            worktree: current.worktree,
            name: projectNameFromPath(current.worktree)
          });
        }
        for (const p of all) {
          if (!p.worktree) continue;
          merged.set(p.worktree, {
            id: p.id || p.worktree,
            worktree: p.worktree,
            name: projectNameFromPath(p.worktree)
          });
        }
        const fallbackProjects = [...merged.values()];
        if (fallbackProjects.length > 0) {
          setProjects(fallbackProjects);
          if (!toText(repoPath).trim()) {
            setRepoPath(fallbackProjects[0].worktree);
          }
          pushConnLog(`fallback project APIs ok count=${fallbackProjects.length}`);
        }
      } catch (fallbackErr) {
        pushConnLog(`fallback project APIs error ${String(fallbackErr)}`, 'error');
      }
    }
  }

  async function onSwitchProject(nextRepoPath: string) {
    const next = toText(nextRepoPath).trim();
    if (!next) return;
    const current = toText(repoPath).trim();
    if (current === next) return;
    stopStream();
    setRepoPath(next);
    setActiveSession('');
    setMessages([]);
    setRenderedTurns([]);
    setSessions([]);
    setSessionNextCursor({});
    setSessionHasMore({});
    setSessionHistoryRetryHint({});
    sessionRawMapRef.current = {};
    sessionOptimisticUserMapRef.current = {};
    optimisticUserIdAliasRef.current = {};
    streamDeltaTextRef.current = {};
    streamPartMapRef.current = {};
    streamPartTypeRef.current = {};
    streamPartDeltaKeyRef.current = {};
    sessionVisibleTurnCountRef.current = {};
    sessionTotalTurnCountRef.current = {};
    olderCursorBackoffRef.current = {};
    bumpOptimisticVersion();
    const pname = projectNameFromPath(next);
    setSuggestions(pickRandomQuestions(buildProjectQuestionPool(pname), 3));
    setStatus(`已切换项目: ${projectNameFromPath(next)}`);
    await refreshModelCatalog(next);
    const nextSessions = await refreshSessionsFromServer(next);
    if (nextSessions.length > 0) {
      const latest = nextSessions[0];
      setActiveSession(latest.id);
    }
  }

  function startStream(targetSessionId: string) {
    stopStream();
    if (!authed || !serverUrl || !repoPath || !targetSessionId) return;
    const streamRunId = streamRunIdRef.current;
    streamSessionRef.current = targetSessionId;
    const url = buildStreamUrl({
      baseUrl: serverUrl,
      repoPath,
      sessionId: targetSessionId,
      intervalMs: 700
    });

    const headers: Record<string, string> = {};
    if (token && token !== NO_AUTH_TOKEN) headers.Authorization = `Bearer ${token}`;
    const es = new EventSource(url, { headers } as any);
    streamRef.current = es;
    pushConnLog(`SSE connect ${url}`);
    let streamClosed = false;
    const isCurrentStream = () =>
      !streamClosed &&
      streamRunIdRef.current === streamRunId &&
      streamRef.current === es &&
      streamSessionRef.current === targetSessionId &&
      sessionIdRef.current === targetSessionId;
    let lastSyncAt = 0;
    let lastStatusSyncAt = 0;
    let lastPartSyncAt = 0;
    const syncFromServer = () => {
      if (!isCurrentStream()) return;
      const now = Date.now();
      if (now - lastSyncAt < 300) return;
      lastSyncAt = now;
      void syncSessionMessages(targetSessionId, {
        limit: INITIAL_SESSION_LIMIT,
        fetchLimit: INITIAL_MESSAGE_FETCH_LIMIT
      });
      void syncSessionStatus(targetSessionId);
    };
    const syncStatusSoon = () => {
      const now = Date.now();
      if (now - lastStatusSyncAt < 900) return;
      lastStatusSyncAt = now;
      void syncSessionStatus(targetSessionId);
    };
    const syncPartsSoon = () => {
      const now = Date.now();
      if (now - lastPartSyncAt < 900) return;
      lastPartSyncAt = now;
      void syncSessionMessages(targetSessionId, {
        limit: INITIAL_SESSION_LIMIT,
        fetchLimit: INITIAL_MESSAGE_FETCH_LIMIT
      });
    };

    es.addEventListener('open', () => {
      if (!isCurrentStream()) return;
      pushConnLog('SSE open');
      setStreaming(true);
      syncFromServer();
    });
    es.addEventListener('error', (e: any) => {
      if (!isCurrentStream()) return;
      syncFromServer();
      setStreaming(false);
      try {
        const detail = typeof e?.data === 'string' ? e.data : JSON.stringify(e);
        pushConnLog(`SSE error ${toText(detail) || 'unknown'}`, 'error');
        if (detail?.includes('invalid bearer token') && pairCode.trim()) {
          pushConnLog('SSE auto pairAuth retry');
          void pairAuth(serverUrl, pairCode)
            .then((renewed) => {
              setToken(renewed.token);
              pushConnLog('SSE auto pairAuth retry ok');
              setStatus('已自动刷新授权，请重试');
            })
            .catch((err) => {
              pushConnLog(`SSE auto pairAuth retry error ${String(err)}`, 'error');
              setStatus(String(err));
            });
        } else {
          setStatus(detail ? `流断开: ${detail}` : '流断开');
        }
      } catch {
        pushConnLog('SSE error parse failed', 'error');
        setStatus('流断开');
      }
    });
    es.addEventListener('messages' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        const payload = typeof event?.data === 'string' ? JSON.parse(event.data) : event?.data;
        const rendered = applyStreamMessageSnapshot(targetSessionId, payload);
        if (rendered) {
          setStreaming(rendered.writing);
          syncStatusSoon();
          return;
        }
      } catch (err) {
        pushConnLog(`SSE messages parse failed ${String(err)}`, 'error');
      }
      syncFromServer();
    });
    es.addEventListener('delta' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        const payload = typeof event?.data === 'string' ? JSON.parse(event.data) : event?.data;
        applyAssistantDelta(targetSessionId, payload);
        syncStatusSoon();
        syncPartsSoon();
      } catch (err) {
        pushConnLog(`SSE delta parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('part' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        const payload = typeof event?.data === 'string' ? JSON.parse(event.data) : event?.data;
        applyAssistantPart(targetSessionId, payload);
        syncStatusSoon();
      } catch (err) {
        pushConnLog(`SSE part parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('stream_fallback' as any, (event: any) => {
      if (!isCurrentStream()) return;
      pushConnLog(`SSE fallback ${toText(event?.data) || 'message-snapshot'}`);
      syncFromServer();
    });
    es.addEventListener('heartbeat' as any, () => {
      if (!isCurrentStream()) return;
      pushConnLog('SSE heartbeat');
    });
    es.addEventListener('end' as any, () => {
      if (!isCurrentStream()) return;
      pushConnLog('SSE end');
      streamClosed = true;
      sessionStatusEpochRef.current += 1;
      streamSessionRef.current = '';
      if (streamRef.current === es) {
        es.close();
        streamRef.current = null;
      }
      setStreaming(false);
      setSessionStatusMap((prev) => ({ ...prev, [targetSessionId]: { type: 'idle' } }));
      setStatus('本轮回复完成');
      void syncSessionMessages(targetSessionId, {
        limit: INITIAL_SESSION_LIMIT,
        fetchLimit: INITIAL_MESSAGE_FETCH_LIMIT
      }).finally(() => {
        if (streamRunIdRef.current !== streamRunId || sessionIdRef.current !== targetSessionId) return;
        setStreaming(false);
        setSessionStatusMap((prev) => ({ ...prev, [targetSessionId]: { type: 'idle' } }));
      });
    });
  }

  const latestTurnMeta = useMemo(() => {
    const lastTurn = renderedTurns[renderedTurns.length - 1];
    if (!lastTurn) {
      return {
        hasError: false
      };
    }
    let hasError = false;
    for (const item of lastTurn.items) {
      if (item.kind === 'error') hasError = true;
    }
    return { hasError };
  }, [renderedTurns]);

  const currentSessionStatus = useMemo(() => {
    const sid = toText(sessionId).trim();
    if (!sid) return { type: 'idle' as const };
    return sessionStatusMap[sid] || { type: 'idle' as const };
  }, [sessionId, sessionStatusMap]);

  const localPendingCount = useMemo(() => {
    const sid = toText(sessionId).trim();
    if (!sid) {
      return Object.values(sessionOptimisticUserMapRef.current).reduce((sum, items) => sum + items.length, 0);
    }
    return Array.isArray(sessionOptimisticUserMapRef.current[sid]) ? sessionOptimisticUserMapRef.current[sid].length : 0;
  }, [optimisticVersion, sessionId]);

  const localSending = localPendingCount > 0;

  const remoteSessionWorking = useMemo(() => {
    if (latestTurnMeta.hasError) return false;
    if (currentSessionStatus.type === 'busy' || currentSessionStatus.type === 'retry') return true;
    return streaming;
  }, [currentSessionStatus, latestTurnMeta.hasError, streaming]);

  const sessionWorking = useMemo(() => {
    if (localSending) return true;
    return remoteSessionWorking;
  }, [localSending, remoteSessionWorking]);

  const showThinkingPlaceholder = useMemo(() => {
    if (!sessionWorking) return false;
    if (currentSessionStatus.type === 'retry') return false;
    for (let turnIdx = renderedTurns.length - 1; turnIdx >= 0; turnIdx -= 1) {
      const turn = renderedTurns[turnIdx];
      for (let itemIdx = turn.items.length - 1; itemIdx >= 0; itemIdx -= 1) {
        if (turn.items[itemIdx].kind === 'error') return false;
      }
      if (turn.userMessage) break;
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
    return true;
  }, [currentSessionStatus.type, messages, renderedTurns, sessionWorking]);

  const displayedTurns = renderedTurns;
  const messageBottomInset = Math.max(140, inputDockHeight + 44);

  const liveQuestionTurnId = useMemo(() => {
    for (let i = renderedTurns.length - 1; i >= 0; i -= 1) {
      const turn = renderedTurns[i];
      for (const item of turn.items) {
        if (item.kind === 'question') return turn.id;
      }
    }
    return '';
  }, [renderedTurns]);

  const activeQuestionsForTurn = useMemo(() => {
    if (!liveQuestionTurnId) return [];
    const turn = renderedTurns.find((t) => t.id === liveQuestionTurnId);
    if (!turn) return [];
    return turn.items
      .filter((item): item is Extract<typeof item, { kind: 'question' }> => item.kind === 'question')
      .map((item) => item.question);
  }, [liveQuestionTurnId, renderedTurns]);



  const latestTodoCard = useMemo(() => {
    for (let turnIdx = displayedTurns.length - 1; turnIdx >= 0; turnIdx -= 1) {
      const turn = displayedTurns[turnIdx];
      for (let itemIdx = turn.items.length - 1; itemIdx >= 0; itemIdx -= 1) {
        const item = turn.items[itemIdx];
        if (item.kind === 'todo') return item.todo;
      }
    }
    return null;
  }, [displayedTurns]);

  const activeQuestionRequest = useMemo(() => questionRequests[0] || null, [questionRequests]);
  const promptText = toText(prompt).trim();
  const composerWillAbort = sessionWorking && !promptText;

  useEffect(() => {
    if (!latestTodoCard) {
      setTodoDockCollapsed(false);
      return;
    }
    if (dismissedTodoCardId && latestTodoCard.id !== dismissedTodoCardId) {
      setDismissedTodoCardId('');
    }
    if (sessionWorking) {
      setTodoDockCollapsed(false);
      return;
    }
    setTodoDockCollapsed(true);
  }, [dismissedTodoCardId, latestTodoCard?.id, latestTodoCard?.summary, latestTodoCard?.finished, sessionWorking]);

  async function connectWithAddressAndCode(
    inputBaseUrl: string,
    inputCode: string,
    opts?: { preferredRepoPath?: string; payloadRepoPaths?: string[]; discoveredDevice?: DiscoveredDevice }
  ) {
    const nextUrl = normalizeBaseUrlForClient(toText(inputBaseUrl).trim(), {
      defaultScheme: opts?.payloadRepoPaths ? undefined : (preferHttps ? 'https' : 'http')
    });
    const nextCode = toText(inputCode).trim();
    const mode = opts?.payloadRepoPaths ? 'payload' : 'manual';
    if (!nextUrl) {
      setStatus('请输入服务地址');
      return;
    }
    setBusy(true);
    try {
      pushConnLog(`auth connect mode=${mode} url=${nextUrl} code=${nextCode ? 'yes' : 'no'}`);
      const ping = await health(nextUrl);
      pushConnLog(`health ok service=${toText((ping as any)?.service?.host)}:${toText((ping as any)?.service?.port)}`);
      const serverNoAuth = Boolean((ping as any)?.auth?.noAuth);
      if (!serverNoAuth && !nextCode) {
        // 缺少验证码是可恢复的用户输入问题，不应当作为 error 日志刷屏
        setStatus('该设备需要验证码，请输入验证码后重试');
        pushConnLog('pair code required by server (need user input)', 'info');
        return;
      }
      let nextToken = NO_AUTH_TOKEN;
      if (!serverNoAuth && nextCode) {
        const res = await pairAuth(nextUrl, nextCode);
        nextToken = toText(res.token).trim();
      }
      setServerUrl(nextUrl);
      setPairCode(nextCode);
      setToken(nextToken);
      setRepoPath('');
      if (opts?.payloadRepoPaths && opts.payloadRepoPaths.length > 0) {
        const fromPayload = toProjectOptionsFromPaths(opts.payloadRepoPaths);
        setProjects(fromPayload);
        const preferred = toText(opts.preferredRepoPath).trim() || fromPayload[0].worktree;
        if (preferred) setRepoPath(preferred);
        pushConnLog(`project list from payload count=${fromPayload.length}`);
      } else {
        await refreshProjectsCatalog({ baseUrl: nextUrl, token: nextToken, preferredRepoPath: opts?.preferredRepoPath });
      }
      Vibration.vibrate([0, 60, 40, 80]);
      setStatus('认证成功，开始新会话');
      setScannerOpen(false);
      setDiscoverOpen(false);
    } catch (e) {
      Vibration.vibrate(220);
      const errText = toText(e);
      pushConnLog(`auth connect error ${errText}`, 'error');
      const pairCodeRequired = /pair code required|required by server|需要验证码/i.test(errText);
      const pairCodeRejected = /pair code|expired|invalid|验证码|过期/i.test(errText);
      if (opts?.discoveredDevice && (pairCodeRequired || pairCodeRejected)) {
        reopenPairPromptForDevice(
          opts.discoveredDevice,
          pairCodeRejected ? '历史验证码已失效，请重新输入验证码' : '该设备需要验证码，请输入验证码后连接'
        );
      } else if (!nextCode && /missing bearer token|invalid bearer token|401/i.test(errText)) {
        setStatus('服务端当前需要验证码，请输入验证码后重试');
      } else if (pairCodeRequired) {
        setStatus('该设备需要验证码，请在首页输入验证码后重试');
      } else if (pairCodeRejected) {
        setStatus('验证码无效或已过期，请检查后重试');
      } else {
        setStatus(errText);
      }
      setScannerLocked(false);
    } finally {
      setBusy(false);
    }
  }

  async function applyPayloadAndPair(raw: string) {
    pushConnLog(`pair payload input len=${raw.trim().length}`);
    setStatus('二维码已识别，正在校验...');
    const payload = parsePairPayload(raw);
    if (!payload) {
      pushConnLog('pair payload invalid JSON/URL', 'error');
      Vibration.vibrate(180);
      setStatus('二维码内容格式无效');
      setScannerLocked(false);
      return;
    }
    const nextUrl = normalizeBaseUrlForClient(String(payload.baseUrl || '').trim(), {
      defaultScheme: preferHttps ? 'https' : 'http'
    });
    const mode = String(payload.authMode || '').trim().toLowerCase();
    const nextCode = mode === 'none' ? '' : String(payload.pairCode || payload.code || '').trim();
    const nextRepo = String(payload.repoPath || '').trim();
    const nextRepoPaths = getRepoPathsFromPairPayload(payload);
    if (!nextUrl) {
      setStatus('二维码缺少服务地址');
      setScannerLocked(false);
      return;
    }
    await connectWithAddressAndCode(nextUrl, nextCode, {
      preferredRepoPath: nextRepo,
      payloadRepoPaths: nextRepoPaths
    });
  }

  async function startDiscover() {
    discoverAbortRef.current?.abort();
    const abortCtrl = new AbortController();
    discoverAbortRef.current = abortCtrl;
    const runId = Date.now();
    discoverRunRef.current = runId;
    discoveringRef.current = true;
    setDiscoveringUi(true);
    const hardStopAt = Date.now() + DISCOVER_SWEEP_HARDSTOP_MS;
    const local = await getLocalIpv4Prefix();
    // 只扫描手机当前 IPv4 的前三段网段；不再扫描其它默认前缀
    const pickPrefixFromText = (seed: string): string => {
      const text = String(seed || '').trim();
      if (!text) return '';
      try {
        const withScheme = text.startsWith('http://') || text.startsWith('https://') ? text : `http://${text}`;
        const host = new URL(withScheme).hostname;
        const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
        return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
      } catch {
        const host = text.split('/')[0]?.split(':')[0] || '';
        const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
        return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
      }
    };
    const prefixFromSeed = pickPrefixFromText(serverUrl);
    const prefixFromCache = (() => {
      const rows = Object.values(discoverCacheRef.current || {});
      if (rows.length === 0) return '';
      const best = rows.slice().sort((a, b) => (Number(b.lastSeen || 0) || 0) - (Number(a.lastSeen || 0) || 0))[0];
      return best?.host ? pickPrefixFromText(best.host) : '';
    })();
    const chosenPrefix = local?.prefix || prefixFromSeed || prefixFromCache || inferDiscoveryPrefixes(serverUrl)[0] || '';
    const prefixes = chosenPrefix ? [chosenPrefix] : [];
    const port = resolvePortFromSeed(serverUrl, 4100);
    const seedLast = inferSeedLastSegment(serverUrl);
    const hostOrder = buildHostOrder(seedLast);
    pushDiscoverLog(
      `开始扫描 localIp=${local?.ip || 'n/a'} prefixes=${prefixes.join(',')} port=${port} seedLast=${seedLast} workers<=${DISCOVER_WORKER_LIMIT}`
    );
    const hosts: string[] = [];
    for (const pre of prefixes) {
      for (const i of hostOrder) hosts.push(`${pre}.${i}`);
    }
    if (hosts.length === 0) {
      pushDiscoverLog('扫描队列为空（未推断出网段前缀）', 'error');
      discoveringRef.current = false;
      return;
    }
    const hostSet = new Set(hosts);
    const cachedHosts = Object.values(discoverCacheRef.current)
      .filter((d) => d.port === port && hostSet.has(d.host) && !discoverPriorityDoneRef.current.has(d.host))
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((d) => d.host);
    const cachedHostSet = new Set(cachedHosts);
    const keepaliveHosts = Object.values(discoverCacheRef.current)
      .filter((d) => d.port === port && hostSet.has(d.host) && !cachedHostSet.has(d.host))
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, DISCOVER_KEEPALIVE_HOSTS_PER_SWEEP)
      .map((d) => d.host);
    const keepaliveHostSet = new Set(keepaliveHosts);
    const allCachedHostSet = new Set(
      Object.values(discoverCacheRef.current)
        .filter((d) => d.port === port && hostSet.has(d.host))
        .map((d) => d.host)
    );
    const offset = discoverSweepOffsetRef.current % hosts.length;
    const rotatedHosts = offset > 0 ? [...hosts.slice(offset), ...hosts.slice(0, offset)] : hosts;
    const queueHosts = [
      ...cachedHosts,
      ...keepaliveHosts,
      ...rotatedHosts.filter((h) => !allCachedHostSet.has(h) && !cachedHostSet.has(h) && !keepaliveHostSet.has(h))
    ];
    for (const h of cachedHosts) discoverPriorityDoneRef.current.add(h);
    let cursor = 0;
    const workers = Math.min(DISCOVER_WORKER_LIMIT, queueHosts.length);
    const found = new Map<string, { host: string; port: number; noAuth: boolean; baseUrl: string }>();
    const runWorker = async () => {
      while (cursor < queueHosts.length && discoverRunRef.current === runId && Date.now() < hardStopAt) {
        if (abortCtrl.signal.aborted) return;
        const idx = cursor++;
        const host = queueHosts[idx];
        let healthInfo: any | null = null;
        let baseUrl = '';
        const candidate = `http://${host}:${port}`;
        try {
          healthInfo = await probeHealthFast(candidate, 760, abortCtrl.signal);
        } catch (e) {
          pushDiscoverLog(`probe 异常 host=${host} err=${toText(e)}`, 'error');
          healthInfo = null;
        }
        if (healthInfo) {
          baseUrl = candidate;
        }
        if (!healthInfo || !baseUrl) continue;
        const key = `${host}:${port}`;
        if (found.has(key)) continue;
        found.set(key, {
          host,
          port,
          noAuth: Boolean(healthInfo?.auth?.noAuth),
          baseUrl
        });
        pushDiscoverLog(`命中 ${key} noAuth=${Boolean(healthInfo?.auth?.noAuth)}`);
      }
    };
    try {
      await Promise.all(Array.from({ length: workers }, () => runWorker()));
      if (discoverRunRef.current !== runId || abortCtrl.signal.aborted) return;
      discoverSweepOffsetRef.current = (offset + Math.max(1, cursor)) % hosts.length;
      const rows = [...found.values()].sort((a, b) => a.host.localeCompare(b.host, 'en'));
      const now = Date.now();
      const foundIds = new Set<string>();
      if (rows.length === 0) {
        pushDiscoverLog(`本轮未发现设备（已探测 ${Math.min(cursor, queueHosts.length)}/${queueHosts.length} host，超时=${Date.now() >= hardStopAt ? '是' : '否'}）`);
      } else {
        pushDiscoverLog(`本轮发现 ${rows.length} 台设备`);
      }
      for (let i = 0; i < rows.length; i += 1) {
        if (i > 0 && i % DISCOVER_POST_PROCESS_CHUNK === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (discoverRunRef.current !== runId || abortCtrl.signal.aborted) return;
        }
        const r = rows[i];
        const id = `${r.host}:${r.port}`;
        foundIds.add(id);
        const prev = discoverCacheRef.current[id];
        const point =
          discoverPointRef.current[id] ||
          (prev ? { x: prev.x, y: prev.y } : clampRadarPoint(pickRadarPoint(radarBox.width, radarBox.height, Object.keys(discoverCacheRef.current).length + 1), radarBox.width, radarBox.height, 34));
        discoverPointRef.current[id] = point;
        if (!discoverOrbitRef.current[id]) {
          discoverOrbitRef.current[id] = { phase: Math.random() * 360, radius: 10 + Math.random() * 12 };
        }
        discoverCacheRef.current[id] = {
          id,
          baseUrl: r.baseUrl,
          host: r.host,
          port: r.port,
          noAuth: r.noAuth,
          x: point.x,
          y: point.y,
          lastSeen: now,
          offline: false
        };
        discoverMissRef.current[id] = 0;
      }

      // 性能优化：如果本轮发现了设备，优先只渲染“本轮发现列表”，
      // 避免把大量历史缓存设备也参与排序/渲染导致卡顿。
      if (!abortCtrl.signal.aborted && rows.length > 0) {
        const nextFoundOnly = rows
          .map((r) => discoverCacheRef.current[`${r.host}:${r.port}`])
          .filter(Boolean)
          .sort((a, b) => a.host.localeCompare(b.host, 'en'));
        setDiscoverDevices((prev) => (isSameDiscoverRenderList(prev, nextFoundOnly) ? prev : nextFoundOnly));
        scheduleDiscoverCacheSave(nextFoundOnly, abortCtrl.signal);
      }

      // 把“离线标记”放到交互空闲后再做，避免扫描结束瞬间卡顿
      const snapshotRunId = runId;
      const snapshotFoundIds = new Set(foundIds);
      void Promise.resolve(
        InteractionManager.runAfterInteractions(() => {
          if (discoverRunRef.current !== snapshotRunId || abortCtrl.signal.aborted) return;
          const cacheEntries = Object.entries(discoverCacheRef.current);
          const now2 = Date.now();
          for (let i = 0; i < cacheEntries.length; i += 1) {
            const [id, d] = cacheEntries[i];
            if (snapshotFoundIds.has(id)) continue;
            const miss = (discoverMissRef.current[id] || 0) + 1;
            discoverMissRef.current[id] = miss;
            const stale = now2 - (Number(d.lastSeen || 0) || 0) > DISCOVER_OFFLINE_AFTER_MS;
            const shouldOffline = stale && miss >= DISCOVER_OFFLINE_MISS_THRESHOLD;
            if (d.offline !== shouldOffline) discoverCacheRef.current[id] = { ...d, offline: shouldOffline };
          }
        })
      ).catch(() => {
        // ignore
      });
      // 如果本轮没发现设备，再回落到展示历史缓存（含离线标记）
      if (rows.length === 0) {
        const next = Object.values(discoverCacheRef.current)
          .sort((a, b) => {
            if (a.offline !== b.offline) return a.offline ? 1 : -1;
            return a.host.localeCompare(b.host, 'en');
          })
          .slice(0, 120);
        if (abortCtrl.signal.aborted) return;
        setDiscoverDevices((prev) => (isSameDiscoverRenderList(prev, next) ? prev : next));
        scheduleDiscoverCacheSave(next, abortCtrl.signal);
      }
    } catch (e) {
      pushDiscoverLog(`扫描流程异常：${toText(e)}`, 'error');
    } finally {
      if (discoverAbortRef.current === abortCtrl) {
        discoverAbortRef.current = null;
      }
      if (discoverRunRef.current === runId) {
        discoveringRef.current = false;
      }
      if (discoverRunRef.current === runId) {
        setDiscoveringUi(false);
      } else {
        // 如果被下一轮覆盖，也需要尽快关掉“扫描中”提示
        setDiscoveringUi(false);
      }
    }
  }

  function onOpenDiscover() {
    setHoveredDeviceId('');
    setSelectedDiscoverId('');
    discoverPriorityDoneRef.current = new Set();
    setDiscoverStageReady(false);
    setDiscoverLogs([]);
    pushDiscoverLog('打开发现设备界面');
    const cached = Object.values(discoverCacheRef.current)
      .sort((a, b) => {
        if (a.offline !== b.offline) return a.offline ? 1 : -1;
        return a.host.localeCompare(b.host, 'en');
      })
      .slice(0, 120);
    if (cached.length > 0) {
      setDiscoverDevices(cached);
    }
    discoverSweepOffsetRef.current = 0;
    setDiscoverOpen(true);
  }

  function onCloseDiscover() {
    if (discoverSaveTimerRef.current) {
      clearTimeout(discoverSaveTimerRef.current);
      discoverSaveTimerRef.current = null;
    }
    discoverPendingSaveRef.current = null;
    discoverAbortRef.current?.abort();
    discoverAbortRef.current = null;
    discoverRunRef.current = 0;
    discoverPointRef.current = {};
    discoverOrbitRef.current = {};
    discoverSweepOffsetRef.current = 0;
    discoverPriorityDoneRef.current = new Set();
    discoverMissRef.current = {};
    discoverRevealRef.current = {};
    discoverLayoutRef.current = {};
    discoverDriftRef.current = {};
    setHoveredDeviceId('');
    setSelectedDiscoverId('');
    setDiscoverStageReady(false);
    discoveringRef.current = false;
    pushDiscoverLog('关闭发现设备界面');
    setDiscoverOpen(false);
  }

  function openPairPrompt(item: DiscoveredDevice) {
    setPairPromptDevice(item);
    const key = deviceKeyOf(item);
    const cached = key ? toText(pairCodeMapRef.current[key]).trim() : '';
    setPairPromptValue(cached || '');
    setPairPromptOpen(true);
  }

  function clearPairCodeForDevice(item: { host: string; port: number } | null | undefined) {
    const key = deviceKeyOf(item);
    if (!key) return;
    if (!(key in (pairCodeMapRef.current || {}))) return;
    const next = { ...(pairCodeMapRef.current || {}) };
    delete next[key];
    pairCodeMapRef.current = next;
    void savePairCodeMap(next);
  }

  function reopenPairPromptForDevice(item: DiscoveredDevice, statusText: string) {
    clearPairCodeForDevice(item);
    setPairPromptDevice(item);
    setPairPromptValue('');
    setPairPromptOpen(true);
    setStatus(statusText);
  }

  async function onConnectDiscoveredDevice(item: DiscoveredDevice, codeOverride?: string) {
    const hostWithPort = (() => {
      try {
        const u = new URL(item.baseUrl);
        return u.host || `${item.host}:${item.port}`;
      } catch {
        return `${item.host}:${item.port}`;
      }
    })();
    setServerUrlTouched(true);
    setServerUrl(hostWithPort);
    setPreferHttps(item.baseUrl.startsWith('https://'));
    const key = deviceKeyOf(item);
    const cached = key ? toText(pairCodeMapRef.current[key]).trim() : '';
    const code = (codeOverride ?? cached ?? pairCode).trim();
    await connectWithAddressAndCode(item.baseUrl, code, { discoveredDevice: item });
  }

  async function onConnectSelectedDiscover() {
    const item = selectedDiscoverDevice;
    if (!item) return;
    if (connectingDiscoverId === item.id) return;
    setConnectingDiscoverId(item.id);
    connectProgressAnim.setValue(0);
    await new Promise<void>((resolve) => {
      Animated.timing(connectProgressAnim, {
        toValue: 1,
        duration: 620,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }).start(() => resolve());
    });
    try {
      await onConnectDiscoveredDevice(item);
    } finally {
      setConnectingDiscoverId('');
      connectProgressAnim.setValue(0);
    }
  }

  async function onOpenScanner() {
    if (Platform.OS === 'web') {
      pushConnLog('open scanner on web blocked');
      setStatus('Web 端暂不支持扫码，请在手机端使用扫码连接');
      return;
    }
    if (!cameraPermission?.granted) {
      const req = await requestCameraPermission();
      if (!req.granted) {
        pushConnLog('camera permission denied', 'error');
        setStatus('相机权限被拒绝');
        return;
      }
    }
    setScannerReady(false);
    pushConnLog('scanner opened');
    setStatus('扫码器已打开，等待识别二维码...');
    setScannerLocked(false);
    setScannerOpen(true);
  }

  async function onPickQrFromAlbum() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        const msg = '相册权限被拒绝';
        setStatus(msg);
        pushConnLog(msg, 'error');
        return;
      }
      const pick = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1
      });
      if (pick.canceled || !pick.assets?.[0]?.uri) {
        setStatus('已取消选择图片');
        return;
      }
      const uri = String(pick.assets[0].uri || '').trim();
      if (!uri) {
        setStatus('未拿到图片 URI');
        return;
      }
      setScannerLocked(true);
      setStatus('正在识别相册二维码...');
      pushConnLog(`scanFromURL start uri=${uri.slice(0, 120)}`);
      const rows: any[] = await scanFromURLAsync(uri, ['qr'] as any);
      pushConnLog(`scanFromURL result count=${rows.length}`);
      if (!rows.length) {
        Vibration.vibrate(180);
        setScannerLocked(false);
        setStatus('图片中未识别到二维码');
        return;
      }
      const first = rows[0];
      const data = String(first?.data || '').trim();
      if (!data) {
        Vibration.vibrate(180);
        setScannerLocked(false);
        setStatus('二维码内容为空');
        return;
      }
      setScanHitCount((v) => v + 1);
      setLastScanAt(Date.now());
      Vibration.vibrate(30);
      await applyPayloadAndPair(data);
    } catch (e) {
      const msg = `相册识别失败: ${String(e)}`;
      setStatus(msg);
      pushConnLog(msg, 'error');
      setScannerLocked(false);
    }
  }

  function onBarcodeScanned(result: any) {
    if (scannerLocked) return;
    setScannerLocked(true);
    Vibration.vibrate(30);
    setScanHitCount((v) => v + 1);
    setLastScanAt(Date.now());
    const data = String(result?.data || '').trim();
    setStatus('已捕获二维码，正在解析...');
    pushConnLog(`qr scanned len=${data.length}`);
    if (!data) {
      pushConnLog('qr scan empty payload', 'error');
      setStatus('未识别到有效二维码内容');
      setScannerLocked(false);
      return;
    }
    void applyPayloadAndPair(data);
  }

  async function onAuthSubmit() {
    await connectWithAddressAndCode(serverUrl, pairCode);
  }

  async function onSendPrompt(customPrompt?: string) {
    const payloadPrompt = (customPrompt ?? prompt).trim();
    if (!authed) {
      setStatus('请先授权');
      return;
    }
    if (!repoPath.trim()) {
      setStatus('未选择项目，请在左侧抽屉切换项目');
      return;
    }
    if (!payloadPrompt) {
      setStatus('请输入消息');
      return;
    }
    setBusy(true);
    const optimisticAt = Date.now();
    const optimisticMessage: OptimisticUserMessage = {
      id: `local:${optimisticAt}`,
      text: payloadPrompt,
      createdAt: optimisticAt
    };
    try {
      let targetSessionId = toText(sessionIdRef.current).trim();
      const normalizedModel = model.trim();
      const requestModel = normalizedModel && normalizedModel.includes('/') ? normalizedModel : undefined;
      if (!targetSessionId) {
        pushConnLog(`POST session.create model=${requestModel || '(default)'}`);
        const created = await createSession({
          baseUrl: serverUrl,
          token,
          repoPath,
          title: payloadPrompt.slice(0, 24) || '新会话'
        });
        targetSessionId = created.id;
        setActiveSession(targetSessionId);
      }
      setChatListResetKey((value) => value + 1);
      upsertOptimisticUserMessage(targetSessionId, optimisticMessage);
      appendOptimisticTurnAndStick(optimisticMessage);
      setPrompt('');
      startStream(targetSessionId);
      pushConnLog(`POST prompt sid=${targetSessionId} model=${requestModel || '(default)'}`);
      const res = await sendPrompt({
        baseUrl: serverUrl,
        token,
        repoPath,
        prompt: payloadPrompt,
        sessionId: targetSessionId,
        model: requestModel
      });
      setActiveSession(res.sessionId);
      void syncSessionMessages(res.sessionId, {
        limit: INITIAL_SESSION_LIMIT,
        fetchLimit: INITIAL_MESSAGE_FETCH_LIMIT
      });
      void refreshSessionsFromServer();
      pushConnLog(`POST prompt ok sid=${res.sessionId}`);
      setStatus('已发送');
    } catch (e) {
      const currentSessionId = toText(sessionIdRef.current).trim();
      if (currentSessionId) {
        dropOptimisticUserMessage(currentSessionId, optimisticMessage.id);
      }
      if (customPrompt === undefined) setPrompt((prev) => prev || payloadPrompt);
      const msg = String(e);
      pushConnLog(`POST prompt error ${msg}`, 'error');
      if (msg.includes('invalid bearer token') && pairCode.trim()) {
        try {
          pushConnLog('prompt auto pairAuth retry');
          const renewed = await pairAuth(serverUrl, pairCode);
          setToken(renewed.token);
          pushConnLog('prompt auto pairAuth retry ok');
          setStatus('已刷新授权，请重试发送');
        } catch (retryErr) {
          pushConnLog(`prompt auto pairAuth retry error ${String(retryErr)}`, 'error');
          setStatus(String(retryErr));
        }
      } else {
        setStatus(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onAbort() {
    const sid = toText(sessionIdRef.current).trim();
    if (!authed || !sid) {
      setStatus('没有可中断的会话');
      return;
    }
    setBusy(true);
    stopStream();
    clearSessionOptimisticMessages(sid);
    setSessionStatusMap((prev) => ({ ...prev, [sid]: { type: 'idle' } }));
    try {
      pushConnLog(`POST abort sid=${sid}`);
      await abortSession({
        baseUrl: serverUrl,
        token,
        repoPath,
        sessionId: sid
      });
      setStatus('已请求中断');
      await syncSessionMessages(sid, { limit: INITIAL_SESSION_LIMIT });
      void syncSessionStatus(sid);
      pushConnLog('POST abort ok');
    } catch (e) {
      pushConnLog(`POST abort error ${String(e)}`, 'error');
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyMessageText(text: string) {
    const value = toText(text).trim();
    if (!value) return;
    try {
      await Clipboard.setStringAsync(value);
      Vibration.vibrate(10);
      setStatus('已复制消息内容');
    } catch (e) {
      setStatus(`复制失败: ${String(e)}`);
    }
  }

  function onNewSession() {
    stopStream();
    const oldSid = toText(sessionIdRef.current).trim();
    setActiveSession('');
    setMessages([]);
    setRenderedTurns([]);
    bumpOptimisticVersion();
    setSessionHistoryRetryHint((prev) => {
      if (!oldSid || !(oldSid in prev)) return prev;
      const next = { ...prev };
      delete next[oldSid];
      return next;
    });
    setSessionNextCursor((prev) => {
      const next = { ...prev };
      if (oldSid) delete next[oldSid];
      return next;
    });
    setSessionHasMore((prev) => {
      const next = { ...prev };
      if (oldSid) delete next[oldSid];
      return next;
    });
    if (oldSid) {
      const nextRaw = { ...sessionRawMapRef.current };
      delete nextRaw[oldSid];
      sessionRawMapRef.current = nextRaw;
    }
    const pname = projectNameFromPath(repoPath);
    setSuggestions(pickRandomQuestions(buildProjectQuestionPool(pname), 3));
    setStatus('新会话已创建');
  }

  function onResetAuth() {
    stopStream();
    setToken('');
    setPairCode('');
    setRepoPath('');
    setProjects([]);
    setActiveSession('');
    setMessages([]);
    setRenderedTurns([]);
    setSessionNextCursor({});
    setSessionHasMore({});
    setSessionHistoryRetryHint({});
    sessionRawMapRef.current = {};
    sessionOptimisticUserMapRef.current = {};
    optimisticUserIdAliasRef.current = {};
    streamDeltaTextRef.current = {};
    streamPartMapRef.current = {};
    streamPartTypeRef.current = {};
    streamPartDeltaKeyRef.current = {};
    sessionVisibleTurnCountRef.current = {};
    sessionTotalTurnCountRef.current = {};
    olderCursorBackoffRef.current = {};
    bumpOptimisticVersion();
    setAuthAsciiBrand(pickRandomAuthAsciiBrand());
    setStatus('已退出授权');
    pushConnLog('reset auth');
  }

  const launchOverlay = launchOverlayVisible ? (
    <Animated.View pointerEvents="none" style={[styles.launchOverlay, { opacity: launchOverlayOpacity }]}> 
      <GiteamLaunchMark />
    </Animated.View>
  ) : null;

  if (!loaded) {
    return (
      <View style={styles.launchScreen}>
        <GiteamLaunchMark />
      </View>
    );
  }

  if (discoverOpen) {
    const connectProgressScaleX = connectProgressAnim.interpolate({ inputRange: [0, 1], outputRange: [0.12, 1] });
    const deviceRows: DiscoverListRow[] = discoverDevices.map((d) => ({
      id: d.id,
      host: d.host,
      port: d.port,
      noAuth: d.noAuth,
      offline: d.offline
    }));
    return (
      <RenderBoundary name="discover-screen">
        <DiscoverListScreen
          styles={styles}
          title="发现设备"
          discoveringUi={discoveringUi}
          devices={deviceRows}
          connectingDiscoverId={connectingDiscoverId}
          connectProgressScaleX={connectProgressScaleX}
          pairPromptOpen={pairPromptOpen && !!pairPromptDevice}
          pairPromptHostPort={pairPromptDevice ? `${pairPromptDevice.host}:${pairPromptDevice.port}` : ''}
          pairPromptValue={pairPromptValue}
          onBack={onCloseDiscover}
          onRescan={() => void startDiscover()}
          onConnectPress={(item) => {
            if (item.offline) return;
            if (!item.noAuth) {
              const key = `${item.host}:${item.port}`;
              const cached = toText(pairCodeMapRef.current[key]).trim();
              if (!cached) {
                const found = discoverDevices.find((d) => d.id === item.id) || null;
                if (found) openPairPrompt(found);
                return;
              }
            }
            const found = discoverDevices.find((d) => d.id === item.id) || null;
            if (found) void onConnectDiscoveredDevice(found);
          }}
          onPairPromptChange={setPairPromptValue}
          onPairPromptCancel={() => {
            setPairPromptOpen(false);
            setPairPromptDevice(null);
          }}
          onPairPromptConfirm={() => {
            const code = pairPromptValue.trim();
            if (!code) {
              setStatus('请输入验证码');
              return;
            }
            const dev = pairPromptDevice;
            const key = deviceKeyOf(dev);
            if (key) {
              const next = { ...(pairCodeMapRef.current || {}) };
              next[key] = code;
              pairCodeMapRef.current = next;
              void savePairCodeMap(next);
            }
            setPairPromptOpen(false);
            setPairPromptDevice(null);
            if (dev) void onConnectDiscoveredDevice(dev, code);
          }}
        />
      </RenderBoundary>
    );
  }

  if (scannerOpen) {
    return (
      <ScannerScreen
        styles={styles}
        title="扫码连接桌面端"
        subtitle="扫描设置页中的二维码即可授权"
        hint1={scannerReady ? (scannerLocked ? '已识别，处理中...' : '识别器已就绪，请将二维码放入框内') : '正在初始化相机...'}
        hint2={`识别回调次数: ${scanHitCount} ${lastScanAt ? `· 最近: ${formatClock(lastScanAt)}` : ''}`}
        hint3="如果实时扫描无反应，可点“相册识别”作为兜底。"
        statusText={toText(status)}
        onCancel={() => setScannerOpen(false)}
        onPickFromAlbum={() => void onPickQrFromAlbum()}
        onRescan={() => {
          setScannerLocked(false);
          setStatus('请继续扫码');
        }}
        CameraViewCompat={CameraViewCompat}
        onCameraReady={() => {
          setScannerReady(true);
          pushConnLog('camera ready');
        }}
        onMountError={(e: any) => {
          const msg = `camera mount error: ${toText(e?.message || e)}`;
          pushConnLog(msg, 'error');
          setStatus(msg);
        }}
        onBarcodeScanned={onBarcodeScanned}
        scannerReady={scannerReady}
        scannerLocked={scannerLocked}
        scanHitCountText=""
      />
    );
  }

  if (!authed) {
    const showAuthNotice = busy || (statusText && statusText.trim() && statusText.trim() !== '准备就绪');
    return (
      <SafeAreaView style={styles.safe}>
        <RenderBoundary name="auth-screen">
        <StatusBar barStyle="dark-content" />
          <ScrollView style={styles.authScroll} contentContainerStyle={styles.authContainerCenter} keyboardShouldPersistTaps="handled">
            <View style={styles.authPageFrame}>
              <View style={styles.authFormWrap}>
                <View style={styles.authAsciiSlot} onLayout={onAuthAsciiSlotLayout}>
                  <Text
                    allowFontScaling={false}
                    maxFontSizeMultiplier={1}
                    textBreakStrategy="simple"
                    style={[styles.authAsciiBrand, authAsciiTextStyle]}
                  >
                    {authAsciiDisplay}
                  </Text>
                </View>
                <Text style={styles.authSub}>连接远程客户端</Text>

                <View style={styles.authFieldGroup}>
                  <Text style={styles.authFieldLabel}>服务地址</Text>
                  <View style={styles.authUrlRow}>
                    <TextInput
                      style={styles.authInputUrl}
                      value={serverUrl}
                      onChangeText={onChangeServerUrl}
                      autoCapitalize="none"
                      placeholder="输入 IP:端口（如 192.168.1.8:4100）"
                      placeholderTextColor="#9aa6b6"
                    />
                    <Pressable style={styles.authScanInlineBtn} onPress={onOpenScanner}>
                      <View style={styles.authScanIconFrame}>
                        <View style={styles.authScanIconLt} />
                        <View style={styles.authScanIconRt} />
                        <View style={styles.authScanIconLb} />
                        <View style={styles.authScanIconRb} />
                      </View>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.authFieldGroup}>
                  <Text style={styles.authFieldLabel}>验证码（选填）</Text>
                  <TextInput
                    style={styles.authInput}
                    value={pairCode}
                    onChangeText={setPairCode}
                    autoCapitalize="none"
                    keyboardType="number-pad"
                    placeholder="输入验证码，免授权模式可留空"
                    placeholderTextColor="#9aa6b6"
                  />
                </View>
                <View style={styles.authTinyRowBottom}>
                  <Pressable style={styles.authTinyCheckWrap} onPress={() => setPreferHttps((v) => !v)}>
                    <View style={preferHttps ? styles.authTinyCheckOn : styles.authTinyCheckOff} />
                    <Text style={styles.authTinyText}>使用 HTTPS 连接</Text>
                  </Pressable>
                  <Pressable style={styles.authTinyLinkBtn} onPress={onOpenDiscover} disabled={busy}>
                    <Text style={styles.authTinyLinkText}>发现设备</Text>
                  </Pressable>
                </View>

                <View style={styles.authActionRow}>
                  <Pressable style={styles.authConnectBtn} onPress={() => void onAuthSubmit()} disabled={busy}>
                    <Text style={styles.authConnectBtnText}>认证</Text>
                  </Pressable>
                </View>

                {showAuthNotice ? (
                  <View style={styles.authNoticeRow}>
                    {busy ? <ActivityIndicator color="#60748d" size="small" /> : null}
                    <Text numberOfLines={2} style={styles.authNoticeText}>{statusText}</Text>
                  </View>
                ) : null}
              </View>
            </View>

          </ScrollView>
        </RenderBoundary>
        {launchOverlay}
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaView style={styles.chatSafe}>
        <RenderBoundary name="chat-screen">
        <Drawer
          drawerPosition="right"
          drawerStyle={{ width: 320 }}
          open={drawerSide === 'right'}
          onOpen={() => setDrawerSide('right')}
          onClose={() => setDrawerSide((side) => (side === 'right' ? '' : side))}
          renderDrawerContent={renderRightDrawerContent}
          overlayStyle={{ backgroundColor: 'rgba(15,23,42,0.2)' }}
          swipeEnabled={drawerSide !== 'left'}
          swipeEdgeWidth={72}
          swipeMinDistance={18}
          swipeMinVelocity={180}
        >
          <Drawer
            drawerPosition="left"
            drawerStyle={{ width: 320 }}
            open={drawerSide === 'left'}
            onOpen={() => setDrawerSide('left')}
            onClose={() => setDrawerSide((side) => (side === 'left' ? '' : side))}
            renderDrawerContent={renderLeftDrawerContent}
            overlayStyle={{ backgroundColor: 'rgba(15,23,42,0.2)' }}
            swipeEnabled={drawerSide !== 'right'}
            swipeEdgeWidth={72}
            swipeMinDistance={18}
            swipeMinVelocity={180}
          >
            <StatusBar barStyle="dark-content" />

      <View style={styles.topBar}>
        <View style={styles.topSideSlot}>
          <Pressable style={styles.iconBtn} onPress={() => openDrawer('left')}>
            <Text style={styles.iconTxt}>≡</Text>
          </Pressable>
        </View>
        <Pressable style={styles.topBrand} onPress={workspacePickerOpen ? closeWorkspacePicker : openWorkspacePicker}>
          <Text style={styles.topTitle}>Giteam</Text>
          <Text numberOfLines={1} style={styles.topWorkspaceText}>
            {(repoPath ? projectNameFromPath(repoPath) : '选择工作空间') + ' ▾'}
          </Text>
        </Pressable>
        <View style={styles.topSideSlotRight}>
          <Pressable style={styles.toolBtn} onPress={() => openDrawer('right')}>
            <Image source={require('./src/assets/icons/tool.png')} style={styles.toolBtnImage} resizeMode="contain" />
          </Pressable>
        </View>
      </View>
      {workspacePickerOpen ? (
        <View style={styles.workspaceMask}>
          <Pressable style={styles.workspaceBackdrop} onPress={closeWorkspacePicker} />
          <Animated.View
            style={[
              styles.workspacePanel,
              {
                height: workspacePanelHeight,
                opacity: workspaceAnim,
                transform: [{ translateY: workspaceAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }]
              }
            ]}
          >
            <Text style={styles.workspaceTitle}>工作空间（{projects.length}）</Text>
            <ScrollView style={styles.workspaceList} contentContainerStyle={styles.workspaceListContent}>
              {projects.map((p) => {
                const active = repoPath.trim() === p.worktree.trim();
                return (
                  <Pressable
                    key={p.id}
                    style={active ? styles.workspaceListItemActive : styles.workspaceListItem}
                    onPress={() => {
                      closeWorkspacePicker();
                      void onSwitchProject(p.worktree);
                    }}
                  >
                    <View style={active ? styles.workspaceFolderIconActive : styles.workspaceFolderIcon}>
                      <View style={active ? styles.workspaceFolderTabActive : styles.workspaceFolderTab} />
                      <View style={active ? styles.workspaceFolderBodyAccentActive : styles.workspaceFolderBodyAccent} />
                    </View>
                    <View style={styles.workspaceItemTextWrap}>
                      <Text numberOfLines={1} style={active ? styles.workspaceItemTitleActive : styles.workspaceItemTitle}>
                        {toText(p.name)}
                      </Text>
                      <Text numberOfLines={1} style={styles.workspaceItemPath}>{toText(p.worktree)}</Text>
                    </View>
                  </Pressable>
                );
              })}
              {projects.length === 0 ? <Text style={styles.drawerEmpty}>暂无可切换工作空间</Text> : null}
            </ScrollView>
          </Animated.View>
        </View>
      ) : null}
      <View style={styles.chatBodyWrap}>
        {showStreamTopGlow ? (
          <View pointerEvents="none" style={styles.streamTopGlowTrack}>
            <Animated.View
              style={[
                styles.streamTopGlowSweep,
                {
                  opacity: streamTopGlowAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.18, 0.46, 0.18] }),
                  transform: [{
                    translateX: streamTopGlowAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-180, 360]
                    })
                  }]
                }
              ]}
            />
          </View>
        ) : null}
        {renderedTurns.length === 0 ? (
          <View style={styles.blankWrap}>
            <Text style={styles.blankTitle}>Giteam</Text>
            <Text style={styles.blankSub}>为你答疑、办事、创作，随时找我聊天</Text>
            <View style={styles.suggestList}>
              {suggestions.map((s) => (
                <Pressable key={s} style={styles.suggestChip} onPress={() => void onSendPrompt(s)}>
                  <Text style={styles.suggestText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.chatListStage}>
            <FlashList
              key={`chat-list-${sessionId || 'draft'}-${chatListResetKey}`}
              ref={messageScrollRef}
              style={styles.msgScroll}
              contentContainerStyle={{ ...styles.msgList, paddingBottom: messageBottomInset }}
              onLayout={(evt) => {
                messageViewportHRef.current = Number(evt.nativeEvent.layout?.height || 0);
              }}
              data={displayedTurns}
              removeClippedSubviews={Platform.OS === 'web'}
              alwaysBounceVertical
              bounces
              overScrollMode="always"
              scrollEventThrottle={16}
              maintainVisibleContentPosition={{
                autoscrollToBottomThreshold: 0.35,
                animateAutoScrollToBottom: false
              }}
              onScrollBeginDrag={() => {
                forceScrollToLatestUntilRef.current = 0;
                messageUserScrollingRef.current = true;
              }}
              onScrollEndDrag={() => {
                messageUserScrollingRef.current = false;
                const distanceFromBottom = Math.max(0, messageContentHRef.current - messageViewportHRef.current - messageScrollYRef.current);
                updateLatestJumpVisibility(distanceFromBottom, true);
              }}
              onMomentumScrollBegin={() => {
                messageUserScrollingRef.current = true;
              }}
              onMomentumScrollEnd={() => {
                messageUserScrollingRef.current = false;
                const distanceFromBottom = Math.max(0, messageContentHRef.current - messageViewportHRef.current - messageScrollYRef.current);
                updateLatestJumpVisibility(distanceFromBottom, true);
              }}
              refreshControl={
                sessionId ? (
                  <RefreshControl
                    refreshing={loadingOlder}
                    onRefresh={() => {
                      if (!sessionHasMore[sessionId]) return;
                      void onLoadOlderMessages();
                    }}
                    enabled={!!sessionHasMore[sessionId]}
                    tintColor="#607287"
                    colors={['#607287']}
                    progressViewOffset={28}
                    title={sessionHasMore[sessionId] ? '下拉加载更多消息' : '没有更多消息'}
                    titleColor="#607287"
                  />
                ) : undefined
              }
              onScroll={(evt) => {
                const y = Number(evt.nativeEvent.contentOffset?.y || 0);
                const viewportH = Number(evt.nativeEvent.layoutMeasurement?.height || 0);
                const contentH = Number(evt.nativeEvent.contentSize?.height || 0);
                onMessageListScroll(y, viewportH, contentH);
              }}
              onContentSizeChange={(_w, h) => {
                messageContentHRef.current = Number(h || 0);
                const distanceFromBottom = Math.max(0, messageContentHRef.current - messageViewportHRef.current - messageScrollYRef.current);
                updateLatestJumpVisibility(distanceFromBottom);
                if (loadingOlder) return;
                if (messageUserScrollingRef.current) return;
                if (Date.now() < forceScrollToLatestUntilRef.current) {
                  requestAnimationFrame(() => scrollToLatest(false));
                  return;
                }
              }}
              keyExtractor={(item) => item.id}
              renderItem={({ item, index }) => (
                <MobileTurnCell
                  turn={item}
                  streaming={streaming}
                  isLastTurn={item.id === displayedTurns[displayedTurns.length - 1]?.id}
                  thinkingPulse={thinkingPulse}
                  hasLiveQuestion={liveQuestionTurnId === item.id}
                  liveQuestions={liveQuestionTurnId === item.id ? activeQuestionsForTurn : []}
                  onQuestionReply={(requestId, answers) => {
                    const sid = toText(sessionIdRef.current).trim();
                    setQuestionSubmitState((prev) => ({ ...prev, [requestId]: { status: 'submitting' } }));
                    setStatus('正在提交答案...');
                    void replyQuestion({
                      baseUrl: serverUrl,
                      token,
                      repoPath,
                      requestId,
                      answers
                    }).then(() => {
                      setQuestionSubmitState((prev) => ({ ...prev, [requestId]: { status: 'submitted' } }));
                      pushConnLog(`question.reply ok ${requestId}`);
                      setStatus('答案已提交');
                      setTimeout(() => {
                        setQuestionRequests((prev) => prev.filter((r) => r.id !== requestId));
                        dismissQuestionRequest(requestId, sid);
                      }, 450);
                      if (sid) {
                        startStream(sid);
                        void syncSessionMessages(sid, {
                          limit: INITIAL_SESSION_LIMIT,
                          fetchLimit: INITIAL_MESSAGE_FETCH_LIMIT
                        });
                        void syncSessionStatus(sid);
                      }
                    }).catch((e) => {
                      pushConnLog(`question.reply error ${requestId} ${String(e)}`, 'error');
                      setStatus(`问题提交失败: ${String(e)}`);
                      setQuestionSubmitState((prev) => ({ ...prev, [requestId]: { status: 'failed', error: String(e) } }));
                    });
                  }}
                  onCopyMessage={copyMessageText}
                  expandedTimelineQuestions={expandedTimelineQuestions}
                  onToggleTimelineQuestion={(id) => {
                    setExpandedTimelineQuestions((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) {
                        next.delete(id);
                      } else {
                        next.add(id);
                      }
                      return next;
                    });
                  }}
                  expandedThinkCards={expandedThinkCards}
                  onToggleThinkCard={(id) => {
                    setExpandedThinkCards((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  }}
                  timelineQuestionTabs={timelineQuestionTabs}
                  onChangeTimelineTab={(questionId, tabIndex) => {
                    setTimelineQuestionTabs((prev) => {
                      const next = new Map(prev);
                      next.set(questionId, tabIndex);
                      return next;
                    });
                  }}
                />
              )}
              ListHeaderComponent={
                sessionId ? (
                  <View style={styles.loadEarlierWrap}>
                    {toText(sessionHistoryRetryHint[sessionId]).trim() ? (
                      <Text style={styles.loadEarlierHint}>{toText(sessionHistoryRetryHint[sessionId])}</Text>
                    ) : null}
                  </View>
                ) : null
              }
              ListFooterComponent={null}
            />
            {showLatestJump ? (
              <Pressable style={styles.latestJumpBtn} onPress={jumpToLatest}>
                <Text style={styles.latestJumpTxt}>↑</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      {latestTodoCard && dismissedTodoCardId !== latestTodoCard.id ? (
        <View style={styles.todoDockWrap}>
          <MobileTodoCardView
            card={latestTodoCard}
            compact
            collapsed={todoDockCollapsed}
            pulse={thinkingPulse}
            onToggle={() => setTodoDockCollapsed((prev) => !prev)}
            onClose={() => setDismissedTodoCardId(latestTodoCard.id)}
          />
        </View>
      ) : null}

      {activeQuestionRequest ? (
        <View key={activeQuestionRequest.id} style={styles.questionDockWrap}>
          <QuestionDock
            request={activeQuestionRequest}
            submitState={questionSubmitState[activeQuestionRequest.id]?.status || 'idle'}
            submitError={questionSubmitState[activeQuestionRequest.id]?.error}
            onReply={(requestId, answers) => {
              const sid = toText(sessionIdRef.current).trim();
              setQuestionSubmitState((prev) => ({ ...prev, [requestId]: { status: 'submitting' } }));
              setStatus('正在提交答案...');
              void replyQuestion({
                baseUrl: serverUrl,
                token,
                repoPath,
                requestId,
                answers
              }).then(() => {
                setQuestionSubmitState((prev) => ({ ...prev, [requestId]: { status: 'submitted' } }));
                pushConnLog(`question.reply ok ${requestId}`);
                setStatus('答案已提交');
                setTimeout(() => {
                  setQuestionRequests((prev) => prev.filter((r) => r.id !== requestId));
                  dismissQuestionRequest(requestId, sid);
                }, 450);
                if (sid) {
                  startStream(sid);
                  void syncSessionMessages(sid, {
                    limit: INITIAL_SESSION_LIMIT,
                    fetchLimit: INITIAL_MESSAGE_FETCH_LIMIT
                  });
                  void syncSessionStatus(sid);
                }
              }).catch((e) => {
                pushConnLog(`question.reply error ${requestId} ${String(e)}`, 'error');
                setStatus(`问题提交失败: ${String(e)}`);
                setQuestionSubmitState((prev) => ({ ...prev, [requestId]: { status: 'failed', error: String(e) } }));
              });
            }}
            onDismiss={(requestId) => {
              setQuestionRequests((prev) => prev.filter((r) => r.id !== requestId));
              dismissQuestionRequest(requestId);
              void rejectQuestion({
                baseUrl: serverUrl,
                token,
                repoPath,
                requestId
              });
            }}
          />
        </View>
      ) : null}

      <View
        style={styles.inputDock}
        onLayout={(evt) => {
          const h = Math.ceil(Number(evt.nativeEvent.layout?.height || 0));
          if (h > 0 && Math.abs(h - inputDockHeight) > 2) setInputDockHeight(h);
        }}
      >
        <View style={styles.inputRow}>
            <TextInput
              style={styles.inputMain}
              value={toText(prompt)}
              onChangeText={setPrompt}
              placeholder="发消息..."
              placeholderTextColor="#9aa5b3"
              multiline
          />
            <Pressable
              style={composerWillAbort ? styles.actionBtnStop : styles.actionBtnSend}
              onPress={composerWillAbort ? onAbort : () => void onSendPrompt()}
              disabled={composerWillAbort ? !toText(sessionIdRef.current).trim() : busy || !promptText}
            >
              <Text style={composerWillAbort ? styles.actionBtnStopTxt : styles.actionBtnSendTxt}>
                {composerWillAbort ? '■' : '→'}
              </Text>
            </Pressable>
        </View>
      </View>

          </Drawer>
        </Drawer>
        </RenderBoundary>
        {launchOverlay}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#f7f8fa' },
  chatSafe: { flex: 1, backgroundColor: '#f7f8fa' },

  launchScreen: { flex: 1, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  launchOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center'
  },
  launchMarkWrap: { alignItems: 'center', justifyContent: 'center', transform: [{ translateY: -10 }] },
  launchPeopleRow: { width: 92, height: 46, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 7 },
  launchPersonTeal: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 6,
    borderColor: '#22b8ad',
    marginBottom: 2
  },
  launchPersonCore: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 7,
    borderColor: '#18b7aa',
    marginBottom: 8
  },
  launchPersonNavy: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 6,
    borderColor: '#07517f',
    marginBottom: 2
  },
  launchWordmark: {
    marginTop: 10,
    color: '#07517f',
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -1.2
  },

  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  centerText: { color: '#4a5565' },
  title: { color: '#1f2630', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#6f7c8f', fontSize: 14 },

  authScroll: { flex: 1 },
  authContainer: { padding: 20, gap: 12, paddingBottom: 28 },
  authContainerCenter: {
    flexGrow: 1,
    width: '100%',
    minHeight: '100%',
    paddingHorizontal: 0,
    paddingVertical: 0
  },
  authPageFrame: {
    flex: 1,
    minHeight: 520,
    width: '100%',
    paddingHorizontal: 26,
    justifyContent: 'center'
  },
  authAsciiSlot: {
    alignSelf: 'stretch',
    height: 94,
    justifyContent: 'center'
  },
  authAsciiBrand: {
    alignSelf: 'center',
    fontSize: 10,
    fontWeight: Platform.OS === 'ios' ? '600' : '400',
    color: '#1f2630',
    lineHeight: 12,
    letterSpacing: 0,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    includeFontPadding: false,
    marginTop: 0,
    transform: [{ translateY: -92 }],
    marginBottom: 10
  },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  authTitle: { fontSize: 32, fontWeight: '700', color: '#1f2630' },
  authSub: { color: '#5f7087', fontSize: 18, marginBottom: 2, fontWeight: '600' },
  authFormWrap: {
    width: '100%',
    gap: 8,
    marginTop: -28
  },
  authFieldGroup: { gap: 6 },
  authFieldLabel: { color: '#6a7c94', fontSize: 12, fontWeight: '600', paddingLeft: 2 },
  authSchemeRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  authSchemeChip: {
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d8e1ec',
    backgroundColor: '#f7fafd',
    alignItems: 'center',
    justifyContent: 'center'
  },
  authSchemeChipActive: {
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center'
  },
  authSchemeChipText: { color: '#5f7087', fontSize: 12, fontWeight: '700' },
  authSchemeChipTextActive: { color: '#f9fbff', fontSize: 12, fontWeight: '700' },
  authInput: {
    minHeight: 48,
    borderBottomWidth: 1,
    borderColor: '#d9e2ee',
    backgroundColor: 'transparent',
    paddingHorizontal: 2,
    paddingVertical: 8,
    color: '#2f3948'
  },
  authUrlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: '#d9e2ee'
  },
  authInputUrl: {
    flex: 1,
    minHeight: 48,
    backgroundColor: 'transparent',
    paddingHorizontal: 2,
    paddingVertical: 8,
    color: '#2f3948'
  },
  authScanInlineBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd7e5',
    backgroundColor: '#f5f8fc',
    alignItems: 'center',
    justifyContent: 'center'
  },
  authScanInlineTxt: { color: '#3f5167', fontSize: 12, fontWeight: '700' },
  authScanIconFrame: {
    width: 16,
    height: 16,
    position: 'relative'
  },
  authScanIconLt: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 6,
    height: 6,
    borderLeftWidth: 1.8,
    borderTopWidth: 1.8,
    borderColor: '#41556f'
  },
  authScanIconRt: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 6,
    height: 6,
    borderRightWidth: 1.8,
    borderTopWidth: 1.8,
    borderColor: '#41556f'
  },
  authScanIconLb: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: 6,
    height: 6,
    borderLeftWidth: 1.8,
    borderBottomWidth: 1.8,
    borderColor: '#41556f'
  },
  authScanIconRb: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 6,
    height: 6,
    borderRightWidth: 1.8,
    borderBottomWidth: 1.8,
    borderColor: '#41556f'
  },
  authTinyRow: {
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  authTinyRowBottom: {
    marginTop: 18,
    marginBottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  authTinyCheckWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  authTinyCheckOn: {
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#3f5878',
    backgroundColor: '#3f5878'
  },
  authTinyCheckOff: {
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#98aac1',
    backgroundColor: '#ffffff'
  },
  authTinyText: { color: '#677b93', fontSize: 11 },
  authTinyLinkBtn: { paddingVertical: 2, paddingHorizontal: 2 },
  authTinyLinkText: { color: '#4f6f98', fontSize: 11, textDecorationLine: 'underline' },
  authQuickRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  authQuickBtn: {
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d2dde9',
    backgroundColor: '#f6f9fd',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12
  },
  authQuickBtnText: { color: '#41546c', fontSize: 12, fontWeight: '700' },
  authActionRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  authConnectBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2937'
  },
  authConnectBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
  authNoticeRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  authNoticeText: { color: '#64748b', fontSize: 12, lineHeight: 18, flex: 1 },
  authPane: { gap: 10 },
  authModeList: { gap: 10 },
  authModeCard: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: '#dde5ef',
    backgroundColor: '#ffffff',
    gap: 4
  },
  authModeTitle: { color: '#2b3442', fontSize: 15, fontWeight: '700' },
  authModeDesc: { color: '#6d7b8f', fontSize: 12, lineHeight: 18 },
  authModeBackBtn: {
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d9e1ec',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7fafc'
  },
  authModeBackTxt: { color: '#4f5f74', fontWeight: '600', fontSize: 12 },
  scanHeroBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center'
  },
  scanHeroBtnText: { color: '#f9fafb', fontWeight: '700', fontSize: 16 },
  authHintBox: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e6e8ec',
    gap: 4
  },
  authHint: { color: '#5f6a7a' },
  fallbackCard: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e6e8ec',
    gap: 8
  },
  fallbackTitle: { color: '#303744', fontWeight: '600' },
  fallbackInput: {
    minHeight: 92,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dfe3e8',
    backgroundColor: '#f9fafb',
    padding: 10,
    color: '#263041',
    textAlignVertical: 'top'
  },
  fallbackBtn: {
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2937'
  },
  fallbackBtnText: { color: '#fff', fontWeight: '600' },
  authStatusMini: {
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e3e8ef',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  authStatusMiniText: { color: '#64748b', fontSize: 12, lineHeight: 18, flex: 1 },
  authStatusBox: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e5eb',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  authStatusText: { color: '#5f6b7c', flex: 1 },

  scannerWrap: { flex: 1, padding: 14, gap: 10 },
  scannerHintText: { color: '#5a6a80', fontSize: 13 },
  scannerFrame: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#dde3ea',
    backgroundColor: '#fff'
  },

  topBar: {
    height: 58,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden'
  },
  streamTopGlowTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(33, 170, 160, 0.08)',
    overflow: 'hidden',
    zIndex: 8,
    elevation: 8
  },
  streamTopGlowSweep: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 220,
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(33, 170, 160, 0.72)'
  },
  topSideSlot: { width: 48, alignItems: 'flex-start', zIndex: 1 },
  topSideSlotRight: { width: 48, alignItems: 'flex-end', zIndex: 1 },
  topBrand: {
    position: 'absolute',
    left: 68,
    right: 68,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 1
  },
  topTitle: { fontSize: 20, color: '#202734', fontWeight: '700' },
  topWorkspaceText: { fontSize: 11, color: '#7a8798' },
  toolBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef1f5'
  },
  toolBtnImage: { width: 16, height: 16 },
  workspaceMask: {
    position: 'absolute',
    top: 58,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    elevation: 5
  },
  workspaceBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.12)'
  },
  workspacePanel: {
    marginTop: 8,
    marginHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d7e1ee',
    backgroundColor: '#fbfcfe',
    paddingHorizontal: 12,
    paddingVertical: 12,
    zIndex: 6,
    elevation: 8
  },
  workspaceTitle: { color: '#2a3442', fontSize: 14, fontWeight: '700', marginBottom: 10 },
  workspaceList: { flex: 1 },
  workspaceListContent: { paddingBottom: 8, gap: 8 },
  workspaceListItem: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e1e7f0',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  workspaceListItemActive: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfd5f4',
    backgroundColor: '#eaf2fc',
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  workspaceFolderIcon: {
    width: 24,
    height: 17,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#9fb6d8',
    backgroundColor: '#dce8f8',
    alignItems: 'center',
    justifyContent: 'center'
  },
  workspaceFolderIconActive: {
    width: 24,
    height: 17,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#7ea3d7',
    backgroundColor: '#cfe1f8',
    alignItems: 'center',
    justifyContent: 'center'
  },
  workspaceFolderTab: {
    position: 'absolute',
    top: -4,
    left: 3,
    width: 10,
    height: 4,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: '#c9daf3',
    borderWidth: 1,
    borderColor: '#9fb6d8'
  },
  workspaceFolderTabActive: {
    position: 'absolute',
    top: -4,
    left: 3,
    width: 10,
    height: 4,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: '#bad0ee',
    borderWidth: 1,
    borderColor: '#84a9da'
  },
  workspaceFolderBodyAccent: {
    position: 'absolute',
    bottom: 3,
    width: 14,
    height: 2,
    borderRadius: 2,
    backgroundColor: '#b7cae5'
  },
  workspaceFolderBodyAccentActive: {
    position: 'absolute',
    bottom: 3,
    width: 14,
    height: 2,
    borderRadius: 2,
    backgroundColor: '#7fa3d5'
  },
  workspaceItemTextWrap: { flex: 1, gap: 1 },
  workspaceItemTitle: { color: '#2f3d51', fontSize: 13, fontWeight: '600' },
  workspaceItemTitleActive: { color: '#1f4e86', fontSize: 13, fontWeight: '700' },
  workspaceItemPath: { color: '#7a8798', fontSize: 11 },
  chatStatusBar: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 6,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start'
  },
  chatStatusText: {
    color: '#6f7c8f',
    fontSize: 12,
    lineHeight: 17,
    flex: 1
  },
  chatStatusCopyBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9e1ec',
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#f8fafc'
  },
  chatStatusCopyTxt: { color: '#536278', fontSize: 11, fontWeight: '600' },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef1f5'
  },
  iconTxt: { color: '#394455', fontWeight: '700' },

  chatBodyWrap: { flex: 1, paddingHorizontal: 16, position: 'relative' },
  chatListStage: { flex: 1, position: 'relative' },
  blankWrap: { marginTop: 26, gap: 10 },
  blankTitle: { fontSize: 40, fontWeight: '700', color: '#c7ced8' },
  blankSub: { color: '#7e8898', fontSize: 18 },
  suggestList: { gap: 10, marginTop: 8 },
  suggestChip: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e6e9ee',
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignSelf: 'flex-start'
  },
  suggestText: { color: '#545f6f', fontSize: 14 },

  msgScroll: { flex: 1 },
  msgList: { gap: 14, paddingTop: 8 },
  latestJumpBtn: {
    position: 'absolute',
    bottom: 14,
    alignSelf: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#d6dee8',
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#64748b',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4
  },
  latestJumpTxt: { color: '#334155', fontSize: 20, fontWeight: '800', lineHeight: 24 },
  turnWrap: { width: '100%', alignSelf: 'stretch', gap: 10 },
  loadEarlierWrap: { alignItems: 'center', paddingTop: 2, paddingBottom: 4 },
  loadEarlierHint: { marginTop: 6, color: '#8b6c45', fontSize: 11 },
  historyHintWrap: { alignItems: 'center', paddingTop: 4, paddingBottom: 2 },
  historyHintText: { color: '#7c8aa0', fontSize: 12 },
  thinkWrap: { width: '100%', alignItems: 'flex-start' },
  contextWrap: { width: '100%', alignItems: 'flex-start' },
  todoInlineWrap: { width: '100%', alignItems: 'flex-start' },
  dividerWrap: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#d8dee8' },
  dividerLabel: { color: '#9aa4b2', fontSize: 11 },
  errorWrap: { width: '100%', alignItems: 'flex-start' },
  todoInlineCard: {
    width: '96%',
    maxWidth: '96%',
    borderRadius: 18,
    borderWidth: 0,
    backgroundColor: '#f7fafc',
    paddingVertical: 12,
    paddingHorizontal: 13,
    gap: 12,
    shadowColor: '#7b8da6',
    shadowOpacity: 0.10,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 1
  },
  todoInlineCardCompact: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 0,
    backgroundColor: '#f7fafc',
    paddingVertical: 12,
    paddingHorizontal: 13,
    gap: 12
  },
  todoCardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  todoCardHeadCompact: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  todoCardHeadMain: { flex: 1, gap: 7 },
  todoTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  todoTitle: { color: '#1f2f46', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  todoActions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 4 },
  todoCloseBtn: {
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef3f8'
  },
  todoCloseText: { color: '#718096', fontSize: 16, lineHeight: 19, fontWeight: '700' },
  todoChipRunning: {
    minWidth: 42,
    height: 21,
    borderRadius: 999,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e7f4f2',
    borderWidth: 1,
    borderColor: '#c8e8e3'
  },
  todoChipRunningText: { color: '#08746f', fontSize: 11, fontWeight: '800' },
  todoChipDone: {
    minWidth: 42,
    height: 21,
    borderRadius: 999,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef6ff',
    borderWidth: 1,
    borderColor: '#d5e8ff'
  },
  todoChipDoneText: { color: '#276aa8', fontSize: 11, fontWeight: '800' },
  todoSummary: { color: '#637084', fontSize: 12, lineHeight: 18, fontWeight: '500' },
  todoProgressTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: '#e8eef5',
    overflow: 'hidden'
  },
  todoProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#21aaa0'
  },
  todoChevron: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '0deg' }]
  },
  todoChevronCollapsed: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-90deg' }]
  },
  todoChevronLineLeft: {
    position: 'absolute',
    width: 6,
    height: 1.5,
    borderRadius: 999,
    backgroundColor: '#73839a',
    transform: [{ translateX: -1.5 }, { rotate: '45deg' }]
  },
  todoChevronLineRight: {
    position: 'absolute',
    width: 6,
    height: 1.5,
    borderRadius: 999,
    backgroundColor: '#73839a',
    transform: [{ translateX: 1.5 }, { rotate: '-45deg' }]
  },
  todoToggleBtn: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    marginTop: -8
  },
  todoArrow: {
    width: 10,
    height: 10,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#708298',
    transform: [{ rotate: '45deg' }]
  },
  todoArrowUp: {
    transform: [{ rotate: '-135deg' }]
  },
  todoList: { gap: 7, paddingTop: 2 },
  todoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  todoRowText: { flex: 1, color: '#2f3d52', fontSize: 13, lineHeight: 19, fontWeight: '500' },
  todoRowTextDone: { color: '#91a0b2', textDecorationLine: 'line-through' },
  todoRowTextCancelled: { color: '#aeb7c3', textDecorationLine: 'line-through' },
  todoStatusPending: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#d5dee9',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center'
  },
  todoStatusCancelled: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#d7dce4',
    backgroundColor: '#f3f5f8',
    alignItems: 'center',
    justifyContent: 'center'
  },
  todoStatusCompleted: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 0,
    backgroundColor: '#21aaa0',
    alignItems: 'center',
    justifyContent: 'center'
  },
  todoStatusCompletedText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  todoStatusRunningContainer: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative'
  },
  todoStatusRunningPulse1: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: 'rgba(33,170,160,0.12)'
  },
  todoStatusRunningPulse2: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(33,170,160,0.28)'
  },
  todoStatusRunningCenter: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#21aaa0'
  },
  todoThinkingDots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  todoThinkingDot: {
    width: 4,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#999999'
  },
  todoThinkingDotOn: { backgroundColor: '#21aaa0', transform: [{ translateY: -0.5 }, { scale: 1.1 }] },
  todoThinkingDotMid: { backgroundColor: '#7990a7' },
  todoThinkingDotSoft: { backgroundColor: '#cdd7e2' },
  contextCard: {
    width: '96%',
    maxWidth: '96%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5eaf2',
    backgroundColor: '#f9fbff',
    overflow: 'hidden',
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6
  },
  contextTitle: { color: '#2f415a', fontSize: 12, fontWeight: '700' },
  contextSummary: { color: '#65758a', fontSize: 12, lineHeight: 18 },
  contextTools: { gap: 5 },
  contextToolRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contextToolTitle: { color: '#2d3a4d', fontSize: 12, fontWeight: '600' },
  contextToolDetail: { color: '#73839a', fontSize: 11, flex: 1 },
  eventWrap: { width: '100%', alignItems: 'flex-start' },
  eventCard: {
    width: '96%',
    maxWidth: '96%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9edf3',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6
  },
  eventHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  eventDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#9da9ba' },
  eventDotRun: { backgroundColor: '#4f7aaf' },
  eventTitle: { color: '#2d3a4d', fontSize: 13, fontWeight: '600' },
  eventMode: { color: '#5f7898', fontSize: 12, fontWeight: '500' },
  eventTime: { marginLeft: 'auto', color: '#8a95a6', fontSize: 11 },
  eventDetail: { color: '#667487', fontSize: 12, lineHeight: 18 },
  eventMeta: { color: '#667a94', fontSize: 11 },
  eventOutput: { color: '#4f5e72', fontSize: 12, lineHeight: 18 },
  questionTimelineWrap: { width: '100%', alignItems: 'flex-start' },
  questionTimelineCard: {
    width: '92%',
    maxWidth: '92%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8ecf2',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  questionTimelineHead: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingVertical: 8, 
    paddingHorizontal: 10,
    backgroundColor: '#f8f9fb',
    borderBottomWidth: 0,
    borderBottomColor: '#eef1f5',
  },
  questionTimelineTitleWrap: { flex: 1, minWidth: 0, gap: 2 },
  questionTimelineTitle: { color: '#1a2233', fontSize: 13, fontWeight: '700' },
  questionTimelineSummary: { color: '#697789', fontSize: 12, lineHeight: 16 },
  questionTimelineHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 },
  questionTimelineBadge: {
    color: '#607287',
    fontSize: 10,
    backgroundColor: '#eef1f5',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    overflow: 'hidden',
  },
  questionTimelineStatus: { 
    color: '#8a95a6', 
    fontSize: 11,
    backgroundColor: '#eef1f5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  questionTimelineToggle: { color: '#5f6b7a', fontSize: 11, fontWeight: '700' },
  questionTimelineBody: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, gap: 5, borderTopWidth: 1, borderTopColor: '#eef1f5' },
  questionTimelineBlock: { gap: 5 },
  questionTimelineHeader: { color: '#5f6b7a', fontSize: 12, fontWeight: '600', marginBottom: 2 },
  questionTimelineText: { color: '#1a2233', fontSize: 13, fontWeight: '600', lineHeight: 18 },
  questionTimelineHint: { color: '#9aa3b2', fontSize: 11, marginTop: 1 },
  questionTimelineOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e4e9f0',
    backgroundColor: '#f8f9fb',
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginVertical: 1,
  },
  questionTimelineOptionLive: {
    borderColor: '#0066b8',
    backgroundColor: 'rgba(0, 102, 184, 0.06)'
  },
  questionTimelineRadio: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: '#c5cdd8', backgroundColor: '#fff' },
  questionTimelineCheckbox: { width: 12, height: 12, borderRadius: 3, borderWidth: 1.5, borderColor: '#c5cdd8', backgroundColor: '#fff' },
  questionTimelineOptionBody: { flex: 1 },
  questionTimelineOptionLabel: { color: '#1a2233', fontSize: 12, fontWeight: '500', lineHeight: 17 },
  questionTimelineOptionDesc: { color: '#7a8494', fontSize: 11, lineHeight: 15, marginTop: 1 },
  questionTimelineDisabled: { color: '#8a95a6', fontSize: 10, lineHeight: 14 },
  questionTimelineTabs: { flexDirection: 'row', gap: 6, marginBottom: 5 },
  questionTimelineTab: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e4e9f0',
    backgroundColor: '#f8f9fb',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  questionTimelineTabActive: {
    borderColor: '#2d3a4d',
    backgroundColor: '#2d3a4d'
  },
  questionTimelineTabText: { color: '#5f6b7a', fontSize: 11, fontWeight: '600' },
  questionTimelineTabTextActive: { color: '#ffffff' },
  errorCard: {
    width: '96%',
    maxWidth: '96%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f0c9c9',
    backgroundColor: '#fff5f5',
    overflow: 'hidden',
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6
  },
  errorTitle: { color: '#8e2f2f', fontSize: 13, fontWeight: '700' },
  errorCode: { color: '#b35656', fontSize: 11, fontWeight: '600' },
  thinkCard: {
    width: '96%',
    maxWidth: '96%',
    borderRadius: 20,
    borderWidth: 0,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    paddingVertical: 4,
    paddingHorizontal: 2,
    gap: 0
  },
  thinkCardExpanded: {
    width: '96%',
    maxWidth: '96%',
    borderRadius: 16,
    borderWidth: 0,
    backgroundColor: '#f5f8fb',
    overflow: 'hidden',
    paddingVertical: 11,
    paddingHorizontal: 12,
    gap: 8
  },
  thinkHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  thinkIdentityRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0, flex: 1 },
  thinkSpark: { color: '#21aaa0', fontSize: 15, lineHeight: 18, fontWeight: '800' },
  thinkHeadMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thinkTitle: { color: '#52627a', fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  thinkToggleText: { color: '#8190a3', fontSize: 11, fontWeight: '700' },
  thinkExpandedHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  thinkExpandedTitle: { color: '#6f7d90', fontSize: 12, fontWeight: '700' },
  thinkText: { color: '#5e6e84', fontSize: 13, lineHeight: 19 },
  thinkCollapsed: { color: '#6f7f95', fontSize: 12, lineHeight: 18 },
  thinkPreviewLines: { gap: 5, paddingTop: 2 },
  thinkPreviewLineRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  thinkPreviewDot: { width: 5, height: 5, borderRadius: 999, backgroundColor: '#c4cfdb' },
  thinkPreviewDotLive: { backgroundColor: '#21aaa0', transform: [{ scale: 1.25 }] },
  thinkPreviewLineText: { flex: 1, color: '#6c7c92', fontSize: 12, lineHeight: 17, fontWeight: '500' },
  thinkFlowRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 1 },
  thinkFlowIconShell: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(10, 80, 125, 0.08)',
    shadowColor: '#7c8fa6',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1
  },
  thinkFlowHalo: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 999,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderTopColor: '#0a507d',
    borderRightColor: 'rgba(33,170,160,0.25)',
    borderBottomColor: 'rgba(10,80,125,0.14)',
    borderLeftColor: 'rgba(33,170,160,0.48)'
  },
  thinkFlowLens: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#0a507d',
    opacity: 0.86
  },
  thinkFlowPill: {
    flex: 1,
    minHeight: 34,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.76)',
    borderWidth: 1,
    borderColor: 'rgba(12, 42, 70, 0.07)',
    paddingLeft: 14,
    paddingRight: 15,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#8092a8',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1
  },
  thinkFlowKicker: { color: '#21aaa0', fontSize: 10, lineHeight: 12, fontWeight: '800', letterSpacing: 0.6 },
  thinkFlowLine: { color: '#5e6d80', fontSize: 12, lineHeight: 16, fontWeight: '600' },
  mdText: { fontSize: 15, lineHeight: 20 },
  mdInlineRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 0 },
  mdSegText: { fontSize: 15, lineHeight: 20 },
  mdHeading: { fontSize: 16, lineHeight: 22, fontWeight: '700', marginBottom: 4 },
  mdInlineCode: { borderRadius: 4, paddingHorizontal: 4, fontSize: 13 },
  mdCodeBlock: { borderRadius: 8, backgroundColor: '#eef3f8', padding: 8 },
  mdCodeText: { fontSize: 12, lineHeight: 18 },
  mdBulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  mdBulletDot: { fontSize: 14, lineHeight: 20 },
  thinkingWrap: { alignItems: 'flex-start' },
  thinkingStickyWrap: { alignItems: 'flex-start', paddingBottom: 6 },
  thinkingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e7ebf2',
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    paddingHorizontal: 12
  },
  thinkingDots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  thinkingDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: '#c7d0de' },
  thinkingDotOn: { backgroundColor: '#6b7f98' },
  thinkingLabel: { color: '#667a94', fontSize: 12, fontWeight: '500' },
  bubbleUserWrap: { width: '100%', alignItems: 'flex-end' },
  bubbleAssistantWrap: { width: '100%', alignItems: 'flex-start' },
  bubbleUser: {
    maxWidth: '84%',
    alignSelf: 'flex-end',
    flexShrink: 1,
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: '#1f2937',
    overflow: 'hidden'
  },
  bubbleAssistant: {
    width: '96%',
    maxWidth: '96%',
    alignSelf: 'flex-start',
    flexShrink: 1,
    borderRadius: 0,
    paddingVertical: 4,
    paddingHorizontal: 2,
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent',
    overflow: 'visible'
  },
  bubbleContent: { width: '100%', flexShrink: 1, minWidth: 0 },
  markdownBlock: { width: '100%', flexShrink: 1, minWidth: 0 },
  bubbleUserText: { color: '#f5f7fb', fontSize: 15, lineHeight: 22 },
  bubbleAssistantText: { color: '#2f3948', lineHeight: 20 },

  todoDockWrap: {
    marginHorizontal: 12,
    marginBottom: 8
  },
  questionDockWrap: {
    marginHorizontal: 12,
    marginBottom: 8
  },
  todoDockCompact: {
    borderRadius: 22,
    borderWidth: 0,
    backgroundColor: '#fbfdff',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    shadowColor: '#66809c',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3
  },
  todoDock: {
    borderRadius: 22,
    borderWidth: 0,
    backgroundColor: '#fbfdff',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    shadowColor: '#66809c',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2
  },

  inputDock: {
    marginHorizontal: 12,
    marginBottom: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e0e5ec',
    backgroundColor: '#ffffff',
    minHeight: 58,
    paddingLeft: 12,
    paddingRight: 10,
    paddingTop: 8,
    paddingBottom: 8,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputMain: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 2,
    color: '#273041',
    textAlignVertical: 'center',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {})
  },
  actionBtnStop: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eceff3'
  },
  actionBtnSend: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2937'
  },
  actionBtnStopTxt: { color: '#5c6779', fontSize: 12, fontWeight: '700' },
  actionBtnSendTxt: { color: '#fff', fontSize: 18, fontWeight: '700' },

  drawerPanelLeft: {
    flex: 1,
    backgroundColor: '#fbfdff',
    borderRightWidth: 1,
    borderColor: '#dde6f2',
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 8, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 8
  },
  drawerPanelRight: {
    flex: 1,
    backgroundColor: '#fbfdff',
    borderLeftWidth: 1,
    borderColor: '#dde6f2',
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: -8, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 8
  },
  drawerHead: { gap: 10, marginBottom: 12 },
  drawerHeadTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  drawerLogoutBtn: {
    width: 32,
    height: 32,
    marginTop: -12,
    marginRight: -6,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef1f5'
  },
  drawerLogoutImage: { width: 16, height: 16 },
  drawerMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  drawerMetaChip: {
    borderRadius: 999,
    backgroundColor: '#f3f7fd',
    borderWidth: 1,
    borderColor: '#d5e1f0',
    color: '#5a6b82',
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: 'hidden'
  },
  drawerModelStatus: { color: '#6a788d', fontSize: 12, lineHeight: 19 },
  drawerModelListItem: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d7e2ef',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6
  },
  drawerModelListItemActive: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#bad2f3',
    backgroundColor: '#ecf4ff',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6
  },
  drawerModelListTitle: { color: '#27384e', fontSize: 14, fontWeight: '600' },
  drawerModelListTitleActive: { color: '#204b82', fontSize: 14, fontWeight: '700' },
  drawerModelListSub: { color: '#74839a', fontSize: 12 },
  drawerModelListSubActive: { color: '#4a6891', fontSize: 12 },
  drawerTitle: { color: '#1f2734', fontWeight: '700', fontSize: 24, letterSpacing: 0.2 },
  drawerNewBtn: {
    borderRadius: 16,
    backgroundColor: '#edf2f8',
    borderWidth: 1,
    borderColor: '#d9e1ed',
    paddingVertical: 13,
    alignItems: 'center'
  },
  drawerNewTxt: { color: '#2d3848', fontWeight: '700', fontSize: 13 },
  drawerScroll: { flex: 1 },
  drawerList: { paddingBottom: 42, paddingTop: 4 },
  drawerItemGap: { marginBottom: 8 },
  drawerMoreBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 6 },
  drawerMoreTxt: { color: '#607287', fontSize: 12, letterSpacing: 0.3 },
  drawerSessionSearch: {
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d4ddea',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    marginBottom: 10,
    color: '#243247',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {})
  },
  drawerItem: {
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe5f0',
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 6,
    minHeight: 72
  },
  drawerItemActive: {
    borderRadius: 16,
    backgroundColor: '#eef5ff',
    borderWidth: 1,
    borderColor: '#bfd3f1',
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 6,
    minHeight: 72
  },
  drawerItemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  drawerItemTitle: { color: '#202834', fontWeight: '700', fontSize: 14 },
  drawerItemTime: { color: '#8392a8', fontSize: 11 },
  drawerItemPreview: { color: '#66758a', fontSize: 12, lineHeight: 18 },
  drawerEmpty: { color: '#7d8897', marginTop: 14, fontSize: 12 },

  discoverWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 20,
    justifyContent: 'flex-start'
  },
  discoverSafe: { flex: 1, backgroundColor: '#f2f6fb' },
  discoverTitle: { color: '#2b394b', fontSize: 15, fontWeight: '600', textAlign: 'center', opacity: 0.9 },
  discoverTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  discoverTitleSideLeft: { minWidth: 88, flexDirection: 'row', justifyContent: 'flex-start' },
  discoverTitleSideRight: { minWidth: 88 },
  discoverBackBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#e7eef8',
    borderWidth: 1,
    borderColor: '#d2deee'
  },
  discoverBackIcon: { color: '#1f2a3a', fontSize: 24, fontWeight: '800', lineHeight: 24, marginTop: -2 },
  discoverListWrap: { flex: 1, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 16 },
  discoverListMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 12 },
  discoverListMetaText: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  discoverRescanBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#111827' },
  discoverRescanTxt: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  discoverList: { flex: 1 },
  discoverListContent: { paddingBottom: 24, gap: 10 },
  discoverListEmpty: { color: '#94a3b8', fontSize: 12, marginTop: 10 },
  discoverListItem: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4
  },
  discoverListItemMain: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, paddingRight: 10 },
  discoverListItemText: { flex: 1 },
  discoverListItemTitle: { color: '#111827', fontSize: 13, fontWeight: '700' },
  discoverListItemSub: { color: '#64748b', fontSize: 12, marginTop: 2 },
  discoverListConnectBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: '#111827' },
  discoverListConnectTxt: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  discoverListConnectBtnOff: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: '#e2e8f0' },
  discoverListConnectTxtOff: { color: '#64748b', fontSize: 13, fontWeight: '700' },
  discoverConnectProgressRow: { marginTop: 10, gap: 6 },

  pairPromptMask: { ...StyleSheet.absoluteFillObject, zIndex: 50 },
  pairPromptBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.32)' },
  pairPromptCard: {
    position: 'absolute',
    left: '7%',
    right: '7%',
    top: '32%',
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8
  },
  pairPromptTitle: { color: '#111827', fontSize: 14, fontWeight: '800' },
  pairPromptSub: { color: '#64748b', fontSize: 12 },
  pairPromptInput: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d4ddea',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    color: '#111827',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {})
  },
  pairPromptActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 2 },
  pairPromptBtnGhost: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: '#eef2f7' },
  pairPromptBtnGhostTxt: { color: '#334155', fontSize: 13, fontWeight: '700' },
  pairPromptBtnPrimary: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: '#111827' },
  pairPromptBtnPrimaryTxt: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  senseStage: {
    flex: 1,
    alignSelf: 'stretch',
    position: 'relative',
    overflow: 'hidden',
    justifyContent: 'center'
  },
  senseTapBlank: {
    ...StyleSheet.absoluteFillObject
  },
  senseWave: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(8,80,140,0.38)'
  },
  senseWaveSoft: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(8,80,140,0.24)'
  },
  senseCenterFloat: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -10,
    marginTop: -15,
    width: 20,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center'
  },
  senseCenterRipple: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -42,
    marginTop: -42,
    width: 84,
    height: 84,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.58)'
  },
  senseCenterRippleSoft: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -42,
    marginTop: -42,
    width: 84,
    height: 84,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(30,41,59,0.4)'
  },
  senseCenterPhone: {
    width: 18,
    height: 28,
    borderRadius: 5,
    borderWidth: 1.3,
    borderColor: '#111827',
    backgroundColor: '#111827',
    alignItems: 'center',
    paddingTop: 3
  },
  senseCenterPhoneNotch: {
    width: 6,
    height: 1.6,
    borderRadius: 2,
    backgroundColor: '#cbd5e1'
  },
  senseDevice: {
    position: 'absolute',
    width: 56,
    height: 76,
    alignItems: 'center',
    zIndex: 4
  },
  senseDeviceIcon: {
    marginTop: 12,
    width: 36,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#0b1220',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 3
  },
  senseDeviceIconHover: {
    marginTop: 11,
    width: 38,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#020617',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 3,
    shadowColor: '#0f172a',
    shadowOpacity: 0.32,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 }
  },
  senseDeviceIconOffline: {
    marginTop: 12,
    width: 36,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#6b7280',
    borderWidth: 1,
    borderColor: '#4b5563',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 3
  },
  senseDeviceIconOfflineHover: {
    marginTop: 11,
    width: 38,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#64748b',
    borderWidth: 1,
    borderColor: '#475569',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 3
  },
  senseDeviceScreen: {
    width: 22,
    height: 2.8,
    borderRadius: 2,
    backgroundColor: '#475569',
    marginBottom: 2
  },
  senseDeviceGlyph: {
    color: '#e2e8f0',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 11
  },
  discoverFooterSlot: {
    height: 162,
    width: '100%',
    justifyContent: 'flex-end',
    position: 'relative'
  },
  discoverDeviceCard: {
    position: 'absolute',
    left: '6%',
    right: '6%',
    bottom: 14,
    width: '88%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6
  },
  discoverCardHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  discoverDotOnline: { width: 8, height: 8, borderRadius: 999, backgroundColor: '#22c55e' },
  discoverDotOffline: { width: 8, height: 8, borderRadius: 999, backgroundColor: '#94a3b8' },
  discoverDeviceCardTitle: { color: '#111827', fontSize: 13, fontWeight: '700' },
  discoverDeviceCardSub: { color: '#64748b', fontSize: 12 },
  discoverDeviceProgressTrack: { marginTop: 2, height: 6, borderRadius: 999, backgroundColor: '#eef2f7', overflow: 'hidden' },
  discoverDeviceProgressBar: {
    height: 6,
    width: '100%',
    borderRadius: 999,
    backgroundColor: '#3b82f6',
    alignSelf: 'stretch'
  },
  discoverDeviceProgressText: { color: '#475569', fontSize: 12, fontWeight: '600' },
  discoverDeviceCardActions: { flexDirection: 'row', marginTop: 2 },
  discoverCardConnectBtn: {
    minWidth: 112,
    height: 34,
    borderRadius: 14,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto'
  },
  discoverCardConnectBtnOffline: {
    minWidth: 112,
    height: 34,
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto'
  },
  discoverCardConnectText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  radarStage: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 336,
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#20364f',
    backgroundColor: '#06101c',
    overflow: 'hidden',
    position: 'relative'
  },
  radarBandOuter: {
    position: 'absolute',
    left: '-8%',
    top: '-8%',
    width: '116%',
    height: '116%',
    borderRadius: 999,
    backgroundColor: 'rgba(0,160,255,0.06)'
  },
  radarBandMid: {
    position: 'absolute',
    left: '12%',
    top: '12%',
    width: '76%',
    height: '76%',
    borderRadius: 999,
    backgroundColor: 'rgba(0,190,255,0.08)'
  },
  radarBandInner: {
    position: 'absolute',
    left: '30%',
    top: '30%',
    width: '40%',
    height: '40%',
    borderRadius: 999,
    backgroundColor: 'rgba(0,220,255,0.1)'
  },
  radarNebulaA: {
    position: 'absolute',
    left: '15%',
    top: '18%',
    width: '38%',
    height: '38%',
    borderRadius: 999,
    backgroundColor: 'rgba(90,70,255,0.09)'
  },
  radarNebulaB: {
    position: 'absolute',
    right: '14%',
    bottom: '16%',
    width: '32%',
    height: '32%',
    borderRadius: 999,
    backgroundColor: 'rgba(0,240,180,0.08)'
  },
  radarRingOuter: {
    position: 'absolute',
    left: '8%',
    top: '8%',
    width: '84%',
    height: '84%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(75,145,220,0.34)'
  },
  radarRingMid: {
    position: 'absolute',
    left: '22%',
    top: '22%',
    width: '56%',
    height: '56%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(85,160,235,0.3)'
  },
  radarRingInner: {
    position: 'absolute',
    left: '36%',
    top: '36%',
    width: '28%',
    height: '28%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(95,175,245,0.26)'
  },
  radarWave: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,236,255,0.62)'
  },
  radarWaveSoft: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(96,200,255,0.35)'
  },
  radarCoreGlow: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -36,
    marginTop: -36,
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: 'rgba(0,228,255,0.16)'
  },
  radarCenterFloat: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -24,
    marginTop: -24,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center'
  },
  radarCenterOrb: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: 'rgba(17,39,63,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(111,189,255,0.38)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#36d7ff',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 }
  },
  radarCenterPhone: {
    width: 14,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.4,
    borderColor: '#94dcff',
    backgroundColor: 'rgba(84,146,205,0.22)',
    alignItems: 'center',
    paddingTop: 2
  },
  radarCenterPhoneNotch: {
    width: 6,
    height: 1.8,
    borderRadius: 2,
    backgroundColor: 'rgba(180,226,255,0.86)'
  },
  radarBlip: {
    position: 'absolute',
    width: 40,
    height: 58,
    alignItems: 'center',
    zIndex: 4
  },
  radarPlanetHalo: {
    position: 'absolute',
    top: 2,
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: 'rgba(68,193,255,0.22)'
  },
  radarPlanetHaloHover: {
    position: 'absolute',
    top: 0,
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: 'rgba(85,208,255,0.35)'
  },
  radarPlanetCore: {
    marginTop: 9,
    width: 14,
    height: 14,
    borderRadius: 999,
    backgroundColor: '#53c5ff',
    borderWidth: 1.5,
    borderColor: 'rgba(231,248,255,0.96)',
    alignItems: 'flex-start',
    justifyContent: 'flex-start'
  },
  radarPlanetCoreHover: {
    marginTop: 8,
    width: 16,
    height: 16,
    borderRadius: 999,
    backgroundColor: '#6ed3ff',
    borderWidth: 1.5,
    borderColor: '#f4f9ff',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    shadowColor: '#63d6ff',
    shadowOpacity: 0.58,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 }
  },
  radarPlanetHighlight: {
    marginTop: 2,
    marginLeft: 2,
    width: 5,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.72)'
  },
  radarPlanetShade: {
    position: 'absolute',
    right: 1.5,
    bottom: 1.5,
    width: 4.5,
    height: 4.5,
    borderRadius: 999,
    backgroundColor: 'rgba(5,33,76,0.4)'
  },
  radarPlanetSparkA: {
    position: 'absolute',
    top: 6,
    right: 2,
    width: 3.5,
    height: 1.5,
    borderRadius: 2,
    backgroundColor: 'rgba(142,228,255,0.92)',
    transform: [{ rotate: '28deg' }]
  },
  radarPlanetSparkB: {
    position: 'absolute',
    top: 3,
    right: 5,
    width: 2,
    height: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(190,240,255,0.95)'
  },
  radarPlanetElectric: {
    position: 'absolute',
    top: -2,
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1.2,
    borderColor: 'rgba(92,217,255,0.88)',
    shadowColor: '#6de4ff',
    shadowOpacity: 0.55,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 0 }
  },
  radarBlipText: { marginTop: 5, fontSize: 9, color: 'rgba(170,217,255,0.4)', maxWidth: 52, textAlign: 'center' },
  radarBlipTextOn: { marginTop: 5, fontSize: 9, color: 'rgba(195,235,255,0.92)', maxWidth: 52, textAlign: 'center' },
  radarVignette: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(114,181,244,0.16)'
  },
  discoverHintText: {
    color: '#667b95',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12
  },
  discoverCloseBtn: {
    alignSelf: 'center',
    width: 46,
    height: 46,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cfdaea',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f6f9fe'
  },
  discoverCloseTxt: {
    color: '#60748d',
    fontSize: 26,
    lineHeight: 26,
    marginTop: -1
  },
  // 旧的发现页列表样式已弃用（当前使用 discoverListWrap / discoverListItem 等）

  row: { flexDirection: 'row', gap: 8 },
  boundaryWrap: {
    margin: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#efcaca',
    backgroundColor: '#fff7f7',
    gap: 6
  },
  boundaryTitle: { color: '#8a2f2f', fontWeight: '700' },
  boundaryText: { color: '#6f3b3b', fontSize: 12 },
  btnSoft: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8edf3'
  },
  btnSoftText: { color: '#39485d', fontWeight: '600' },
  scannerStatusText: { color: '#4d5e76', fontSize: 13, lineHeight: 18 }
});
