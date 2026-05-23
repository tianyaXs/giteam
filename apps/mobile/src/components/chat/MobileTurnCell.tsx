import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  PanResponder,
  Platform,
  Pressable,
  Text,
  View,
  type TextStyle
} from 'react-native';
import type { MarkedStyles } from 'react-native-marked';
import { formatClock } from '../../lib/time';
import { toText } from '../../lib/text';
import type { MobileQuestionCard, MobileRenderedTurn, MobileTodoCard } from '../../types';
import type { TurnCellInteractionState } from '../../features/chat/useInteractiveTurnCells';
import { MobileMarkedMarkdown } from './MobileMarkedMarkdown';

function normalizeMarkdownForMobile(input: string) {
  return toText(input).replace(/^[ \t]{2,}(?=(?:\*\*|#{1,6}\s|[-*+]\s|\d+\.\s|>\s))/gm, '');
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
  const isUser = tone === 'user';
  const isThink = tone === 'think';
  const textColor = isUser ? '#fffaf2' : isThink ? '#746b5e' : '#24211d';
  const mutedColor = isUser ? '#eadfce' : isThink ? '#8d826f' : '#7c766c';
  const headingColor = isUser ? '#ffffff' : isThink ? '#5f5749' : '#211e19';
  const codeBg = isUser ? 'rgba(38, 35, 29, 0.34)' : isThink ? '#eee8dc' : '#ece8df';
  const codeColor = isUser ? '#fffaf2' : '#3a352e';
  const markdownStyles = useMemo<MarkedStyles>(
    () => ({
      text: {
        color: textColor,
        fontSize: isThink ? 14 : 15,
        lineHeight: isThink ? 22 : 24,
        fontFamily: bodyFontFamily
      },
      paragraph: {
        marginTop: 2,
        marginBottom: 2
      },
      strong: { color: headingColor, fontWeight: 'bold', fontFamily: bodyFontFamily },
      em: { color: mutedColor, fontStyle: 'italic', fontFamily: bodyFontFamily },
      link: { color: isUser ? '#bfdbfe' : '#1768c2', textDecorationLine: 'underline', fontFamily: bodyFontFamily },
      h1: { color: headingColor, fontSize: 20, lineHeight: 27, fontWeight: '800', marginTop: 8, marginBottom: 6, fontFamily: bodyFontFamily },
      h2: { color: headingColor, fontSize: 18, lineHeight: 25, fontWeight: '800', marginTop: 6, marginBottom: 5, fontFamily: bodyFontFamily },
      h3: { color: headingColor, fontSize: 16, lineHeight: 23, fontWeight: '800', marginTop: 5, marginBottom: 4, fontFamily: bodyFontFamily },
      h4: { color: headingColor, fontSize: 15, lineHeight: 22, fontWeight: '800', marginTop: 4, marginBottom: 3, fontFamily: bodyFontFamily },
      h5: { color: headingColor, fontSize: 14, lineHeight: 21, fontWeight: '800', marginTop: 4, marginBottom: 3, fontFamily: bodyFontFamily },
      h6: { color: mutedColor, fontSize: 13, lineHeight: 20, fontWeight: '800', marginTop: 4, marginBottom: 3, fontFamily: bodyFontFamily },
      list: {
        marginTop: 4,
        marginBottom: 4,
        marginLeft: 14
      },
      li: {
        color: textColor,
        fontSize: isThink ? 14 : 15,
        lineHeight: isThink ? 22 : 24,
        fontFamily: bodyFontFamily
      },
      codespan: {
        color: textColor,
        backgroundColor: codeBg,
        borderColor: isUser ? 'rgba(234,223,206,0.22)' : '#ddd4c5',
        borderWidth: 1,
        borderRadius: 5,
        fontSize: 13,
        fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
        paddingHorizontal: 4,
        paddingVertical: 1
      },
      code: {
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
        borderLeftWidth: 3,
        marginTop: 8,
        marginBottom: 8,
        paddingLeft: 9
      },
      hr: {
        backgroundColor: isUser ? 'rgba(234,223,206,0.35)' : '#ded6ca',
        height: 1,
        marginTop: 10,
        marginBottom: 10
      },
      table: {
        borderColor: isUser ? 'rgba(234,223,206,0.35)' : '#ddd4c5',
        borderWidth: 1,
        borderRadius: 10
      },
      tableRow: {
        borderColor: isUser ? 'rgba(234,223,206,0.24)' : '#ddd4c5',
        borderBottomWidth: 1
      },
      tableCell: {
        paddingHorizontal: 8,
        paddingVertical: 8
      }
    }),
    [bodyFontFamily, codeBg, codeColor, headingColor, isThink, isUser, mutedColor, textColor]
  );
  const codeTextStyle = useMemo<TextStyle>(
    () => ({
      color: codeColor,
      fontSize: 13,
      lineHeight: 20,
      fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo'
    }),
    [codeColor]
  );

  return (
    <View style={styles.markdownBlock}>
      <MobileMarkedMarkdown
        codeTextStyle={codeTextStyle}
        containerStyle={styles.streamdownTextContainer}
        streaming={streaming}
        styles={markdownStyles}
        value={src}
      />
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
      <Pressable style={compact ? styles.todoDockCompact : styles.todoDock} onPress={onToggle}>
        {content}
      </Pressable>
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
    const measuredHeightRef = useRef(0);

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
            return (
              <View key={item.context.id} style={styles.contextWrap}>
                <View style={styles.contextCard}>
                  <View style={styles.contextHeadRow}>
                    <Text style={styles.contextTitle}>{toText(item.context.title || 'Context')}</Text>
                  </View>
                  {tools.length > 0 ? (
                    <View style={styles.contextTools}>
                      {tools.slice(0, 3).map((tool) => (
                        <View key={tool.id} style={styles.contextToolRow}>
                          <Text style={styles.contextToolTitle}>{toText(tool.title || 'tool')}</Text>
                          <Text numberOfLines={1} style={styles.contextToolDetail}>
                            {toText(tool.detail || tool.mode || tool.status || '执行完成')}
                          </Text>
                          {toText(tool.detail) ? (
                            <Pressable hitSlop={8} style={styles.contextCopyBtn} onPress={() => onCopyMessage(toText(tool.detail))}>
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
            const status = toText(item.event.status).toLowerCase();
            const dotStyle = status === 'running' || status === 'pending' ? styles.eventDotRun : styles.eventDot;
            const title = toText(item.event.title || 'Event');
            const mode = toText(item.event.mode);
            const eventDetail = toText(item.event.detail);
            const detail = toText(item.event.detail || item.event.mode || item.event.status || '工具执行完成');
            const isWriteEvent = mode === '写入' || mode.toLowerCase() === 'write' || title === 'apply_patch';
            if (isWriteEvent) {
              const writeTitle = title === 'apply_patch' ? 'Patch' : 'Write';
              const summary = eventDetail.match(/^(Added|Modified|Deleted|新增|修改|删除)\s+(.+?)(?:\s+(\+\d+)\s+(-\d+))?$/);
              const actionLabel = summary ? ({ 新增: 'Added', 修改: 'Modified', 删除: 'Deleted' } as Record<string, string>)[summary[1]] || summary[1] : '';
              return (
                <View key={item.event.id} style={styles.eventWrap}>
                  <View style={styles.writeEventCard}>
                    <View style={styles.writeEventHead}>
                      <View style={status === 'running' || status === 'pending' ? styles.writeEventDotRun : styles.writeEventDot} />
                      <Text numberOfLines={1} style={styles.writeEventTitle}>
                        {writeTitle}
                      </Text>
                      <Text style={styles.writeEventTime}>{formatClock(item.event.createdAt)}</Text>
                    </View>
                    {summary ? (
                      <View style={styles.writeEventSummaryRow}>
                        <Text style={styles.writeEventAction}>{actionLabel}</Text>
                        <Text numberOfLines={1} style={styles.writeEventFile}>
                          {summary[2]}
                        </Text>
                        {summary[3] ? <Text style={styles.writeEventAdd}>{summary[3]}</Text> : null}
                        {summary[4] ? <Text style={styles.writeEventDel}>{summary[4]}</Text> : null}
                      </View>
                    ) : eventDetail ? (
                      <Text numberOfLines={1} style={styles.writeEventDetail}>
                        {eventDetail}
                      </Text>
                    ) : null}
                    {toText(item.event.output) ? (
                      <Text numberOfLines={3} style={styles.writeEventOutput}>
                        {toText(item.event.output)}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            }
            const isShellEvent = title.toLowerCase() === 'bash' || mode.toLowerCase() === 'bash' || mode === '命令';
            return (
              <View key={item.event.id} style={styles.eventWrap}>
                <View style={[styles.eventCard, isShellEvent && styles.bashEventCard]}>
                  <View style={styles.eventHead}>
                    <View style={isShellEvent ? (status === 'running' || status === 'pending' ? styles.bashEventDotRun : styles.bashEventDot) : dotStyle} />
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
    prev.onCopyMessage === next.onCopyMessage &&
    prev.onToggleTimelineQuestion === next.onToggleTimelineQuestion &&
    prev.onToggleThinkCard === next.onToggleThinkCard &&
    prev.onChangeTimelineTab === next.onChangeTimelineTab &&
    prev.onMeasuredHeight === next.onMeasuredHeight
);
