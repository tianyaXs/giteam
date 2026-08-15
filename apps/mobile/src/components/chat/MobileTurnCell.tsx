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
import Reanimated, {
  Easing as ReEasing,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import type { TurnCellInteractionState } from '../../features/chat/useInteractiveTurnCells';
import { useMobileTheme } from '../../features/theme/ThemeProvider';
import { toText } from '../../lib/text';
import type { MobileEventCard, MobileQuestionCard, MobileRenderedTurn, MobileTodoCard, MobileToolBatchCard } from '../../types';
import { MobileMarkedMarkdown } from './MobileMarkedMarkdown';
import { buildMobileDiffRows } from './mobileDiff';
import { AnimatedCollapsibleContent } from '../AccordionBody';

/** 已播过入场的气泡，避免列表回收重复播放 */
const enteredBubbleKeys = new Set<string>();
const ENTER_FRESH_MS = 6000;

/** 聊天时间线展开：与 Moirai AnimatedCollapsibleContent 同款 reveal。 */
function TimelineExpand(props: { open: boolean; children: React.ReactNode }) {
  return (
    <AnimatedCollapsibleContent open={props.open} mode="slide" durationMs={240}>
      {props.children}
    </AnimatedCollapsibleContent>
  );
}

function takeBubbleEnter(key: string, createdAt: number): boolean {
  const id = toText(key).trim();
  if (!id) return false;
  if (enteredBubbleKeys.has(id)) return false;
  const age = Date.now() - (Number(createdAt) || 0);
  if (age > ENTER_FRESH_MS) {
    enteredBubbleKeys.add(id);
    return false;
  }
  enteredBubbleKeys.add(id);
  if (enteredBubbleKeys.size > 400) {
    const drop = enteredBubbleKeys.size - 280;
    let i = 0;
    for (const k of enteredBubbleKeys) {
      enteredBubbleKeys.delete(k);
      i += 1;
      if (i >= drop) break;
    }
  }
  return true;
}

/**
 * 自下短距上移 + 淡入。
 * 不用 layout `entering`：列表里常会先画出终态再播。
 * playKey 只用 message id（勿拼 turn.id）：乐观消息落库后 turn.id 会变，否则会重播入场抖一下。
 */
function BubbleEnter(props: {
  playKey: string;
  createdAt: number;
  variant: 'user' | 'assistant';
  children: React.ReactNode;
}) {
  const { playKey, createdAt, variant, children } = props;
  const decisionRef = useRef<{ key: string; play: boolean } | null>(null);
  if (!decisionRef.current || decisionRef.current.key !== playKey) {
    decisionRef.current = { key: playKey, play: takeBubbleEnter(playKey, createdAt) };
  }
  const shouldPlay = decisionRef.current.play;
  const distance = variant === 'user' ? 14 : 12;
  const duration = variant === 'user' ? 240 : 280;
  const progress = useSharedValue(shouldPlay ? 0 : 1);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!shouldPlay || startedRef.current) return;
    startedRef.current = true;
    progress.value = withTiming(1, {
      duration,
      easing: ReEasing.out(ReEasing.cubic)
    });
  }, [duration, progress, shouldPlay]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * distance }]
  }));

  // 静态 opacity 兜住首帧；之后以 animated style 为准（数组后项覆盖）
  return (
    <Reanimated.View style={[{ opacity: shouldPlay ? 0 : 1 }, style]}>
      {children}
    </Reanimated.View>
  );
}

function normalizeMarkdownForMobile(input: string) {
  const trimmed = toText(input);
  return trimmed.replace(/^[ \t]{2,}(?=(?:\*\*|#{1,6}\s|[-*+]\s|\d+\.\s|>\s))/gm, '');
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

function InstantExpand(props: { open: boolean; children: React.ReactNode; style?: any }) {
  // 兼容旧调用：统一走 slide 模式（有滑动，无高度补间）。
  return (
    <TimelineExpand open={props.open}>
      {props.style ? <View style={props.style}>{props.children}</View> : props.children}
    </TimelineExpand>
  );
}

const MarkdownMessage = React.memo(function MarkdownMessage(props: {
  bodyFontFamily: string;
  styles: Record<string, any>;
  text: string;
  tone: 'user' | 'assistant' | 'think';
  streaming: boolean;
}) {
  const { bodyFontFamily, streaming, styles, text, tone } = props;
  const { colors } = useMobileTheme();
  const src = normalizeMarkdownForMobile(text);
  const flowAnim = useRef(new Animated.Value(streaming ? 0 : 1)).current;
  const isUser = tone === 'user';
  const isThink = tone === 'think';
  const textColor = isUser ? colors.primaryText : isThink ? colors.muted : colors.text;
  const mutedColor = isUser ? `${colors.primaryText}B3` : colors.muted;
  const headingColor = isUser ? colors.primaryText : colors.text;
  const codeBg = isUser ? `${colors.primaryText}2E` : colors.sidebar;
  const inlineCodeColor = isUser ? colors.primaryText : isThink ? colors.muted : colors.primary;
  const codeColor = isUser ? colors.primaryText : colors.primary;
  const monoFamily = Platform.OS === 'android' ? 'monospace' : 'Menlo';
  const markdownStyles = useMemo<Record<string, any>>(
    () => ({
      body: {
        color: textColor,
        fontSize: isThink ? 14 : 15,
        lineHeight: isThink ? 21 : 23,
        fontFamily: bodyFontFamily
      },
      paragraph: { marginTop: 0, marginBottom: isThink ? 8 : 10 },
      strong: { color: headingColor, fontWeight: '700', fontFamily: bodyFontFamily },
      em: { color: mutedColor, fontStyle: 'italic', fontFamily: bodyFontFamily },
      s: { textDecorationLine: 'line-through' },
      link: {
        color: isUser ? colors.primaryText : colors.primary,
        textDecorationLine: 'underline',
        fontFamily: bodyFontFamily
      },
      heading1: { color: headingColor, fontSize: 24, lineHeight: 30, fontWeight: '700', marginTop: 14, marginBottom: 8, fontFamily: bodyFontFamily },
      heading2: { color: headingColor, fontSize: 20, lineHeight: 26, fontWeight: '700', marginTop: 12, marginBottom: 7, fontFamily: bodyFontFamily },
      heading3: { color: headingColor, fontSize: 17, lineHeight: 23, fontWeight: '700', marginTop: 10, marginBottom: 6, fontFamily: bodyFontFamily },
      heading4: { color: headingColor, fontSize: 16, lineHeight: 22, fontWeight: '700', marginTop: 8, marginBottom: 5, fontFamily: bodyFontFamily },
      heading5: { color: mutedColor, fontSize: 15, lineHeight: 21, fontWeight: '700', marginTop: 8, marginBottom: 4, fontFamily: bodyFontFamily },
      heading6: { color: mutedColor, fontSize: 14, lineHeight: 20, fontWeight: '700', marginTop: 8, marginBottom: 4, fontFamily: bodyFontFamily },
      bullet_list: { marginTop: 2, marginBottom: isThink ? 8 : 10 },
      ordered_list: { marginTop: 2, marginBottom: isThink ? 8 : 10 },
      list_item: { marginTop: 2, marginBottom: 2 },
      bullet_list_icon: { color: colors.primary, fontSize: isThink ? 14 : 15, lineHeight: isThink ? 21 : 23 },
      ordered_list_icon: { color: colors.primary, fontSize: isThink ? 14 : 15, lineHeight: isThink ? 21 : 23, fontFamily: bodyFontFamily },
      code_inline: {
        color: inlineCodeColor,
        backgroundColor: codeBg,
        borderRadius: 4,
        fontSize: 12.5,
        fontFamily: monoFamily,
        paddingHorizontal: 4
      },
      code_block: {
        color: codeColor,
        backgroundColor: codeBg,
        borderRadius: 10,
        padding: 12,
        marginTop: 2,
        marginBottom: 10,
        fontSize: 12.5,
        lineHeight: 19,
        fontFamily: monoFamily
      },
      fence: {
        color: codeColor,
        backgroundColor: codeBg,
        borderRadius: 10,
        padding: 12,
        marginTop: 2,
        marginBottom: 10,
        fontSize: 12.5,
        lineHeight: 19,
        fontFamily: monoFamily,
        borderWidth: 0
      },
      blockquote: {
        backgroundColor: isUser ? `${colors.primaryText}1F` : colors.card,
        borderLeftWidth: 3,
        borderLeftColor: isUser ? colors.primaryText : colors.primary,
        paddingHorizontal: 12,
        paddingVertical: 2,
        marginTop: 4,
        marginBottom: 10,
        borderRadius: 4
      },
      hr: { backgroundColor: colors.border, height: 1, marginTop: 10, marginBottom: 10 },
      table: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginTop: 4, marginBottom: 10 },
      thead: { backgroundColor: isUser ? `${colors.primaryText}1A` : colors.card },
      th: { color: headingColor, fontWeight: '700', padding: 7, borderColor: colors.border },
      td: { color: textColor, padding: 7, borderColor: colors.border },
      tr: { borderBottomWidth: 1, borderColor: colors.border },
      image: { borderRadius: 10, marginTop: 4, marginBottom: 8 }
    }),
    [bodyFontFamily, codeBg, codeColor, colors, headingColor, inlineCodeColor, isThink, isUser, monoFamily, mutedColor, textColor]
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
    <View style={styles.markdownBlock} collapsable={false}>
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
}, (prev, next) =>
  prev.text === next.text &&
  prev.streaming === next.streaming &&
  prev.tone === next.tone &&
  prev.bodyFontFamily === next.bodyFontFamily &&
  prev.styles === next.styles
);

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
  const parts = normalized.split(/[\\/]/).filter(Boolean);
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
  if (normalized === 'grep' || normalized === 'glob' || normalized === 'search' || normalized === 'find') return '搜索';
  if (normalized === 'list' || normalized === 'ls') return '列出';
  if (normalized === 'write') return '写入';
  if (normalized === 'edit') return '编辑';
  if (normalized === 'apply_patch' || normalized === 'patch') return 'Patch';
  if (normalized === 'bash') return 'bash';
  return normalized || '工具';
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

      {allActions.length > 0 ? (
        <InstantExpand open={isExpanded}>
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
        </InstantExpand>
      ) : null}
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

function ThinkActivityRow(props: {
  styles: Record<string, any>;
  text: string;
  active: boolean;
  mutedColor: string;
  labelColor: string;
}) {
  const { active, styles, mutedColor, labelColor } = props;
  const content = toText(props.text).trim();
  // 与桌面 ReasoningGroup / 移动端 toolBatch 一致：标签旁始终保留末行预览，展开不拆掉表头避免抖高。
  const preview =
    content
      .split(/\r?\n+/)
      .map((line) => line.replace(/^[-*•\d.\s]+/, '').trim())
      .filter(Boolean)
      .slice(-1)[0] || (content ? '整理推理摘要' : '');
  const label = active ? '思考中' : '已思考';

  return (
    <View style={styles.activityPressable}>
      <Text
        style={[
          styles.activityLabel,
          { color: labelColor },
          active ? styles.activityLabelActive : null
        ]}
      >
        {label}
      </Text>
      {preview ? (
        <Text numberOfLines={1} style={[styles.activityPreview, { color: mutedColor }]}>
          {preview}
        </Text>
      ) : null}
    </View>
  );
}

function ErrorActivityRow(props: {
  styles: Record<string, any>;
  title: string;
  preview: string;
  expanded: boolean;
  labelColor: string;
  mutedColor: string;
  expandable: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const {
    children,
    expandable,
    expanded,
    labelColor,
    mutedColor,
    onToggle,
    preview,
    styles,
    title
  } = props;
  // 表头始终保留预览行（对齐「已运行 N 条」），避免展开瞬间改表头高度造成列表抖。
  const header = (
    <View style={styles.activityPressable}>
      <Text style={[styles.activityLabel, { color: labelColor }]}>{title}</Text>
      {preview ? (
        <Text numberOfLines={1} style={[styles.activityPreview, { color: mutedColor }]}>
          {preview}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.errorWrap} accessibilityRole="alert" accessibilityLabel={`${title}${preview ? `: ${preview}` : ''}`}>
      {expandable ? (
        <Pressable onPress={onToggle}>{header}</Pressable>
      ) : (
        header
      )}
      {/*
        slide 模式：布局瞬时占高 + 下滑淡入，避免高度手风琴多帧破坏同回合 Markdown。
      */}
      {expandable ? (
        <TimelineExpand open={expanded}>
          <View style={styles.errorExpandBody}>{children}</View>
        </TimelineExpand>
      ) : null}
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
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={props.styles.userAttachmentScroller}
      contentContainerStyle={props.styles.userAttachmentStrip}
      keyboardShouldPersistTaps="handled"
    >
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => props.onOpen(item)}
          onLongPress={() => props.onCopy(item.uri)}
          delayLongPress={260}
          style={props.styles.userAttachmentThumbWrap}
        >
          <Image source={{ uri: item.uri }} style={props.styles.userAttachmentImage} resizeMode="cover" />
        </Pressable>
      ))}
    </ScrollView>
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

function EventCardView(props: {
  styles: Record<string, any>;
  event: MobileEventCard;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { event, expanded, onToggle, styles } = props;
  const status = toText(event.status).toLowerCase();
  const isRunning = status === 'running' || status === 'pending';
  const title = toText(event.title || 'Event');
  const mode = toText(event.mode);
  const eventDetail = toText(event.detail);
  const detail = toText(event.detail || event.mode || event.status || '工具执行完成');
  const isWriteEvent = mode === '写入' || mode.toLowerCase() === 'write' || title === 'apply_patch';
  const isShellEvent = title.toLowerCase() === 'bash' || mode.toLowerCase() === 'bash' || mode === '命令';
  const isTaskEvent = title.toLowerCase() === 'task' || !!toText((event as any).taskSessionId) || !!toText((event as any).taskSubagent);
  const eventMeta = toText(event.meta);
  const eventOutput = toText(event.output);
  const eventFileDiff = event.fileDiff;
  const eventPatchFiles = Array.isArray(event.patchFiles) ? event.patchFiles : [];
  const eventExpandable =
    isShellEvent
    || isWriteEvent
    || isTaskEvent
    || !!eventOutput
    || detail.length > 56
    || eventMeta.length > 0
    || !!eventFileDiff
    || eventPatchFiles.length > 0;

  if (isTaskEvent) {
    const subagent = toText((event as any).taskSubagent) || 'plan';
    const description = toText(event.detail) || toText(event.mode) || '子任务';
    const sessionHint = toText((event as any).taskSessionId);
    return (
      <View style={styles.eventWrap}>
        <Pressable disabled={!eventExpandable} onPress={onToggle} style={styles.eventCard}>
          <View style={styles.eventHead}>
            <Text style={styles.eventTitle}>{`Task · ${subagent}`}</Text>
            <Text style={styles.eventMode}>{isRunning ? '运行中' : status === 'error' ? '失败' : '完成'}</Text>
          </View>
          <Text numberOfLines={2} style={styles.eventDetail}>{description}</Text>
        </Pressable>
        <InstantExpand open={expanded}>
          <View style={styles.eventExpandBody}>
            {sessionHint ? <Text style={styles.eventMeta}>{`session ${sessionHint.slice(0, 12)}…`}</Text> : null}
            {eventOutput ? <Text style={styles.eventOutput}>{eventOutput}</Text> : null}
          </View>
        </InstantExpand>
      </View>
    );
  }

  // bash：不展示 bash/命令 标签，直接用终端块呈现命令与输出
  if (isShellEvent) {
    const command = toText(event.meta) || toText(event.detail);
    const isError = status === 'error' || status === 'failed';
    return (
      <View style={styles.eventWrap}>
        <Pressable disabled={!eventExpandable} onPress={onToggle} style={styles.bashTerminalWrap}>
          <View
            style={[
              styles.bashTerminalCard,
              isError ? styles.bashTerminalCardError : null,
              isRunning ? styles.bashTerminalCardRun : null
            ]}
          >
            {command ? (
              <Text style={styles.bashTerminalCommand} numberOfLines={expanded ? undefined : 3}>
                <Text style={styles.bashTerminalDollar}>{'$ '}</Text>
                {command}
              </Text>
            ) : (
              <Text style={styles.bashTerminalCommand}>{isRunning ? '运行中…' : 'bash'}</Text>
            )}
            {!expanded && eventOutput ? (
              <Text numberOfLines={3} style={[styles.bashTerminalOutput, isError ? styles.bashTerminalOutputError : null]}>
                {eventOutput}
              </Text>
            ) : null}
            <InstantExpand open={expanded && !!eventOutput}>
              <Text style={[styles.bashTerminalOutput, isError ? styles.bashTerminalOutputError : null]}>
                {eventOutput}
              </Text>
            </InstantExpand>
          </View>
        </Pressable>
      </View>
    );
  }

  const cardStyle = isWriteEvent
    ? styles.writeEventCard
    : styles.eventCard;

  const titleStyle = isWriteEvent
    ? styles.writeEventTitle
    : styles.eventTitle;

  const detailStyle = isWriteEvent
    ? styles.writeEventDetail
    : styles.eventDetail;

  const outputStyle = isWriteEvent
    ? styles.writeEventOutput
    : styles.eventOutput;

  if (isWriteEvent) {
    const writeTitle = writeEventActionLabel(event);
    const writeSummary = summarizeWriteEvent(event);
    const pathText = writeSummary?.file || eventMeta || eventDetail;
    const pathParts = splitDisplayPath(pathText);
    const hasStructuredDiff = !!eventFileDiff || eventPatchFiles.length > 0;
    const writeMeta = !hasStructuredDiff && eventMeta && eventMeta !== pathText ? eventMeta : '';
    const writeDetail = !hasStructuredDiff && !writeSummary && eventDetail && eventDetail !== pathText ? eventDetail : '';

    return (
      <View style={styles.eventWrap}>
        <Pressable
          disabled={!eventExpandable}
          onPress={onToggle}
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
            <Text numberOfLines={1} style={detailStyle}>
              {eventDetail}
            </Text>
          ) : null}
          {eventOutput && !expanded ? (
            <Text numberOfLines={3} style={outputStyle}>
              {eventOutput}
            </Text>
          ) : null}
        </Pressable>
        <InstantExpand open={expanded}>
          <View style={styles.eventExpandBody}>
            {writeMeta ? <Text style={styles.eventMeta}>{writeMeta}</Text> : null}
            {writeDetail ? <Text style={detailStyle}>{writeDetail}</Text> : null}
            {eventFileDiff ? (
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
            {!eventFileDiff && eventPatchFiles.length > 0 ? (
              <View style={styles.eventDiffList}>
                {eventPatchFiles.map((file) => (
                  <EventDiffBlock
                    key={`${event.id}:${file.relativePath}`}
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
            {eventOutput ? <Text style={outputStyle}>{eventOutput}</Text> : null}
          </View>
        </InstantExpand>
      </View>
    );
  }

  return (
    <View style={styles.eventWrap}>
      <Pressable
        disabled={!eventExpandable}
        onPress={onToggle}
        style={cardStyle}
      >
        <View style={styles.eventHead}>
          <Text style={titleStyle}>{toolLabel(title)}</Text>
          {mode ? <Text style={styles.eventMode}>{mode}</Text> : null}
        </View>
        <Text numberOfLines={2} style={detailStyle}>{detail}</Text>
        {eventOutput && !expanded ? <Text numberOfLines={3} style={outputStyle}>{eventOutput}</Text> : null}
      </Pressable>
      <InstantExpand open={expanded}>
        <View style={styles.eventExpandBody}>
          {eventMeta ? <Text style={styles.eventMeta}>{eventMeta}</Text> : null}
          {eventOutput ? <Text style={outputStyle}>{eventOutput}</Text> : null}
        </View>
      </InstantExpand>
    </View>
  );
}

/** 与桌面端 ToolBatchGroup 对齐：相邻同类工具收成一个可折叠批组，标签用
 *  「已运行 N 条命令 / 已编辑 N 个文件 / 已查询 N 次 / 已浏览 N 次」。 */
function ToolBatchCardView(props: {
  styles: Record<string, any>;
  batch: MobileToolBatchCard;
  expanded: boolean;
  onToggle: () => void;
  expandedEventIds: Record<string, boolean>;
  onToggleEvent: (eventId: string) => void;
}) {
  const { batch, expanded, expandedEventIds, onToggle, onToggleEvent, styles } = props;
  const running = batch.status === 'running';
  const shell = batch.batchKind === 'shell';
  const web = batch.batchKind === 'web';
  const browser = batch.batchKind === 'browser';
  const noun = shell ? '条命令' : web ? '次' : browser ? '次' : '个文件';
  const label = shell
    ? (running ? '运行中' : '已运行')
    : web
      ? (running ? '查询中' : '已查询')
      : browser
        ? (running ? '浏览中' : '已浏览')
        : (running ? '编辑中' : '已编辑');

  return (
    <View style={styles.toolBatchWrap}>
      <Pressable style={styles.toolBatchHead} onPress={onToggle}>
        <Text style={running ? styles.toolBatchLabelActive : styles.toolBatchLabel}>{label}</Text>
        <Text style={styles.toolBatchCount}>{`${batch.events.length} ${noun}`}</Text>
      </Pressable>
      <InstantExpand open={expanded}>
        <View style={styles.toolBatchList}>
          {batch.events.map((event) => (
            <EventCardView
              key={event.id}
              styles={styles}
              event={event}
              expanded={!!expandedEventIds[event.id]}
              onToggle={() => onToggleEvent(event.id)}
            />
          ))}
        </View>
      </InstantExpand>
    </View>
  );
}

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
    const { colors } = useMobileTheme();
    const [expandedContextIds, setExpandedContextIds] = useState<Record<string, boolean>>({});
    const [expandedEventIds, setExpandedEventIds] = useState<Record<string, boolean>>({});
    const [expandedBatchIds, setExpandedBatchIds] = useState<Record<string, boolean>>({});
    const [expandedErrorIds, setExpandedErrorIds] = useState<Record<string, boolean>>({});
    const measuredHeightRef = useRef(0);
    // 展开高度变化交给 LegendList maintainVisibleContentPosition.size，不再预写 scroll 补偿。
    const toggleLocalExpansion = useCallback((apply: () => void) => {
      apply();
    }, []);

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
          <BubbleEnter
            key={`user:${turn.userMessage.id}`}
            playKey={`user:${turn.userMessage.id}`}
            createdAt={turn.createdAt}
            variant="user"
          >
            <View style={styles.bubbleUserWrap}>
              <UserAttachmentStrip
                attachments={turn.userMessage.attachments}
                onOpen={onOpenImage}
                onCopy={onCopyImage}
                styles={styles}
              />
              {toText(turn.userMessage.text).trim() ? (
                <Pressable
                  style={[
                    styles.bubbleUser,
                    {
                      // ChatGPT 风格：用户消息中性浅灰气泡（右下角留小尖角），不用品牌绿大面积铺色。
                      backgroundColor: colors.isDark ? colors.card : colors.sidebar,
                      borderBottomRightRadius: 6
                    }
                  ]}
                  onLongPress={() => onCopyMessage(toText(turn.userMessage?.text))}
                  delayLongPress={280}
                >
                  <Text style={[styles.bubbleUserText, { color: colors.text }]}>
                    {toText(turn.userMessage.text || '...')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </BubbleEnter>
        ) : null}
        {turn.items.map((item) => {
          if (item.kind === 'chat') {
            const m = item.message;
            if (m.role === 'user') return null;
            return (
              <BubbleEnter
                key={m.id}
                playKey={`assistant:${m.id}`}
                createdAt={Number(m.createdAt || turn.createdAt)}
                variant="assistant"
              >
                <View style={styles.bubbleAssistantWrap}>
                  <Pressable style={styles.bubbleAssistant} onLongPress={() => onCopyMessage(toText(m.text))} delayLongPress={280}>
                    <View style={styles.bubbleContent}>{renderMarkdown(styles, bodyFontFamily, toText(m.text || '...'), 'assistant', streaming && isLastTurn)}</View>
                  </Pressable>
                </View>
              </BubbleEnter>
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
                    onPress={() =>
                      toggleLocalExpansion(() =>
                        setExpandedContextIds((prev) => ({ ...prev, [item.context.id]: !prev[item.context.id] }))
                      )
                    }
                  >
                    <View style={styles.contextHeadRow}>
                      <View style={styles.contextHeadMain}>
                        <View style={styles.contextInlineSummaryRow}>
                          <Text style={styles.contextInlineTitle}>{toText(item.context.title || '已探索')}</Text>
                          <Text style={styles.contextSummary}>{toText(item.context.summary || '已收集上下文')}</Text>
                        </View>
                        {toText(item.context.detail) ? (
                          <Text numberOfLines={1} style={styles.contextDetail}>
                            {toText(item.context.detail)}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                  {tools.length > 0 ? (
                    <InstantExpand open={expanded}>
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
                    </InstantExpand>
                  ) : null}
                </View>
              </View>
            );
          }
          if (item.kind === 'event') {
            return (
              <EventCardView
                key={item.event.id}
                styles={styles}
                event={item.event}
                expanded={!!expandedEventIds[item.event.id]}
                onToggle={() => toggleLocalExpansion(() => setExpandedEventIds((prev) => ({ ...prev, [item.event.id]: !prev[item.event.id] })))}
              />
            );
          }
          if (item.kind === 'toolBatch') {
            return (
              <ToolBatchCardView
                key={item.batch.id}
                styles={styles}
                batch={item.batch}
                expanded={!!expandedBatchIds[item.batch.id]}
                onToggle={() => toggleLocalExpansion(() => setExpandedBatchIds((prev) => ({ ...prev, [item.batch.id]: !prev[item.batch.id] })))}
                expandedEventIds={expandedEventIds}
                onToggleEvent={(eventId) => toggleLocalExpansion(() => setExpandedEventIds((prev) => ({ ...prev, [eventId]: !prev[eventId] })))}
              />
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
            const title = toText(item.error.title || '运行失败') || '运行失败';
            const body = toText(item.error.text || '').trim();
            const code = toText(item.error.code).trim();
            const paused =
              /^(已暂停|已中止|aborted)$/i.test(body) || /中止|暂停|已停止|abort/i.test(body) || /暂停|中止/.test(title);
            const label = paused ? '已暂停' : title;
            const preview = paused
              ? ''
              : body
                  .split(/\r?\n/)
                  .map((line) => line.trim())
                  .find(Boolean) || body;
            const long = !paused && (body.length > 96 || body.includes('\n') || Boolean(code));
            const expanded = !!expandedErrorIds[item.error.id];
            const labelColor = colors.isDark ? '#FCA5A5' : '#B91C1C';
            return (
              <ErrorActivityRow
                key={item.error.id}
                styles={styles}
                title={label}
                preview={preview}
                expanded={expanded}
                expandable={long}
                labelColor={labelColor}
                mutedColor={colors.muted}
                onToggle={() =>
                  toggleLocalExpansion(() =>
                    setExpandedErrorIds((prev) => ({ ...prev, [item.error.id]: !prev[item.error.id] }))
                  )
                }
              >
                {code ? (
                  <Text style={[styles.errorCode, { color: colors.isDark ? '#b35656' : '#DC2626' }]}>{code}</Text>
                ) : null}
                {body ? (
                  <Text style={[styles.errorBodyText, { color: colors.muted }]}>{body}</Text>
                ) : null}
              </ErrorActivityRow>
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
            const thinkActive = streaming && isLastTurn && !card.finished;
            return (
              <View key={card.id} style={styles.thinkWrap}>
                <Pressable style={styles.thinkCard} onPress={() => onToggleThinkCard(card.id)}>
                  <ThinkActivityRow
                    active={thinkActive}
                    styles={styles}
                    text={contentText}
                    mutedColor={colors.muted}
                    labelColor={thinkActive ? colors.text : colors.muted}
                  />
                </Pressable>
                <TimelineExpand open={isThinkExpanded}>
                  <View style={[styles.bubbleContent, styles.thinkExpandBody]}>
                    {renderMarkdown(styles, bodyFontFamily, contentText, 'think', thinkActive)}
                  </View>
                </TimelineExpand>
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
    prev.onMeasuredHeight === next.onMeasuredHeight
);
