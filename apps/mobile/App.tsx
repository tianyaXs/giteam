import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  Image,
  InteractionManager,
  Keyboard,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  Vibration,
  View
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Network from 'expo-network';
import EventSource from 'react-native-sse';
import { FlashList } from '@shopify/flash-list';
import { StreamdownText } from 'react-native-streamdown';
import type { MarkdownStyle } from 'react-native-enriched-markdown';
import { Feather } from '@expo/vector-icons';
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
import { loadChatSnapshot, saveChatSnapshot } from './src/storage/chatSnapshot';
import { loadQuestionDismissals, saveQuestionDismissal } from './src/storage/questionDismissals';
import {
  abortSession,
  buildStreamUrl,
  createSession,
  getClientRepositories,
  getCurrentProject,
  getMessages,
  getInstalledOpencodeSkills,
  getOpencodeCommands,
  getOpencodeConfig,
  getOpencodeMcpStatus,
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
  ensureStreamSessionStores as storeEnsureStreamSessionStores,
  getKnownStreamMessageRole as storeGetKnownStreamMessageRole,
  getStoredStreamPart as storeGetStoredStreamPart,
  ingestStreamRows as storeIngestStreamRows,
  mergeStreamPart as storeMergeStreamPart,
  patchStoredStreamPartDelta as storePatchStoredStreamPartDelta,
  publishStreamRows as storePublishStreamRows,
  rawMessageId as storeRawMessageId,
  rawMessageRole as storeRawMessageRole,
  rawPartId as storeRawPartId,
  removeStreamPermission,
  removeStreamQuestion,
  resetOpenCodeStreamStores as storeResetOpenCodeStreamStores,
  setStreamSessionStatus,
  setStreamTodos,
  shouldStoreStreamPart as storeShouldStoreStreamPart,
  upsertStreamPermission,
  upsertStreamQuestion,
  type OpenCodeStreamStoreRefs,
  type StreamPartEvent
} from './src/features/messages/opencodeStore';
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
const IMAGE_SEND_TARGET_BASE64_LENGTH = 1_100_000;
const IMAGE_SEND_TIMEOUT_MS = 180000;
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
  attachments?: Array<{
    id: string;
    kind: 'image';
    uri: string;
    mime?: string;
    filename?: string;
  }>;
};

type ComposerAttachment = {
  id: string;
  uri: string;
  filename: string;
  mime: string;
  dataUrl: string;
  status?: 'processing' | 'ready' | 'uploading' | 'failed';
  statusText?: string;
};

type RecentImageItem = {
  id: string;
  uri: string;
  filename: string;
  mediaType?: string;
};

/** 会话列表稳定排序：时间降序，相同时间用 id 字典序（避免服务端/合并顺序不稳定） */
function stableSortSessionItems(items: SessionItem[]): SessionItem[] {
  const deduped = new Map<string, SessionItem>();
  for (const item of items) {
    const id = toText(item.id).trim();
    if (!id) continue;
    const prev = deduped.get(id);
    if (!prev) {
      deduped.set(id, { ...item, id });
      continue;
    }
    deduped.set(id, {
      id,
      title: toText(item.title) || prev.title,
      preview: toText(item.preview) || prev.preview,
      updatedAt: Math.max(Number(prev.updatedAt) || 0, Number(item.updatedAt) || 0),
      createdAt: Number(prev.createdAt || 0) || Number(item.createdAt || 0) || undefined
    });
  }
  return [...deduped.values()].sort((a, b) => {
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

type ComposerAgentName = 'build' | 'plan';

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

type OpencodeSlashCommand = {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  source: 'builtin' | 'command' | 'skill' | 'mcp';
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

const HANDWRITTEN_TEXT_FONT = Platform.select({
  ios: 'Kaiti SC',
  android: 'serif',
  default: undefined,
});

function MarkdownMessage(props: { text: string; tone: 'user' | 'assistant' | 'think' }) {
  const { text, tone } = props;
  const src = normalizeMarkdownForMobile(text);
  const isUser = tone === 'user';
  const isThink = tone === 'think';
  const textColor = isUser ? '#fffaf2' : isThink ? '#746b5e' : '#24211d';
  const mutedColor = isUser ? '#eadfce' : isThink ? '#8d826f' : '#7c766c';
  const headingColor = isUser ? '#ffffff' : isThink ? '#5f5749' : '#211e19';
  const codeBg = isUser ? 'rgba(38, 35, 29, 0.34)' : isThink ? '#eee8dc' : '#ece8df';
  const codeColor = isUser ? '#fffaf2' : '#3a352e';
  const markdownStyles = useMemo<MarkdownStyle>(() => ({
    paragraph: {
      color: textColor,
      fontSize: isThink ? 14 : 15,
      lineHeight: isThink ? 22 : 24,
      marginTop: 3,
      marginBottom: 3,
      fontFamily: HANDWRITTEN_TEXT_FONT
    },
    strong: { color: headingColor, fontWeight: 'bold', fontFamily: HANDWRITTEN_TEXT_FONT },
    em: { color: mutedColor, fontStyle: 'italic', fontFamily: HANDWRITTEN_TEXT_FONT },
    link: { color: isUser ? '#bfdbfe' : '#1768c2', underline: true, fontFamily: HANDWRITTEN_TEXT_FONT },
    h1: { color: headingColor, fontSize: 20, lineHeight: 27, fontWeight: '800', marginTop: 8, marginBottom: 6, fontFamily: HANDWRITTEN_TEXT_FONT },
    h2: { color: headingColor, fontSize: 18, lineHeight: 25, fontWeight: '800', marginTop: 6, marginBottom: 5, fontFamily: HANDWRITTEN_TEXT_FONT },
    h3: { color: headingColor, fontSize: 16, lineHeight: 23, fontWeight: '800', marginTop: 5, marginBottom: 4, fontFamily: HANDWRITTEN_TEXT_FONT },
    h4: { color: headingColor, fontSize: 15, lineHeight: 22, fontWeight: '800', marginTop: 4, marginBottom: 3, fontFamily: HANDWRITTEN_TEXT_FONT },
    h5: { color: headingColor, fontSize: 14, lineHeight: 21, fontWeight: '800', marginTop: 4, marginBottom: 3, fontFamily: HANDWRITTEN_TEXT_FONT },
    h6: { color: mutedColor, fontSize: 13, lineHeight: 20, fontWeight: '800', marginTop: 4, marginBottom: 3, fontFamily: HANDWRITTEN_TEXT_FONT },
    list: {
      color: textColor,
      fontSize: isThink ? 14 : 15,
      lineHeight: isThink ? 22 : 24,
      marginTop: 4,
      marginBottom: 4,
      marginLeft: 14,
      bulletColor: mutedColor,
      markerColor: mutedColor,
      gapWidth: 8,
      fontFamily: HANDWRITTEN_TEXT_FONT
    },
    code: {
      color: codeColor,
      backgroundColor: codeBg,
      borderColor: isUser ? 'rgba(234,223,206,0.22)' : '#ddd4c5',
      fontSize: 13,
      fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo'
    },
    codeBlock: {
      color: codeColor,
      backgroundColor: codeBg,
      borderColor: isUser ? 'rgba(234,223,206,0.22)' : '#ddd4c5',
      borderRadius: 12,
      borderWidth: 1,
      padding: 12,
      marginTop: 8,
      marginBottom: 8,
      fontSize: 13,
      fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo'
    },
    blockquote: {
      color: textColor,
      backgroundColor: isUser ? 'rgba(38, 35, 29, 0.18)' : '#f3eee5',
      borderColor: isUser ? '#eadfce' : '#c9b99f',
      borderWidth: 3,
      gapWidth: 9,
      marginTop: 8,
      marginBottom: 8,
      fontSize: isThink ? 14 : 15,
      lineHeight: isThink ? 22 : 24,
      fontFamily: HANDWRITTEN_TEXT_FONT
    },
    thematicBreak: { color: isUser ? 'rgba(234,223,206,0.35)' : '#ded6ca', height: 1, marginTop: 10, marginBottom: 10 },
    table: {
      color: textColor,
      fontSize: isThink ? 14 : 15,
      lineHeight: isThink ? 22 : 24,
      borderColor: isUser ? 'rgba(234,223,206,0.35)' : '#ddd4c5',
      borderWidth: 1,
      borderRadius: 10,
      cellPaddingHorizontal: 8,
      cellPaddingVertical: 8,
      headerTextColor: headingColor,
      headerBackgroundColor: isUser ? 'rgba(38, 35, 29, 0.20)' : '#f1eadf',
      rowEvenBackgroundColor: 'transparent',
      rowOddBackgroundColor: isUser ? 'rgba(38, 35, 29, 0.10)' : '#fbf7ef',
      fontFamily: HANDWRITTEN_TEXT_FONT
    }
  }), [codeBg, codeColor, headingColor, isThink, isUser, mutedColor, textColor]);

  return (
    <View style={styles.markdownBlock}>
      <StreamdownText
        markdown={src}
        markdownStyle={markdownStyles}
        containerStyle={styles.streamdownTextContainer}
        selectable
        remendConfig={{ katex: false }}
      />
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

function buildLiveTodoCard(sessionId: string, todos: any[]): MobileTodoCard | null {
  const sid = toText(sessionId).trim();
  const items = Array.isArray(todos)
    ? todos
        .map((todo: any, index: number) => {
          const id = toText(todo?.id).trim() || `todo:${index}`;
          const content = toText(todo?.content).trim();
          const status = toText(todo?.status).trim();
          if (!id || !content) return null;
          if (status !== 'pending' && status !== 'in_progress' && status !== 'completed' && status !== 'cancelled') return null;
          return {
            id,
            content,
            status,
            priority: toText(todo?.priority).trim() || undefined
          };
        })
        .filter(Boolean) as MobileTodoCard['items']
    : [];
  if (items.length === 0) return null;
  const done = items.filter((item) => item.status === 'completed').length;
  const active = items.find((item) => item.status === 'in_progress') || items.find((item) => item.status === 'pending') || items[items.length - 1] || null;
  return {
    id: `todo:stream:${sid || 'current'}`,
    title: 'Todo',
    summary: active ? `已完成 ${done}/${items.length} · ${active.content}` : `已完成 ${done}/${items.length}`,
    createdAt: Date.now(),
    items,
    finished: items.every((item) => item.status === 'completed' || item.status === 'cancelled')
  };
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
  const hasContent = toText(props.text).trim().length > 0;
  const steps = (props.active ? visible.slice(-3) : visible.slice(-2));
  const [lineIndex, setLineIndex] = useState(Math.max(0, visible.length - 1));
  const lineAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const dotAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setLineIndex(Math.max(0, visible.length - 1));
  }, [visible.length, props.text]);

  useEffect(() => {
    if (!props.active) {
      progressAnim.stopAnimation();
      progressAnim.setValue(0);
      dotAnim.stopAnimation();
      dotAnim.setValue(0);
      return;
    }
    dotAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(dotAnim, {
        toValue: 1,
        duration: 960,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true
      })
    );
    loop.start();
    return () => loop.stop();
  }, [dotAnim, progressAnim, props.active]);

  const currentLine = props.active
    ? (visible[Math.min(lineIndex, visible.length - 1)] || '正在整理思路...')
    : '已完成思考';
  const dotScaleA = dotAnim.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [0.72, 1.22, 0.82, 0.72] });
  const dotScaleB = dotAnim.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [0.82, 0.72, 1.22, 0.82] });
  const dotScaleC = dotAnim.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [1.12, 0.82, 0.72, 1.12] });
  const dotOpacityA = dotAnim.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [0.45, 1, 0.55, 0.45] });
  const dotOpacityB = dotAnim.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [0.55, 0.45, 1, 0.55] });
  const dotOpacityC = dotAnim.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: [1, 0.55, 0.45, 1] });
  return (
    <View style={styles.thinkFlowRow}>
      <View style={styles.thinkFlowIconShell}>
        <Text style={styles.thinkFlowIconText}>G</Text>
      </View>
      <View style={styles.thinkFlowContent}>
        <View style={hasContent ? styles.thinkFlowPill : styles.thinkFlowPillWaiting}>
          {props.active || !hasContent ? (
            <View style={styles.thinkFlowDots}>
              <Animated.View style={[styles.thinkFlowDot, { opacity: dotOpacityA, transform: [{ scale: dotScaleA }] }]} />
              <Animated.View style={[styles.thinkFlowDot, { opacity: dotOpacityB, transform: [{ scale: dotScaleB }] }]} />
              <Animated.View style={[styles.thinkFlowDot, { opacity: dotOpacityC, transform: [{ scale: dotScaleC }] }]} />
            </View>
          ) : null}
          {hasContent ? (
            <Animated.Text
              numberOfLines={1}
              style={[
                styles.thinkFlowLine,
                {
                  opacity: lineAnim,
                  transform: [{ translateY: lineAnim.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) }]
                }
              ]}
            >
              {currentLine}
            </Animated.Text>
          ) : null}
        </View>
        {hasContent ? (
          <Animated.View style={[styles.thinkFlowSteps, { opacity: lineAnim }]}> 
            {steps.map((step, index) => (
              <View key={`${index}:${step}`} style={styles.thinkFlowStepRow}>
                <View style={index === steps.length - 1 && props.active ? styles.thinkFlowStepDotLive : styles.thinkFlowStepDot} />
                <Text numberOfLines={1} style={styles.thinkFlowStepText}>{step}</Text>
              </View>
            ))}
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

function UserAttachmentStrip(props: {
  attachments?: Array<{ id: string; kind: 'image'; uri: string; filename?: string }>;
  onOpen: (item: { id: string; uri: string; filename?: string }) => void;
  onCopy: (uri: string) => void;
}) {
  const items = Array.isArray(props.attachments) ? props.attachments : [];
  if (items.length <= 0) return null;
  return (
    <View style={styles.userAttachmentStrip}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => props.onOpen(item)}
          onLongPress={() => props.onCopy(item.uri)}
          delayLongPress={260}
        >
          <Image source={{ uri: item.uri }} style={styles.userAttachmentImage} resizeMode="cover" />
        </Pressable>
      ))}
    </View>
  );
}

function normalizeMarkdownForMobile(input: string) {
  return toText(input)
    // Some server text is visually indented before markdown markers; marked treats 4-space indent as code.
    .replace(/^[ \t]{2,}(?=(?:\*\*|#{1,6}\s|[-*+]\s|\d+\.\s|>\s))/gm, '');
}

const STREAM_DEBUG = false;

function streamDebug(label: string, payload?: Record<string, unknown>) {
  if (!STREAM_DEBUG) return;
  try {
    console.log(`[GiteamStream] ${label}`, payload ? JSON.stringify(payload) : '');
  } catch {
    console.log(`[GiteamStream] ${label}`);
  }
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
  const swipeX = useRef(new Animated.Value(0)).current;
  const swipeResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => !!onClose && gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
    onPanResponderMove: (_, gesture) => {
      if (!onClose) return;
      swipeX.setValue(Math.min(96, Math.max(0, gesture.dx)));
    },
    onPanResponderRelease: (_, gesture) => {
      if (!onClose) return;
      if (gesture.dx > 72) {
        Animated.timing(swipeX, { toValue: 140, duration: 140, useNativeDriver: true }).start(() => onClose());
        return;
      }
      Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, tension: 110, friction: 12 }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, tension: 110, friction: 12 }).start();
    }
  }), [onClose, swipeX]);
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
  const dock = (
    <Animated.View style={{ transform: [{ translateX: swipeX }] }} {...(onClose ? swipeResponder.panHandlers : {})}>
      <Pressable style={compact ? styles.todoDockCompact : styles.todoDock} onPress={onToggle}>
        {content}
      </Pressable>
    </Animated.View>
  );
  if (!onClose) return dock;
  return (
    <View style={styles.todoSwipeShell}>
      <View style={styles.todoSwipeHint}><Text style={styles.todoSwipeHintText}>右滑关闭</Text></View>
      {dock}
    </View>
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
  onOpenImage: (item: { id: string; uri: string; filename?: string }) => void;
  onCopyImage: (uri: string) => void;
  expandedTimelineQuestions: Set<string>;
  onToggleTimelineQuestion: (id: string) => void;
  expandedThinkCards: Set<string>;
  onToggleThinkCard: (id: string) => void;
  timelineQuestionTabs: Map<string, number>;
  onChangeTimelineTab: (questionId: string, tabIndex: number) => void;
}) {
  const { turn, streaming, isLastTurn, thinkingPulse, hasLiveQuestion, liveQuestions, onQuestionReply, onCopyMessage, onOpenImage, onCopyImage, expandedTimelineQuestions, onToggleTimelineQuestion, expandedThinkCards, onToggleThinkCard, timelineQuestionTabs, onChangeTimelineTab } = props;
  const [, setMeasuredHeight] = useState(0);
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
            <UserAttachmentStrip attachments={turn.userMessage.attachments} onOpen={onOpenImage} onCopy={onCopyImage} />
            {toText(turn.userMessage.text).trim() ? (
              <Text style={styles.bubbleUserText}>{toText(turn.userMessage.text || '...')}</Text>
            ) : null}
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
                <View style={styles.contextHeadRow}>
                  <Text style={styles.contextTitle}>{toText(item.context.title || 'Context')}</Text>
                </View>
                {tools.length > 0 ? (
                  <View style={styles.contextTools}>
                    {tools.slice(0, 3).map((t) => (
                      <View key={t.id} style={styles.contextToolRow}>
                        <Text style={styles.contextToolTitle}>{toText(t.title || 'tool')}</Text>
                        <Text numberOfLines={1} style={styles.contextToolDetail}>
                          {toText(t.detail || t.mode || t.status || '执行完成')}
                        </Text>
                        {toText(t.detail) ? (
                          <Pressable hitSlop={8} style={styles.contextCopyBtn} onPress={() => onCopyMessage(toText(t.detail))}>
                            <Text style={styles.contextCopyText}>⧉</Text>
                          </Pressable>
                        ) : null}
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
          const title = toText(item.event.title || 'Event');
          const mode = toText(item.event.mode);
          const eventDetail = toText(item.event.detail);
          const detail = toText(item.event.detail || item.event.mode || item.event.status || '工具执行完成');
          const isWriteEvent = mode === '写入' || mode.toLowerCase() === 'write' || title === 'apply_patch';
          if (isWriteEvent) {
            const writeTitle = title === 'apply_patch' ? 'Patch' : 'Write';
            const summary = eventDetail.match(/^(Added|Modified|Deleted|新增|修改|删除)\s+(.+?)(?:\s+(\+\d+)\s+(-\d+))?$/);
            const actionLabel = summary
              ? ({ '新增': 'Added', '修改': 'Modified', '删除': 'Deleted' } as Record<string, string>)[summary[1]] || summary[1]
              : '';
            return (
              <View key={item.event.id} style={styles.eventWrap}>
                <View style={styles.writeEventCard}>
                  <View style={styles.writeEventHead}>
                    <View style={st === 'running' || st === 'pending' ? styles.writeEventDotRun : styles.writeEventDot} />
                    <Text numberOfLines={1} style={styles.writeEventTitle}>{writeTitle}</Text>
                    <Text style={styles.writeEventTime}>{formatClock(item.event.createdAt)}</Text>
                  </View>
                  {summary ? (
                    <View style={styles.writeEventSummaryRow}>
                      <Text style={styles.writeEventAction}>{actionLabel}</Text>
                      <Text numberOfLines={1} style={styles.writeEventFile}>{summary[2]}</Text>
                      {summary[3] ? <Text style={styles.writeEventAdd}>{summary[3]}</Text> : null}
                      {summary[4] ? <Text style={styles.writeEventDel}>{summary[4]}</Text> : null}
                    </View>
                  ) : eventDetail ? <Text numberOfLines={1} style={styles.writeEventDetail}>{eventDetail}</Text> : null}
                  {toText(item.event.output) ? <Text numberOfLines={3} style={styles.writeEventOutput}>{toText(item.event.output)}</Text> : null}
                </View>
              </View>
            );
          }
          const isShellEvent = title.toLowerCase() === 'bash' || mode.toLowerCase() === 'bash' || mode === '命令';
          return (
            <View key={item.event.id} style={styles.eventWrap}>
              <View style={[styles.eventCard, isShellEvent && styles.bashEventCard]}>
                <View style={styles.eventHead}>
                  <View style={isShellEvent ? (st === 'running' || st === 'pending' ? styles.bashEventDotRun : styles.bashEventDot) : dotStyle} />
                  <Text style={[styles.eventTitle, isShellEvent && styles.bashEventTitle]}>{title}</Text>
                  {mode ? <Text style={[styles.eventMode, isShellEvent && styles.bashEventMode]}>{mode}</Text> : null}
                  <Text style={[styles.eventTime, isShellEvent && styles.bashEventTime]}>{formatClock(item.event.createdAt)}</Text>
                </View>
                <Text style={[styles.eventDetail, isShellEvent && styles.bashEventDetail]}>{detail}</Text>
                {toText(item.event.output) ? <Text style={[styles.eventOutput, isShellEvent && styles.bashEventOutput]}>{toText(item.event.output)}</Text> : null}
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
                    <ThinkPreviewLines text={contentText} active={streaming && isLastTurn && !card.finished} />
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
  const user = [...messages].reverse().find((m) => m.role === 'user' && m.text.trim());
  return user ? user.text.slice(0, 42) : '新会话';
}

function isPlaceholderSessionTitle(input: string): boolean {
  const text = toText(input).trim();
  return !text || text === '新会话' || text === '新建线程' || text === 'New session' || text === 'newsession';
}

function pickSessionDisplayTitle(item: Pick<SessionItem, 'title' | 'preview' | 'id'>, fallbackMessages?: MobileChatMessage[]): string {
  const rawTitle = toText(item.title).trim();
  if (!isPlaceholderSessionTitle(rawTitle)) return rawTitle;
  const preview = toText(item.preview).trim();
  if (preview && !isPlaceholderSessionTitle(preview)) return preview.slice(0, 24);
  const userFallback = fallbackMessages?.find((message) => message.role === 'user' && toText(message.text).trim());
  if (userFallback) return toText(userFallback.text).trim().slice(0, 24);
  return rawTitle || '未命名会话';
}

function formatSessionTimestamp(input?: number): string {
  const value = Number(input || 0);
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameMonth = sameYear && date.getMonth() === now.getMonth();
  const sameDate = sameMonth && date.getDate() === now.getDate();
  if (sameDate) return formatClock(value);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return sameYear ? `${month}-${day}` : `${date.getFullYear()}/${month}/${day}`;
}

function assistantTextWeight(messages: MobileChatMessage[]): number {
  return messages
    .filter((m) => m.role === 'assistant')
    .reduce((sum, m) => sum + toText(m.text).length, 0);
}

function losesRenderedAssistant(prev: MobileChatMessage[], next: MobileChatMessage[]): boolean {
  const prevAssistant = assistantTextWeight(prev);
  if (prevAssistant <= 0) return false;
  const nextAssistant = assistantTextWeight(next);
  if (nextAssistant >= prevAssistant) return false;
  const prevLastUserIndex = Math.max(...prev.map((m, index) => (m.role === 'user' ? index : -1)));
  const nextLastUserIndex = Math.max(...next.map((m, index) => (m.role === 'user' ? index : -1)));
  if (prevLastUserIndex < 0 || nextLastUserIndex < 0) return false;
  const prevTailAssistant = prev.slice(prevLastUserIndex + 1).some((m) => m.role === 'assistant' && toText(m.text));
  const nextTailAssistant = next.slice(nextLastUserIndex + 1).some((m) => m.role === 'assistant' && toText(m.text));
  return prevTailAssistant && !nextTailAssistant;
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
  const mobileState = raw?.giteamMobileModelState && typeof raw.giteamMobileModelState === 'object' ? raw.giteamMobileModelState : {};
  const hiddenModels = new Set<string>(
    Array.isArray(mobileState?.hiddenModels) ? mobileState.hiddenModels.map((x: any) => String(x || '').trim()).filter(Boolean) : []
  );
  const modelLabels = mobileState?.modelLabels && typeof mobileState.modelLabels === 'object' ? mobileState.modelLabels : {};
  const addMobileModel = (value: any) => {
    const id = String(value || '').trim();
    if (!id || !id.includes('/') || hiddenModels.has(id) || out.has(id)) return;
    const idx = id.indexOf('/');
    const label = String((modelLabels as any)?.[id] || id.slice(idx + 1) || id).trim();
    out.set(id, { id, provider: id.slice(0, idx), label });
  };
  const availableModels = Array.isArray(mobileState?.availableModels) ? mobileState.availableModels : [];
  const enabledModels = Array.isArray(mobileState?.enabledModels) ? mobileState.enabledModels : [];
  for (const item of availableModels) addMobileModel(item);
  for (const item of enabledModels) addMobileModel(item);
  addMobileModel(mobileState?.activeModel);
  if (out.size > 0) return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));

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
  for (const hidden of hiddenModels) out.delete(hidden);
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeMcpStatusMap(raw: any): Record<string, any> {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw.mcp && typeof raw.mcp === 'object' && !Array.isArray(raw.mcp)
      ? raw.mcp
      : raw.mcpServers && typeof raw.mcpServers === 'object' && !Array.isArray(raw.mcpServers)
        ? raw.mcpServers
        : raw)
    : {};
  const out: Record<string, any> = {};
  if (Array.isArray(raw?.items) || Array.isArray(raw?.servers)) {
    const rows = Array.isArray(raw?.items) ? raw.items : raw.servers;
    for (const item of rows) {
      const name = toText(item?.name || item?.id).trim();
      if (name) out[name] = item;
    }
    return out;
  }
  for (const [key, value] of Object.entries(source as Record<string, any>)) {
    if (key === 'mcp' || key === 'mcpServers' || key === '$schema') continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    out[key] = value;
  }
  return out;
}

function toProjectOptionsFromPaths(paths: string[]): ProjectOption[] {
  const uniq = Array.from(new Set(paths.map((x) => toText(x).trim()).filter(Boolean)));
  return sanitizeProjectOptions(uniq.map((p) => ({
    id: p,
    worktree: p,
    name: projectNameFromPath(p)
  })));
}

function sanitizeProjectOptions(items: ProjectOption[]): ProjectOption[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const worktree = toText(item.worktree).trim();
    const name = toText(item.name || projectNameFromPath(worktree)).trim();
    if (!worktree || !name || worktree === '/' || name === '/') return false;
    if (seen.has(worktree)) return false;
    seen.add(worktree);
    return true;
  }).map((item) => ({
    ...item,
    name: toText(item.name || projectNameFromPath(item.worktree)).trim()
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
  const { width: windowWidth } = useWindowDimensions();
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
  const [composerAgent, setComposerAgent] = useState<ComposerAgentName>('build');
  const [autoAcceptPermissions, setAutoAcceptPermissions] = useState(false);
  const [composerPickerOpen, setComposerPickerOpen] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [installedSkills, setInstalledSkills] = useState<any[]>([]);
  const [installedMcpServers, setInstalledMcpServers] = useState<Array<{ name: string; status: any }>>([]);
  const [extensionsLoading, setExtensionsLoading] = useState(false);
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
  const [slashCommands, setSlashCommands] = useState<OpencodeSlashCommand[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [imageAttachments, setImageAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentPanelVisible, setAttachmentPanelVisible] = useState(false);
  const [recentImages, setRecentImages] = useState<RecentImageItem[]>([]);
  const [recentImagesLoading, setRecentImagesLoading] = useState(false);
  const [recentImagesLoadingMore, setRecentImagesLoadingMore] = useState(false);
  const [recentImagesCursor, setRecentImagesCursor] = useState<string | undefined>(undefined);
  const [recentImagesHasNext, setRecentImagesHasNext] = useState(false);
  const [albumPickerOpen, setAlbumPickerOpen] = useState(false);
  const [albumImages, setAlbumImages] = useState<RecentImageItem[]>([]);
  const [albumImagesLoading, setAlbumImagesLoading] = useState(false);
  const [albumImagesLoadingMore, setAlbumImagesLoadingMore] = useState(false);
  const [albumCursor, setAlbumCursor] = useState<string | undefined>(undefined);
  const [albumHasNext, setAlbumHasNext] = useState(false);
  const [mediaAlbums, setMediaAlbums] = useState<Array<{ id: string; title: string; assetCount?: number }>>([]);
  const [selectedMediaAlbumId, setSelectedMediaAlbumId] = useState<string>('all');
  const [albumSelectedIds, setAlbumSelectedIds] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<{ uri: string; filename?: string } | null>(null);
  const [photoCameraOpen, setPhotoCameraOpen] = useState(false);
  const [photoCameraReady, setPhotoCameraReady] = useState(false);
  const [photoCameraBusy, setPhotoCameraBusy] = useState(false);
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
  const [notebookPage, setNotebookPage] = useState<'left' | 'main' | 'right'>('main');
  const [notebookTheme, setNotebookTheme] = useState<'paper' | 'slate'>('paper');
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionNextCursor, setSessionNextCursor] = useState<Record<string, string>>({});
  const [sessionHasMore, setSessionHasMore] = useState<Record<string, boolean>>({});
  const [sessionHistoryRetryHint, setSessionHistoryRetryHint] = useState<Record<string, string>>({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [optimisticVersion, setOptimisticVersion] = useState(0);
  const [sessionDisplayedCount, setSessionDisplayedCount] = useState(10);
  const [showLatestJump, setShowLatestJump] = useState(false);
  const [inputDockHeight, setInputDockHeight] = useState(88);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [streamTodoCard, setStreamTodoCard] = useState<MobileTodoCard | null>(null);
  const [chatListResetKey, setChatListResetKey] = useState(0);
  const [startupSessionHydrating, setStartupSessionHydrating] = useState(false);

  const streamRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef('');
  const streamSessionRef = useRef('');
  const messageScrollRef = useRef<any>(null);
  const forceScrollToLatestUntilRef = useRef(0);
  const latestJumpVisibleRef = useRef(false);
  const latestJumpLastChangeRef = useRef(0);
  const projectsRef = useRef<ProjectOption[]>([]);
  const sessionsRef = useRef<SessionItem[]>([]);
  const messagesRef = useRef<MobileChatMessage[]>([]);
  const renderedTurnsRef = useRef<MobileRenderedTurn[]>([]);
  const sessionCacheRef = useRef<Record<string, SessionItem[]>>({});
  const discoverDevicesRef = useRef<DiscoverCacheDevice[]>([]);
  const modelOptionsRef = useRef<ModelOption[]>([]);
  const sessionRawMapRef = useRef<Record<string, any[]>>({});
  const sessionOptimisticUserMapRef = useRef<Record<string, OptimisticUserMessage[]>>({});
  const optimisticUserIdAliasRef = useRef<Record<string, Record<string, string>>>({});
  const sentAttachmentCacheRef = useRef<Record<string, Record<string, { at: number; attachments: NonNullable<OptimisticUserMessage['attachments']> }>>>({});
  const pendingPromptSessionRef = useRef<Record<string, { id: string; startedAt: number }>>({});
  const renderRegressionRetryRef = useRef<Record<string, number>>({});
  const streamMessageRoleRef = useRef<Record<string, Record<string, string>>>({});
  const streamMessageStoreRef = useRef<Record<string, Record<string, any>>>({});
  const streamPartStoreRef = useRef<Record<string, Record<string, Record<string, any>>>>({});
  const streamSessionStatusStoreRef = useRef<Record<string, SessionStatusInfo>>({});
  const streamPermissionStoreRef = useRef<Record<string, any[]>>({});
  const streamQuestionStoreRef = useRef<Record<string, QuestionRequest[]>>({});
  const streamTodoStoreRef = useRef<Record<string, any[]>>({});
  const streamPendingPartEventsRef = useRef<Record<string, Record<string, StreamPartEvent[]>>>({});
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
  const streamRenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamTypewriterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamTypewriterQueueRef = useRef<Record<string, { sid: string; messageId: string; partId: string; field: string; text: string }>>({});
  const sessionStatusEpochRef = useRef(0);
  const busySinceRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const recentImagesLoadingRef = useRef(false);
  const albumImagesLoadingRef = useRef(false);
  const discoverRunRef = useRef(0);
  const discoverAbortRef = useRef<AbortController | null>(null);

  function getOpenCodeStreamStores(): OpenCodeStreamStoreRefs {
    return {
      messageRole: streamMessageRoleRef,
      message: streamMessageStoreRef,
      part: streamPartStoreRef,
      sessionStatus: streamSessionStatusStoreRef,
      permission: streamPermissionStoreRef,
      question: streamQuestionStoreRef,
      todo: streamTodoStoreRef,
      pendingPartEvents: streamPendingPartEventsRef,
      rawRows: sessionRawMapRef
    };
  }
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
  const notebookTrackX = useRef(new Animated.Value(0)).current;
  const notebookPageIndexRef = useRef(1);
  const streamTopGlowAnim = useRef(new Animated.Value(0)).current;
  const streamTopGlowLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const streamTopGlowActiveRef = useRef(false);
  const streamTopGlowHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launchOverlayOpacity = useRef(new Animated.Value(1)).current;
  const actionIconAnim = useRef(new Animated.Value(1)).current;
  const attachmentPanelAnim = useRef(new Animated.Value(0)).current;
  const attachmentToggleAnim = useRef(new Animated.Value(0)).current;
  const photoCameraRef = useRef<any>(null);
  const [launchOverlayVisible, setLaunchOverlayVisible] = useState(true);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const authed = useMemo(() => token.trim().length > 0, [token]);
  const recentTileSize = Math.max(70, Math.floor((Math.max(320, windowWidth - 80) - 18) / 4));
  const recentVisibleRows = Math.max(1, Math.min(3, Math.ceil((recentImages.length || 1) / 4)));
  const recentScrollerHeight = recentVisibleRows * recentTileSize + Math.max(0, recentVisibleRows - 1) * 6 + 8;
  const albumSelectedSet = useMemo(() => new Set(albumSelectedIds), [albumSelectedIds]);
  const streamTopGlowRequested = false;
  const showStreamTopGlow = false;

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
    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      const height = Number(event.endCoordinates?.height || 0);
      setKeyboardInset(height > 0 ? height : 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardInset(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    setStreamTodoCard(null);
  }, [sessionId]);

  useEffect(() => {
    if (!loaded || !launchOverlayVisible || startupSessionHydrating) return;
    const timer = setTimeout(() => {
      Animated.timing(launchOverlayOpacity, {
        toValue: 0,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }).start(() => setLaunchOverlayVisible(false));
    }, 260);
    return () => clearTimeout(timer);
  }, [launchOverlayOpacity, launchOverlayVisible, loaded, startupSessionHydrating]);

  useEffect(() => {
    if (!startupSessionHydrating) return;
    const timer = setTimeout(() => setStartupSessionHydrating(false), 4500);
    return () => clearTimeout(timer);
  }, [startupSessionHydrating]);

  useEffect(() => {
    const index = notebookPage === 'left' ? 0 : notebookPage === 'right' ? 2 : 1;
    notebookPageIndexRef.current = index;
    Animated.spring(notebookTrackX, {
      toValue: -windowWidth * index,
      stiffness: 240,
      damping: 28,
      mass: 0.9,
      useNativeDriver: true
    }).start();
  }, [notebookPage, notebookTrackX, windowWidth]);

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
  const currentWorkspaceName = useMemo(
    () => (repoPath ? projectNameFromPath(repoPath) : '选择工作空间'),
    [repoPath]
  );
  const currentSessionTitle = useMemo(() => {
    const active = sessions.find((item) => item.id === sessionId);
    if (active) return pickSessionDisplayTitle(active, messages);
    const fallback = messages.find((item) => item.role === 'user' && toText(item.text).trim());
    return fallback ? toText(fallback.text).slice(0, 24) : 'newsession';
  }, [messages, sessionId, sessions]);
  const notebookColors = useMemo(() => {
    if (notebookTheme === 'slate') {
      return {
        shell: '#eef1f5',
        main: '#f7f8fa',
        left: '#eef1f5',
        right: '#eef1f5',
        paper: '#ffffff',
        text: '#2f3338',
        muted: '#6b737c',
        faint: '#8b939b',
        line: 'rgba(47,51,56,0.12)',
        chip: '#dfe6ee',
        chipText: '#4d5660',
        active: '#e7eaee',
        ink: '#1f2937',
        topControl: 'rgba(223,230,238,0.58)',
        topControlBorder: 'rgba(47,51,56,0.07)'
      };
    }
    return {
      shell: '#f7f3ea',
      main: '#f8f5ee',
      left: '#f7f3ea',
      right: '#f7f3ea',
      paper: '#fffdf7',
      text: '#24211d',
      muted: '#7c766c',
      faint: '#9a9182',
      line: 'rgba(65,54,38,0.10)',
      chip: '#ece8df',
      chipText: '#5d5345',
      active: '#f0e9dc',
      ink: '#24211d',
      topControl: 'rgba(236,232,223,0.62)',
      topControlBorder: 'rgba(65,54,38,0.10)'
    };
  }, [notebookTheme]);
  const workspaceSessionGroups = useMemo(() => {
    const rawProjects = projects.length > 0
      ? projects
      : repoPath
        ? [{ id: repoPath, name: projectNameFromPath(repoPath), worktree: repoPath }]
        : [];
    const seenWorktrees = new Set<string>();
    const knownProjects = rawProjects.filter((project) => {
      const key = toText(project.worktree || project.id || project.name).trim();
      if (!key || seenWorktrees.has(key)) return false;
      seenWorktrees.add(key);
      return true;
    });
    const q = sessionSearch.trim().toLowerCase();
    return knownProjects.map((project, projectIndex) => {
      const activeWorkspace = repoPath.trim() === project.worktree.trim();
      const source = activeWorkspace
        ? sessions
        : stableSortSessionItems(sessionCacheRef.current[project.worktree] || []);
      const filtered = q
        ? source.filter((s) => {
            const title = toText(s.title).toLowerCase();
            const preview = toText(s.preview).toLowerCase();
            return title.includes(q) || preview.includes(q) || s.id.toLowerCase().includes(q) || project.name.toLowerCase().includes(q);
          })
        : source;
      const limit = q ? filtered.length : Math.min(filtered.length, activeWorkspace ? sessionDisplayedCount : 6);
      return {
        key: `${project.worktree || project.id || project.name}:${projectIndex}`,
        project,
        activeWorkspace,
        sessions: filtered.slice(0, limit),
        total: filtered.length
      };
    }).filter((group) => !q || group.sessions.length > 0 || group.project.name.toLowerCase().includes(q));
  }, [projects, repoPath, sessionDisplayedCount, sessionSearch, sessions]);
  const availableProjects = useMemo(() => {
    const source = projects.length > 0 ? projects : projectsRef.current;
    const sanitized = sanitizeProjectOptions(source);
    if (sanitized.length > 0) return sanitized;
    const current = toText(repoPath).trim();
    return current ? sanitizeProjectOptions([{ id: current, worktree: current, name: projectNameFromPath(current) }]) : [];
  }, [projects, repoPath]);
  const currentWorkspaceSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    const source = sessions;
    if (!q) return source;
    return source.filter((s) => {
      const title = toText(s.title).toLowerCase();
      const preview = toText(s.preview).toLowerCase();
      return title.includes(q) || preview.includes(q) || s.id.toLowerCase().includes(q);
    });
  }, [sessionSearch, sessions]);
  const notebookPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15,
    onPanResponderGrant: () => {
      notebookTrackX.stopAnimation();
    },
    onPanResponderMove: (_, gesture) => {
      const baseX = -windowWidth * notebookPageIndexRef.current;
      const nextX = Math.min(0, Math.max(-windowWidth * 2, baseX + gesture.dx));
      notebookTrackX.setValue(nextX);
    },
    onPanResponderRelease: (_, gesture) => {
      const baseIndex = notebookPageIndexRef.current;
      const threshold = windowWidth * 0.14;
      let nextIndex = baseIndex;
      if (gesture.dx < -threshold || gesture.vx < -0.35) nextIndex = Math.min(2, baseIndex + 1);
      else if (gesture.dx > threshold || gesture.vx > 0.35) nextIndex = Math.max(0, baseIndex - 1);
      const nextPage = nextIndex === 0 ? 'left' : nextIndex === 2 ? 'right' : 'main';
      if (nextPage === 'left') openDrawer('left');
      else if (nextPage === 'right') openDrawer('right');
      else closeDrawer();
    },
    onPanResponderTerminate: () => {
      switchNotebookPage(notebookPage);
    }
  }), [notebookPage, notebookTrackX, windowWidth]);
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
    void (async () => {
      const prefs = await loadPrefs();
      if (!alive) return;
      const cachedChat = prefs.token && prefs.repoPath && prefs.sessionId
        ? await loadChatSnapshot(prefs.repoPath, prefs.sessionId)
        : null;
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
      setComposerAgent(prefs.agent || 'build');
      setAutoAcceptPermissions(Boolean((prefs as any).autoAcceptPermissions));
      setNotebookTheme(prefs.notebookTheme || 'paper');
      if (cachedChat) {
        setMessages(cachedChat.messages);
        setRenderedTurns(cachedChat.renderedTurns);
        messagesRef.current = cachedChat.messages;
        renderedTurnsRef.current = cachedChat.renderedTurns;
      }
      setStartupSessionHydrating(Boolean(prefs.token && prefs.repoPath && prefs.sessionId && !cachedChat));
      setModel(prefs.model || '');
      setLoaded(true);
      const pname = projectNameFromPath(toText(prefs.repoPath));
      setSuggestions(pickRandomQuestions(buildProjectQuestionPool(pname), 3));
    })();
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
      model,
      agent: composerAgent,
      autoAcceptPermissions,
      notebookTheme
    });
  }, [loaded, serverUrl, serverUrlTouched, preferHttps, pairCode, repoPath, projects, token, sessionId, model, composerAgent, autoAcceptPermissions, notebookTheme]);

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
    return () => { cancelled = true; };
  }, [repoPath, serverUrl, token]);

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
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    renderedTurnsRef.current = renderedTurns;
  }, [renderedTurns]);

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
    void (async () => {
      try {
        await syncSessionMessages(sessionId, {
          limit: INITIAL_SESSION_LIMIT,
          fetchLimit: INITIAL_MESSAGE_FETCH_LIMIT
        });
        await syncSessionStatus(sessionId);
      } finally {
        setStartupSessionHydrating(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, authed, sessionId, repoPath]);

  useEffect(() => {
    if (!loaded || !authed || !repoPath || sessionId) return;
    setStartupSessionHydrating(false);
  }, [loaded, authed, repoPath, sessionId]);

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

  useEffect(() => {
    busySinceRef.current = busy ? Date.now() : 0;
  }, [busy]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;
      if (!prevState.match(/inactive|background/) || nextState !== 'active') return;
      const sid = toText(sessionIdRef.current).trim();
      if (!sid || !authed || !repoPath) {
        setBusy(false);
        return;
      }
      const pending = pendingPromptSessionRef.current[sid];
      const busyForMs = busySinceRef.current ? Date.now() - busySinceRef.current : 0;
      if (pending && Date.now() - pending.startedAt > 15000) {
        delete pendingPromptSessionRef.current[sid];
      }
      if (busyForMs > 8000 || pending || streaming) {
        setStatus('正在恢复会话状态...');
        setBusy(false);
        void syncSessionMessages(sid, {
          limit: INITIAL_SESSION_LIMIT,
          fetchLimit: INITIAL_MESSAGE_FETCH_LIMIT
        });
        void syncSessionStatus(sid).then((info) => {
          if (info?.type === 'busy' || info?.type === 'retry') {
            setStatus('服务端仍在处理，正在接回流式输出...');
            startStream(sid);
          } else {
            setStreaming(false);
            setStatus('会话已恢复');
          }
        });
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, repoPath, streaming]);

  function stopStream() {
    streamRunIdRef.current += 1;
    sessionStatusEpochRef.current += 1;
    if (streamRef.current) {
      pushConnLog('SSE close');
      streamRef.current.close();
      streamRef.current = null;
    }
    if (streamRenderTimerRef.current) {
      clearTimeout(streamRenderTimerRef.current);
      streamRenderTimerRef.current = null;
    }
    if (streamTypewriterTimerRef.current) {
      clearTimeout(streamTypewriterTimerRef.current);
      streamTypewriterTimerRef.current = null;
    }
    streamTypewriterQueueRef.current = {};
    streamSessionRef.current = '';
    resetOpenCodeStreamStores();
    setStreamTodoCard(null);
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
        if (local.attachments?.length) {
          sentAttachmentCacheRef.current[sid] = {
            ...(sentAttachmentCacheRef.current[sid] || {}),
            [`id:${matched.id}`]: { at: Date.now(), attachments: local.attachments },
            [`id:${local.id}`]: { at: Date.now(), attachments: local.attachments },
            [`text:${text}`]: { at: Date.now(), attachments: local.attachments },
          };
        }
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
      nextMessages.push({ id: item.id, role: 'user', text: item.text, createdAt: item.createdAt, attachments: item.attachments });
      nextTurns.push({
        id: `turn:optimistic:${item.id}`,
        createdAt: item.createdAt,
        userMessage: { id: item.id, role: 'user', text: item.text, createdAt: item.createdAt, attachments: item.attachments },
        items: [],
        signature: `optimistic:${item.id}:${item.text.length}:${item.attachments?.length || 0}`
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
    forceScrollToLatestUntilRef.current = Date.now() + 45000;
    setMessages([{ id: message.id, role: 'user', text: message.text, createdAt: message.createdAt, attachments: message.attachments }]);
    setRenderedTurns([
      {
        id: `turn:optimistic:${message.id}`,
        createdAt: message.createdAt,
        userMessage: { id: message.id, role: 'user', text: message.text, createdAt: message.createdAt, attachments: message.attachments },
        items: [],
        signature: `optimistic:${message.id}:${message.text.length}:${message.attachments?.length || 0}`
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
    if (messageUserScrollingRef.current) return;
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
    if (drawerSide === side && notebookPage === side) return;
    setComposerPickerOpen(false);
    setWorkspaceSwitcherOpen(false);
    setDrawerSide(side);
    switchNotebookPage(side);
    void InteractionManager.runAfterInteractions(() => {
      if (side === 'left') {
        void refreshProjectsCatalog();
        void refreshSessionsFromServer();
      }
      else void refreshInstalledExtensions();
    });
  }

  async function refreshInstalledExtensions() {
    const repo = toText(repoPath).trim();
    if (!authed || !repo || !serverUrl || !token) {
      console.log('[extensions] skip: no auth', { authed, repo: !!repo, serverUrl: !!serverUrl, token: !!token });
      return;
    }
    setExtensionsLoading(true);
    try {
      console.log('[extensions] fetching...');
      const [skills, mcp, cfg] = await Promise.all([
        getInstalledOpencodeSkills({ baseUrl: serverUrl, token, repoPath: repo }).catch((err: unknown) => {
          console.log('[extensions] skills error:', err);
          return [];
        }),
        getOpencodeMcpStatus({ baseUrl: serverUrl, token, repoPath: repo }).catch((err: unknown) => {
          console.log('[extensions] mcp error:', err);
          return {};
        }),
        getOpencodeConfig({ baseUrl: serverUrl, token, repoPath: repo }).catch((err: unknown) => {
          console.log('[extensions] config fallback error:', err);
          return {};
        })
      ]);
      const mcpMap = {
        ...normalizeMcpStatusMap(cfg),
        ...normalizeMcpStatusMap(mcp)
      };
      console.log('[extensions] skills:', skills?.length, 'mcp keys:', Object.keys(mcpMap).length);
      setInstalledSkills(Array.isArray(skills) ? skills : []);
      setInstalledMcpServers(Object.entries(mcpMap).map(([name, status]) => ({ name, status })));
    } finally {
      setExtensionsLoading(false);
    }
  }

  useEffect(() => {
    if (notebookPage !== 'right') return;
    void refreshInstalledExtensions();
  }, [notebookPage, repoPath, serverUrl, token, authed]);

  function closeDrawer() {
    setDrawerSide('');
    setWorkspaceSwitcherOpen(false);
    switchNotebookPage('main');
  }

  function switchNotebookPage(next: 'left' | 'main' | 'right') {
    if (notebookPage === next) return;
    setNotebookPage(next);
  }

  const renderLeftDrawerContent = useCallback(() => (
    <View style={[styles.drawerPanelLeft, { backgroundColor: notebookColors.left }]}> 
      <View style={styles.drawerHead}>
        <Text maxFontSizeMultiplier={1.05} style={[styles.drawerTitle, styles.leftHandText, { color: notebookColors.text }]}>Giteam</Text>
      </View>
      <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerList} showsVerticalScrollIndicator={false}>
        <View style={styles.leftSectionBlock}>
          <Text style={[styles.leftSectionLabel, { color: notebookColors.faint }]}>Workspace</Text>
          <View style={styles.leftProjectRow}>
            <Pressable
              style={styles.leftProjectMain}
              onPress={() => setWorkspaceSwitcherOpen((v) => !v)}
            >
              <View style={[styles.leftProjectIconBox, { borderColor: notebookColors.line, backgroundColor: notebookColors.paper }]}> 
                <Feather name="folder" size={15} color={notebookColors.text} />
              </View>
              <View style={styles.leftProjectTextBlock}>
                <View style={styles.leftProjectTitleRow}>
                  <Text numberOfLines={1} style={[styles.workspaceSwitcherTitle, { color: notebookColors.text }]}>{currentWorkspaceName}</Text>
                  <Feather name="chevron-down" size={15} color={notebookColors.faint} />
                </View>
                <Text numberOfLines={1} style={[styles.workspaceSwitcherSub, { color: notebookColors.muted }]}>当前工作区</Text>
              </View>
            </Pressable>
            <Pressable
              style={[styles.leftProjectCompose, { borderColor: notebookColors.line, backgroundColor: notebookColors.paper }]}
              onPress={() => { onNewSession(); closeDrawer(); }}
            >
              <Feather name="edit-3" size={16} color={notebookColors.muted} />
            </Pressable>
          </View>
          {workspaceSwitcherOpen ? (
            <View style={[styles.workspaceSwitcherSheetInline, { borderColor: notebookColors.line, backgroundColor: notebookColors.paper }]}> 
              {availableProjects.map((project) => {
                const active = repoPath.trim() === project.worktree.trim();
                return (
                  <Pressable
                    key={project.worktree}
                    style={styles.workspaceSwitcherInlineItem}
                    onPress={() => {
                      setWorkspaceSwitcherOpen(false);
                      if (active) return;
                      void onSwitchProject(project.worktree);
                    }}
                  >
                    <Text numberOfLines={1} style={[styles.workspaceSwitcherItemTitle, { color: active ? notebookColors.text : notebookColors.muted }]}>{toText(project.name)}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
        <View style={styles.leftSearchShell}>
          <Feather name="search" size={18} color={notebookColors.faint} />
          <TextInput
            style={[styles.drawerSessionSearchMinimal, { color: notebookColors.text }]}
            value={sessionSearch}
            onChangeText={setSessionSearch}
            autoCapitalize="none"
            placeholder="搜索会话"
            placeholderTextColor={notebookColors.faint}
          />
        </View>
        <Animated.View style={{ opacity: leftDrawerPulse }}>
          <View style={styles.directoryGroupPlain}>
            {currentWorkspaceSessions.slice(0, sessionSearch.trim() ? currentWorkspaceSessions.length : sessionDisplayedCount).map((s) => {
              const active = s.id === sessionId;
              const title = pickSessionDisplayTitle(s, active ? messages : undefined);
              const preview = toText(s.preview).trim();
              const timeLabel = formatSessionTimestamp(s.updatedAt || s.createdAt);
              return (
                <Pressable
                  key={`${repoPath}:${s.id}`}
                  style={active ? [styles.directorySessionPlainRow, styles.directorySessionPlainRowActive] : styles.directorySessionPlainRow}
                  onPress={() => {
                    stopStream();
                    setActiveSession(s.id);
                    closeDrawer();
                  }}
                >
                  <View style={active ? styles.leftSessionRailActive : styles.leftSessionRail} />
                  <View style={styles.directorySessionPlainBody}>
                    <View style={styles.directorySessionPlainHead}>
                      <Text maxFontSizeMultiplier={1.08} numberOfLines={1} style={[active ? styles.directorySessionPlainTitleActive : styles.directorySessionPlainTitle, { color: notebookColors.text }]}>{title}</Text>
                      {timeLabel ? <Text style={[styles.directorySessionPlainTime, { color: notebookColors.faint }]}>{timeLabel}</Text> : null}
                    </View>
                    {preview ? <Text numberOfLines={1} style={[styles.directorySessionPlainMeta, { color: active ? notebookColors.muted : notebookColors.faint }]}>{preview}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
          {!sessionSearch.trim() && currentWorkspaceSessions.length > sessionDisplayedCount ? (
            <Pressable style={styles.drawerMoreBtn} onPress={() => setSessionDisplayedCount((p) => Math.min(p + 5, currentWorkspaceSessions.length))}>
              <Text style={[styles.drawerMoreTxt, { color: notebookColors.muted }]}>查看更多会话</Text>
            </Pressable>
          ) : null}
        </Animated.View>
        {currentWorkspaceSessions.length === 0 ? <Text style={[styles.drawerEmpty, styles.leftHandText, { color: notebookColors.muted }]}>暂无匹配会话</Text> : null}
      </ScrollView>
    </View>
  ), [availableProjects, currentWorkspaceName, currentWorkspaceSessions, leftDrawerPulse, notebookColors, notebookTheme, projects.length, repoPath, sessionDisplayedCount, sessionId, sessionSearch, sessions.length, workspaceSwitcherOpen]);

  const renderRightDrawerContent = useCallback(() => (
    <View style={[styles.drawerPanelRight, { backgroundColor: notebookColors.right }]}> 
      <View style={styles.drawerHead}>
        <View style={styles.drawerHeadTop}>
          <View>
            <Text style={[styles.drawerEyebrow, styles.rightHandText, { color: notebookColors.faint }]}>Capabilities</Text>
            <Text style={[styles.drawerTitle, styles.rightHandText, { color: notebookColors.text }]}>Tools</Text>
            <Text style={[styles.drawerModelStatus, styles.rightHandText, { color: notebookColors.muted }]}>Skills and MCP bookmarks for this task</Text>
          </View>
        </View>
      </View>
      <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerList}>
        <Animated.View style={{ opacity: rightDrawerPulse }}>
          <View style={[styles.extensionSectionCard, { backgroundColor: notebookColors.paper, borderColor: notebookColors.line }]}> 
            <View style={styles.extensionSectionHead}>
              <View style={styles.extensionHeroOrb}>
                <Text style={styles.extensionHeroOrbText}>S</Text>
              </View>
              <View style={styles.extensionHeroCopy}>
                <Text style={styles.extensionHeroTitle}>Skills</Text>
                <Text style={styles.extensionHeroSub}>
                  {installedSkills.length > 0 ? `${installedSkills.length} available` : 'No skills'}
                </Text>
              </View>
            </View>
            {installedSkills.length > 0 ? (
              installedSkills.map((skill, idx) => {
                const name = toText(
                  skill?.name ||
                  skill?.title ||
                  skill?.id ||
                  skill?.spec ||
                  (typeof skill === 'string' ? skill : null) ||
                  `Skill ${idx + 1}`
                );
                const desc = toText(
                  skill?.description ||
                  skill?.path ||
                  skill?.location ||
                  skill?.source ||
                  skill?.config?.description ||
                  'Installed skill'
                );
                return (
                  <View key={`skill-${idx}-${name}`} style={styles.extensionCard}>
                    <View style={styles.extensionCardIcon}>
                      <Feather name="zap" size={14} color="#5d5345" />
                    </View>
                    <View style={styles.extensionCardMain}>
                      <Text numberOfLines={1} style={styles.extensionCardTitle}>{name}</Text>
                      {desc ? <Text numberOfLines={2} style={styles.extensionCardSub}>{desc}</Text> : null}
                    </View>
                  </View>
                );
              })
            ) : !extensionsLoading ? (
              <Text style={[styles.drawerEmpty, styles.rightHandText]}>No installed skills</Text>
            ) : null}
          </View>

          <View style={[styles.extensionSectionCard, { backgroundColor: notebookColors.paper, borderColor: notebookColors.line }]}> 
            <View style={styles.extensionSectionHead}>
              <View style={styles.extensionHeroOrbAlt}>
                <Text style={styles.extensionHeroOrbText}>M</Text>
              </View>
              <View style={styles.extensionHeroCopy}>
                <Text style={styles.extensionHeroTitle}>MCP</Text>
                <Text style={styles.extensionHeroSub}>
                  {installedMcpServers.length > 0 ? `${installedMcpServers.length} servers` : 'No MCP servers'}
                </Text>
              </View>
            </View>

            {installedMcpServers.length > 0 ? (
              installedMcpServers.map(({ name, status }) => {
                const type = toText(
                  status?.type ||
                  status?.config?.type ||
                  status?.transport ||
                  'mcp'
                );
                const state = toText(
                  status?.status ||
                  status?.state ||
                  (status?.connected ? 'Connected' : 'Configured')
                );
                return (
                  <View key={`mcp-${name}`} style={styles.extensionCard}>
                    <View style={styles.extensionCardIconMcp}>
                      <Feather name="server" size={14} color="#5d5345" />
                    </View>
                    <View style={styles.extensionCardMain}>
                      <View style={styles.extensionCardTitleRow}>
                        <Text numberOfLines={1} style={styles.extensionCardTitle}>{name}</Text>
                        <Text style={styles.extensionStatePill}>{state}</Text>
                      </View>
                      <Text numberOfLines={1} style={styles.extensionCardSub}>{type}</Text>
                    </View>
                  </View>
                );
              })
            ) : !extensionsLoading ? (
              <Text style={[styles.drawerEmpty, styles.rightHandText]}>No configured MCP servers</Text>
            ) : null}
          </View>

          {extensionsLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <ActivityIndicator size="small" color="#7c766c" />
              <Text style={[styles.drawerEmpty, styles.rightHandText, { marginTop: 8 }]}>Loading extensions...</Text>
            </View>
          ) : null}
        </Animated.View>
      </ScrollView>
    </View>
  ), [extensionsLoading, installedMcpServers, installedSkills, notebookColors, rightDrawerPulse]);

  function upsertSession(nextSessionId: string, nextMessages: MobileChatMessage[]) {
    if (!nextSessionId) return;
    const preview = summarizePreview(nextMessages);
    setSessions((prev) => {
      const prevEntry = prev.find((s) => s.id === nextSessionId);
      const fallbackTitle = nextMessages.find((m) => m.role === 'user' && m.text.trim())?.text.slice(0, 24) || '新会话';
      const nextRow: SessionItem = {
        id: nextSessionId,
        title: toText(prevEntry?.title).trim() || fallbackTitle,
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
      const normalizedCached = stableSortSessionItems(cached);
      const prevIds = new Set(sessionsRef.current.map((x) => x.id));
      const hasNew = normalizedCached.some((x) => !prevIds.has(x.id));
      sessionsRef.current = normalizedCached;
      setSessions(normalizedCached);
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
    const prevTitleMap = new Map(prev.map((x) => [x.id, x.title]));
    const previewMap = new Map(prev.map((x) => [x.id, x.preview]));
    const merged = stableSortSessionItems(next.map((s) => ({
      id: s.id,
      title: isPlaceholderSessionTitle(s.title) && !isPlaceholderSessionTitle(toText(prevTitleMap.get(s.id)))
        ? toText(prevTitleMap.get(s.id))
        : s.title,
      preview: previewMap.get(s.id) || '',
      updatedAt: s.updatedAt,
      createdAt: s.createdAt
    })));
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
    const storeRows = publishStreamRows(targetSessionId);
    const merged = storeRows.length > 0 ? storeRows : (Array.isArray(sessionRawMapRef.current[targetSessionId]) ? sessionRawMapRef.current[targetSessionId] : []);
    const baseRendered = buildTurnWindow(merged, visibleTurnCount);
    const optimistic = reconcileOptimisticUserMessages(targetSessionId, baseRendered.chatMessages);
    const stableBaseRendered = stabilizeServerUserTurnIds(targetSessionId, baseRendered);
    const rendered = overlayOptimisticTurns(stableBaseRendered, optimistic);
    sessionVisibleTurnCountRef.current[targetSessionId] = rendered.visibleTurnCount;
    sessionTotalTurnCountRef.current[targetSessionId] = rendered.totalTurnCount;
    const cacheNow = Date.now();
    const nextCache = { ...(sentAttachmentCacheRef.current[targetSessionId] || {}) };
    for (const message of rendered.chatMessages) {
      if (message.role !== 'user' || !message.attachments?.length) continue;
      const text = toText(message.text).trim();
      nextCache[`id:${message.id}`] = { at: cacheNow, attachments: message.attachments };
      if (text) nextCache[`text:${text}`] = { at: cacheNow, attachments: message.attachments };
    }
    sentAttachmentCacheRef.current[targetSessionId] = nextCache;
    const cachedAttachments = sentAttachmentCacheRef.current[targetSessionId] || {};
    const now = Date.now();
    const withPersistedAttachments = (message: MobileChatMessage): MobileChatMessage => {
      if (message.role !== 'user') return message;
      const key = toText(message.text).trim();
      const cached = cachedAttachments[`id:${message.id}`] || cachedAttachments[`text:${key}`];
      if (cached && now - cached.at < 24 * 60 * 60 * 1000 && cached.attachments.length) {
        return { ...message, attachments: cached.attachments };
      }
      if (message.attachments?.length) return message;
      return message;
    };
    let nextMessages = rendered.chatMessages.map(withPersistedAttachments);
    let nextTurns = rendered.renderedTurns.map((turn) => turn.userMessage ? ({ ...turn, userMessage: withPersistedAttachments(turn.userMessage) }) : turn);
    if (targetSessionId === sessionIdRef.current && losesRenderedAssistant(messagesRef.current, nextMessages)) {
      pushConnLog(`render guard sid=${targetSessionId} reason=assistant regression prev=${assistantTextWeight(messagesRef.current)} next=${assistantTextWeight(nextMessages)}`);
      nextMessages = messagesRef.current;
      nextTurns = renderedTurnsRef.current;
      const lastRetryAt = renderRegressionRetryRef.current[targetSessionId] || 0;
      if (Date.now() - lastRetryAt > 5000) {
        renderRegressionRetryRef.current[targetSessionId] = Date.now();
        setTimeout(() => {
          if (targetSessionId === sessionIdRef.current) {
            void syncSessionMessages(targetSessionId, {
              limit: Math.max(INITIAL_SESSION_LIMIT, sessionVisibleTurnCountRef.current[targetSessionId] || 0),
              fetchLimit: INITIAL_MESSAGE_FETCH_LIMIT
            });
          }
        }, 1200);
      }
    }
    setMessages(nextMessages);
    setRenderedTurns(nextTurns);
    if (targetSessionId === sessionIdRef.current && repoPath.trim() && nextTurns.length > 0) {
      void saveChatSnapshot({
        repoPath,
        sessionId: targetSessionId,
        messages: nextMessages,
        renderedTurns: nextTurns,
        updatedAt: Date.now()
      });
    }
    upsertSession(targetSessionId, nextMessages);
    const nextCursor = toText(nextCursorHint ?? sessionNextCursor[targetSessionId]).trim();
    const hiddenInCache = rendered.totalTurnCount > rendered.visibleTurnCount;
    setSessionHasMore((prev) => ({ ...prev, [targetSessionId]: !!nextCursor || hiddenInCache }));
    return rendered;
  }

  function rawMessageRole(row: any) {
    return storeRawMessageRole(row);
  }

  function rawMessageId(row: any) {
    return storeRawMessageId(row);
  }

  function rawPartId(part: any, index = 0) {
    return storeRawPartId(part, index);
  }

  function mergeStreamPart(prev: any, incoming: any) {
    return storeMergeStreamPart(prev, incoming);
  }

  function shouldStoreStreamPart(part: any) {
    return storeShouldStoreStreamPart(part);
  }

  function resetOpenCodeStreamStores() {
    storeResetOpenCodeStreamStores(getOpenCodeStreamStores());
  }

  function ensureStreamSessionStores(targetSessionId: string) {
    return storeEnsureStreamSessionStores(getOpenCodeStreamStores(), targetSessionId);
  }

  function composeStreamRows(targetSessionId: string) {
    return storePublishStreamRows(getOpenCodeStreamStores(), targetSessionId);
  }

  function publishStreamRows(targetSessionId: string) {
    return storePublishStreamRows(getOpenCodeStreamStores(), targetSessionId);
  }

  function ingestStreamRows(targetSessionId: string, rows: any[]) {
    return storeIngestStreamRows(getOpenCodeStreamStores(), targetSessionId, rows);
  }

  function getKnownStreamMessageRole(targetSessionId: string, messageId: string) {
    return storeGetKnownStreamMessageRole(getOpenCodeStreamStores(), targetSessionId, messageId);
  }

  function queueStreamPartEvent(targetSessionId: string, messageId: string, event: StreamPartEvent) {
    const sid = toText(targetSessionId).trim();
    const mid = toText(messageId).trim();
    if (!sid || !mid) return;
    const bySession = streamPendingPartEventsRef.current[sid] || {};
    const list = bySession[mid] || [];
    bySession[mid] = [...list, event];
    streamPendingPartEventsRef.current[sid] = bySession;
    streamDebug('stream.part.pending', { sid, messageId: mid, kind: event.kind, count: bySession[mid].length });
  }

  function dropPendingStreamPartEvents(targetSessionId: string, messageId: string) {
    const sid = toText(targetSessionId).trim();
    const mid = toText(messageId).trim();
    const bySession = streamPendingPartEventsRef.current[sid];
    if (!bySession || !bySession[mid]) return;
    streamDebug('stream.part.drop', { sid, messageId: mid, count: bySession[mid].length });
    delete bySession[mid];
  }

  function flushPendingStreamPartEvents(targetSessionId: string, messageId: string) {
    const sid = toText(targetSessionId).trim();
    const mid = toText(messageId).trim();
    const bySession = streamPendingPartEventsRef.current[sid];
    const pending = bySession?.[mid] || [];
    if (pending.length <= 0) return;
    delete bySession[mid];
    streamDebug('stream.part.flush', { sid, messageId: mid, count: pending.length });
    for (const event of pending) {
      if (event.kind === 'delta') applyAssistantDeltaNow(sid, event.payload);
      else if (event.kind === 'part') applyAssistantPartNow(sid, event.payload);
      else applyPartRemovedNow(sid, event.payload);
    }
  }

  function applyStreamMessageInfo(targetSessionId: string, payload: unknown) {
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const info = source?.info;
    const sid = toText(source?.sessionId || source?.sessionID || info?.sessionID || targetSessionId).trim();
    if (!sid || sid !== sessionIdRef.current || !info || typeof info !== 'object') return;
    const mid = toText(info?.id).trim();
    if (!mid) return;
    const rows = ingestStreamRows(sid, [{ info, parts: [] }]);
    recordStreamMessageRoles(sid, rows);
    renderStreamWindow(sid);
  }

  function applyStreamMessageRemoved(targetSessionId: string, payload: unknown) {
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const sid = toText(source?.sessionId || source?.sessionID || targetSessionId).trim();
    const mid = toText(source?.messageId || source?.messageID).trim();
    if (!sid || sid !== sessionIdRef.current || !mid) return;
    delete streamMessageStoreRef.current[sid]?.[mid];
    delete streamPartStoreRef.current[sid]?.[mid];
    delete streamMessageRoleRef.current[sid]?.[mid];
    dropPendingStreamPartEvents(sid, mid);
    publishStreamRows(sid);
    renderStreamWindow(sid);
  }

  function applyPartRemoved(targetSessionId: string, payload: unknown) {
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const messageId = toText(source?.messageId || source?.messageID).trim();
    const role = getKnownStreamMessageRole(targetSessionId, messageId);
    if (!role) {
      queueStreamPartEvent(targetSessionId, messageId, { kind: 'part_removed', payload });
      return;
    }
    applyPartRemovedNow(targetSessionId, payload);
  }

  function applyPartRemovedNow(targetSessionId: string, payload: unknown) {
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const sid = toText(source?.sessionId || source?.sessionID || targetSessionId).trim();
    const messageId = toText(source?.messageId || source?.messageID).trim();
    const partId = toText(source?.partId || source?.partID).trim();
    if (!sid || sid !== sessionIdRef.current || !messageId || !partId) return;
    const partMap = streamPartStoreRef.current[sid]?.[messageId];
    if (!partMap?.[partId]) return;
    delete partMap[partId];
    if (Object.keys(partMap).length === 0 && streamPartStoreRef.current[sid]) delete streamPartStoreRef.current[sid][messageId];
    publishStreamRows(sid);
    renderStreamWindow(sid);
  }

  function refreshQuestionRequestsFromStore(targetSessionId: string) {
    const sid = toText(targetSessionId).trim();
    const live = (streamQuestionStoreRef.current[sid] || []) as QuestionRequest[];
    const fromParts = extractQuestionRequests(sessionRawMapRef.current[sid] || [], sid);
    const merged = new Map<string, QuestionRequest>();
    [...fromParts, ...live].forEach((req) => {
      if (!req?.id || dismissedQuestions.has(req.id)) return;
      merged.set(req.id, req);
    });
    setQuestionRequests([...merged.values()]);
  }

  function applyStreamTodo(targetSessionId: string, payload: unknown) {
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const sid = toText(source?.sessionID || source?.sessionId || targetSessionId).trim();
    if (!sid || sid !== sessionIdRef.current) return;
    const todos = Array.isArray(source?.todos) ? source.todos : [];
    setStreamTodos(getOpenCodeStreamStores(), sid, todos);
    setStreamTodoCard(buildLiveTodoCard(sid, todos));
  }

  function applyStreamPermission(targetSessionId: string, payload: unknown) {
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const sid = toText(source?.sessionID || source?.sessionId || targetSessionId).trim();
    if (!sid || sid !== sessionIdRef.current) return;
    upsertStreamPermission(getOpenCodeStreamStores(), { ...source, sessionID: sid });
  }

  function applyStreamPermissionReplied(targetSessionId: string, payload: unknown) {
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const sid = toText(source?.sessionID || source?.sessionId || targetSessionId).trim();
    if (!sid || sid !== sessionIdRef.current) return;
    removeStreamPermission(getOpenCodeStreamStores(), sid, toText(source?.requestID || source?.requestId || source?.id));
  }

  function applyStreamQuestion(targetSessionId: string, payload: unknown) {
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const sid = toText(source?.sessionID || source?.sessionId || targetSessionId).trim();
    if (!sid || sid !== sessionIdRef.current) return;
    upsertStreamQuestion(getOpenCodeStreamStores(), { ...source, sessionID: sid });
    refreshQuestionRequestsFromStore(sid);
  }

  function applyStreamQuestionRemoved(targetSessionId: string, payload: unknown) {
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const sid = toText(source?.sessionID || source?.sessionId || targetSessionId).trim();
    if (!sid || sid !== sessionIdRef.current) return;
    removeStreamQuestion(getOpenCodeStreamStores(), sid, toText(source?.requestID || source?.requestId || source?.id));
    refreshQuestionRequestsFromStore(sid);
  }

  function recordStreamMessageRoles(targetSessionId: string, rows: any[]) {
    const sid = toText(targetSessionId).trim();
    if (!sid || !Array.isArray(rows)) return;
    const roleStore = streamMessageRoleRef.current[sid] || {};
    for (const row of rows) {
      const mid = rawMessageId(row);
      const role = roleStore[mid] || rawMessageRole(row);
      if (!mid || !role) continue;
      if (role === 'assistant') flushPendingStreamPartEvents(sid, mid);
      else dropPendingStreamPartEvents(sid, mid);
    }
  }

  function getStoredStreamPart(targetSessionId: string, messageId: string, partId: string) {
    return storeGetStoredStreamPart(getOpenCodeStreamStores(), targetSessionId, messageId, partId);
  }

  function patchStoredStreamPartDelta(targetSessionId: string, messageId: string, partId: string, field: string, delta: string) {
    return storePatchStoredStreamPartDelta(getOpenCodeStreamStores(), targetSessionId, messageId, partId, field, delta);
  }

  function markStreamAssistantMessage(targetSessionId: string, messageId: string) {
    const sid = toText(targetSessionId).trim();
    const mid = toText(messageId).trim();
    if (!sid || !mid) return;
    streamMessageRoleRef.current[sid] = { ...(streamMessageRoleRef.current[sid] || {}), [mid]: 'assistant' };
    flushPendingStreamPartEvents(sid, mid);
  }

  function applyStreamMessageSnapshot(targetSessionId: string, payload: unknown) {
    if (targetSessionId !== sessionIdRef.current) return undefined;
    const incoming = Array.isArray(payload) ? payload : Array.isArray((payload as any)?.items) ? (payload as any).items : [];
    if (incoming.length === 0) return undefined;
    const merged = ingestStreamRows(targetSessionId, incoming);
    recordStreamMessageRoles(targetSessionId, merged);
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
    refreshQuestionRequestsFromStore(targetSessionId);
    pushConnLog(`SSE messages sid=${targetSessionId} rows=${incoming.length} merged=${merged.length} turns=${turnInfo.totalTurnCount}`);
    return rendered;
  }

  function applyAssistantDelta(targetSessionId: string, payload: unknown) {
    if (targetSessionId !== sessionIdRef.current) return;
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const messageId = toText(source?.messageId || source?.messageID).trim();
    const role = getKnownStreamMessageRole(targetSessionId, messageId);
    if (!role) {
      queueStreamPartEvent(targetSessionId, messageId, { kind: 'delta', payload });
      return;
    }
    const partId = toText(source?.partId || source?.partID).trim() || toText(source?.field).trim() || 'text';
    if (!getStoredStreamPart(targetSessionId, messageId, partId)) {
      const field = toText(source?.field).trim();
      const type = toText(source?.type).trim() || (field === 'reasoning' ? 'reasoning' : 'text');
      upsertStreamPart(targetSessionId, messageId, {
        id: partId,
        messageID: messageId,
        type,
        text: ''
      });
    }
    applyAssistantDeltaNow(targetSessionId, payload);
  }

  function applyAssistantDeltaNow(targetSessionId: string, payload: unknown) {
    if (targetSessionId !== sessionIdRef.current) return;
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const messageId = toText(source?.messageId || source?.messageID).trim();
    const partId = toText(source?.partId || source?.partID).trim() || 'text';
    const field = toText(source?.field).trim();
    const delta = typeof source?.delta === 'string' ? source.delta : '';
    const kind = toText(source?.type).trim() || (field === 'reasoning' ? 'reasoning' : 'text');
    streamDebug('delta.received', { sid: targetSessionId, messageId, partId, field, kind, deltaLen: delta.length, deltaPreview: delta.slice(0, 40) });
    if (!messageId || !delta) {
      streamDebug('delta.ignored', { reason: 'missing messageId or delta', messageId, deltaLen: delta.length });
      return;
    }
    enqueueStreamTypewriterDelta(targetSessionId, messageId, partId, field || 'text', delta);
    const nextLen = toText(getStoredStreamPart(targetSessionId, messageId, partId)?.[field || 'text']).length + delta.length;
    streamDebug('delta.enqueued', { sid: targetSessionId, messageId, partId, kind, totalLen: nextLen });
    setStreaming(true);
  }

  function enqueueStreamTypewriterDelta(targetSessionId: string, messageId: string, partId: string, field: string, delta: string) {
    const sid = toText(targetSessionId).trim();
    const mid = toText(messageId).trim();
    const pid = toText(partId).trim();
    const key = `${sid}:${mid}:${pid}:${field}`;
    if (!sid || !mid || !pid || !field || !delta) return;
    const current = streamTypewriterQueueRef.current[key];
    streamTypewriterQueueRef.current[key] = {
      sid,
      messageId: mid,
      partId: pid,
      field,
      text: `${current?.text || ''}${delta}`
    };
    scheduleStreamTypewriterDrain();
  }

  function streamTypewriterChunkSize(length: number) {
    if (length > 480) return 18;
    if (length > 180) return 10;
    if (length > 64) return 6;
    return 3;
  }

  function scheduleStreamTypewriterDrain() {
    if (streamTypewriterTimerRef.current) return;
    streamTypewriterTimerRef.current = setTimeout(() => {
      streamTypewriterTimerRef.current = null;
      const entries = Object.entries(streamTypewriterQueueRef.current);
      if (entries.length === 0) return;
      const touchedSessions = new Set<string>();
      for (const [key, item] of entries) {
        if (item.sid !== sessionIdRef.current) {
          delete streamTypewriterQueueRef.current[key];
          continue;
        }
        const take = streamTypewriterChunkSize(item.text.length);
        const chunk = item.text.slice(0, take);
        const rest = item.text.slice(take);
        if (chunk) {
          const ok = patchStoredStreamPartDelta(item.sid, item.messageId, item.partId, item.field, chunk);
          if (ok) touchedSessions.add(item.sid);
        }
        if (rest) streamTypewriterQueueRef.current[key] = { ...item, text: rest };
        else delete streamTypewriterQueueRef.current[key];
      }
      touchedSessions.forEach((sid) => scheduleStreamRender(sid));
      if (Object.keys(streamTypewriterQueueRef.current).length > 0) {
        streamTypewriterTimerRef.current = setTimeout(() => {
          streamTypewriterTimerRef.current = null;
          scheduleStreamTypewriterDrain();
        }, 16);
      }
    }, 16);
  }

  function scheduleStreamRender(targetSessionId: string) {
    if (streamRenderTimerRef.current) return;
    streamRenderTimerRef.current = setTimeout(() => {
      streamRenderTimerRef.current = null;
      if (targetSessionId !== sessionIdRef.current) return;
      const distanceFromBottom = Math.max(0, messageContentHRef.current - messageViewportHRef.current - messageScrollYRef.current);
      const shouldFollowStream = !messageUserScrollingRef.current && distanceFromBottom < 96;
      renderStreamWindow(targetSessionId);
      if (shouldFollowStream) {
        requestAnimationFrame(() => scrollToLatest(false));
      }
    }, 24);
  }

  function renderStreamWindow(targetSessionId: string) {
    const totalTurns = Math.max(1, Number(sessionTotalTurnCountRef.current[targetSessionId] || INITIAL_SESSION_LIMIT));
    const visibleTurns = Math.max(INITIAL_SESSION_LIMIT, Number(sessionVisibleTurnCountRef.current[targetSessionId] || INITIAL_SESSION_LIMIT));
    const rendered = applyTurnWindow(targetSessionId, Math.min(totalTurns, visibleTurns));
    const last = rendered.renderedTurns[rendered.renderedTurns.length - 1];
    streamDebug('render.window', {
      sid: targetSessionId,
      turns: rendered.renderedTurns.length,
      writing: rendered.writing,
      lastTurn: last?.id,
      lastItems: last?.items?.map((item: any) => item.kind).join(',') || ''
    });
  }

  function upsertStreamPart(targetSessionId: string, messageId: string, part: any, createdAt: number = Date.now()) {
    if (!shouldStoreStreamPart(part)) return;
    const partId = rawPartId(part, Object.keys(streamPartStoreRef.current[targetSessionId]?.[messageId] || {}).length);
    if (!targetSessionId || !messageId || !partId) return;
    const sid = ensureStreamSessionStores(targetSessionId);
    if (!sid) return;
    const byMessage = streamPartStoreRef.current[sid] || {};
    const existingParts = byMessage[messageId] || {};
    const nextPart = { ...(existingParts[partId] || {}), ...part, id: partId, messageID: messageId };
    byMessage[messageId] = { ...existingParts, [partId]: mergeStreamPart(existingParts[partId], nextPart) };
    streamPartStoreRef.current[sid] = byMessage;
    rewriteStreamMessageRow(targetSessionId, messageId, createdAt);
  }

  function rewriteStreamMessageRow(targetSessionId: string, messageId: string, createdAt: number = Date.now()) {
    const sid = ensureStreamSessionStores(targetSessionId);
    if (!sid) return;
    const partMap = streamPartStoreRef.current[sid]?.[messageId] || {};
    const parts = Object.values(partMap);
    streamDebug('stream.row.rewrite', {
      sid: targetSessionId,
      messageId,
      parts: parts.map((p: any) => `${p?.type || '?'}:${toText(p?.text).length}`).join(',')
    });
    const currentInfo = streamMessageStoreRef.current[sid]?.[messageId] || {};
    streamMessageStoreRef.current[sid][messageId] = {
      ...currentInfo,
      id: messageId,
      role: 'assistant',
      time: currentInfo.time || { created: createdAt }
    };
    streamMessageRoleRef.current[sid] = { ...(streamMessageRoleRef.current[sid] || {}), [messageId]: 'assistant' };
    publishStreamRows(sid);
  }

  function applyAssistantPart(targetSessionId: string, payload: unknown) {
    if (targetSessionId !== sessionIdRef.current) return;
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const part = source?.part;
    const messageId = toText(source?.messageId || source?.messageID || part?.messageID || part?.messageId).trim();
    const role = getKnownStreamMessageRole(targetSessionId, messageId);
    if (!role) {
      queueStreamPartEvent(targetSessionId, messageId, { kind: 'part', payload });
      return;
    }
    applyAssistantPartNow(targetSessionId, payload);
  }

  function applyAssistantPartNow(targetSessionId: string, payload: unknown) {
    if (targetSessionId !== sessionIdRef.current) return;
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const part = source?.part;
    const messageId = toText(source?.messageId || source?.messageID || part?.messageID || part?.messageId).trim();
    if (!messageId || !part || typeof part !== 'object') return;
    upsertStreamPart(targetSessionId, messageId, part);
    flushPendingStreamPartEvents(targetSessionId, messageId);
    renderStreamWindow(targetSessionId);
    if (!messageUserScrollingRef.current) {
      forceScrollToLatestUntilRef.current = Date.now() + 45000;
      requestAnimationFrame(() => scrollToLatest(false));
    }
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
      requests.forEach((req) => upsertStreamQuestion(getOpenCodeStreamStores(), req));
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
      refreshQuestionRequestsFromStore(sid);
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
        if (!before && pendingPromptSessionRef.current[targetSessionId]) {
          pushConnLog(`GET messages skip sid=${targetSessionId} reason=pending prompt`);
          return;
        }
        const prevRaw = sessionRawMapRef.current[targetSessionId] || [];
        const merged = before ? mergeMessageRows(prevRaw, incoming) : ingestStreamRows(targetSessionId, incoming);
        if (before) {
          sessionRawMapRef.current[targetSessionId] = merged;
          ingestStreamRows(targetSessionId, merged);
        }
        recordStreamMessageRoles(targetSessionId, merged);
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
      streamDebug('sync.messages.result', {
        sid: targetSessionId,
        mergedCount: res.mergedCount,
        prevMergedCount: res.prevMergedCount,
        totalTurnCount: res.totalTurnCount,
        status: statusInfo?.type || 'none'
      });

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
      const last = rendered.renderedTurns[rendered.renderedTurns.length - 1];
      streamDebug('sync.rendered', {
        sid: targetSessionId,
        turns: rendered.renderedTurns.length,
        writing: rendered.writing,
        lastTurn: last?.id,
        lastItems: last?.items?.map((item: any) => item.kind).join(',') || ''
      });

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
      let nextProjects = sanitizeProjectOptions(rows.map((x) => ({
        id: x.id || x.path,
        worktree: x.path,
        name: toText(x.name) || projectNameFromPath(x.path)
      })));
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
        nextProjects = sanitizeProjectOptions([...merged.values()]);
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
        const fallbackProjects = sanitizeProjectOptions([...merged.values()]);
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
    const cachedNextSessions = stableSortSessionItems(sessionCacheRef.current[next] || []);
    stopStream();
    setStartupSessionHydrating(false);
    sessionsRef.current = cachedNextSessions;
    setRepoPath(next);
    setActiveSession('');
    setMessages([]);
    setRenderedTurns([]);
    setSessions(cachedNextSessions);
    setSessionNextCursor({});
    setSessionHasMore({});
    setSessionHistoryRetryHint({});
    sessionRawMapRef.current = {};
    sessionOptimisticUserMapRef.current = {};
    optimisticUserIdAliasRef.current = {};
    resetOpenCodeStreamStores();
    sessionVisibleTurnCountRef.current = {};
    sessionTotalTurnCountRef.current = {};
    renderRegressionRetryRef.current = {};
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
    const parseSseData = (event: any) => {
      return typeof event?.data === 'string' ? JSON.parse(event.data) : event?.data;
    };
    const handleDeltaPayload = (payload: any) => {
      applyAssistantDelta(targetSessionId, payload);
      syncStatusSoon();
    };
    const handlePartPayload = (payload: any) => {
      applyAssistantPart(targetSessionId, payload);
      syncStatusSoon();
    };

    es.addEventListener('open', () => {
      if (!isCurrentStream()) return;
      pushConnLog('SSE open');
      streamDebug('sse.open', { sid: targetSessionId });
      setStreaming(true);
      syncFromServer();
    });
    es.addEventListener('error', (e: any) => {
      if (!isCurrentStream()) return;
      syncFromServer();
      setStreaming(false);
      try {
        const detail = typeof e?.data === 'string' ? e.data : JSON.stringify(e);
        streamDebug('sse.error', { sid: targetSessionId, detail: toText(detail).slice(0, 180) });
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
        streamDebug('sse.messages', { sid: targetSessionId, payloadType: Array.isArray(payload) ? 'array' : typeof payload });
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
    es.addEventListener('session_status' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        const payload = parseSseData(event);
        const status = payload?.status;
        if (status && typeof status === 'object') {
          setStreamSessionStatus(getOpenCodeStreamStores(), targetSessionId, status);
          setSessionStatusMap((prev) => ({ ...prev, [targetSessionId]: status as SessionStatusInfo }));
          setStreaming((status as SessionStatusInfo).type !== 'idle');
        }
      } catch (err) {
        pushConnLog(`SSE session_status parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('message' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyStreamMessageInfo(targetSessionId, parseSseData(event));
      } catch (err) {
        pushConnLog(`SSE message parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('message_removed' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyStreamMessageRemoved(targetSessionId, parseSseData(event));
      } catch (err) {
        pushConnLog(`SSE message_removed parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('todo' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyStreamTodo(targetSessionId, parseSseData(event));
      } catch (err) {
        pushConnLog(`SSE todo parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('permission' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyStreamPermission(targetSessionId, parseSseData(event));
      } catch (err) {
        pushConnLog(`SSE permission parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('permission_replied' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyStreamPermissionReplied(targetSessionId, parseSseData(event));
      } catch (err) {
        pushConnLog(`SSE permission_replied parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('question' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyStreamQuestion(targetSessionId, parseSseData(event));
      } catch (err) {
        pushConnLog(`SSE question parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('question_removed' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyStreamQuestionRemoved(targetSessionId, parseSseData(event));
      } catch (err) {
        pushConnLog(`SSE question_removed parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('assistant_message' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        const payload = parseSseData(event);
        const messageId = toText(payload?.messageId || payload?.messageID).trim();
        streamDebug('sse.assistant_message', { sid: targetSessionId, messageId });
        if (messageId) markStreamAssistantMessage(targetSessionId, messageId);
      } catch (err) {
        pushConnLog(`SSE assistant_message parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('delta' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        const payload = parseSseData(event);
        streamDebug('sse.delta.event', { sid: targetSessionId, keys: payload && typeof payload === 'object' ? Object.keys(payload).join(',') : typeof payload });
        handleDeltaPayload(payload);
      } catch (err) {
        pushConnLog(`SSE delta parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('part' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        const payload = parseSseData(event);
        streamDebug('sse.part.event', { sid: targetSessionId, keys: payload && typeof payload === 'object' ? Object.keys(payload).join(',') : typeof payload });
        handlePartPayload(payload);
      } catch (err) {
        pushConnLog(`SSE part parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('part_removed' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyPartRemoved(targetSessionId, parseSseData(event));
      } catch (err) {
        pushConnLog(`SSE part_removed parse failed ${String(err)}`, 'error');
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
      streamDebug('sse.end', { sid: targetSessionId });
      streamClosed = true;
      sessionStatusEpochRef.current += 1;
      streamSessionRef.current = '';
      scheduleStreamTypewriterDrain();
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
      let hasAssistantProgress = false;
      for (let itemIdx = turn.items.length - 1; itemIdx >= 0; itemIdx -= 1) {
        const item = turn.items[itemIdx];
        if (item.kind === 'error') return false;
        if (item.kind !== 'chat' || item.message.role !== 'user') hasAssistantProgress = true;
      }
      if (turn.userMessage) {
        const show = !hasAssistantProgress;
        streamDebug('pending.placeholder.check', {
          turnId: turn.id,
          show,
          hasAssistantProgress,
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
    streamDebug('pending.placeholder.fallback', { show: true, reason: 'no assistant text after last user', messages: messages.length });
    return true;
  }, [currentSessionStatus.type, messages, renderedTurns, sessionWorking]);

  const displayedTurns = useMemo(() => {
    if (!showThinkingPlaceholder || renderedTurns.length <= 0) return renderedTurns;
    const lastTurn = renderedTurns[renderedTurns.length - 1];
    const pendingItem = {
      kind: 'think' as const,
      createdAt: Date.now(),
      card: {
        id: `${lastTurn.id}:pending-thinking`,
        title: '思考中',
        text: '',
        createdAt: Date.now(),
        finished: false
      }
    };
    return [
      ...renderedTurns.slice(0, -1),
      {
        ...lastTurn,
        items: [...lastTurn.items, pendingItem],
        signature: `${lastTurn.signature}:pending-thinking`
      }
    ];
  }, [renderedTurns, showThinkingPlaceholder]);
  const messageBottomInset = Math.max(140, inputDockHeight + 44 + keyboardInset);
  const inputModelLabel = useMemo(() => {
    const selected = modelOptions.find((option) => option.id === model);
    const label = toText(selected?.label || model || 'Model');
    return label.replace(/^openai\//i, '').replace(/^kimi-for-coding\//i, '').slice(0, 18);
  }, [model, modelOptions]);
  const composerModeOptions = useMemo<Array<{ key: ComposerAgentName; label: string }>>(() => ([
    { key: 'build', label: 'Build' },
    { key: 'plan', label: 'Plan' }
  ]), []);

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
    return streamTodoCard;
  }, [displayedTurns, streamTodoCard]);

  const activeQuestionRequest = useMemo(() => questionRequests[0] || null, [questionRequests]);

  const builtinSlashCommands = useMemo<OpencodeSlashCommand[]>(() => [
    { id: 'builtin-new', trigger: 'new', title: 'New session', description: '开始一个新会话', source: 'builtin' },
    { id: 'builtin-compact', trigger: 'compact', title: 'Compact', description: '压缩当前会话上下文', source: 'builtin' },
    { id: 'builtin-model', trigger: 'model', title: 'Model', description: '切换当前模型', source: 'builtin' },
    { id: 'builtin-agent', trigger: 'agent', title: 'Agent', description: '切换 agent', source: 'builtin' },
    { id: 'builtin-open', trigger: 'open', title: 'Open', description: '搜索文件、命令和会话', source: 'builtin' },
    { id: 'builtin-terminal', trigger: 'terminal', title: 'Terminal', description: '打开或聚焦终端', source: 'builtin' },
    { id: 'builtin-mcp', trigger: 'mcp', title: 'MCP', description: '切换 MCPs', source: 'builtin' },
    { id: 'builtin-workspace', trigger: 'workspace', title: 'Workspace', description: '在侧边栏启用或禁用多个工作区', source: 'builtin' },
    { id: 'builtin-init', trigger: 'init', title: 'Init', description: 'create/update AGENTS.md', source: 'builtin' },
    { id: 'builtin-review', trigger: 'review', title: 'Review', description: 'review changes [commit|branch|pr]', source: 'builtin' }
  ], []);

  const slashQuery = useMemo(() => {
    const m = prompt.match(/^\/(\S*)$/);
    return m ? m[1].toLowerCase() : '';
  }, [prompt]);

  const slashSuggestions = useMemo(() => {
    if (!slashOpen) return [];
    const all = [...builtinSlashCommands, ...slashCommands];
    const seen = new Set<string>();
    return all
      .filter((cmd) => {
        const key = cmd.trigger.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return !slashQuery || key.includes(slashQuery) || cmd.title.toLowerCase().includes(slashQuery);
      });
  }, [builtinSlashCommands, slashCommands, slashOpen, slashQuery]);

  const promptText = toText(prompt).trim();
  const hasPromptText = promptText.length > 0;
  const hasSendAction = hasPromptText || imageAttachments.length > 0;
  const imageQueueBusy = imageAttachments.some((img) => img.status === 'processing' || img.status === 'uploading');
  const imageQueueFailed = imageAttachments.some((img) => img.status === 'failed');
  const composerWillAbort = sessionWorking && !hasSendAction;
  const canSendNow = !busy && hasSendAction && !imageQueueBusy && !imageQueueFailed;
  const canAbortNow = !busy && composerWillAbort;

  const attachmentPanelStyle = {
    opacity: attachmentPanelAnim,
    transform: [
      {
        translateY: attachmentPanelAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0]
        })
      },
      {
        scale: attachmentPanelAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.96, 1]
        })
      }
    ]
  } as const;

  useEffect(() => {
    if (hasSendAction) setAttachmentMenuOpen(false);
  }, [hasSendAction]);

  useEffect(() => {
    actionIconAnim.setValue(0.7);
    Animated.timing(actionIconAnim, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [actionIconAnim, attachmentMenuOpen, hasSendAction]);

  useEffect(() => {
    Animated.timing(attachmentToggleAnim, {
      toValue: attachmentMenuOpen ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();

    if (attachmentMenuOpen) {
      setAttachmentPanelVisible(true);
      Animated.spring(attachmentPanelAnim, {
        toValue: 1,
        stiffness: 220,
        damping: 22,
        mass: 0.9,
        useNativeDriver: true
      }).start();
      void loadRecentImages();
      return;
    }

    Animated.timing(attachmentPanelAnim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) setAttachmentPanelVisible(false);
    });
  }, [attachmentMenuOpen]);

  function inferMimeFromFilename(filename: string): string {
    const lower = toText(filename).toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.heic')) return 'image/heic';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    return 'image/jpeg';
  }

  async function fileUriToDataUrl(uri: string, fallbackMime: string): Promise<string> {
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });
      if (!base64 || base64.length < 20) {
        throw new Error('empty base64');
      }
      return `data:${fallbackMime};base64,${base64}`;
    } catch (e) {
      setStatus(`读取文件失败: ${String(e)}`);
      throw e;
    }
  }

  async function compressImageForSend(item: { uri: string; filename: string; mime?: string; dataUrl?: string }) {
    const mime = toText(item.mime).trim() || inferMimeFromFilename(item.filename);
    const sourceUri = toText(item.uri).trim();
    if (!mime.startsWith('image/') || !sourceUri) {
      return { ...item, mime, dataUrl: item.dataUrl || '' };
    }

    const attempts = [
      { width: 1280, compress: 0.62 },
      { width: 1024, compress: 0.5 },
      { width: 896, compress: 0.42 },
      { width: 768, compress: 0.34 },
      { width: 640, compress: 0.28 },
      { width: 512, compress: 0.22 }
    ];
    let best: { uri: string; dataUrl: string; mime: string } | null = null;
    for (const attempt of attempts) {
      try {
        const result = await ImageManipulator.manipulateAsync(
          sourceUri,
          [{ resize: { width: attempt.width } }],
          { compress: attempt.compress, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        const base64 = toText(result.base64);
        if (!base64 || base64.length <= 20) continue;
        const next = { uri: result.uri || sourceUri, dataUrl: `data:image/jpeg;base64,${base64}`, mime: 'image/jpeg' };
        best = next;
        if (base64.length <= IMAGE_SEND_TARGET_BASE64_LENGTH) break;
      } catch {}
    }
    if (best) return { ...item, uri: best.uri, mime: best.mime, dataUrl: best.dataUrl };
    const fallback = item.dataUrl || await fileUriToDataUrl(sourceUri, mime);
    return { ...item, mime, dataUrl: fallback };
  }

  async function appendAssetsAsAttachments(items: Array<{ uri: string; filename: string; mime?: string; dataUrl?: string }>) {
    try {
      if (items.length > 0) setStatus('正在处理图片...');
      await Promise.all(items.map(async (item, idx) => {
        const id = `img-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
        const initialMime = toText(item.mime).trim() || inferMimeFromFilename(item.filename);
        setImageAttachments((prev) => [...prev, {
          id,
          uri: item.uri,
          filename: item.filename,
          mime: initialMime,
          dataUrl: item.dataUrl || '',
          status: 'processing',
          statusText: '压缩中'
        }]);
        try {
        const prepared = await compressImageForSend(item);
        const mime = toText(prepared.mime).trim() || inferMimeFromFilename(prepared.filename);
        const dataUrl = prepared.dataUrl || await fileUriToDataUrl(prepared.uri, mime);
        if (!dataUrl || dataUrl.length <= 20) throw new Error('empty image data');
        const next = {
          id,
          uri: prepared.uri,
          filename: prepared.filename,
          mime,
          dataUrl,
          status: 'ready' as const,
          statusText: '就绪'
        } satisfies ComposerAttachment;
        setImageAttachments((prev) => prev.map((img) => img.id === id ? next : img));
        } catch (e) {
          setImageAttachments((prev) => prev.map((img) => img.id === id ? { ...img, status: 'failed', statusText: '处理失败' } : img));
          throw e;
        }
      }));
      setStatus('图片已添加');
    } catch (e) {
      setStatus(`处理图片失败: ${String(e)}`);
    }
  }

  function mediaAssetsToRecentItems(assets: MediaLibrary.Asset[]): RecentImageItem[] {
    return assets.map((asset) => ({
      id: asset.id,
      uri: asset.uri,
      filename: asset.filename || `photo-${asset.id}.jpg`,
      mediaType: String(asset.mediaType || '')
    }));
  }

  async function loadRecentImages(opts?: { append?: boolean }) {
    const append = Boolean(opts?.append);
    if (recentImagesLoadingRef.current) return;
    if (append && !recentImagesHasNext) return;
    try {
      recentImagesLoadingRef.current = true;
      if (append) setRecentImagesLoadingMore(true);
      else setRecentImagesLoading(true);
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        setStatus('相册权限被拒绝');
        return;
      }
      const page = await MediaLibrary.getAssetsAsync({
        first: 12,
        after: append ? recentImagesCursor : undefined,
        mediaType: [MediaLibrary.MediaType.photo],
        sortBy: [MediaLibrary.SortBy.creationTime]
      });
      const items = mediaAssetsToRecentItems(page.assets);
      setRecentImages((prev) => append ? [...prev, ...items.filter((item) => !prev.some((old) => old.id === item.id))] : items);
      setRecentImagesCursor(page.endCursor || undefined);
      setRecentImagesHasNext(Boolean(page.hasNextPage));
    } catch (e) {
      setStatus(`读取最近图片失败: ${String(e)}`);
    } finally {
      recentImagesLoadingRef.current = false;
      setRecentImagesLoading(false);
      setRecentImagesLoadingMore(false);
    }
  }

  function maybeLoadMoreRecentImages(y: number, viewportH: number, contentH: number) {
    if (!recentImagesHasNext || recentImagesLoadingRef.current) return;
    if (contentH - viewportH - y < 80) void loadRecentImages({ append: true });
  }

  async function pickImageFromLibrary(kind: 'album' | 'file') {
    try {
      if (kind === 'file') {
        const result = await DocumentPicker.getDocumentAsync({
          type: '*/*',
          multiple: true,
          copyToCacheDirectory: true
        });
        if (result.canceled || !result.assets?.length) return;
        await appendAssetsAsAttachments(result.assets.map((asset, idx) => ({
          uri: asset.uri,
          filename: asset.name || `file-${idx}`,
          mime: asset.mimeType || 'application/octet-stream',
          dataUrl: ''
        })));
        return;
      }
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setStatus('相册权限被拒绝');
        return;
      }
      const pick = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.35,
        base64: false
      });
      if (pick.canceled || !pick.assets?.length) return;
      await appendAssetsAsAttachments(pick.assets.map((asset, idx) => {
        const base64 = asset.base64;
        const mime = asset.mimeType || 'image/png';
        return {
          uri: asset.uri,
          filename: asset.fileName || `image-${idx}.png`,
          mime,
          dataUrl: base64 && base64.length > 20 ? `data:${mime};base64,${base64}` : ''
        };
      }));
    } catch (e) {
      setStatus(kind === 'album' ? `选择图片失败: ${String(e)}` : `选择文件失败: ${String(e)}`);
    }
  }

  async function openAlbumPicker() {
    try {
      setAttachmentMenuOpen(false);
      setAlbumPickerOpen(true);
      setAlbumSelectedIds([]);
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        setAlbumPickerOpen(false);
        setStatus('相册权限被拒绝');
        return;
      }
      const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
      const mappedAlbums = albums
        .filter((album) => (album.assetCount || 0) > 0)
        .map((album) => ({ id: album.id, title: album.title || '相册', assetCount: album.assetCount }));
      setMediaAlbums([{ id: 'all', title: '图片和视频' }, ...mappedAlbums]);
      setSelectedMediaAlbumId('all');
      await loadAlbumImages({ albumId: 'all' });
    } catch (e) {
      setAlbumPickerOpen(false);
      setStatus(`读取相册失败: ${String(e)}`);
    }
  }

  async function loadAlbumImages(opts?: { albumId?: string; append?: boolean }) {
    const albumId = opts?.albumId ?? selectedMediaAlbumId;
    const append = Boolean(opts?.append);
    if (albumImagesLoadingRef.current) return;
    if (append && !albumHasNext) return;
    try {
      albumImagesLoadingRef.current = true;
      if (append) setAlbumImagesLoadingMore(true);
      else {
        setAlbumImagesLoading(true);
        setAlbumImages([]);
        setAlbumCursor(undefined);
      }
      const album = albumId === 'all' ? undefined : albumId;
      const page = await MediaLibrary.getAssetsAsync({
        first: 80,
        after: append ? albumCursor : undefined,
        album,
        mediaType: [MediaLibrary.MediaType.photo],
        sortBy: [MediaLibrary.SortBy.creationTime]
      });
      const items = mediaAssetsToRecentItems(page.assets);
      setAlbumImages((prev) => append ? [...prev, ...items.filter((item) => !prev.some((old) => old.id === item.id))] : items);
      setAlbumCursor(page.endCursor || undefined);
      setAlbumHasNext(Boolean(page.hasNextPage));
    } catch (e) {
      if (!append) setAlbumImages([]);
      setStatus(`读取相册失败: ${String(e)}`);
    } finally {
      albumImagesLoadingRef.current = false;
      setAlbumImagesLoading(false);
      setAlbumImagesLoadingMore(false);
    }
  }

  function selectMediaAlbum(albumId: string) {
    setSelectedMediaAlbumId(albumId);
    setAlbumSelectedIds([]);
    void loadAlbumImages({ albumId });
  }

  function toggleAlbumImage(id: string) {
    setAlbumSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  }

  async function confirmAlbumSelection() {
    const selected = albumImages.filter((item) => albumSelectedIds.includes(item.id));
    setAlbumPickerOpen(false);
    setAlbumSelectedIds([]);
    if (selected.length === 0) return;
    await appendAssetsAsAttachments(selected.map((item) => ({
      uri: item.uri,
      filename: item.filename,
      mime: inferMimeFromFilename(item.filename)
    })));
  }

  async function captureWithCamera() {
    try {
      setPhotoCameraOpen(false);
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setStatus('相机权限被拒绝'); return; }
      const pick = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        base64: false
      });
      if (pick.canceled || !pick.assets?.[0]) return;
      const asset = pick.assets[0];
      await appendAssetsAsAttachments([{
        uri: asset.uri,
        filename: asset.fileName || `camera-${Date.now()}.jpg`,
        mime: asset.mimeType || 'image/jpeg'
      }]);
    } catch (e) {
      setStatus(`拍照失败: ${String(e)}`);
    }
  }

  async function takePhotoFromInlineCamera() {
    if (photoCameraBusy) return;
    try {
      setPhotoCameraBusy(true);
      const photo = await photoCameraRef.current?.takePictureAsync?.({
        quality: 0.6,
        base64: false,
        skipProcessing: false
      });
      if (!photo?.uri) return;
      setPhotoCameraOpen(false);
      const base64 = photo.base64;
      const mime = 'image/jpeg';
      await appendAssetsAsAttachments([{
        uri: photo.uri,
        filename: `camera-${Date.now()}.jpg`,
        mime,
        dataUrl: base64 && base64.length > 20 ? `data:${mime};base64,${base64}` : ''
      }]);
    } catch (e) {
      setStatus(`拍照失败: ${String(e)}`);
    } finally {
      setPhotoCameraBusy(false);
    }
  }

  async function attachRecentImage(item: RecentImageItem) {
    setAttachmentMenuOpen(false);
    await appendAssetsAsAttachments([{
      uri: item.uri,
      filename: item.filename,
      mime: inferMimeFromFilename(item.filename)
    }]);
  }

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
    const port = resolvePortFromSeed(serverUrl, 5100);
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
    const images = imageAttachments.filter((img) => img.status !== 'failed');
    if (!authed) {
      setStatus('请先授权');
      return;
    }
    if (!repoPath.trim()) {
      setStatus('未选择项目，请在左侧抽屉切换项目');
      return;
    }
    if (!payloadPrompt && images.length === 0) {
      setStatus('请输入消息');
      return;
    }
    if (imageAttachments.some((img) => img.status === 'processing' || img.status === 'uploading')) {
      setStatus('图片还在处理中，请稍等');
      return;
    }
    if (imageAttachments.some((img) => img.status === 'failed')) {
      setStatus('有图片处理失败，请删除后重试');
      return;
    }
    setBusy(true);
    if (images.length > 0) {
      setImageAttachments((prev) => prev.map((img) => ({ ...img, status: 'uploading', statusText: '发送中' })));
    }
    const optimisticAt = Date.now();
    const optimisticMessage: OptimisticUserMessage = {
      id: `local:${optimisticAt}`,
      text: payloadPrompt,
      createdAt: optimisticAt,
      attachments: images.map((img) => ({
        id: img.id,
        kind: 'image' as const,
        uri: img.dataUrl || img.uri,
        mime: img.mime,
        filename: img.filename,
      }))
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
          title: payloadPrompt.slice(0, 24) || '新会话',
          agent: composerAgent,
          autoAcceptPermissions
        });
        targetSessionId = created.id;
        setActiveSession(targetSessionId);
      }
      setChatListResetKey((value) => value + 1);
      if (optimisticMessage.attachments?.length) {
        sentAttachmentCacheRef.current[targetSessionId] = {
          ...(sentAttachmentCacheRef.current[targetSessionId] || {}),
          [`id:${optimisticMessage.id}`]: {
            at: Date.now(),
            attachments: optimisticMessage.attachments,
          },
          [`text:${toText(payloadPrompt).trim()}`]: {
            at: Date.now(),
            attachments: optimisticMessage.attachments,
          }
        };
      }
      upsertOptimisticUserMessage(targetSessionId, optimisticMessage);
      appendOptimisticTurnAndStick(optimisticMessage);
      setPrompt('');
      setSlashOpen(false);
      setImageAttachments([]);
      pendingPromptSessionRef.current[targetSessionId] = {
        id: optimisticMessage.id,
        startedAt: Date.now()
      };
      startStream(targetSessionId);
      pushConnLog(`POST prompt sid=${targetSessionId} model=${requestModel || '(default)'} images=${images.length}`);
      images.forEach((img, idx) => {
        pushConnLog(`  image[${idx}] mime=${img.mime} filename=${img.filename} dataUrlLength=${img.dataUrl?.length || 0}`);
      });
      const parts = [
        { id: `prt_${Date.now()}_text`, type: 'text' as const, text: payloadPrompt },
        ...images.map((img, idx) => ({
          id: `prt_${Date.now()}_${idx}`,
        type: 'file' as const,
        mime: img.mime,
        url: img.dataUrl,
        filename: img.filename
        }))
      ];
      pushConnLog(`sendPrompt start, parts count=${parts.length}, timeout=${images.length > 0 ? IMAGE_SEND_TIMEOUT_MS : 12000}ms`);
      const res = await sendPrompt({
        baseUrl: serverUrl,
        token,
        repoPath,
        prompt: payloadPrompt,
        sessionId: targetSessionId,
        model: requestModel,
        agent: composerAgent,
        autoAcceptPermissions,
        parts: parts.length > 0 ? parts : undefined,
        timeoutMs: images.length > 0 ? IMAGE_SEND_TIMEOUT_MS : undefined
      });
      delete pendingPromptSessionRef.current[targetSessionId];
      pushConnLog(`sendPrompt success, sessionId=${res.sessionId}`);
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
        delete pendingPromptSessionRef.current[currentSessionId];
        dropOptimisticUserMessage(currentSessionId, optimisticMessage.id);
      }
      if (customPrompt === undefined) {
        setPrompt((prev) => prev || payloadPrompt);
        setImageAttachments(images.map((img) => ({ ...img, status: 'ready', statusText: '就绪' })));
      }
      const msg = String(e);
      pushConnLog(`POST prompt error images=${images.length} msg=${msg}`, 'error');
      console.error('[onSendPrompt] error:', msg, 'images:', images.length, 'dataUrl lengths:', images.map(i => i.dataUrl?.length || 0));
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
        setStatus(`发送失败: ${msg}`);
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
    resetOpenCodeStreamStores();
    sessionVisibleTurnCountRef.current = {};
    sessionTotalTurnCountRef.current = {};
    renderRegressionRetryRef.current = {};
    olderCursorBackoffRef.current = {};
    bumpOptimisticVersion();
    setAuthAsciiBrand(pickRandomAuthAsciiBrand());
    setStartupSessionHydrating(false);
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
        <StatusBar barStyle="dark-content" backgroundColor="#f7f8fa" translucent={false} />
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
                      placeholder="输入 IP:端口（如 192.168.1.8:5100）"
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
      <SafeAreaView style={[styles.chatSafe, { backgroundColor: notebookColors.shell }]}>
        <RenderBoundary name="chat-screen">
        <View style={[styles.notebookShell, { backgroundColor: notebookColors.shell }]} {...notebookPanResponder.panHandlers}>
          <Animated.View
            style={[
              styles.notebookTrack,
              {
                width: windowWidth * 3,
                transform: [{ translateX: notebookTrackX }]
              }
            ]}
          >
            <View style={[styles.notebookPageFrame, { width: windowWidth }]}>
              {renderLeftDrawerContent()}
            </View>
            <View style={[styles.notebookMainPage, { backgroundColor: notebookColors.main, width: windowWidth }]}> 
            <StatusBar barStyle="dark-content" backgroundColor={notebookColors.shell} />

      <View style={[styles.topBar, { backgroundColor: notebookColors.main }]}> 
        <View style={styles.topSideSlot} />
        <View style={styles.topBrand}>
          <Text numberOfLines={1} style={[styles.topTitleCompact, { color: notebookColors.text }]}>{currentSessionTitle}</Text>
        </View>
        <View style={styles.topSideSlotRight} />
      </View>
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
              contentContainerStyle={{ paddingTop: 8, paddingBottom: messageBottomInset, backgroundColor: 'transparent' }}
              onLayout={(evt) => {
                messageViewportHRef.current = Number(evt.nativeEvent.layout?.height || 0);
              }}
              data={displayedTurns}
              removeClippedSubviews={Platform.OS === 'web'}
              alwaysBounceVertical
              bounces
              overScrollMode="always"
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              maintainVisibleContentPosition={{
                autoscrollToBottomThreshold: 80
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
                  streaming={sessionWorking}
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
                  onOpenImage={(img) => setPreviewImage({ uri: img.uri, filename: img.filename })}
                  onCopyImage={(uri) => void copyMessageText(uri)}
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

      {attachmentPanelVisible ? (
        <Pressable
          style={styles.attachmentBackdrop}
          onPress={() => setAttachmentMenuOpen(false)}
        />
      ) : null}

      <View
        style={[styles.inputDock, keyboardInset > 0 ? { marginBottom: keyboardInset + 10 } : null]}
        onLayout={(evt) => {
          const h = Math.ceil(Number(evt.nativeEvent.layout?.height || 0));
          if (h > 0 && Math.abs(h - inputDockHeight) > 2) setInputDockHeight(h);
        }}
      >
        {imageAttachments.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.attachmentRow}
            style={styles.attachmentScroller}
          >
            {imageAttachments.map((img) => (
              <Pressable key={img.id} style={styles.attachmentTile} onPress={() => setPreviewImage({ uri: img.uri, filename: img.filename })}>
                <Image source={{ uri: img.uri }} style={styles.attachmentThumb} resizeMode="cover" />
                {img.status && img.status !== 'ready' ? (
                  <View style={img.status === 'failed' ? [styles.attachmentStateOverlay, styles.attachmentStateFailed] : styles.attachmentStateOverlay}>
                    {img.status === 'processing' || img.status === 'uploading' ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                    <Text style={styles.attachmentStateText}>{img.statusText || (img.status === 'failed' ? '失败' : '处理中')}</Text>
                  </View>
                ) : null}
                <Pressable
                  style={styles.attachmentRemove}
                  onPress={() => setImageAttachments((prev) => prev.filter((i) => i.id !== img.id))}
                  hitSlop={8}
                >
                  <Text style={styles.attachmentRemoveTxt}>×</Text>
                </Pressable>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <TextInput
          style={styles.inputMain}
          value={toText(prompt)}
          onChangeText={(value) => {
            if (attachmentMenuOpen) setAttachmentMenuOpen(false);
            setPrompt(value);
            const isSlash = /^\//.test(value) && !value.includes(' ');
            setSlashOpen(isSlash);
            setSlashActiveIndex(0);
          }}
          placeholder="What would you like to do?"
          placeholderTextColor="#c6cbd3"
          multiline
        />
        <View style={styles.inputToolbar}>
          <Pressable
            style={styles.cameraBtn}
            onPress={() => setAttachmentMenuOpen((prev) => !prev)}
            hitSlop={8}
          >
            <Animated.View
              style={{
                transform: [{
                  rotate: attachmentToggleAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '90deg']
                  })
                }]
              }}
            >
              <Feather name={attachmentMenuOpen ? 'x' : 'plus'} size={22} color="#111827" />
            </Animated.View>
          </Pressable>
          <View style={styles.inputToolbarSpacer} />
          <Pressable style={styles.modelMiniPill} onPress={() => setComposerPickerOpen(true)}>
            <Text numberOfLines={1} style={styles.modelMiniText}>{inputModelLabel}</Text>
          </Pressable>
          <Pressable
            style={canSendNow || canAbortNow ? styles.actionBtnSend : styles.actionBtnDisabled}
            onPress={() => {
              if (canAbortNow) {
                void onAbort();
                return;
              }
              if (!canSendNow) return;
              void onSendPrompt();
            }}
            disabled={!canSendNow && !canAbortNow}
          >
            <Animated.View
              style={{
                opacity: actionIconAnim,
                transform: [{ scale: actionIconAnim }]
              }}
            >
              <Feather
                name={canAbortNow ? 'square' : 'arrow-up'}
                size={canAbortNow ? 16 : 20}
                color={canSendNow || canAbortNow ? '#ffffff' : '#8d949e'}
              />
            </Animated.View>
          </Pressable>
        </View>
        {slashOpen && slashSuggestions.length > 0 ? (
          <ScrollView style={styles.slashPopover} keyboardShouldPersistTaps="handled">
            {slashSuggestions.map((cmd, idx) => (
              <Pressable
                key={cmd.id}
                style={[
                  styles.slashItem,
                  idx === slashActiveIndex ? styles.slashItemActive : null
                ]}
                onPress={() => {
                  setPrompt(`/${cmd.trigger} `);
                  setSlashOpen(false);
                }}
              >
                <View style={styles.slashItemMain}>
                  <View style={styles.slashItemTopRow}>
                    <Text style={styles.slashTrigger}>/{cmd.trigger}</Text>
                    <Text style={styles.slashSource}>{cmd.source}</Text>
                  </View>
                  <Text style={styles.slashTitle}>{cmd.title}</Text>
                  {cmd.description ? <Text numberOfLines={1} style={styles.slashDesc}>{cmd.description}</Text> : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {attachmentPanelVisible ? (
          <Animated.View style={[styles.attachmentPanel, attachmentPanelStyle]}>
            <View style={styles.attachmentMenuRow}>
              <Pressable
                style={styles.attachmentMenuCard}
              onPress={() => {
                  setAttachmentMenuOpen(false);
                  void captureWithCamera();
                }}
              >
                <View style={styles.attachmentMenuIconShell}>
                  <Feather name="camera" size={22} color="#1f2937" />
                </View>
                 <Text style={styles.attachmentMenuLabel}>Camera</Text>
              </Pressable>
              <Pressable
                style={styles.attachmentMenuCard}
              onPress={() => {
                  setAttachmentMenuOpen(false);
                  void openAlbumPicker();
                }}
              >
                <View style={styles.attachmentMenuIconShell}>
                  <Feather name="image" size={22} color="#1f2937" />
                </View>
                <Text style={styles.attachmentMenuLabel}>Photos</Text>
              </Pressable>
              <Pressable
                style={styles.attachmentMenuCard}
              onPress={() => {
                  setAttachmentMenuOpen(false);
                  void pickImageFromLibrary('file');
                }}
              >
                <View style={styles.attachmentMenuIconShell}>
                  <Feather name="folder" size={22} color="#1f2937" />
                </View>
                <Text style={styles.attachmentMenuLabel}>Files</Text>
              </Pressable>
            </View>
            <View style={styles.recentHeaderRow}>
              <Text style={styles.recentHeaderTitle}>Recent Images</Text>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              style={[styles.recentScroller, { height: recentScrollerHeight }]}
              contentContainerStyle={styles.recentScrollerContent}
              scrollEventThrottle={16}
              onScroll={(evt) => {
                const y = Number(evt.nativeEvent.contentOffset?.y || 0);
                const viewportH = Number(evt.nativeEvent.layoutMeasurement?.height || 0);
                const contentH = Number(evt.nativeEvent.contentSize?.height || 0);
                maybeLoadMoreRecentImages(y, viewportH, contentH);
              }}
            >
              <View style={styles.recentGrid}>
                {recentImages.map((item) => (
                  <Pressable key={item.id} style={styles.recentThumbCard} onPress={() => void attachRecentImage(item)}>
                    <Image source={{ uri: item.uri }} style={styles.recentThumbImage} resizeMode="cover" />
                  </Pressable>
                ))}
                {recentImages.length === 0 && recentImagesLoading ? (
                  <View style={styles.recentLoadingState}>
                    <ActivityIndicator size="small" color="#64748b" />
                    <Text style={styles.recentLoadingText}>Loading recent images</Text>
                  </View>
                ) : null}
                {recentImages.length === 0 && !recentImagesLoading ? (
                  <View style={styles.recentEmptyState}>
                    <Feather name="image" size={18} color="#94a3b8" />
                    <Text style={styles.recentEmptyText}>No recent images</Text>
                  </View>
                ) : null}
                {recentImagesLoadingMore ? <View style={styles.recentLoadingMore}><ActivityIndicator size="small" /></View> : null}
                {recentImagesHasNext && !recentImagesLoadingMore ? <View style={styles.recentLoadHint}><Text style={styles.recentLoadHintText}>Scroll to load more</Text></View> : null}
              </View>
            </ScrollView>
          </Animated.View>
        ) : null}
      </View>

            </View>
            <View style={[styles.notebookPageFrame, { width: windowWidth }]}>
              {renderRightDrawerContent()}
            </View>
          </Animated.View>
        </View>
        </RenderBoundary>
        {albumPickerOpen ? (
          <View style={styles.albumOverlay}>
            <Pressable style={styles.albumBackdrop} onPress={() => setAlbumPickerOpen(false)} />
            <View style={styles.albumSheet}>
              <View style={styles.albumHeaderRow}>
                <Pressable style={styles.albumHeaderBtn} onPress={() => setAlbumPickerOpen(false)}>
                  <Text style={styles.albumHeaderBtnText}>取消</Text>
                </Pressable>
                <Text style={styles.albumTitle}>相册</Text>
                <Pressable style={[styles.albumHeaderBtn, albumSelectedIds.length === 0 ? styles.albumHeaderBtnDisabled : null]} onPress={() => void confirmAlbumSelection()} disabled={albumSelectedIds.length === 0}>
                  <Text style={[styles.albumHeaderBtnText, albumSelectedIds.length === 0 ? styles.albumHeaderBtnTextDisabled : null]}>{albumSelectedIds.length > 0 ? `添加 ${albumSelectedIds.length}` : '添加'}</Text>
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.albumPickerBar} contentContainerStyle={styles.albumPickerBarContent}>
                {mediaAlbums.map((album) => (
                  <Pressable
                    key={album.id}
                    style={album.id === selectedMediaAlbumId ? [styles.albumPickerChip, styles.albumPickerChipActive] : styles.albumPickerChip}
                    onPress={() => selectMediaAlbum(album.id)}
                  >
                    <Text style={album.id === selectedMediaAlbumId ? [styles.albumPickerChipText, styles.albumPickerChipTextActive] : styles.albumPickerChipText} numberOfLines={1}>
                      {album.title}{album.assetCount ? ` ${album.assetCount}` : ''}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {albumImagesLoading ? (
                <View style={styles.albumLoadingWrap}>
                  <ActivityIndicator />
                  <Text style={styles.albumLoadingText}>Loading photos...</Text>
                </View>
              ) : albumImages.length === 0 ? (
                <Text style={styles.albumEmptyText}>暂无照片</Text>
              ) : (
                <FlashList
                  data={albumImages}
                  numColumns={3}
                  keyExtractor={(item) => item.id}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.albumGrid}
                  extraData={albumSelectedIds}
                  onEndReached={() => void loadAlbumImages({ append: true })}
                  onEndReachedThreshold={0.7}
                  ListFooterComponent={albumImagesLoadingMore ? <View style={styles.albumLoadingMore}><ActivityIndicator size="small" /></View> : null}
                  renderItem={({ item }) => {
                    const selectedIndex = albumSelectedIds.indexOf(item.id);
                    const selected = albumSelectedSet.has(item.id);
                    return (
                      <Pressable style={styles.albumThumbCell} onPress={() => toggleAlbumImage(item.id)}>
                        <View style={styles.albumThumbCard}>
                          <Image source={{ uri: item.uri }} style={styles.albumThumbImage} resizeMode="cover" />
                          <View style={[styles.albumSelectBadge, selected ? styles.albumSelectBadgeOn : null]}>
                            <Text style={[styles.albumSelectText, selected ? styles.albumSelectTextOn : null]}>{selected ? selectedIndex + 1 : ''}</Text>
                          </View>
                        </View>
                      </Pressable>
                    );
                  }}
                />
              )}
            </View>
          </View>
        ) : null}
        {previewImage ? (
          <View style={styles.imagePreviewOverlay}>
            <Pressable style={styles.imagePreviewBackdrop} onPress={() => setPreviewImage(null)} />
            <View style={styles.imagePreviewCard}>
              <View style={styles.imagePreviewToolbar}>
                <Pressable style={styles.imagePreviewButton} onPress={() => setPreviewImage(null)}>
                  <Text style={styles.imagePreviewButtonText}>关闭</Text>
                </Pressable>
              </View>
              {previewImage ? <Image source={{ uri: previewImage.uri }} style={styles.imagePreviewImage} resizeMode="contain" /> : null}
            </View>
          </View>
        ) : null}
        {composerPickerOpen ? (
          <View style={styles.composerPickerOverlay}>
            <Pressable style={styles.composerPickerBackdrop} onPress={() => setComposerPickerOpen(false)} />
              <View style={[styles.composerPickerSheet, { backgroundColor: notebookColors.left }]}> 
                <View style={styles.composerPickerHeader}>
                <Text style={styles.composerPickerTitle}>Model & Mode</Text>
                <Pressable style={styles.composerPickerCloseBtn} onPress={() => setComposerPickerOpen(false)}>
                  <Feather name="x" size={20} color="#7c766c" />
                </Pressable>
              </View>
              <View style={styles.composerPickerSection}>
                <Text style={styles.composerPickerSectionTitle}>Mode</Text>
                {composerModeOptions.map((option) => {
                  const active = composerAgent === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      style={active ? [styles.composerPickerRow, styles.composerPickerRowActive] : styles.composerPickerRow}
                      onPress={() => setComposerAgent(option.key)}
                    >
                      <Text style={active ? [styles.composerPickerRowText, styles.composerPickerRowTextActive] : styles.composerPickerRowText}>{option.label}</Text>
                      {active ? <Feather name="check" size={18} color="#111827" /> : null}
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.composerPickerDivider} />
              <View style={styles.composerPickerSection}>
                <View style={styles.composerPickerRow}>
                  <Text style={styles.composerPickerRowText}>Auto Accept</Text>
                  <Pressable
                    style={autoAcceptPermissions ? [styles.composerPickerSwitch, styles.composerPickerSwitchActive] : styles.composerPickerSwitch}
                    onPress={() => setAutoAcceptPermissions((v) => !v)}
                  >
                    <View style={autoAcceptPermissions ? [styles.composerPickerSwitchThumb, styles.composerPickerSwitchThumbActive] : styles.composerPickerSwitchThumb} />
                  </Pressable>
                </View>
              </View>
              <View style={styles.composerPickerDivider} />
              <ScrollView style={styles.composerPickerList} contentContainerStyle={{ paddingBottom: 20 }}>
                {modelOptions.map((opt) => {
                  const active = model.trim() === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      style={active ? [styles.composerPickerItem, styles.composerPickerItemActive] : styles.composerPickerItem}
                      onPress={() => { setModel(opt.id); setComposerPickerOpen(false); }}
                    >
                      <View style={styles.composerPickerItemMain}>
                        <Text style={active ? styles.composerPickerItemTitleActive : styles.composerPickerItemTitle}>{toText(opt.label)}</Text>
                        <Text style={styles.composerPickerItemSub}>{toText(opt.id)}</Text>
                      </View>
                      {active ? <View style={styles.composerPickerCheck}><Feather name="check" size={16} color="#5d5345" /></View> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        ) : null}
        {launchOverlay}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#f7f8fa' },
  chatSafe: { flex: 1, backgroundColor: '#f7f8fa', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0 },

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
    height: 64,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden'
  },
  notebookShell: {
    flex: 1,
    backgroundColor: '#f5f1e8',
    position: 'relative'
  },
  notebookTrack: {
    flex: 1,
    flexDirection: 'row'
  },
  notebookPageFrame: {
    flex: 1
  },
  notebookMainPage: {
    flex: 1,
    backgroundColor: '#f8f5ee'
  },
  streamTopGlowTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(58, 143, 130, 0.10)',
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
    backgroundColor: 'rgba(58, 143, 130, 0.62)'
  },
  topSideSlot: { width: 48, alignItems: 'flex-start', zIndex: 1 },
  topSideSlotRight: { width: 48, alignItems: 'flex-end', zIndex: 1 },
  topBrand: {
    position: 'absolute',
    left: 68,
    right: 68,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 1,
    top: 8
  },
  topTitle: { fontSize: 20, color: '#24211d', fontWeight: '700' },
  topTitleCompact: { fontSize: 18, lineHeight: 22, color: '#24211d', fontWeight: '700' },
  topWorkspaceText: { fontSize: 11, lineHeight: 14, color: '#8d826f', fontWeight: '500' },
  toolBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
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
    backgroundColor: 'transparent'
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
    borderWidth: 1,
    backgroundColor: '#eef1f5'
  },
  iconTxt: { color: '#394455', fontWeight: '700' },

  chatBodyWrap: { flex: 1, paddingHorizontal: 16, position: 'relative' },
  chatListStage: { flex: 1, position: 'relative' },
  blankWrap: { marginTop: 26, gap: 10 },
  blankTitle: { fontSize: 40, fontWeight: '700', color: '#24211d' },
  blankSub: { color: '#8d826f', fontSize: 18 },
  suggestList: { gap: 10, marginTop: 8 },
  suggestChip: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.10)',
    backgroundColor: '#fffdf7',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignSelf: 'flex-start'
  },
  suggestText: { color: '#5d5345', fontSize: 14 },

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
    borderColor: 'rgba(65,54,38,0.10)',
    backgroundColor: 'rgba(255,253,247,0.96)',
    shadowColor: '#503c1e',
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4
  },
  latestJumpTxt: { color: '#3a352e', fontSize: 20, fontWeight: '800', lineHeight: 24 },
  turnWrap: { width: '100%', alignSelf: 'stretch', gap: 10 },
  loadEarlierWrap: { alignItems: 'center', paddingTop: 2, paddingBottom: 4 },
  loadEarlierHint: { marginTop: 6, color: '#8b6c45', fontSize: 11 },
  historyHintWrap: { alignItems: 'center', paddingTop: 4, paddingBottom: 2 },
  historyHintText: { color: '#7c8aa0', fontSize: 12 },
  thinkWrap: { width: '100%', alignItems: 'flex-start' },
  contextWrap: { width: '100%', alignItems: 'flex-start' },
  todoInlineWrap: { width: '100%', alignItems: 'flex-start' },
  dividerWrap: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#ded6ca' },
  dividerLabel: { color: '#9a9182', fontSize: 11 },
  errorWrap: { width: '100%', alignItems: 'flex-start' },
  todoInlineCard: {
    width: '96%',
    maxWidth: '96%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.10)',
    backgroundColor: '#fffdf7',
    paddingVertical: 12,
    paddingHorizontal: 13,
    gap: 12,
    shadowColor: '#503c1e',
    shadowOpacity: 0.07,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 1
  },
  todoInlineCardCompact: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.10)',
    backgroundColor: '#fffdf7',
    paddingVertical: 12,
    paddingHorizontal: 13,
    gap: 12
  },
  todoCardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  todoCardHeadCompact: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  todoCardHeadMain: { flex: 1, gap: 7 },
  todoTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  todoTitle: { color: '#24211d', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  todoActions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 4 },
  todoChipRunning: {
    minWidth: 42,
    height: 21,
    borderRadius: 999,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e7f2ee',
    borderWidth: 1,
    borderColor: '#c8ded7'
  },
  todoChipRunningText: { color: '#2f7f74', fontSize: 11, fontWeight: '800' },
  todoChipDone: {
    minWidth: 42,
    height: 21,
    borderRadius: 999,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1eadf',
    borderWidth: 1,
    borderColor: '#ddd4c5'
  },
  todoChipDoneText: { color: '#5d5345', fontSize: 11, fontWeight: '800' },
  todoSummary: { color: '#7c766c', fontSize: 12, lineHeight: 18, fontWeight: '500' },
  todoProgressTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: '#e5ded2',
    overflow: 'hidden'
  },
  todoProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#3a8f82'
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
    backgroundColor: '#8d826f',
    transform: [{ translateX: -1.5 }, { rotate: '45deg' }]
  },
  todoChevronLineRight: {
    position: 'absolute',
    width: 6,
    height: 1.5,
    borderRadius: 999,
    backgroundColor: '#8d826f',
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
    borderColor: '#8d826f',
    transform: [{ rotate: '45deg' }]
  },
  todoArrowUp: {
    transform: [{ rotate: '-135deg' }]
  },
  todoList: { gap: 7, paddingTop: 2 },
  todoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  todoRowText: { flex: 1, color: '#3a352e', fontSize: 13, lineHeight: 19, fontWeight: '500' },
  todoRowTextDone: { color: '#a69d8e', textDecorationLine: 'line-through' },
  todoRowTextCancelled: { color: '#b8afa0', textDecorationLine: 'line-through' },
  todoStatusPending: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#d8cec0',
    backgroundColor: '#fffdf7',
    alignItems: 'center',
    justifyContent: 'center'
  },
  todoStatusCancelled: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#d8cec0',
    backgroundColor: '#eee8dc',
    alignItems: 'center',
    justifyContent: 'center'
  },
  todoStatusCompleted: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 0,
    backgroundColor: '#3a8f82',
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
    backgroundColor: 'rgba(58,143,130,0.12)'
  },
  todoStatusRunningPulse2: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(58,143,130,0.24)'
  },
  todoStatusRunningCenter: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#3a8f82'
  },
  todoThinkingDots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  todoThinkingDot: {
    width: 4,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#999999'
  },
  todoThinkingDotOn: { backgroundColor: '#3a8f82', transform: [{ translateY: -0.5 }, { scale: 1.1 }] },
  todoThinkingDotMid: { backgroundColor: '#8d826f' },
  todoThinkingDotSoft: { backgroundColor: '#d8cec0' },
  contextCard: {
    width: '96%',
    maxWidth: '96%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eadcc8',
    backgroundColor: '#fff9f0',
    overflow: 'hidden',
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6
  },
  contextHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  contextTitle: { color: '#6a4126', fontSize: 12, fontWeight: '700' },
  contextSummary: { color: '#8b705a', fontSize: 12, lineHeight: 18 },
  contextTools: { gap: 5 },
  contextToolRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contextToolTitle: { color: '#6d4428', fontSize: 12, fontWeight: '600' },
  contextToolDetail: { color: '#9a7a62', fontSize: 11, flex: 1 },
  contextCopyBtn: {
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3e5d3'
  },
  contextCopyText: { color: '#8b6040', fontSize: 12, lineHeight: 14, fontWeight: '800' },
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
  bashEventCard: {
    borderColor: '#ead8bf',
    backgroundColor: '#fff8ed'
  },
  bashEventDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#c48b48' },
  bashEventDotRun: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#d47a34' },
  bashEventTitle: { color: '#68411f' },
  bashEventMode: { color: '#9a6a39' },
  bashEventTime: { color: '#aa8a68' },
  bashEventDetail: { color: '#7f6045' },
  bashEventOutput: {
    color: '#6e533c',
    backgroundColor: '#f8ecd9',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  writeEventCard: {
    width: '96%',
    maxWidth: '96%',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#ead8bf',
    backgroundColor: '#fff8ed',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8
  },
  writeEventHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  writeEventDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: '#c48b48' },
  writeEventDotRun: { width: 8, height: 8, borderRadius: 999, backgroundColor: '#d47a34' },
  writeEventTitle: { flexShrink: 1, color: '#68411f', fontSize: 13, lineHeight: 18, fontWeight: '800', letterSpacing: 0.1 },
  writeEventTime: { marginLeft: 'auto', color: '#aa8a68', fontSize: 12, lineHeight: 17, fontWeight: '500' },
  writeEventDetail: { color: '#7f6045', fontSize: 12, lineHeight: 17, fontWeight: '600' },
  writeEventSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  writeEventAction: {
    color: '#9a5f25',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    backgroundColor: '#f4e2c8',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden'
  },
  writeEventFile: { flex: 1, color: '#6e4a2a', fontSize: 12, lineHeight: 17, fontWeight: '700' },
  writeEventAdd: { color: '#1f8a5b', fontSize: 12, lineHeight: 17, fontWeight: '800' },
  writeEventDel: { color: '#b65b5b', fontSize: 12, lineHeight: 17, fontWeight: '800' },
  writeEventOutput: {
    color: '#6e533c',
    fontSize: 12,
    lineHeight: 18,
    backgroundColor: '#f8ecd9',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
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
    backgroundColor: '#f3eee5',
    overflow: 'hidden',
    paddingVertical: 11,
    paddingHorizontal: 12,
    gap: 8
  },
  thinkHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  thinkIdentityRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0, flex: 1 },
  thinkSpark: { color: '#3a8f82', fontSize: 15, lineHeight: 18, fontWeight: '800' },
  thinkHeadMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thinkTitle: { color: '#5d5345', fontSize: 12, fontWeight: '800', letterSpacing: 0.2, fontFamily: HANDWRITTEN_TEXT_FONT },
  thinkToggleText: { color: '#8d826f', fontSize: 11, fontWeight: '700', fontFamily: HANDWRITTEN_TEXT_FONT },
  thinkExpandedHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  thinkExpandedTitle: { color: '#7c766c', fontSize: 12, fontWeight: '700', fontFamily: HANDWRITTEN_TEXT_FONT },
  thinkText: { color: '#6f6657', fontSize: 13, lineHeight: 19, fontFamily: HANDWRITTEN_TEXT_FONT },
  thinkCollapsed: { color: '#7c766c', fontSize: 12, lineHeight: 18, fontFamily: HANDWRITTEN_TEXT_FONT },
  thinkPreviewLines: { gap: 5, paddingTop: 2 },
  thinkPreviewLineRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  thinkPreviewDot: { width: 5, height: 5, borderRadius: 999, backgroundColor: '#d8cec0' },
  thinkPreviewDotLive: { backgroundColor: '#3a8f82', transform: [{ scale: 1.25 }] },
  thinkPreviewLineText: { flex: 1, color: '#7c766c', fontSize: 12, lineHeight: 17, fontWeight: '500', fontFamily: HANDWRITTEN_TEXT_FONT },
  thinkFlowRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingTop: 1 },
  thinkFlowIconShell: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#24211d',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    shadowColor: '#503c1e',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2
  },
  thinkFlowIconText: { color: '#ffffff', fontSize: 14, lineHeight: 18, fontWeight: '800', letterSpacing: 0.2 },
  thinkFlowStatusDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#9aa6b2',
    borderWidth: 2,
    borderColor: '#f8f5ee'
  },
  thinkFlowStatusDotActive: { backgroundColor: '#3a8f82' },
  thinkFlowContent: { flex: 1, minWidth: 0, gap: 8 },
  thinkFlowDots: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 2 },
  thinkFlowDot: { width: 5.5, height: 5.5, borderRadius: 999, backgroundColor: '#5d5345' },
  thinkFlowDotActive: { backgroundColor: '#5d5345', opacity: 1, transform: [{ scale: 1.18 }] },
  thinkFlowDotMid: { backgroundColor: '#3a8f82', opacity: 0.75 },
  thinkFlowDotSoft: { backgroundColor: '#c9b99f', opacity: 0.58 },
  thinkFlowPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: '#fffdf7',
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.08)',
    paddingLeft: 14,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#503c1e',
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1
  },
  thinkFlowPillWaiting: {
    alignSelf: 'flex-start',
    minWidth: 64,
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: '#fffdf7',
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.08)',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#503c1e',
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1
  },
  thinkFlowKicker: { color: '#3a8f82', fontSize: 10, lineHeight: 12, fontWeight: '800', letterSpacing: 0.6, fontFamily: HANDWRITTEN_TEXT_FONT },
  thinkFlowLine: { flexShrink: 1, color: '#5d5345', fontSize: 13, lineHeight: 17, fontWeight: '600', letterSpacing: -0.1, fontFamily: HANDWRITTEN_TEXT_FONT },
  thinkFlowSteps: { gap: 6, paddingLeft: 8 },
  thinkFlowStepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thinkFlowStepDot: { width: 4, height: 4, borderRadius: 999, backgroundColor: '#d8cec0' },
  thinkFlowStepDotLive: { width: 5, height: 5, borderRadius: 999, backgroundColor: '#3a8f82' },
  thinkFlowStepText: { flex: 1, color: '#8d826f', fontSize: 12, lineHeight: 16, fontWeight: '500', fontFamily: HANDWRITTEN_TEXT_FONT },
  mdText: { fontSize: 15, lineHeight: 20, fontFamily: HANDWRITTEN_TEXT_FONT },
  mdInlineRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 0 },
  mdSegText: { fontSize: 15, lineHeight: 20, fontFamily: HANDWRITTEN_TEXT_FONT },
  mdHeading: { fontSize: 16, lineHeight: 22, fontWeight: '700', marginBottom: 4, fontFamily: HANDWRITTEN_TEXT_FONT },
  mdInlineCode: { borderRadius: 4, paddingHorizontal: 4, fontSize: 13 },
  mdCodeBlock: { borderRadius: 8, backgroundColor: '#ece8df', padding: 8 },
  mdCodeText: { fontSize: 12, lineHeight: 18 },
  mdBulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  mdBulletDot: { fontSize: 14, lineHeight: 20, fontFamily: HANDWRITTEN_TEXT_FONT },
  thinkingWrap: { alignItems: 'flex-start' },
  thinkingStickyWrap: { alignItems: 'flex-start', paddingBottom: 6 },
  thinkingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ddd4c5',
    backgroundColor: '#fffdf7',
    paddingVertical: 10,
    paddingHorizontal: 12
  },
  thinkingDots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  thinkingDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: '#c7d0de' },
  thinkingDotOn: { backgroundColor: '#6b7f98' },
  thinkingLabel: { color: '#667a94', fontSize: 12, fontWeight: '500', fontFamily: HANDWRITTEN_TEXT_FONT },
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
  userAttachmentStrip: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, marginBottom: 8 },
  userAttachmentImage: { width: 74, height: 74, borderRadius: 10, backgroundColor: '#334155' },
  albumOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    justifyContent: 'flex-end'
  },
  albumBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.36)' },
  albumSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 86,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#ffffff',
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 18,
    overflow: 'hidden'
  },
  albumHeaderRow: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  albumHeaderBtn: { minWidth: 62, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  albumHeaderBtnDisabled: { opacity: 0.45 },
  albumHeaderBtnText: { color: '#1f2937', fontSize: 15, fontWeight: '700' },
  albumHeaderBtnTextDisabled: { color: '#94a3b8' },
  albumTitle: { color: '#111827', fontSize: 17, fontWeight: '800' },
  albumPickerBar: { maxHeight: 42, marginHorizontal: -2, marginBottom: 4 },
  albumPickerBarContent: { gap: 8, paddingHorizontal: 2, paddingVertical: 4 },
  albumPickerChip: { height: 30, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' },
  albumPickerChipActive: { backgroundColor: '#111827', borderColor: '#111827' },
  albumPickerChipText: { maxWidth: 160, color: '#64748b', fontSize: 13, fontWeight: '700' },
  albumPickerChipTextActive: { color: '#ffffff' },
  albumLoadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  albumLoadingText: { color: '#64748b', fontSize: 13 },
  albumGrid: { paddingTop: 8, paddingBottom: 18 },
  albumLoadingMore: { height: 36, alignItems: 'center', justifyContent: 'center' },
  albumThumbCell: { flex: 1, padding: 3 },
  albumThumbCard: { width: '100%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: '#eef2f7' },
  albumThumbImage: { width: '100%', height: '100%' },
  albumSelectBadge: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.34)',
    borderWidth: 1.5,
    borderColor: '#ffffff'
  },
  albumSelectBadgeOn: { backgroundColor: '#1f2937' },
  albumSelectText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  albumSelectTextOn: { color: '#ffffff' },
  albumEmptyText: { width: '100%', paddingVertical: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 },
  imagePreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    elevation: 10000
  },
  imagePreviewBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.72)' },
  imagePreviewCard: { width: '92%', maxHeight: '86%', borderRadius: 18, backgroundColor: '#ffffff', padding: 12, gap: 10 },
  imagePreviewToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  imagePreviewButton: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#f1f5f9' },
  imagePreviewButtonText: { color: '#1f2937', fontSize: 13, fontWeight: '600' },
  imagePreviewImage: { width: '100%', height: 520, borderRadius: 12, backgroundColor: '#f8fafc' },
  photoCameraScreen: { flex: 1, width: '100%', height: '100%', backgroundColor: '#000' },
  photoCameraOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -80,
    bottom: 0,
    zIndex: 9998,
    elevation: 9998,
    backgroundColor: '#000'
  },
  photoCameraView: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  photoCameraControls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 128,
    paddingBottom: 28,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.32)'
  },
  photoCameraTextButton: { width: 76, alignItems: 'center', justifyContent: 'center' },
  photoCameraText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  photoCameraShutter: {
    width: 72,
    height: 72,
    borderRadius: 999,
    borderWidth: 4,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center'
  },
  photoCameraShutterDisabled: { opacity: 0.45 },
  photoCameraShutterInner: { width: 54, height: 54, borderRadius: 999, backgroundColor: '#ffffff' },
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
  streamdownTextContainer: { width: '100%', flexShrink: 1, minWidth: 0 },
  bubbleUserText: { color: '#f5f7fb', fontSize: 15, lineHeight: 22, fontFamily: HANDWRITTEN_TEXT_FONT },
  bubbleAssistantText: { color: '#2f3948', lineHeight: 20 },

  todoDockWrap: {
    marginHorizontal: 12,
    marginBottom: 8
  },
  todoSwipeShell: {
    borderRadius: 22,
    overflow: 'hidden'
  },
  todoSwipeHint: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 18,
    backgroundColor: '#eef5ee'
  },
  todoSwipeHintText: { color: '#3a8f82', fontSize: 12, lineHeight: 16, fontWeight: '800' },
  questionDockWrap: {
    marginHorizontal: 12,
    marginBottom: 8
  },
  todoDockCompact: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.10)',
    backgroundColor: '#fffdf7',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    shadowColor: '#503c1e',
    shadowOpacity: 0.08,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3
  },
  todoDock: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.10)',
    backgroundColor: '#fffdf7',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    shadowColor: '#503c1e',
    shadowOpacity: 0.07,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2
  },

  inputDock: {
    marginHorizontal: 14,
    marginBottom: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.10)',
    backgroundColor: '#fffdf7',
    minHeight: 104,
    paddingLeft: 16,
    paddingRight: 14,
    paddingTop: 15,
    paddingBottom: 12,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 14,
    shadowColor: '#503c1e',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
    zIndex: 3
  },
  attachmentBackdrop: {
    ...StyleSheet.absoluteFillObject,
    top: 58,
    bottom: 86,
    backgroundColor: 'rgba(248,245,238,0.62)',
    zIndex: 2
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputToolbar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  inputToolbarSpacer: { flex: 1 },
  autoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 10,
    paddingRight: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f1eadf',
    borderWidth: 1,
    borderColor: '#ded6ca'
  },
  autoToggleActive: {
    backgroundColor: '#e7f2ee',
    borderColor: '#c8ded7',
    shadowColor: '#3a8f82',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  autoToggleAura: {
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffdf7',
    borderWidth: 1.5,
    borderColor: '#d8cec0'
  },
  autoToggleText: { color: '#7c766c', fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  autoToggleTextActive: { color: '#2f7f74' },
  autoToggleKnob: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#a69d8e'
  },
  autoToggleKnobActive: { backgroundColor: '#3a8f82' },
  inputMain: {
    minHeight: 34,
    maxHeight: 120,
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 10,
    color: '#24211d',
    fontSize: 17,
    lineHeight: 22,
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {})
  },
  actionBtnStop: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ece8df'
  },
  actionBtnSend: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#24211d'
  },
  actionBtnDisabled: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent'
  },
  accessPill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  accessPillText: { color: '#d46b25', fontSize: 15, fontWeight: '700' },
  modelMiniPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f1eadf',
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 200
  },
  modelMiniText: { color: '#3a352e', fontSize: 14, fontWeight: '700', lineHeight: 18, flexShrink: 1 },
  actionBtnStopTxt: { color: '#7c766c', fontSize: 12, fontWeight: '700' },
  actionBtnSendTxt: { color: '#fff', fontSize: 18, fontWeight: '700' },
  actionBtnGhost: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4efe6',
    borderWidth: 1,
    borderColor: '#ddd4c5'
  },
  actionBtnGhostTxt: { color: '#24211d', fontSize: 22, lineHeight: 22, fontWeight: '500' },
  slashPopover: {
    marginTop: 8,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e7edf5',
    overflow: 'hidden',
    maxHeight: 320,
    shadowColor: '#c8d2df',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2
  },
  slashItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  slashItemActive: { backgroundColor: '#f2f6fb' },
  slashItemMain: { flex: 1, minWidth: 0, gap: 2 },
  slashItemTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  slashTrigger: { color: '#1f2937', fontSize: 15, fontWeight: '600' },
  slashTitle: { color: '#475569', fontSize: 13 },
  slashDesc: { color: '#94a3b8', fontSize: 12 },
  slashSource: { color: '#94a3b8', fontSize: 11, textTransform: 'uppercase' },

  attachmentScroller: { maxHeight: 70, marginLeft: -2, marginRight: -2, marginBottom: 1 },
  attachmentRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 2, paddingTop: 2, paddingBottom: 4 },
  attachmentTile: {
    width: 62,
    height: 62,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#d7dee8',
    overflow: 'hidden',
    shadowColor: '#334155',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1
  },
  attachmentThumb: { width: '100%', height: '100%', borderRadius: 11 },
  attachmentStateOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: 'rgba(15,23,42,0.58)'
  },
  attachmentStateFailed: { backgroundColor: 'rgba(185,28,28,0.68)' },
  attachmentStateText: { color: '#ffffff', fontSize: 10, fontWeight: '700' },
  attachmentChip: {},
  attachmentName: { display: 'none' },
  attachmentRemove: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)'
  },
  attachmentRemoveTxt: { color: '#ffffff', fontSize: 14, lineHeight: 14, fontWeight: '700' },
  imagePickBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0'
  },
  imagePickBtnTxt: { color: '#334155', fontSize: 18, fontWeight: '600', lineHeight: 20 },
  cameraBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent'
  },
  cameraBtnTxt: { fontSize: 16 },
  attachmentPanel: {
    paddingTop: 12,
    gap: 12
  },
  attachmentMenuRow: { flexDirection: 'row', gap: 8 },
  attachmentMenuCard: {
    flex: 1,
    minHeight: 88,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e7edf5',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  attachmentMenuIcon: { fontSize: 24 },
  attachmentMenuIconShell: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e7edf5'
  },
  attachmentMenuLabel: { color: '#334155', fontSize: 14, fontWeight: '500' },
  recentHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  recentHeaderTitle: { color: '#64748b', fontSize: 13, fontWeight: '500' },
  recentScroller: { maxHeight: 300 },
  recentScrollerContent: { paddingTop: 4, paddingBottom: 0 },
  recentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignContent: 'flex-start', paddingBottom: 10 },
  recentThumbCard: {
    width: '23.5%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f1f5f9'
  },
  recentLoadingState: {
    width: '100%',
    minHeight: 74,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#edf2f7',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  recentLoadingText: { color: '#64748b', fontSize: 12, fontWeight: '500' },
  recentThumbImage: { width: '100%', height: '100%' },
  recentLoadingMore: { width: '100%', height: 28, alignItems: 'center', justifyContent: 'center' },
  recentLoadHint: { width: '100%', height: 24, alignItems: 'center', justifyContent: 'center' },
  recentLoadHintText: { color: '#94a3b8', fontSize: 11, fontWeight: '600' },
  recentEmptyState: {
    width: '100%',
    minHeight: 80,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  recentEmptyText: { color: '#94a3b8', fontSize: 12 },

  drawerPanelLeft: {
    flex: 1,
    backgroundColor: '#f7f3ea',
    paddingTop: 38,
    paddingHorizontal: 18,
    paddingBottom: 22
  },
  drawerPanelRight: {
    flex: 1,
    backgroundColor: '#f7f3ea',
    paddingTop: 38,
    paddingHorizontal: 18,
    paddingBottom: 22
  },
  leftHandText: { fontFamily: HANDWRITTEN_TEXT_FONT },
  rightHandText: { fontFamily: HANDWRITTEN_TEXT_FONT },
  drawerHead: { gap: 8, marginBottom: 18, paddingHorizontal: 14 },
  drawerHeadTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  notebookPageTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  notebookHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  themeTextBtn: { marginLeft: 'auto', paddingHorizontal: 2, paddingVertical: 6 },
  notebookGhostBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(38,35,29,0.16)',
    backgroundColor: 'rgba(255,250,242,0.64)',
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  notebookGhostBtnText: { color: '#4b4337', fontSize: 12, fontWeight: '800', lineHeight: 15, fontFamily: HANDWRITTEN_TEXT_FONT },
  themeSwitchBtn: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  themeSwitchText: { fontSize: 11, fontWeight: '800', lineHeight: 14 },
  drawerEyebrow: { color: '#958b78', fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', fontFamily: HANDWRITTEN_TEXT_FONT },
  drawerHeaderMetaText: { fontSize: 11, lineHeight: 15, fontWeight: '600', marginTop: 1, fontFamily: HANDWRITTEN_TEXT_FONT },
  drawerSectionLabel: { color: '#8b806d', fontSize: 12, fontWeight: '800', letterSpacing: 0.5, marginBottom: 9, marginTop: 8 },
  drawerAgentSegment: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    borderRadius: 999,
    backgroundColor: '#f3f5f8',
    gap: 6,
    alignSelf: 'stretch'
  },
  drawerAgentChip: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center'
  },
  drawerAgentChipActive: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  drawerAgentChipText: { color: '#7c8798', fontSize: 14, fontWeight: '700' },
  drawerAgentChipTextActive: { color: '#182131' },
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
    lineHeight: 15,
    paddingHorizontal: 11,
    paddingVertical: 5,
    overflow: 'hidden'
  },
  drawerModelStatus: { color: '#6a788d', fontSize: 13, lineHeight: 20, marginBottom: 2 },
  drawerModelRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  drawerModelCheckBadge: {
    borderRadius: 999,
    backgroundColor: '#d9e9ff',
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  drawerModelCheckText: { color: '#24538a', fontSize: 11, fontWeight: '800' },
  drawerModelListItem: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4ebf3',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 9,
    shadowColor: '#0f172a',
    shadowOpacity: 0.035,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1
  },
  drawerModelListItemActive: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#bfd6f5',
    backgroundColor: '#eef5ff',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 9,
    shadowColor: '#7ba7df',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2
  },
  drawerModelListTitle: { color: '#27384e', fontSize: 15, fontWeight: '700' },
  drawerModelListTitleActive: { color: '#1d4d86', fontSize: 15, fontWeight: '800' },
  drawerModelListSub: { color: '#74839a', fontSize: 12, lineHeight: 18 },
  drawerModelListSubActive: { color: '#4a6891', fontSize: 12, lineHeight: 18 },
  drawerProviderPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#f4f7fb'
  },
  drawerProviderPillActive: { backgroundColor: '#dfeafc' },
  drawerProviderPillText: { color: '#6d7b90', fontSize: 11, fontWeight: '700' },
  drawerProviderPillTextActive: { color: '#315b90' },
  drawerTitle: { color: '#26231d', fontWeight: '800', fontSize: 34, lineHeight: 38, letterSpacing: -1.2 },
  drawerNewBtn: {
    borderRadius: 999,
    backgroundColor: '#26231d',
    borderWidth: 1,
    borderColor: '#26231d',
    paddingVertical: 7,
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12
  },
  drawerNewTxt: { color: '#fbfaf6', fontWeight: '800', fontSize: 12, lineHeight: 15 },
  drawerScroll: { flex: 1 },
  drawerList: { paddingBottom: 28, paddingTop: 2 },
  leftActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  leftRoundAction: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffdf7',
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.08)',
    shadowColor: '#503c1e',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2
  },
  leftRoundActionSoft: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#24211d',
    shadowColor: '#503c1e',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3
  },
  leftStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  leftStatusDotOn: { width: 8, height: 8, borderRadius: 999, backgroundColor: '#22c78a' },
  leftStatusDotOff: { width: 8, height: 8, borderRadius: 999, backgroundColor: '#c9b99f' },
  leftStatusText: { fontSize: 15, lineHeight: 20, fontWeight: '600', marginTop: 0, fontFamily: HANDWRITTEN_TEXT_FONT },
  leftSectionBlock: { marginTop: 0, marginBottom: 16, paddingHorizontal: 14 },
  leftSectionLabel: { fontSize: 12, lineHeight: 16, fontWeight: '800', marginBottom: 10, letterSpacing: 0.4, textTransform: 'uppercase', fontFamily: HANDWRITTEN_TEXT_FONT },
  leftProjectRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  leftProjectMain: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10 },
  leftProjectIconBox: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0c15b',
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.12)'
  },
  leftProjectTextBlock: { flex: 1, justifyContent: 'center', gap: 2 },
  leftProjectTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  leftProjectCompose: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,253,247,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.08)'
  },
  leftProjectChevron: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  directoryPaper: {
    borderRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 17,
    paddingBottom: 20,
    shadowColor: '#4c4438',
    shadowOpacity: 0.04,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1
  },
  directoryPaperTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, gap: 14 },
  directoryPaperHeading: { flex: 1, gap: 3 },
  directoryPaperLabel: { fontSize: 13, lineHeight: 17, fontWeight: '800', letterSpacing: 0.2 },
  directoryPaperMeta: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
  directorySectionCaption: { fontSize: 11, lineHeight: 14, fontWeight: '700', marginBottom: 8, letterSpacing: 0.3 },
  workspaceSwitcherRow: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12
  },
  workspaceSwitcherCopy: { flex: 1, gap: 2 },
  workspaceSwitcherTitle: { fontSize: 18, lineHeight: 23, fontWeight: '700', letterSpacing: -0.05, fontFamily: HANDWRITTEN_TEXT_FONT },
  workspaceSwitcherSub: { fontSize: 11, lineHeight: 15, fontWeight: '500', fontFamily: HANDWRITTEN_TEXT_FONT },
  workspaceSwitcherChevron: { fontSize: 18, lineHeight: 18, fontWeight: '600' },
  workspaceSwitcherSheet: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 6,
    marginBottom: 12
  },
  workspaceSwitcherItem: {
    minHeight: 38,
    borderRadius: 12,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  workspaceSwitcherItemTitle: { fontSize: 14, lineHeight: 19, fontWeight: '600', fontFamily: HANDWRITTEN_TEXT_FONT },
  workspaceSwitcherSheetInline: {
    borderWidth: 1,
    borderRadius: 14,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4
  },
  workspaceSwitcherInlineItem: { minHeight: 32, justifyContent: 'center' },
  directoryGroup: { marginBottom: 18 },
  directoryGroupPlain: { gap: 4 },
  directoryWorkspaceRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 2,
    paddingBottom: 4
  },
  directoryWorkspaceTitle: { fontSize: 16, lineHeight: 21, fontWeight: '800', letterSpacing: -0.15 },
  directoryActiveDot: { width: 5, height: 5, borderRadius: 999, marginTop: 1 },
  directorySessionRow: {
    minHeight: 34,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 2,
    paddingVertical: 5
  },
  directorySessionActive: {
    minHeight: 36,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(38,35,29,0.06)'
  },
  directorySessionActiveSlate: {
    shadowColor: '#9aa5b1',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1
  },
  directoryBullet: { width: 6, height: 6, borderRadius: 999, opacity: 0.72 },
  directoryBulletSpacer: { width: 6, height: 6 },
  directorySessionTitle: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '600', letterSpacing: -0.03, fontFamily: HANDWRITTEN_TEXT_FONT },
  drawerSessionSearchMinimal: {
    flex: 1,
    height: 38,
    paddingHorizontal: 0,
    fontSize: 14,
    fontFamily: HANDWRITTEN_TEXT_FONT,
    color: '#24211d',
    borderBottomWidth: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {})
  },
  leftSearchShell: {
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.08)',
    backgroundColor: '#f8f4ec',
    paddingHorizontal: 12,
    marginHorizontal: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  directorySessionPlainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 0,
    minHeight: 62,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderColor: 'rgba(65,54,38,0.06)',
    position: 'relative'
  },
  directorySessionPlainRowActive: {
    backgroundColor: 'rgba(255,253,247,0.58)',
    borderRadius: 14,
    borderBottomWidth: 1,
    borderColor: 'rgba(65,54,38,0.10)',
    paddingHorizontal: 14
  },
  leftSessionRail: { position: 'absolute', left: 0, top: 12, width: 3, height: 36, borderRadius: 999, backgroundColor: 'transparent' },
  leftSessionRailActive: { position: 'absolute', left: 0, top: 12, width: 3, height: 36, borderRadius: 999, backgroundColor: '#24211d' },
  directorySessionPlainBody: { flex: 1, gap: 4 },
  directorySessionPlainHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  directorySessionPlainTitle: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '600', letterSpacing: -0.05, fontFamily: HANDWRITTEN_TEXT_FONT },
  directorySessionPlainTitleActive: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '800', letterSpacing: -0.06, fontFamily: HANDWRITTEN_TEXT_FONT },
  directorySessionPlainTime: { fontSize: 11, lineHeight: 15, fontWeight: '600', fontFamily: HANDWRITTEN_TEXT_FONT },
  directorySessionPlainMeta: { fontSize: 12, lineHeight: 17, fontWeight: '500', fontFamily: HANDWRITTEN_TEXT_FONT },
  workspaceSectionCard: {
    borderRadius: 2,
    borderLeftWidth: 3,
    borderColor: '#26231d',
    backgroundColor: 'rgba(255,252,245,0.72)',
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 12,
    gap: 12,
    marginBottom: 18
  },
  workspaceCurrentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  workspaceCurrentBadge: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: '#26231d',
    alignItems: 'center',
    justifyContent: 'center'
  },
  workspaceCurrentBadgeText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  workspaceCurrentCopy: { flex: 1, gap: 2 },
  workspaceCurrentTitle: { color: '#26231d', fontSize: 16, fontWeight: '800' },
  workspaceCurrentPath: { color: '#8d826f', fontSize: 11 },
  workspaceMiniList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  workspaceMiniItem: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ded2be',
    backgroundColor: '#fffaf0',
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  workspaceMiniItemActive: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#26231d',
    backgroundColor: '#26231d',
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  workspaceMiniItemText: { color: '#5f5749', fontSize: 12, fontWeight: '700' },
  workspaceMiniItemTextActive: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  drawerItemGap: { marginBottom: 8 },
  drawerMoreBtn: {
    alignItems: 'center',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,253,247,0.50)',
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.08)'
  },
  drawerMoreTxt: { color: '#7c766c', fontSize: 12, fontWeight: '700', letterSpacing: 0.2, fontFamily: HANDWRITTEN_TEXT_FONT },
  drawerSessionSearch: {
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddd2c0',
    backgroundColor: '#fffaf2',
    paddingHorizontal: 13,
    marginBottom: 12,
    color: '#26231d',
    fontSize: 13,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {})
  },
  drawerItem: {
    borderRadius: 0,
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderColor: 'rgba(38,35,29,0.12)',
    paddingHorizontal: 2,
    paddingVertical: 14,
    gap: 6,
    minHeight: 68
  },
  drawerItemActive: {
    borderRadius: 14,
    backgroundColor: '#fffaf2',
    borderWidth: 1,
    borderColor: '#d6c7ad',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
    minHeight: 72
  },
  drawerItemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  drawerItemTitle: { color: '#26231d', fontWeight: '800', fontSize: 15 },
  drawerItemTime: { color: '#9a907f', fontSize: 11 },
  drawerItemPreview: { color: '#6f6657', fontSize: 12, lineHeight: 18 },
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
  scannerStatusText: { color: '#4d5e76', fontSize: 13, lineHeight: 18 },

  extensionSectionCard: {
    borderRadius: 18,
    backgroundColor: 'rgba(255,253,247,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.10)',
    marginBottom: 14,
    padding: 15,
    gap: 13
  },
  extensionSectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    justifyContent: 'flex-start'
  },
  extensionHeroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e8edf4',
    marginBottom: 10,
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1
  },
  extensionHeroCardAlt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e8edf4',
    marginBottom: 10,
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1
  },
  extensionHeroOrb: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: '#f0e9dc',
    alignItems: 'center',
    justifyContent: 'center'
  },
  extensionHeroOrbAlt: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: '#f0e9dc',
    alignItems: 'center',
    justifyContent: 'center'
  },
  extensionHeroOrbText: { color: '#3b332b', fontSize: 16, fontWeight: '800', fontFamily: HANDWRITTEN_TEXT_FONT },
  extensionHeroCopy: { flex: 1, gap: 3 },
  extensionHeroTitle: { color: '#25231d', fontSize: 16, fontWeight: '900', fontFamily: HANDWRITTEN_TEXT_FONT },
  extensionHeroSub: { color: '#7c766c', fontSize: 12, fontWeight: '700', fontFamily: HANDWRITTEN_TEXT_FONT },
  extensionSectionGap: { height: 16 },
  extensionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderRadius: 17,
    backgroundColor: 'rgba(255,253,247,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(65,54,38,0.08)',
    marginBottom: 8,
    shadowColor: '#0f172a',
    shadowOpacity: 0.02,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 0
  },
  extensionCardIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#f4eadb',
    alignItems: 'center',
    justifyContent: 'center'
  },
  extensionCardIconMcp: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#f4eadb',
    alignItems: 'center',
    justifyContent: 'center'
  },
  extensionCardMain: { flex: 1, gap: 2, paddingTop: 1 },
  extensionCardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  extensionCardTitle: { color: '#25231d', fontSize: 13, fontWeight: '800', fontFamily: HANDWRITTEN_TEXT_FONT },
  extensionCardSub: { color: '#7c766c', fontSize: 11, lineHeight: 16, fontWeight: '600', fontFamily: HANDWRITTEN_TEXT_FONT },
  extensionStatePill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#f0e9dc',
    color: '#5d5345',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: HANDWRITTEN_TEXT_FONT,
    overflow: 'hidden'
  },

  composerPickerOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 60, justifyContent: 'flex-end' },
  composerPickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(36,33,29,0.28)' },
  composerPickerSheet: {
    backgroundColor: '#f7f3ea',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 34,
    maxHeight: '80%',
    shadowColor: '#503c1e',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 10
  },
  composerPickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  composerPickerTitle: { color: '#24211d', fontSize: 22, lineHeight: 28, fontWeight: '800', fontFamily: HANDWRITTEN_TEXT_FONT },
  composerPickerCloseBtn: { width: 32, height: 32, borderRadius: 999, backgroundColor: '#ece8df', alignItems: 'center', justifyContent: 'center' },
  composerPickerSegment: { flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: '#f3f5f8', gap: 6, marginBottom: 16 },
  composerPickerChip: { flex: 1, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  composerPickerChipActive: { flex: 1, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: '#ffffff', shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2, alignItems: 'center', justifyContent: 'center' },
  composerPickerChipText: { color: '#7c8798', fontSize: 14, fontWeight: '700' },
  composerPickerChipTextActive: { color: '#182131' },
  composerPickerList: { maxHeight: 400 },
  composerPickerItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, backgroundColor: 'rgba(255,253,247,0.62)', borderWidth: 1, borderColor: 'rgba(65,54,38,0.08)', marginBottom: 8 },
  composerPickerItemActive: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, backgroundColor: '#f0e9dc', borderWidth: 1, borderColor: 'rgba(65,54,38,0.16)', marginBottom: 8 },
  composerPickerItemMain: { flex: 1, gap: 4 },
  composerPickerItemTitle: { color: '#24211d', fontSize: 15, lineHeight: 20, fontWeight: '600', fontFamily: HANDWRITTEN_TEXT_FONT },
  composerPickerItemTitleActive: { color: '#24211d', fontSize: 15, lineHeight: 20, fontWeight: '800', fontFamily: HANDWRITTEN_TEXT_FONT },
  composerPickerItemSub: { color: '#7c766c', fontSize: 12, lineHeight: 16, fontFamily: HANDWRITTEN_TEXT_FONT },
  composerPickerCheck: { width: 28, height: 28, borderRadius: 999, backgroundColor: '#ece8df', alignItems: 'center', justifyContent: 'center' },
  composerPickerSection: { marginBottom: 8 },
  composerPickerSectionTitle: { color: '#9a9182', fontSize: 12, fontWeight: '800', marginBottom: 8, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: HANDWRITTEN_TEXT_FONT },
  composerPickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(255,253,247,0.34)', marginBottom: 6 },
  composerPickerRowActive: { backgroundColor: '#f0e9dc' },
  composerPickerRowText: { color: '#5d5345', fontSize: 16, lineHeight: 21, fontWeight: '600', fontFamily: HANDWRITTEN_TEXT_FONT },
  composerPickerRowTextActive: { color: '#24211d', fontWeight: '800' },
  composerPickerDivider: { height: 1, backgroundColor: 'rgba(65,54,38,0.10)', marginVertical: 8 },
  composerPickerSwitch: { width: 48, height: 28, borderRadius: 999, backgroundColor: '#ece8df', padding: 3, justifyContent: 'center' },
  composerPickerSwitchActive: { backgroundColor: '#d8cec0' },
  composerPickerSwitchThumb: { width: 22, height: 22, borderRadius: 999, backgroundColor: '#fffdf7', shadowColor: '#503c1e', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  composerPickerSwitchThumbActive: { alignSelf: 'flex-end' }
});
