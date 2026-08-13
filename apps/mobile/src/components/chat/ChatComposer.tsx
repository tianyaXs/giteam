import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated as RNAnimated,
  Easing,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
  Easing as ReEasing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from 'react-native-reanimated';
import { useMobileTheme } from '../../features/theme/ThemeProvider';
import { toText } from '../../lib/text';
import { ProviderIcon } from '../ProviderIcon';
import { IdleReasoningPill } from './IdleReasoningPill';
import { ComposerSendDragHandle } from './ComposerSendDragHandle';
import { ComposerSendGlyph } from './ComposerSendGlyph';
import { ModelPickerPopover } from './ModelPickerPopover';
import type { MobileThinkingLevel } from './thinkingLevels';

/**
 * 待机：左粒子胶囊 + 右模型圆钮（仅新会话默认）。
 * 有内容的会话默认保持输入框；点空白不收回；输入框左滑可回到待机双钮。
 */

function shortModelLabel(label: string): string {
  const raw = toText(label).trim();
  if (!raw) return '模型';
  const s = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  return s.length > 18 ? `${s.slice(0, 16)}…` : s;
}

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

type SlashCommand = {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  source: 'builtin' | 'command' | 'skill' | 'mcp';
};

type ModelOption = {
  id: string;
  label: string;
  provider: string;
};

type ComposerModeOption = {
  key: 'build' | 'plan';
  label: string;
};

const H_INSET = 16;
const BTN_GAP = 10;
const BTN_HEIGHT = 52;
const BTN_RADIUS = 26;
/** 圆形图标钮边长：与行高一致，避免压成椭圆 */
const MODEL_BTN_WIDTH = BTN_HEIGHT;
/** 无可用模型时右侧「进入设置」最小宽度 */
const SETUP_BTN_WIDTH = 108;
/** 仅 opacity/transform，可走原生驱动 */
const EXPAND_MS = 260;

const IDLE_LAYER_STYLE = {
  ...StyleSheet.absoluteFillObject,
  zIndex: 1
} as const;

/** 输入条表面样式（不用 absoluteFill 铺底色，避免 Android 重挂载后圆角失效） */
const DOCK_SURFACE_STYLE = {
  flex: 1,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  paddingHorizontal: 6,
  borderRadius: BTN_RADIUS,
  overflow: 'hidden' as const,
  borderWidth: StyleSheet.hairlineWidth
};

export type ChatComposerHandle = {
  collapse: () => void;
};

type ChatComposerProps = {
  styles: Record<string, any>;
  prompt: string;
  imageAttachments: ComposerAttachment[];
  attachmentMenuOpen: boolean;
  attachmentPanelVisible: boolean;
  attachmentToggleAnim: RNAnimated.Value;
  attachmentPanelStyle: any;
  actionIconAnim: RNAnimated.Value;
  inputModelLabel?: string;
  composerModeOptions?: ComposerModeOption[];
  composerAgent?: 'build' | 'plan';
  modelOptions?: ModelOption[];
  selectedModel?: string;
  onSelectMode?: (mode: 'build' | 'plan') => void;
  onSelectModel?: (id: string) => void;
  onOpenModelManager?: () => void;
  canSendNow: boolean;
  canAbortNow: boolean;
  slashOpen: boolean;
  slashActiveIndex: number;
  slashSuggestions: SlashCommand[];
  recentScrollerHeight: number;
  recentImages: RecentImageItem[];
  recentImagesLoading: boolean;
  recentImagesLoadingMore: boolean;
  recentImagesHasNext: boolean;
  keyboardInset: number;
  onLayoutHeight: (height: number) => void;
  onPromptChange: (value: string) => void;
  onToggleAttachmentMenu: () => void;
  onDismissAttachmentPanel: () => void;
  onOpenAttachmentPreview: (img: { uri: string; filename?: string }) => void;
  onRemoveAttachment: (id: string) => void;
  onAbort: () => void;
  onSend: () => void;
  onSelectSlash: (trigger: string) => void;
  onCaptureCamera: () => void;
  onOpenAlbumPicker: () => void;
  onPickFile: () => void;
  onRecentScroll: (y: number, viewportH: number, contentH: number) => void;
  onAttachRecentImage: (item: RecentImageItem) => void;
  thinkingLevel?: MobileThinkingLevel;
  onThinkingLevelChange?: (level: MobileThinkingLevel) => void;
  /** 当前会话 id：切换时重置默认态 */
  sessionId?: string;
  /** 会话已有消息：默认保持输入框，点空白不回到待机 */
  hasConversationContent?: boolean;
};

const ChatComposerImpl = React.forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposerImpl(
  props,
  ref
) {
  const {
    actionIconAnim,
    attachmentMenuOpen,
    attachmentPanelStyle,
    attachmentPanelVisible,
    attachmentToggleAnim,
    canAbortNow,
    canSendNow,
    imageAttachments,
    inputModelLabel,
    modelOptions = [],
    selectedModel = '',
    onSelectModel,
    onOpenModelManager,
    keyboardInset,
    onAbort,
    onAttachRecentImage,
    onCaptureCamera,
    onDismissAttachmentPanel,
    onLayoutHeight,
    onOpenAlbumPicker,
    onOpenAttachmentPreview,
    onPickFile,
    onPromptChange,
    onRecentScroll,
    onRemoveAttachment,
    onSelectSlash,
    onSend,
    onToggleAttachmentMenu,
    prompt,
    recentImages,
    recentImagesHasNext,
    recentImagesLoading,
    recentImagesLoadingMore,
    recentScrollerHeight,
    slashActiveIndex,
    slashOpen,
    slashSuggestions,
    styles,
    thinkingLevel = 'medium',
    onThinkingLevelChange,
    sessionId = '',
    hasConversationContent = false
  } = props;

  const { colors } = useMobileTheme();
  const insets = useSafeAreaInsets();
  // Sticky 已改为整页 KeyboardAvoidingView；弹起时收掉 Home Indicator 边距，避免输入条悬空
  const bottomPad = keyboardInset > 0 ? 8 : Math.max(10, insets.bottom);
  const sendActive = canSendNow || canAbortNow;

  const hasPrompt = toText(prompt).trim().length > 0;
  const hasModels = modelOptions.length > 0;
  const idleRightBtnW = hasModels ? MODEL_BTN_WIDTH : SETUP_BTN_WIDTH;
  const idleRightBtnWSv = useSharedValue(idleRightBtnW);
  const inputRef = useRef<TextInput>(null);
  const modelBtnRef = useRef<View>(null);
  // 仅用户点「聊天」后才展开；避免 Fast Refresh / 误 focus 卡住展开态把右侧模型藏掉
  const [composerOpen, setComposerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelAnchor, setModelAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  /** 右侧模型区已向左展开 */
  const [modelFocus, setModelFocus] = useState(false);
  /** 长按推理强度调节中 */
  const [scrubbing, setScrubbing] = useState(false);
  /** 待机行总宽（React state：粒子场 / 布局；shared：宽度动画） */
  const [idleRowWidth, setIdleRowWidth] = useState(0);
  const lastLayoutHRef = useRef(0);
  const idleRowW = useSharedValue(0);
  /** 0=待机比例，1=模型区展开 */
  const modelSplit = useSharedValue(0);
  /** 0=正常，1=左胶囊铺满遮住模型 */
  const scrubCover = useSharedValue(0);
  /** 输入框左滑位移（跟手，负值向左）；0=输入盖满，-w=待机全显 */
  const swipeX = useSharedValue(0);
  /** 1=输入层挂载中（用滑动遮盖），0=仅待机 */
  const dockMode = useSharedValue(0);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  /** 收起中：避免 blur + keyboardHide 双触发打两次动画 */
  const closingRef = useRef(false);
  /** openInput 后等 TextInput 挂载再 focus，避免 ref 仍为空导致键盘不弹 */
  const pendingFocusRef = useRef(false);
  /** 用户在有内容会话上手动左滑进入待机；避免 hydration 又拉回输入框 */
  const userChoseIdleRef = useRef(false);

  /**
   * Shell 与按钮态解耦（对齐 ChatGPT/Claude）：
   * - standby：待机粒子双钮
   * - docked：输入条（可为空、可发送、可停止）
   * 发送/等待/结束都保持 docked；仅用户左滑才回 standby。
   */
  const shellDocked =
    composerOpen || hasPrompt || canAbortNow || (hasConversationContent && !userChoseIdleRef.current);
  const idle = !shellDocked;
  const keepDockOpen = shellDocked;
  const selectedOption = modelOptions.find((m) => m.id === selectedModel.trim());
  const providerId = toText(selectedOption?.provider || selectedModel).trim() || 'synthetic';
  const modelDisplayLabel = shortModelLabel(toText(inputModelLabel || selectedOption?.label || selectedModel));
  const modelA11y = hasModels
    ? modelFocus
      ? `当前模型：${modelDisplayLabel}，再次点击打开模型菜单，长按进入模型设置`
      : `当前模型：${modelDisplayLabel}，点击展开，长按进入模型设置`
    : '进入设置，开启模型';

  useEffect(() => {
    idleRightBtnWSv.value = hasModels ? MODEL_BTN_WIDTH : SETUP_BTN_WIDTH;
  }, [hasModels, idleRightBtnWSv]);

  useEffect(() => {
    if (!hasModels) setModelFocus(false);
  }, [hasModels]);

  useEffect(() => {
    modelSplit.value = withTiming(modelFocus ? 1 : 0, {
      duration: EXPAND_MS,
      easing: ReEasing.out(ReEasing.cubic)
    });
  }, [modelFocus, modelSplit]);

  useEffect(() => {
    scrubCover.value = withTiming(scrubbing ? 1 : 0, {
      duration: EXPAND_MS,
      easing: ReEasing.out(ReEasing.cubic)
    });
  }, [scrubCover, scrubbing]);

  const resetIdleBalance = useCallback(() => {
    setModelFocus(false);
    setScrubbing(false);
    setModelPickerOpen(false);
    modelSplit.value = 0;
    scrubCover.value = 0;
  }, [modelSplit, scrubCover]);

  const applySessionComposerDefault = useCallback(
    (withContent: boolean) => {
      closingRef.current = false;
      userChoseIdleRef.current = false;
      resetIdleBalance();
      swipeX.value = 0;
      Keyboard.dismiss();
      if (withContent) {
        pendingFocusRef.current = false;
        dockMode.value = 1;
        setComposerOpen(true);
      } else {
        pendingFocusRef.current = false;
        dockMode.value = 0;
        setComposerOpen(false);
      }
    },
    [dockMode, resetIdleBalance, swipeX]
  );

  const handleThinkingLevelChange = useCallback(
    (level: MobileThinkingLevel) => {
      onThinkingLevelChange?.(level);
    },
    [onThinkingLevelChange]
  );

  const handleSelectModel = useCallback(
    (id: string) => {
      onSelectModel?.(id);
    },
    [onSelectModel]
  );

  const handleOpenModelManager = useCallback(() => {
    onOpenModelManager?.();
  }, [onOpenModelManager]);

  const closeModelPicker = useCallback(() => {
    setModelPickerOpen(false);
  }, []);

  // 左浅右深对比（浅色：灰底聊天 / 黑底图标；深色：深灰聊天 / 白底图标）
  const modelBg = colors.isDark ? '#FFFFFF' : '#1A1A1F';
  const modelIconColor = colors.isDark ? '#1A1A1F' : '#FFFFFF';
  // 展开态：干净中性底 + 细边框层次
  const dockBg = colors.isDark ? '#2A2A2E' : '#FFFFFF';
  // 对齐桌面 contrast 圆钮（截图）：实心深色圆 + 白色图标，轻阴影，无粗描边
  const sendActiveFill = colors.isDark ? '#F4F4F5' : '#1A1A1F';
  const sendActiveIcon = colors.isDark ? '#1A1A1F' : '#FFFFFF';
  const sendBg = canAbortNow || canSendNow
    ? sendActiveFill
    : colors.isDark
      ? 'rgba(255,255,255,0.12)'
      : '#E8E8ED';
  const sendIcon = canAbortNow || canSendNow ? sendActiveIcon : colors.muted;
  const sendChromeStyle = useMemo(
    () =>
      canAbortNow || canSendNow
        ? {
            backgroundColor: sendBg,
            borderWidth: 0,
            shadowColor: '#000',
            shadowOpacity: colors.isDark ? 0.35 : 0.12,
            shadowRadius: 2,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2
          }
        : {
            backgroundColor: sendBg,
            borderWidth: 0,
            shadowOpacity: 0,
            elevation: 0
          },
    [canAbortNow, canSendNow, colors.isDark, sendBg]
  );

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const openInput = useCallback(() => {
    closingRef.current = false;
    userChoseIdleRef.current = false;
    resetIdleBalance();
    const w = Math.max(160, idleRowW.value > 0 ? idleRowW.value : idleRowWidth || 320);
    // 从左侧滑入遮盖待机（与左滑回待机对称）
    swipeX.value = -w;
    dockMode.value = 1;
    pendingFocusRef.current = true;
    setComposerOpen(true);
    swipeX.value = withTiming(0, {
      duration: 300,
      easing: ReEasing.out(ReEasing.cubic)
    });
  }, [dockMode, idleRowW, idleRowWidth, resetIdleBalance, swipeX]);

  const onScrubbingChange = useCallback((next: boolean) => {
    if (next) {
      setModelFocus(false);
      setModelPickerOpen(false);
    }
    setScrubbing(next);
  }, []);

  const restoreIdleStandby = useCallback(() => {
    setModelPickerOpen(false);
    setModelFocus(false);
  }, []);

  // TextInput 仅在展开层挂载后才能 focus
  useEffect(() => {
    if (!composerOpen || !pendingFocusRef.current) return;
    if (toText(promptRef.current).trim()) {
      pendingFocusRef.current = false;
      return;
    }
    pendingFocusRef.current = false;
    const t = setTimeout(() => focusInput(), 32);
    return () => clearTimeout(t);
  }, [composerOpen, focusInput]);

  const closeInput = useCallback(
    (mode: 'animate' | 'snap' = 'animate', opts?: { force?: boolean }) => {
      // 等待回复：blur / 收键盘不得回待机（壳层与停止钮同闩）。
      if (canAbortNow) return;
      if (toText(promptRef.current).trim()) return;
      // 有内容会话：仅左滑（force）可回待机；点空白 / 失焦 / 收键盘不收回
      if (!opts?.force && hasConversationContent) return;
      const finish = () => {
        // 先切 dockMode：待机层立刻满不透明，避免 swipeX 归零时闪一下
        dockMode.value = 0;
        setComposerOpen(false);
        // 输入层卸掉后再归零位移，否则会瞬移回中再卸载
        requestAnimationFrame(() => {
          swipeX.value = 0;
          closingRef.current = false;
          resetIdleBalance();
        });
      };
      if (closingRef.current) {
        if (mode === 'snap') finish();
        return;
      }
      closingRef.current = true;
      setModelPickerOpen(false);
      if (mode === 'snap') {
        finish();
        return;
      }
      // 向左滑出，露出待机（与进入时右滑遮盖对称）
      const w = Math.max(160, idleRowW.value > 0 ? idleRowW.value : 320);
      swipeX.value = withTiming(
        -w,
        { duration: 280, easing: ReEasing.out(ReEasing.cubic) },
        (finished) => {
          if (finished) runOnJS(finish)();
        }
      );
    },
    [canAbortNow, dockMode, hasConversationContent, idleRowW, resetIdleBalance, swipeX]
  );

  const commitSwipeToIdle = useCallback(() => {
    if (canAbortNow) return;
    if (toText(promptRef.current).trim()) return;
    userChoseIdleRef.current = true;
    // 不在此处 Keyboard.dismiss：滑完再收键盘会整页再抬一次，像「刷新」
    closeInput('snap', { force: true });
  }, [canAbortNow, closeInput]);

  const canSwipeToIdle = (composerOpen || keepDockOpen) && !canAbortNow && !hasPrompt && !canSendNow;
  const showIdleOrb = canSwipeToIdle;

  const dockSwipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canSwipeToIdle)
        .activeOffsetX([-12, 12])
        .failOffsetY([-16, 16])
        .onUpdate((evt) => {
          'worklet';
          // 仅向左跟手；向右橡皮筋轻微阻尼
          if (evt.translationX <= 0) {
            swipeX.value = evt.translationX;
          } else {
            swipeX.value = evt.translationX * 0.12;
          }
        })
        .onEnd((evt) => {
          'worklet';
          const w = Math.max(160, idleRowW.value);
          const distance = Math.max(0, -swipeX.value);
          const threshold = w * 0.28;
          const fling = evt.velocityX < -550;
          if (distance > threshold || fling) {
            swipeX.value = withTiming(
              -w,
              { duration: 240, easing: ReEasing.out(ReEasing.cubic) },
              (finished) => {
                if (finished) runOnJS(commitSwipeToIdle)();
              }
            );
          } else {
            swipeX.value = withSpring(0, { damping: 22, stiffness: 260, mass: 0.85 });
          }
        })
        .onFinalize((_evt, success) => {
          'worklet';
          // 手势被打断且尚未越过半程时收回
          if (!success) {
            const w = Math.max(160, idleRowW.value);
            if (swipeX.value > -w * 0.45) {
              swipeX.value = withSpring(0, { damping: 22, stiffness: 260, mass: 0.85 });
            }
          }
        }),
    [canSwipeToIdle, commitSwipeToIdle, idleRowW, swipeX]
  );

  const openModelPicker = useCallback(() => {
    Keyboard.dismiss();
    // 仅新会话待机态下点模型时，不需要收起输入框
    const show = (anchor: { x: number; y: number; width: number; height: number } | null) => {
      setModelAnchor(anchor);
      setModelPickerOpen(true);
    };
    let measured = false;
    const timer = setTimeout(() => {
      if (!measured) show(null);
    }, 80);
    modelBtnRef.current?.measureInWindow((x, y, width, height) => {
      measured = true;
      clearTimeout(timer);
      if (width > 0 && height > 0) {
        show({ x, y, width, height });
      } else {
        show(null);
      }
    });
  }, []);

  /** 待机：有模型 → 展开后再弹菜单；无模型 → 直接进设置；长按 → 模型开关设置 */
  const onIdleModelPress = useCallback(() => {
    if (scrubbing) return;
    Keyboard.dismiss();
    if (!hasModels) {
      setModelFocus(false);
      setModelPickerOpen(false);
      onOpenModelManager?.();
      return;
    }
    if (!modelFocus) {
      setModelPickerOpen(false);
      setModelFocus(true);
      return;
    }
    openModelPicker();
  }, [hasModels, modelFocus, onOpenModelManager, openModelPicker, scrubbing]);

  const onIdleModelLongPress = useCallback(() => {
    if (scrubbing) return;
    Keyboard.dismiss();
    setModelFocus(false);
    setModelPickerOpen(false);
    onOpenModelManager?.();
  }, [onOpenModelManager, scrubbing]);

  useImperativeHandle(
    ref,
    () => ({
      collapse: () => {
        Keyboard.dismiss();
        onDismissAttachmentPanel();
        if (toText(promptRef.current).trim()) return;
        // 有内容会话：点空白只收键盘，不回待机
        closeInput('animate');
      }
    }),
    [closeInput, onDismissAttachmentPanel]
  );

  // 切换会话：新会话 → 待机双钮；有内容 → 输入框（不自动弹键盘）
  useEffect(() => {
    applySessionComposerDefault(hasConversationContent);
    // 仅随会话切换重置；内容异步到达由下方 hydration 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 历史异步灌入：有内容且用户未主动待机时，升为输入框
  useEffect(() => {
    if (!hasConversationContent) return;
    if (userChoseIdleRef.current) return;
    if (composerOpen || keepDockOpen) return;
    pendingFocusRef.current = false;
    swipeX.value = 0;
    dockMode.value = 1;
    setComposerOpen(true);
  }, [composerOpen, dockMode, hasConversationContent, keepDockOpen, swipeX]);

  const wasAwaitingRef = useRef(false);
  useEffect(() => {
    if (hasPrompt || canAbortNow) {
      closingRef.current = false;
      userChoseIdleRef.current = false;
      swipeX.value = 0;
      dockMode.value = 1;
      setComposerOpen(true);
      wasAwaitingRef.current = canAbortNow;
      return;
    }
    // 等待结束：有内容保持 docked；空会话也不自动回待机（避免粒子闪），由用户左滑。
    if (wasAwaitingRef.current && !canAbortNow) {
      wasAwaitingRef.current = false;
      setComposerOpen(true);
      dockMode.value = 1;
      swipeX.value = 0;
      return;
    }
    wasAwaitingRef.current = false;
  }, [hasPrompt, canAbortNow, dockMode, swipeX]);

  useEffect(() => {
    // 键盘收起：生成中 / 有内容会话不回待机；仅空会话且非等待可收回
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const sub = Keyboard.addListener(hideEvent, () => {
      if (canAbortNow) return;
      if (hasConversationContent) return;
      if (!toText(promptRef.current).trim()) closeInput('animate');
    });
    return () => sub.remove();
  }, [canAbortNow, closeInput, hasConversationContent]);

  // 两侧始终用明确 width（勿用 flex：Reanimated 会残留 flex:1 把右侧挤没）
  const leftSlotStyle = useAnimatedStyle(() => {
    const row = idleRowW.value;
    if (row <= 0) return { width: 0, opacity: 0 };
    const rightIdle = idleRightBtnWSv.value;
    const standbyLeft = Math.max(MODEL_BTN_WIDTH, row - BTN_GAP - rightIdle);
    const standby = interpolate(modelSplit.value, [0, 1], [standbyLeft, MODEL_BTN_WIDTH], Extrapolation.CLAMP);
    const width = interpolate(scrubCover.value, [0, 1], [standby, row], Extrapolation.CLAMP);
    return { width, opacity: 1 };
  });

  const rightSlotStyle = useAnimatedStyle(() => {
    const row = idleRowW.value;
    if (row <= 0) return { width: 0, marginLeft: 0, opacity: 0 };
    const rightIdle = idleRightBtnWSv.value;
    const focusRight = Math.max(MODEL_BTN_WIDTH, row - BTN_GAP - MODEL_BTN_WIDTH);
    const standby = interpolate(modelSplit.value, [0, 1], [rightIdle, focusRight], Extrapolation.CLAMP);
    const width = interpolate(scrubCover.value, [0, 1], [standby, 0], Extrapolation.CLAMP);
    const marginLeft = interpolate(scrubCover.value, [0, 1], [BTN_GAP, 0], Extrapolation.CLAMP);
    const opacity = interpolate(scrubCover.value, [0, 0.55, 1], [1, 0.35, 0], Extrapolation.CLAMP);
    return { width, marginLeft, opacity };
  });

  const modelLabelStyle = useAnimatedStyle(() => {
    const opacity = interpolate(modelSplit.value, [0, 0.45, 1], [0, 0, 1], Extrapolation.CLAMP);
    const translateX = interpolate(modelSplit.value, [0, 1], [8, 0], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateX }]
    };
  });

  // 左滑揭示待机 / 点击后右滑进入输入：共用 swipeX
  const idleBaseStyle = useAnimatedStyle(() => {
    const w = Math.max(160, idleRowW.value);
    const peek = interpolate(-swipeX.value, [0, w * 0.22, w * 0.55], [0, 0.55, 1], Extrapolation.CLAMP);
    const inDock = dockMode.value > 0.5;
    return {
      opacity: inDock ? peek : 1,
      transform: [{ scale: inDock ? 0.94 + peek * 0.06 : 1 }]
    };
  });

  const dockFollowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeX.value }],
    opacity: interpolate(
      -swipeX.value,
      [0, Math.max(160, idleRowW.value) * 0.55],
      [1, 0.82],
      Extrapolation.CLAMP
    )
  }));

  const showDock = composerOpen || keepDockOpen;

  const dockShadowOuter = useMemo(
    () =>
      showDock
        ? Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOpacity: colors.isDark ? 0.5 : 0.12,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 10 }
            },
            android: {},
            default: {}
          })
        : null,
    [colors.isDark, showDock]
  );

  const dockShadowInner = useMemo(
    () =>
      showDock
        ? Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOpacity: colors.isDark ? 0.35 : 0.1,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 }
            },
            android: { elevation: 12 },
            default: {}
          })
        : null,
    [colors.isDark, showDock]
  );

  const reportLayoutHeight = useCallback(
    (h: number) => {
      if (h <= 0) return;
      if (Math.abs(h - lastLayoutHRef.current) <= 1) return;
      lastLayoutHRef.current = h;
      onLayoutHeight(h);
    },
    [onLayoutHeight]
  );

  const idleRow = (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
      <Reanimated.View style={[{ height: BTN_HEIGHT, overflow: 'hidden', justifyContent: 'center' }, leftSlotStyle]}>
        <IdleReasoningPill
          isDark={colors.isDark}
          thinkingLevel={thinkingLevel}
          onThinkingLevelChange={handleThinkingLevelChange}
          onOpenInput={openInput}
          onRestoreStandby={restoreIdleStandby}
          onScrubbingChange={onScrubbingChange}
          height={BTN_HEIGHT}
          borderRadius={BTN_RADIUS}
          active={idle}
          compact={modelFocus && !scrubbing}
          layoutWidth={
            scrubbing
              ? idleRowWidth
              : modelFocus
                ? MODEL_BTN_WIDTH
                : Math.max(0, idleRowWidth - BTN_GAP - idleRightBtnW)
          }
        />
      </Reanimated.View>

      <Reanimated.View
        style={[
          {
            height: BTN_HEIGHT,
            overflow: 'hidden',
            justifyContent: 'center',
            alignItems: 'center'
          },
          rightSlotStyle
        ]}
        pointerEvents={scrubbing ? 'none' : 'auto'}
      >
        <View
          ref={modelBtnRef}
          collapsable={false}
          style={{
            width: '100%',
            height: BTN_HEIGHT,
            borderRadius: BTN_RADIUS,
            backgroundColor: modelBg,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: hasModels && modelFocus ? 14 : hasModels ? 0 : 12,
            overflow: 'hidden'
          }}
        >
          <Pressable
            onPress={onIdleModelPress}
            onLongPress={onIdleModelLongPress}
            delayLongPress={380}
            hitSlop={8}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: hasModels && modelFocus ? 'flex-start' : 'center',
              gap: hasModels && modelFocus ? 8 : 0,
              minHeight: BTN_HEIGHT
            }}
            accessibilityRole="button"
            accessibilityLabel={modelA11y}
            accessibilityHint="长按进入模型开关设置"
          >
            {hasModels ? (
              <>
                <ProviderIcon
                  providerId={providerId}
                  size={26}
                  color={modelIconColor}
                  backgroundColor="transparent"
                  padded={false}
                />
                {modelFocus ? (
                  <Reanimated.View style={[{ flexShrink: 1, minWidth: 0 }, modelLabelStyle]}>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 14,
                        fontWeight: '600',
                        color: modelIconColor,
                        includeFontPadding: false
                      }}
                    >
                      {modelDisplayLabel}
                    </Text>
                  </Reanimated.View>
                ) : null}
              </>
            ) : (
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  color: modelIconColor,
                  includeFontPadding: false,
                  textAlign: 'center'
                }}
              >
                进入设置
              </Text>
            )}
          </Pressable>
        </View>
      </Reanimated.View>
    </View>
  );

  return (
    <>
      {attachmentPanelVisible ? <Pressable style={styles.attachmentBackdrop} onPress={onDismissAttachmentPanel} /> : null}
      <View
        style={{
          marginHorizontal: H_INSET,
          marginBottom: bottomPad,
          backgroundColor: 'transparent'
        }}
        onLayout={(evt) => {
          const h = Math.ceil(Number(evt.nativeEvent.layout?.height || 0));
          reportLayoutHeight(h);
        }}
      >
        {imageAttachments.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.attachmentRow}
            style={[styles.attachmentScroller, { marginBottom: 8 }]}
          >
            {imageAttachments.map((img) => (
              <Pressable key={img.id} style={styles.attachmentTile} onPress={() => onOpenAttachmentPreview({ uri: img.uri, filename: img.filename })}>
                <Image source={{ uri: img.uri }} style={styles.attachmentThumb} resizeMode="cover" />
                {img.status && img.status !== 'ready' ? (
                  <View style={img.status === 'failed' ? [styles.attachmentStateOverlay, styles.attachmentStateFailed] : styles.attachmentStateOverlay}>
                    {img.status === 'processing' || img.status === 'uploading' ? <ActivityIndicator size="small" color={colors.text} /> : null}
                    <Text style={styles.attachmentStateText}>{img.statusText || (img.status === 'failed' ? '失败' : '处理中')}</Text>
                  </View>
                ) : null}
                <Pressable style={styles.attachmentRemove} onPress={() => onRemoveAttachment(img.id)} hitSlop={8}>
                  <Text style={styles.attachmentRemoveTxt}>×</Text>
                </Pressable>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {/* 外层投影（不可 overflow:hidden）；内层裁圆角。仅输入态铺底+投影，避免待机两钮被连成一块 */}
        <View
          collapsable={false}
          style={[
            {
              borderRadius: BTN_RADIUS,
              backgroundColor: showDock ? dockBg : 'transparent'
            },
            dockShadowOuter,
            dockShadowInner
          ]}
        >
          <View
            collapsable={false}
            style={{
              width: '100%',
              height: BTN_HEIGHT,
              position: 'relative',
              borderRadius: BTN_RADIUS,
              overflow: 'hidden',
              backgroundColor: showDock ? dockBg : 'transparent'
            }}
            onLayout={(evt) => {
              const w = Math.ceil(evt.nativeEvent.layout.width);
              if (w > 0) {
                idleRowW.value = w;
                if (w !== idleRowWidth) setIdleRowWidth(w);
              }
            }}
          >
          <Reanimated.View
            style={[IDLE_LAYER_STYLE, idleBaseStyle]}
            pointerEvents={idle ? 'auto' : 'none'}
          >
            {idleRow}
          </Reanimated.View>

          {showDock ? (
            <GestureDetector gesture={dockSwipeGesture}>
              <Reanimated.View
                collapsable={false}
                style={[
                  StyleSheet.absoluteFillObject,
                  {
                    zIndex: 3,
                    borderRadius: BTN_RADIUS,
                    overflow: 'hidden',
                    backgroundColor: dockBg
                  },
                  dockFollowStyle
                ]}
              >
                <View
                  collapsable={false}
                  style={[
                    DOCK_SURFACE_STYLE,
                    {
                      backgroundColor: dockBg,
                      borderColor: colors.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.1)'
                    }
                  ]}
                  pointerEvents={showDock ? 'auto' : 'none'}
                >
                  <Pressable style={styles.cameraBtn} onPress={onToggleAttachmentMenu} hitSlop={8}>
                    <RNAnimated.View
                      style={{
                        transform: [
                          {
                            rotate: attachmentToggleAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: ['0deg', '45deg']
                            })
                          }
                        ]
                      }}
                    >
                      <Feather name={attachmentMenuOpen ? 'x' : 'plus'} size={22} color={colors.text} />
                    </RNAnimated.View>
                  </Pressable>

                  <TextInput
                    ref={inputRef}
                    style={[
                      styles.inputMain,
                      {
                        color: colors.text,
                        flex: 1,
                        minHeight: 44,
                        maxHeight: 44,
                        paddingTop: Platform.OS === 'ios' ? 12 : 10,
                        paddingBottom: Platform.OS === 'ios' ? 12 : 10,
                        paddingHorizontal: 8,
                        backgroundColor: 'transparent'
                      }
                    ]}
                    value={toText(prompt)}
                    onChangeText={onPromptChange}
                    placeholder="询问任何问题"
                    placeholderTextColor={colors.muted}
                    multiline={false}
                    onFocus={() => {
                      closingRef.current = false;
                      userChoseIdleRef.current = false;
                      swipeX.value = 0;
                      dockMode.value = 1;
                      resetIdleBalance();
                      setComposerOpen(true);
                    }}
                    onBlur={() => {
                      // 失焦不自动待机：等待中 / 有会话内容时保持 docked（对齐主流 IM）。
                      if (canAbortNow || hasConversationContent) return;
                      if (!toText(promptRef.current).trim()) closeInput('animate');
                    }}
                  />

                  {showIdleOrb ? (
                    <ComposerSendDragHandle
                      enabled={showIdleOrb}
                      backgroundColor={sendBg}
                      iconColor={sendIcon}
                      chromeStyle={sendChromeStyle}
                      swipeX={swipeX}
                      rowWidth={idleRowW}
                      onCommitIdle={commitSwipeToIdle}
                    />
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={canAbortNow ? '停止生成' : '发送'}
                      style={[
                        sendActive ? styles.actionBtnSend : styles.actionBtnDisabled,
                        sendChromeStyle
                      ]}
                      onPress={() => {
                        if (canAbortNow) {
                          onAbort();
                          return;
                        }
                        if (!canSendNow) return;
                        // 先发送（clearPrompt 内置 turnAwaiting 门闩），再失焦；
                        // 若先 blur，会在 working 未置位时空窗误关 dock。
                        closingRef.current = false;
                        userChoseIdleRef.current = false;
                        dockMode.value = 1;
                        setComposerOpen(true);
                        onSend();
                        requestAnimationFrame(() => inputRef.current?.blur());
                      }}
                      disabled={!sendActive}
                    >
                      <RNAnimated.View style={{ opacity: actionIconAnim, transform: [{ scale: actionIconAnim }] }}>
                        <ComposerSendGlyph busy={canAbortNow} color={sendIcon} size={20} />
                      </RNAnimated.View>
                    </Pressable>
                  )}
                </View>
              </Reanimated.View>
            </GestureDetector>
          ) : null}
          </View>
        </View>

        {slashOpen && slashSuggestions.length > 0 ? (
          <ScrollView
            style={[styles.slashPopover, { backgroundColor: colors.card, borderColor: colors.border }]}
            keyboardShouldPersistTaps="handled"
          >
            {slashSuggestions.map((cmd, idx) => (
              <Pressable
                key={cmd.id}
                style={[styles.slashItem, idx === slashActiveIndex ? { backgroundColor: colors.primarySoft } : null]}
                onPress={() => onSelectSlash(cmd.trigger)}
              >
                <View style={styles.slashItemMain}>
                  <View style={styles.slashItemTopRow}>
                    <Text style={[styles.slashTrigger, { color: colors.primary }]}>/{cmd.trigger}</Text>
                    <Text style={[styles.slashSource, { color: colors.muted }]}>{cmd.source}</Text>
                  </View>
                  <Text style={[styles.slashTitle, { color: colors.text }]}>{cmd.title}</Text>
                  {cmd.description ? (
                    <Text numberOfLines={1} style={[styles.slashDesc, { color: colors.muted }]}>
                      {cmd.description}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {attachmentPanelVisible ? (
          <RNAnimated.View style={[styles.attachmentPanel, attachmentPanelStyle]}>
            <View style={styles.attachmentMenuRow}>
              <Pressable
                style={[styles.attachmentMenuCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={onCaptureCamera}
              >
                <View style={[styles.attachmentMenuIconShell, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
                  <Feather name="camera" size={22} color={colors.primary} />
                </View>
                <Text style={[styles.attachmentMenuLabel, { color: colors.text }]}>拍照</Text>
              </Pressable>
              <Pressable
                style={[styles.attachmentMenuCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={onOpenAlbumPicker}
              >
                <View style={[styles.attachmentMenuIconShell, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
                  <Feather name="image" size={22} color={colors.primary} />
                </View>
                <Text style={[styles.attachmentMenuLabel, { color: colors.text }]}>相册</Text>
              </Pressable>
              <Pressable
                style={[styles.attachmentMenuCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={onPickFile}
              >
                <View style={[styles.attachmentMenuIconShell, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
                  <Feather name="folder" size={22} color={colors.primary} />
                </View>
                <Text style={[styles.attachmentMenuLabel, { color: colors.text }]}>文件</Text>
              </Pressable>
            </View>
            <View style={styles.recentHeaderRow}>
              <Text style={[styles.recentHeaderTitle, { color: colors.muted }]}>最近图片</Text>
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
                onRecentScroll(y, viewportH, contentH);
              }}
            >
              <View style={styles.recentGrid}>
                {recentImages.map((item) => (
                  <Pressable key={item.id} style={styles.recentThumbCard} onPress={() => onAttachRecentImage(item)}>
                    <Image source={{ uri: item.uri }} style={styles.recentThumbImage} resizeMode="cover" />
                  </Pressable>
                ))}
                {recentImages.length === 0 && recentImagesLoading ? (
                  <View style={styles.recentLoadingState}>
                    <ActivityIndicator size="small" color={colors.muted} />
                    <Text style={styles.recentLoadingText}>Loading recent images</Text>
                  </View>
                ) : null}
                {recentImages.length === 0 && !recentImagesLoading ? (
                  <View style={styles.recentEmptyState}>
                    <Feather name="image" size={18} color={colors.muted} />
                    <Text style={styles.recentEmptyText}>No recent images</Text>
                  </View>
                ) : null}
                {recentImagesLoadingMore ? (
                  <View style={styles.recentLoadingMore}>
                    <ActivityIndicator size="small" />
                  </View>
                ) : null}
                {recentImagesHasNext && !recentImagesLoadingMore ? (
                  <View style={styles.recentLoadHint}>
                    <Text style={styles.recentLoadHintText}>Scroll to load more</Text>
                  </View>
                ) : null}
              </View>
            </ScrollView>
          </RNAnimated.View>
        ) : null}
      </View>

      <ModelPickerPopover
        modelOptions={modelOptions}
        selectedModel={selectedModel}
        onSelectModel={handleSelectModel}
        open={modelPickerOpen}
        onClose={closeModelPicker}
        anchor={modelAnchor}
        surfaceColor={modelBg}
        contentColor={modelIconColor}
      />
    </>
  );
});

export const ChatComposer = React.memo(ChatComposerImpl);
