import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View
} from 'react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';
import { toText } from '../../lib/text';
import type { MobileEventCard, MobileQuestionCard, MobileRenderedTurn, MobileTodoCard } from '../../types';
import type { TurnCellInteractionState } from '../../features/chat/useInteractiveTurnCells';
import { FONT_MIXED_BODY_MEDIUM } from '../../styles/mobileFonts';
import { MobileMarkedMarkdown } from './MobileMarkedMarkdown';
import { buildMobileDiffRows } from './mobileDiff';

const CODE_SEGMENT_RE = /(```[\s\S]*?```|`[^`\n]+`)/g;

function escapeUnderscoresInPaths(input: string) {
  return input
    .split(CODE_SEGMENT_RE)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(
        /(^|[\s([{>"'「『（，,：:;—-])((?:\.?[A-Za-z0-9][A-Za-z0-9._-]*)(?:[\\/][A-Za-z0-9._-]+)+(?::\d+(?::\d+)?)?)/gm,
        (full, prefix, token) => {
          if (!token.includes('_')) return full;
          return `${prefix}${token.replace(/_/g, '\\_')}`;
        }
      );
    })
    .join('');
}

function normalizeMarkdownForMobile(input: string) {
  const trimmed = toText(input);
  const withoutListIndent = trimmed.replace(/^[ \t]{2,}(?=(?:\*\*|#{1,6}\s|[-*+]\s|\d+\.\s|>\s))/gm, '');
  return escapeUnderscoresInPaths(withoutListIndent);
}

function normalizeReasoningText(input: string) {
  return toText(input)
    .replace(/\*\*/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*•·]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function todoMeta(card: MobileTodoCard) {
  const items = Array.isArray(card.items) ? card.items : [];
  const total = items.length;
  const done = items.filter((item) => item.status === 'completed').length;
  const active =
    items.find((item) => item.status === 'in_progress') ||
    items.find((item) => item.status === 'pending') ||
    items[items.length - 1] ||
    null;
  return { total, done, active };
}

function MarkdownMessage(props: {
  bodyFontFamily: string;
  styles: Record<string, any>;
  text: string;
  tone: 'user' | 'assistant' | 'think';
  streaming: boolean;
}) {
  const { bodyFontFamily, streaming, styles, text, tone } = props;
  const src = normalizeMarkdownForMobile(text);
  const flowAnim = useRef(new Animated.Value(streaming ? 0 : 1)).current;
  const isUser = tone === 'user';
  const isThink = tone === 'think';
  const textColor = isUser ? '#fffaf2' : isThink ? '#746b5e' : '#24211d';
  const mutedColor = isUser ? '#eadfce' : isThink ? '#8d826f' : '#6f6a61';
  const headingColor = isUser ? '#ffffff' : isThink ? '#5f5749' : '#211e19';
  const codeBg = isUser ? 'rgba(38, 35, 29, 0.34)' : isThink ? '#eee8dc' : '#f1ede5';
  const inlineCodeColor = isUser ? '#fffaf2' : isThink ? '#6b6459' : '#667168';
  const codeColor = isUser ? '#fffaf2' : '#355c4e';
  const markdownStyles = useMemo<MarkdownStyle>(
    () => ({
      paragraph: {
        color: textColor,
        fontSize: isThink ? 14 : 15,
        lineHeight: isThink ? 21 : 23,
        fontFamily: bodyFontFamily,
        marginTop: 0,
        marginBottom: isThink ? 10 : 12
      },
      strong: { color: headingColor, fontWeight: 'bold', fontFamily: bodyFontFamily },
      em: { color: mutedColor, fontStyle: 'italic', fontFamily: bodyFontFamily },
      link: { color: isUser ? '#bfdbfe' : '#2d7f95', underline: true, fontFamily: bodyFontFamily },
      h1: { color: headingColor, fontSize: 28, lineHeight: 34, fontWeight: '700', marginTop: 20, marginBottom: 10, fontFamily: bodyFontFamily },
      h2: { color: headingColor, fontSize: 24, lineHeight: 30, fontWeight: '700', marginTop: 18, marginBottom: 10, fontFamily: bodyFontFamily },
      h3: { color: headingColor, fontSize: 20, lineHeight: 26, fontWeight: '700', marginTop: 16, marginBottom: 8, fontFamily: bodyFontFamily },
      h4: { color: headingColor, fontSize: 18, lineHeight: 24, fontWeight: '700', marginTop: 14, marginBottom: 8, fontFamily: bodyFontFamily },
      h5: { color: headingColor, fontSize: 17, lineHeight: 23, fontWeight: '700', marginTop: 12, marginBottom: 7, fontFamily: bodyFontFamily },
      h6: { color: mutedColor, fontSize: 16, lineHeight: 22, fontWeight: '700', marginTop: 12, marginBottom: 7, fontFamily: bodyFontFamily },
      list: {
        color: textColor,
        fontSize: isThink ? 14 : 15,
        lineHeight: isThink ? 21 : 23,
        fontFamily: bodyFontFamily,
        marginTop: 0,
        marginBottom: 12,
        marginLeft: 6,
        gapWidth: 8,
        bulletColor: mutedColor,
        markerColor: mutedColor
      },
      code: {
        color: inlineCodeColor,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        fontSize: 12.5,
        fontFamily: FONT_MIXED_BODY_MEDIUM
      },
      codeBlock: {
        color: codeColor,
        backgroundColor: codeBg,
        borderColor: codeBg,
        borderRadius: 8,
        padding: 10,
        marginTop: 2,
        marginBottom: 10,
        fontSize: 12.5,
        lineHeight: 20,
        fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo'
      },
      blockquote: {
        color: textColor,
        backgroundColor: isUser ? 'rgba(38, 35, 29, 0.18)' : '#f7f3eb',
        borderColor: isUser ? '#eadfce' : '#c9b99f',
        borderWidth: 2,
        marginTop: 8,
        marginBottom: 12,
        gapWidth: 10
      },
      thematicBreak: {
        color: isUser ? 'rgba(234,223,206,0.35)' : '#ded6ca',
        height: 1,
        marginTop: 14,
        marginBottom: 14
      },
      table: {
        color: textColor,
        fontSize: isThink ? 14 : 15,
        lineHeight: isThink ? 21 : 23,
        headerTextColor: headingColor,
        borderColor: isUser ? 'rgba(234,223,206,0.35)' : '#ddd4c5',
        borderWidth: 1,
        borderRadius: 8,
        cellPaddingHorizontal: 8,
        cellPaddingVertical: 8,
        rowEvenBackgroundColor: isUser ? 'rgba(255,255,255,0.04)' : '#fbf8f2',
        rowOddBackgroundColor: isUser ? 'rgba(255,255,255,0.02)' : '#f6f0e6'
      }
    }),
    [bodyFontFamily, codeBg, codeColor, headingColor, inlineCodeColor, isThink, isUser, mutedColor, textColor]
  );

  useEffect(() => {
    if (!streaming) {
      flowAnim.stopAnimation();
      flowAnim.setValue(1);
      return;
    }
    // 只在流式开始时触发一次淡入动画，避免文本更新时重复动画导致波动
    flowAnim.stopAnimation();
    flowAnim.setValue(0);
    const animation = Animated.timing(flowAnim, {
      toValue: 1,
      duration: 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    });
    animation.start();
    return () => animation.stop();
    // 依赖项中移除 src，避免每次文本更新都触发动画
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowAnim, streaming]);

  return (
    <View style={styles.markdownBlock}>
      <Animated.View
        style={{
          opacity: flowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }),
          transform: [
            {
              translateY: flowAnim.interpolate({ inputRange: [0, 1], outputRange: [3, 0] })
            }
          ]
        }}
      >
        <MobileMarkedMarkdown
          containerStyle={styles.streamdownTextContainer}
          streaming={streaming}
          styles={markdownStyles}
          value={src}
          onLinkPress={async (event) => {
            const url = toText(event?.url).trim();
            if (!url) return;
            try {
              await Linking.openURL(url);
            } catch {
              // 忽略打开失败，避免点击链接打断聊天页
            }
          }}
        />
      </Animated.View>
    </View>
  );
}

function renderMarkdown(
  styles: Record<string, any>,
  bodyFontFamily: string,
  text: unknown,
  tone: 'user' | 'assistant' | 'think',
  streaming: boolean
) {
  return <MarkdownMessage bodyFontFamily={bodyFontFamily} streaming={streaming} styles={styles} text={toText(text)} tone={tone} />;
}

function splitDisplayPath(input: string) {
  const normalized = toText(input).replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 0) return { filename: '', directory: '' };
  const filename = parts[parts.length - 1] || '';
  const directoryParts = parts.slice(0, -1);
  if (directoryParts.length <= 0) return { filename, directory: '' };
  return {
    filename,
    directory: `/${directoryParts.slice(-2).join('/')}/`,
  };
}

function summarizeWriteEvent(event: MobileEventCard) {
  const fileDiff = event?.fileDiff;
  const patchFiles = Array.isArray(event?.patchFiles) ? event.patchFiles : [];
  if (fileDiff) {
    return {
      file: fileDiff.file || '',
      additions: Number(fileDiff.additions || 0),
      deletions: Number(fileDiff.deletions || 0),
    };
  }
  if (patchFiles.length === 1) {
    const file = patchFiles[0];
    return {
      file: file.relativePath || file.filePath || '',
      additions: Number(file.additions || 0),
      deletions: Number(file.deletions || 0),
    };
  }
  if (patchFiles.length > 1) {
    return {
      file: `${patchFiles.length} 个文件`,
      additions: patchFiles.reduce((sum: number, file: any) => sum + Number(file.additions || 0), 0),
      deletions: patchFiles.reduce((sum: number, file: any) => sum + Number(file.deletions || 0), 0),
    };
  }
  return null;
}

function writeEventActionLabel(event: MobileEventCard) {
  const title = toText(event.title).toLowerCase();
  if (title === 'write') return '写入';
  return '编辑';
}

function toolLabel(tool: string) {
  const normalized = toText(tool).toLowerCase();
  if (normalized === 'read') return '读取';
  if (normalized === 'grep' || normalized === 'glob' || normalized === 'search') return '搜索';
  if (normalized === 'list') return '列出';
  if (normalized === 'write') return '写入';
  if (normalized === 'edit') return '编辑';
  if (normalized === 'apply_patch' || normalized === 'patch') return 'Patch';
  if (normalized === 'bash') return 'bash';
  return normalized || '工具';
}

function Chevron(props: { expanded: boolean; styles: Record<string, any> }) {
  return (
    <View style={[props.styles.disclosureChevron, props.expanded && props.styles.disclosureChevronExpanded]}>
      <View style={props.styles.disclosureChevronLineLeft} />
      <View style={props.styles.disclosureChevronLineRight} />
    </View>
  );
}

function ToolActivityRow(props: {
  styles: Record<string, any>;
  tool: string;
  detail: string;
  status: string;
  subtle?: boolean;
}) {
  const { detail, styles, subtle = false, tool } = props;
  return (
    <View style={[styles.contextToolRow, subtle && styles.contextToolRowSubtle]}>
      <Text style={styles.contextToolTitle}>{toolLabel(tool)}</Text>
      <Text numberOfLines={subtle ? 1 : 2} style={styles.contextToolDetail}>
        {detail}
      </Text>
    </View>
  );
}

function EventDiffBlock(props: {
  styles: Record<string, any>;
  path: string;
  additions: number;
  deletions: number;
  patch?: string;
  before?: string;
  after?: string;
  showHeader?: boolean;
}) {
  const { additions, deletions, patch, path, styles, before, after, showHeader = true } = props;
  const rows = useMemo(
    () => buildMobileDiffRows({ path, patch, before, after }),
    [after, before, patch, path]
  );
  return (
    <View style={styles.eventDiffBlock}>
      {showHeader ? (
        <View style={styles.eventDiffHead}>
          <Text numberOfLines={1} style={styles.eventDiffPath}>{path}</Text>
          <Text style={styles.writeEventAdd}>{`+${additions}`}</Text>
          <Text style={styles.writeEventDel}>{`-${deletions}`}</Text>
        </View>
      ) : null}
      {rows.length > 0 ? (
        <View style={styles.eventDiffCodeWindow}>
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator style={styles.eventDiffCodeWrap}>
            <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
              <View style={styles.eventDiffCodeCanvas}>
                {rows.map((row) => (
                  <View
                    key={row.id}
                    style={[
                      styles.eventDiffRow,
                      row.kind === 'hunk'
                        ? styles.eventDiffRowHunk
                        : row.kind === 'add'
                          ? styles.eventDiffRowAdd
                          : row.kind === 'delete'
                            ? styles.eventDiffRowDelete
                            : row.kind === 'note'
                              ? styles.eventDiffRowNote
                              : styles.eventDiffRowContext
                    ]}
                  >
                    <Text style={[styles.eventDiffLineNumber, row.leftNumber == null && styles.eventDiffLineNumberMuted]}>
                      {row.leftNumber == null ? ' ' : row.leftNumber}
                    </Text>
                    <Text style={[styles.eventDiffLineNumber, row.rightNumber == null && styles.eventDiffLineNumberMuted]}>
                      {row.rightNumber == null ? ' ' : row.rightNumber}
                    </Text>
                    <Text style={styles.eventDiffMarker}>{row.marker}</Text>
                    <Text selectable style={styles.eventDiffCodeText}>{row.text}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function ExploringStatusPill(props: {
  styles: Record<string, any>;
  status: {
    title: string;
    summary: string;
    detail?: string;
  };
  currentActions?: Array<{ tool: string; detail: string; status: string }>;
  completedActions?: Array<{ tool: string; detail: string; status: string }>;
  onToggleExpand?: () => void;
  isExpanded?: boolean;
}) {
  const { status, styles, currentActions = [], completedActions = [], onToggleExpand, isExpanded = false } = props;
  const isRunning = status.title === '探索中';
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(isExpanded ? 1 : 0)).current;

  useEffect(() => {
    if (!isRunning) {
      pulseAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 1200,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [isRunning, pulseAnim]);

  useEffect(() => {
    if (isRunning) return;
    Animated.timing(rotateAnim, {
      toValue: isExpanded ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isExpanded, isRunning, rotateAnim]);

  const chevronRotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });

  const allActions = [...currentActions, ...completedActions];

  if (isRunning) {
    const waveOpacity = pulseAnim.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.28, 0.82, 0.28],
    });
    const waveScale = pulseAnim.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.985, 1, 0.985],
    });
    const runningLabel = status.title === '探索中' ? '正在探索' : status.title;

    return (
      <View style={styles.exploringStatusWrap}>
        <Animated.Text
          style={[
            styles.exploringThinkingText,
            {
              opacity: waveOpacity,
              transform: [{ scale: waveScale }],
            },
          ]}
        >
          {runningLabel}
        </Animated.Text>
      </View>
    );
  }

  return (
    <View style={styles.exploringStatusWrap}>
      <Pressable onPress={onToggleExpand} style={styles.exploringStatusCard}>
        <View style={styles.exploringStatusHead}>
          <View style={styles.exploringStatusTitleWrap}>
            <Text style={styles.exploringStatusTitle}>{status.title}</Text>
          </View>
          {allActions.length > 0 ? (
            <Animated.View style={{ transform: [{ rotate: chevronRotate }] }}>
              <Chevron expanded={false} styles={styles} />
            </Animated.View>
          ) : null}
        </View>
        <Text style={styles.exploringStatusText} numberOfLines={1} ellipsizeMode="tail">
          {status.summary}
        </Text>
        {status.detail ? (
          <Text style={styles.exploringStatusMeta} numberOfLines={1} ellipsizeMode="tail">
            {status.detail}
          </Text>
        ) : null}
        {!status.detail && allActions.length > 0 && !isExpanded ? (
          <Text style={styles.exploringStatusMeta} numberOfLines={1} ellipsizeMode="tail">
            {toolLabel(allActions[0]?.tool || '')} · {toText(allActions[0]?.detail || '')}
          </Text>
        ) : null}
      </Pressable>

      {isExpanded && allActions.length > 0 && (
        <View style={styles.exploringStatusListCard}>
          {allActions.map((action, index) => (
            <ToolActivityRow
              key={`${action.tool}-${index}`}
              detail={action.detail}
              status={action.status}
              styles={styles}
              subtle
              tool={action.tool}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function TodoStatusBadge(props: { status: 'pending' | 'in_progress' | 'completed' | 'cancelled'; pulse: boolean; styles: Record<string, any> }) {
  const { pulse, status, styles } = props;
  if (status === 'completed') {
    return (
      <View style={styles.todoStatusCompleted}>
        <Text style={styles.todoStatusCompletedText}>✓</Text>
      </View>
    );
  }
  if (status === 'in_progress') {
    return (
      <View style={styles.todoStatusRunningContainer}>
        <View style={styles.todoStatusRunningPulse1} />
        <View style={styles.todoStatusRunningPulse2} />
        <View style={styles.todoStatusRunningCenter} />
      </View>
    );
  }
  if (status === 'cancelled') return <View style={styles.todoStatusCancelled} />;
  return <View style={pulse ? styles.todoStatusPending : styles.todoStatusPending} />;
}

function ThinkPreviewLines(props: { styles: Record<string, any>; text: string; active: boolean }) {
  const { active, styles } = props;
  const lines = toText(props.text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const visible = lines.length ? lines.slice(-6) : ['正在整理上下文...', '分析可执行步骤...', '准备生成回复...'];
  const hasContent = toText(props.text).trim().length > 0;
  const steps = active ? visible.slice(-3) : visible.slice(-2);
  const [lineIndex, setLineIndex] = useState(Math.max(0, visible.length - 1));
  const lineAnim = useRef(new Animated.Value(1)).current;
  const dotAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setLineIndex(Math.max(0, visible.length - 1));
  }, [props.text, visible.length]);

  useEffect(() => {
    if (!active) {
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
  }, [active, dotAnim]);

  const currentLine = active ? visible[Math.min(lineIndex, visible.length - 1)] || '正在整理思路...' : '已完成思考';
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
          {active || !hasContent ? (
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
                <View style={index === steps.length - 1 && active ? styles.thinkFlowStepDotLive : styles.thinkFlowStepDot} />
                <Text numberOfLines={1} style={styles.thinkFlowStepText}>
                  {step}
                </Text>
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
  styles: Record<string, any>;
}) {
  const items = Array.isArray(props.attachments) ? props.attachments : [];
  if (items.length <= 0) return null;
  return (
    <View style={props.styles.userAttachmentStrip}>
      {items.map((item) => (
        <Pressable key={item.id} onPress={() => props.onOpen(item)} onLongPress={() => props.onCopy(item.uri)} delayLongPress={260}>
          <Image source={{ uri: item.uri }} style={props.styles.userAttachmentImage} resizeMode="cover" />
        </Pressable>
      ))}
    </View>
  );
}

export const MobileTodoCardView = React.memo(function MobileTodoCardView(props: {
  card: MobileTodoCard;
  compact?: boolean;
  collapsed?: boolean;
  pulse: boolean;
  onToggle?: () => void;
  onClose?: () => void;
  styles: Record<string, any>;
}) {
  const { card, compact, collapsed, onClose, onToggle, pulse, styles } = props;
  const meta = todoMeta(card);
  const activeText = toText(meta.active?.content);
  const swipeX = useRef(new Animated.Value(0)).current;
  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => !!onClose && gesture.dx > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.1,
        onMoveShouldSetPanResponderCapture: (_, gesture) => !!onClose && gesture.dx > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.1,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, gesture) => {
          if (!onClose) return;
          swipeX.setValue(Math.min(96, Math.max(0, gesture.dx)));
        },
        onPanResponderRelease: (_, gesture) => {
          if (!onClose) return;
          if (gesture.dx > 56 || gesture.vx > 0.65) {
            Animated.timing(swipeX, { toValue: 140, duration: 140, useNativeDriver: true }).start(() => onClose());
            return;
          }
          Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, tension: 110, friction: 12 }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, tension: 110, friction: 12 }).start();
        }
      }),
    [onClose, swipeX]
  );

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
            <Pressable hitSlop={10} style={styles.todoCloseBtn} onPress={onClose}>
              <Text style={styles.todoCloseText}>×</Text>
            </Pressable>
          ) : null}
          {onToggle ? (
            <Pressable hitSlop={8} style={styles.todoToggleBtn} onPress={onToggle}>
              <View style={[styles.todoArrow, collapsed && styles.todoArrowUp]} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {!collapsed ? (
        <View style={styles.todoList}>
          {card.items.map((item) => (
            <View key={item.id} style={styles.todoRow}>
              <TodoStatusBadge pulse={pulse} status={item.status} styles={styles} />
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
      <View style={compact ? styles.todoDockCompact : styles.todoDock}>
        {content}
      </View>
    </Animated.View>
  );
  if (!onClose) return dock;
  return (
    <View style={styles.todoSwipeShell}>
      <View style={styles.todoSwipeHint}>
        <Text style={styles.todoSwipeHintText}>右滑关闭</Text>
      </View>
      {dock}
    </View>
  );
});

const QuestionTimelineCard = React.memo(function QuestionTimelineCard(props: {
  question: MobileQuestionCard;
  liveQuestions: MobileQuestionCard[];
  hasLiveQuestion: boolean;
  expanded: boolean;
  activeTab: number;
  styles: Record<string, any>;
  onToggle: (id: string) => void;
  onChangeTab: (questionId: string, tabIndex: number) => void;
}) {
  const {
    activeTab,
    expanded,
    hasLiveQuestion,
    liveQuestions,
    onChangeTab,
    onToggle,
    question,
    styles
  } = props;
  if (toText(question.status).toLowerCase() === 'running') return null;

  const questions = Array.isArray(question.questions) ? question.questions : [];
  let liveRequest =
    liveQuestions.find((req) => {
      const reqTool: { messageID?: string; callID?: string } = req.tool || {};
      const itemTool: { messageID?: string; callID?: string } = question.tool || {};
      if (reqTool.callID && itemTool.callID && reqTool.callID === itemTool.callID) return true;
      if (reqTool.messageID && itemTool.messageID && reqTool.messageID === itemTool.messageID) return true;
      return false;
    }) || null;
  const hasLiveDockRequest = !!liveRequest;
  if (!liveRequest && question.status === 'running' && question.tool?.callID) {
    liveRequest = {
      id: question.tool.callID,
      title: '',
      status: 'running',
      questions: question.questions,
      interactive: true,
      tool: {
        messageID: question.tool.messageID || '',
        callID: question.tool.callID
      }
    };
  }
  const canReply = !!liveRequest;
  if (hasLiveDockRequest || hasLiveQuestion) return null;

  const firstQuestion = questions[0];
  const questionSummary = toText(firstQuestion?.question || firstQuestion?.header || '查看问题详情');
  const currentTab = questions.length > 1 ? activeTab : 0;
  const currentQuestion = questions[currentTab];
  const optionCount = questions.reduce(
    (sum, row) => sum + (Array.isArray(row.options) ? row.options.length : 0) + (row.custom !== false ? 1 : 0),
    0
  );
  const status = toText(question.status).toLowerCase();
  const statusLabel = status === 'completed' ? '已提交' : status === 'error' ? '已忽略' : '已过期';

  return (
    <View style={styles.questionTimelineWrap}>
      <View style={styles.questionTimelineCard}>
        <Pressable
          style={styles.questionTimelineHead}
          onPress={() => {
            if (canReply) return;
            onToggle(question.id);
          }}
        >
          <View style={styles.questionTimelineTitleWrap}>
            <Text style={styles.questionTimelineTitle}>{toText(question.title || '问题')}</Text>
            <Text numberOfLines={1} style={styles.questionTimelineSummary}>
              {questionSummary}
            </Text>
          </View>
          <View style={styles.questionTimelineHeadRight}>
            <Text style={styles.questionTimelineBadge}>{statusLabel}</Text>
            {!canReply ? <Text style={styles.questionTimelineToggle}>{expanded ? '▲' : '▼'}</Text> : null}
          </View>
        </Pressable>
        {canReply ? (
          <View style={styles.questionTimelineBody}>
            <Text style={styles.questionTimelineHint}>请从底部弹窗回答此问题</Text>
          </View>
        ) : expanded ? (
          <View style={styles.questionTimelineBody}>
            {questions.length > 1 ? (
              <View style={styles.questionTimelineTabs}>
                {questions.map((_, idx) => (
                  <Pressable
                    key={`${question.id}:tab:${idx}`}
                    style={[
                      styles.questionTimelineTab,
                      idx === activeTab && styles.questionTimelineTabActive
                    ]}
                    onPress={() => onChangeTab(question.id, idx)}
                  >
                    <Text
                      style={[
                        styles.questionTimelineTabText,
                        idx === activeTab && styles.questionTimelineTabTextActive
                      ]}
                    >
                      {idx + 1}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {currentQuestion ? (
              <View key={`${question.id}:${currentTab}`} style={styles.questionTimelineBlock}>
                {toText(currentQuestion.header) ? <Text style={styles.questionTimelineHeader}>{toText(currentQuestion.header)}</Text> : null}
                <Text style={styles.questionTimelineText}>{toText(currentQuestion.question || '请选择一个答案')}</Text>
                <Text style={styles.questionTimelineHint}>{currentQuestion.multiple ? '多选' : '单选'} · 已过期</Text>
                {(Array.isArray(currentQuestion.options) ? currentQuestion.options : []).map((opt, optIndex) => (
                  <View key={`${question.id}:${currentTab}:${optIndex}`} style={styles.questionTimelineOption}>
                    <View style={currentQuestion.multiple ? styles.questionTimelineCheckbox : styles.questionTimelineRadio} />
                    <View style={styles.questionTimelineOptionBody}>
                      <Text style={styles.questionTimelineOptionLabel}>{toText(opt.label)}</Text>
                      {toText(opt.description) ? <Text style={styles.questionTimelineOptionDesc}>{toText(opt.description)}</Text> : null}
                    </View>
                  </View>
                ))}
                {currentQuestion.custom !== false ? (
                  <View style={styles.questionTimelineOption}>
                    <View style={currentQuestion.multiple ? styles.questionTimelineCheckbox : styles.questionTimelineRadio} />
                    <View style={styles.questionTimelineOptionBody}>
                      <Text style={styles.questionTimelineOptionLabel}>输入自己的答案</Text>
                      <Text style={styles.questionTimelineOptionDesc}>输入你的答案...</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}
            <Text style={styles.questionTimelineDisabled}>
              {questions.length} 个问题 · {optionCount} 个选项 · 仅查看
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

export const MobileTurnCell = React.memo(
  function MobileTurnCell(props: {
    bodyFontFamily: string;
    styles: Record<string, any>;
    turn: MobileRenderedTurn;
    streaming: boolean;
    isLastTurn: boolean;
    thinkingPulse: boolean;
    hasLiveQuestion: boolean;
    liveQuestions: MobileQuestionCard[];
    interaction: TurnCellInteractionState;
    exploringStatus?: {
      title: string;
      summary: string;
      detail?: string;
    };
    exploringActions?: {
      current: Array<{ tool: string; detail: string; status: string }>;
      completed: Array<{ tool: string; detail: string; status: string }>;
    };
    onQuestionReply: (requestId: string, answers: string[][]) => void;
    onCopyMessage: (text: string) => void;
    onOpenImage: (item: { id: string; uri: string; filename?: string }) => void;
    onCopyImage: (uri: string) => void;
    onToggleTimelineQuestion: (id: string) => void;
    onToggleThinkCard: (id: string) => void;
    onChangeTimelineTab: (questionId: string, tabIndex: number) => void;
    onBeforeLocalLayoutChange: () => void;
    onMeasuredHeight: (id: string, height: number) => void;
  }) {
    const {
      bodyFontFamily,
      exploringStatus,
      exploringActions,
      hasLiveQuestion,
      interaction,
      isLastTurn,
      liveQuestions,
      onChangeTimelineTab,
      onCopyImage,
      onCopyMessage,
      onBeforeLocalLayoutChange,
      onMeasuredHeight,
      onOpenImage,
      onQuestionReply,
      onToggleThinkCard,
      onToggleTimelineQuestion,
      streaming,
      styles,
      thinkingPulse,
      turn
    } = props;
    const [isExploringExpanded, setIsExploringExpanded] = useState(false);
    const [expandedContextIds, setExpandedContextIds] = useState<Record<string, boolean>>({});
    const [expandedEventIds, setExpandedEventIds] = useState<Record<string, boolean>>({});
    const measuredHeightRef = useRef(0);
    const toggleLocalExpansion = useCallback((apply: () => void) => {
      onBeforeLocalLayoutChange();
      apply();
    }, [onBeforeLocalLayoutChange]);

    return (
      <View
        style={styles.turnWrap}
        onLayout={(evt) => {
          const h = Math.ceil(Number(evt.nativeEvent.layout?.height || 0));
          if (h <= 0) return;
          if (Math.abs(measuredHeightRef.current - h) <= 1) return;
          measuredHeightRef.current = h;
          onMeasuredHeight(turn.id, h);
        }}
      >
        {turn.userMessage ? (
          <View style={styles.bubbleUserWrap}>
            <Pressable style={styles.bubbleUser} onLongPress={() => onCopyMessage(toText(turn.userMessage?.text))} delayLongPress={280}>
              <UserAttachmentStrip attachments={turn.userMessage.attachments} onOpen={onOpenImage} onCopy={onCopyImage} styles={styles} />
              {toText(turn.userMessage.text).trim() ? <Text style={styles.bubbleUserText}>{toText(turn.userMessage.text || '...')}</Text> : null}
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
                  <View style={styles.bubbleContent}>{renderMarkdown(styles, bodyFontFamily, toText(m.text || '...'), 'assistant', streaming && isLastTurn)}</View>
                </Pressable>
              </View>
            );
          }
          if (item.kind === 'context') {
            const tools = Array.isArray(item.context.tools) ? item.context.tools : [];
            const expanded = !!expandedContextIds[item.context.id];
            return (
              <View key={item.context.id} style={styles.contextWrap}>
                <View style={styles.contextCard}>
                  <Pressable
                    style={styles.contextPressable}
                    onPress={() => toggleLocalExpansion(() => setExpandedContextIds((prev) => ({ ...prev, [item.context.id]: !prev[item.context.id] })))}
                  >
                    <View style={styles.contextHeadRow}>
                      <View style={styles.contextHeadMain}>
                        <View style={styles.contextInlineSummaryRow}>
                          <Text style={styles.contextInlineTitle}>{toText(item.context.title || '已探索')}</Text>
                          <Text style={styles.contextSummary}>{toText(item.context.summary || '已收集上下文')}</Text>
                          {tools.length > 0 ? <Chevron expanded={expanded} styles={styles} /> : null}
                        </View>
                        {toText(item.context.detail) ? (
                          <Text numberOfLines={1} style={styles.contextDetail}>
                            {toText(item.context.detail)}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                  {expanded && tools.length > 0 ? (
                    <View style={styles.contextTools}>
                      {tools.map((tool) => (
                        <ToolActivityRow
                          key={tool.id}
                          detail={toText(tool.detail || tool.meta || tool.mode || tool.status || '执行完成')}
                          status={toText(tool.status)}
                          styles={styles}
                          tool={toText(tool.title || 'tool')}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>
            );
          }
          if (item.kind === 'event') {
            const status = toText(item.event.status).toLowerCase();
            const isRunning = status === 'running' || status === 'pending';
            const title = toText(item.event.title || 'Event');
            const mode = toText(item.event.mode);
            const eventDetail = toText(item.event.detail);
            const detail = toText(item.event.detail || item.event.mode || item.event.status || '工具执行完成');
            const isWriteEvent = mode === '写入' || mode.toLowerCase() === 'write' || title === 'apply_patch';
            const isShellEvent = title.toLowerCase() === 'bash' || mode.toLowerCase() === 'bash' || mode === '命令';
            const isExpanded = !!expandedEventIds[item.event.id];
            const eventMeta = toText(item.event.meta);
            const eventOutput = toText(item.event.output);
            const eventFileDiff = item.event.fileDiff;
            const eventPatchFiles = Array.isArray(item.event.patchFiles) ? item.event.patchFiles : [];
            const eventExpandable = isShellEvent || isWriteEvent || !!eventOutput || detail.length > 56 || eventMeta.length > 0 || !!eventFileDiff || eventPatchFiles.length > 0;
            
            const cardStyle = isWriteEvent 
              ? styles.writeEventCard 
              : isShellEvent 
                ? [styles.eventCard, styles.bashEventCard] 
                : styles.eventCard;
            
            const dotStyle = isWriteEvent
              ? (isRunning ? styles.writeEventDotRun : styles.writeEventDot)
              : isShellEvent
                ? (isRunning ? styles.bashEventDotRun : styles.bashEventDot)
                : (isRunning ? styles.eventDotRun : styles.eventDot);
            
            const titleStyle = isWriteEvent
              ? styles.writeEventTitle
              : [styles.eventTitle, isShellEvent && styles.bashEventTitle];
            
            const detailStyle = isWriteEvent
              ? styles.writeEventDetail
              : [styles.eventDetail, isShellEvent && styles.bashEventDetail];
            
            const outputStyle = isWriteEvent
              ? styles.writeEventOutput
              : [styles.eventOutput, isShellEvent && styles.bashEventOutput];
            
            if (isWriteEvent) {
              const writeTitle = writeEventActionLabel(item.event);
              const writeSummary = summarizeWriteEvent(item.event);
              const pathText = writeSummary?.file || eventMeta || eventDetail;
              const pathParts = splitDisplayPath(pathText);
              const hasStructuredDiff = !!eventFileDiff || eventPatchFiles.length > 0;
              const writeMeta = !hasStructuredDiff && eventMeta && eventMeta !== pathText ? eventMeta : '';
              const writeDetail = !hasStructuredDiff && !writeSummary && eventDetail && eventDetail !== pathText ? eventDetail : '';
              
              return (
                <View key={item.event.id} style={styles.eventWrap}>
                  <Pressable
                    disabled={!eventExpandable}
                    onPress={() => toggleLocalExpansion(() => setExpandedEventIds((prev) => ({ ...prev, [item.event.id]: !prev[item.event.id] })))}
                    style={cardStyle}
                  >
                    <View style={styles.writeEventHead}>
                      <View style={styles.writeEventHeadMain}>
                        <Text style={titleStyle}>{writeTitle}</Text>
                        {pathParts.filename ? (
                          <Text numberOfLines={1} style={styles.writeEventFile}>
                            {pathParts.filename}
                          </Text>
                        ) : null}
                        {pathParts.directory ? (
                          <Text ellipsizeMode="head" numberOfLines={1} style={styles.writeEventDirectory}>
                            {pathParts.directory}
                          </Text>
                        ) : null}
                      </View>
                      {writeSummary ? <Text style={styles.writeEventAdd}>{`+${writeSummary.additions}`}</Text> : null}
                      {writeSummary ? <Text style={styles.writeEventDel}>{`-${writeSummary.deletions}`}</Text> : null}
                    </View>
                    {!writeSummary && eventDetail ? (
                      <Text numberOfLines={isExpanded ? 0 : 1} style={detailStyle}>
                        {eventDetail}
                      </Text>
                    ) : null}
                    {isExpanded && writeMeta ? <Text style={styles.eventMeta}>{writeMeta}</Text> : null}
                    {isExpanded && writeDetail ? <Text style={detailStyle}>{writeDetail}</Text> : null}
                    {isExpanded && eventFileDiff ? (
                      <EventDiffBlock
                        additions={eventFileDiff.additions}
                        deletions={eventFileDiff.deletions}
                        before={eventFileDiff.before}
                        after={eventFileDiff.after}
                        patch={eventFileDiff.patch}
                        path={eventFileDiff.file}
                        showHeader={false}
                        styles={styles}
                      />
                    ) : null}
                    {isExpanded && !eventFileDiff && eventPatchFiles.length > 0 ? (
                      <View style={styles.eventDiffList}>
                        {eventPatchFiles.map((file) => (
                          <EventDiffBlock
                            key={`${item.event.id}:${file.relativePath}`}
                            additions={file.additions}
                            deletions={file.deletions}
                            patch={file.patch}
                            path={file.relativePath}
                            showHeader={eventPatchFiles.length > 1}
                            styles={styles}
                          />
                        ))}
                      </View>
                    ) : null}
                    {eventOutput ? (
                      <Text numberOfLines={isExpanded ? 0 : 3} style={outputStyle}>
                        {eventOutput}
                      </Text>
                    ) : null}
                  </Pressable>
                </View>
              );
            }
            
            return (
              <View key={item.event.id} style={styles.eventWrap}>
                <Pressable
                  disabled={!eventExpandable}
                  onPress={() => toggleLocalExpansion(() => setExpandedEventIds((prev) => ({ ...prev, [item.event.id]: !prev[item.event.id] })))}
                  style={cardStyle}
                >
                  <View style={styles.eventHead}>
                    {isShellEvent ? <View style={dotStyle} /> : null}
                    <Text style={titleStyle}>{toolLabel(title)}</Text>
                    {!isShellEvent && mode ? <Text style={styles.eventMode}>{mode}</Text> : null}
                  </View>
                  <Text numberOfLines={isExpanded ? 0 : 2} style={detailStyle}>{detail}</Text>
                  {isExpanded && eventMeta ? <Text style={styles.eventMeta}>{eventMeta}</Text> : null}
                  {eventOutput ? <Text numberOfLines={isExpanded ? 0 : 3} style={outputStyle}>{eventOutput}</Text> : null}
                </Pressable>
              </View>
            );
          }
          if (item.kind === 'question') {
            return (
              <QuestionTimelineCard
                key={item.question.id}
                activeTab={interaction.timelineQuestionTabs[item.question.id] || 0}
                expanded={!!interaction.expandedTimelineQuestionIds[item.question.id]}
                hasLiveQuestion={hasLiveQuestion}
                liveQuestions={liveQuestions}
                onChangeTab={onChangeTimelineTab}
                onToggle={onToggleTimelineQuestion}
                question={item.question}
                styles={styles}
              />
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
                  <View style={styles.bubbleContent}>{renderMarkdown(styles, bodyFontFamily, toText(item.error.text || 'Unknown error'), 'assistant', false)}</View>
                </View>
              </View>
            );
          }
          if (item.kind === 'todo') {
            return (
              <View key={item.todo.id} style={styles.todoInlineWrap}>
                <MobileTodoCardView
                  card={item.todo}
                  pulse={streaming && isLastTurn && !item.todo.finished}
                  styles={styles}
                />
              </View>
            );
          }
          if (item.kind === 'think') {
            const card = item.card;
            if (!card) return null;
            const isThinkExpanded = !!interaction.expandedThinkIds[card.id];
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
                      <View style={styles.bubbleContent}>{renderMarkdown(styles, bodyFontFamily, contentText, 'think', streaming && isLastTurn && !card.finished)}</View>
                    </>
                  ) : (
                    <ThinkPreviewLines active={streaming && isLastTurn && !card.finished} styles={styles} text={contentText} />
                  )}
                </Pressable>
              </View>
            );
          }
          return null;
        })}
        {/* 探索中状态 - 只在最后一个 turn 且正在流式输出时显示 */}
        {isLastTurn && exploringStatus ? (
          <ExploringStatusPill
            styles={styles}
            status={exploringStatus}
            currentActions={exploringActions?.current || []}
            completedActions={exploringActions?.completed || []}
            isExpanded={isExploringExpanded}
            onToggleExpand={() => toggleLocalExpansion(() => setIsExploringExpanded(v => !v))}
          />
        ) : null}
      </View>
    );
  },
  (prev, next) =>
    prev.turn.id === next.turn.id &&
    prev.turn.signature === next.turn.signature &&
    prev.streaming === next.streaming &&
    prev.isLastTurn === next.isLastTurn &&
    prev.interaction.interactionSignature === next.interaction.interactionSignature &&
    prev.thinkingPulse === next.thinkingPulse &&
    prev.hasLiveQuestion === next.hasLiveQuestion &&
    prev.liveQuestions === next.liveQuestions &&
    prev.exploringStatus === next.exploringStatus &&
    prev.exploringActions === next.exploringActions &&
    prev.onCopyMessage === next.onCopyMessage &&
    prev.onToggleTimelineQuestion === next.onToggleTimelineQuestion &&
    prev.onToggleThinkCard === next.onToggleThinkCard &&
    prev.onChangeTimelineTab === next.onChangeTimelineTab &&
    prev.onBeforeLocalLayoutChange === next.onBeforeLocalLayoutChange &&
    prev.onMeasuredHeight === next.onMeasuredHeight
);
