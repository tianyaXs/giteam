import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMobileTheme } from '../../features/theme/ThemeProvider';
import { toText } from '../../lib/text';
import { ProviderIcon } from '../ProviderIcon';
import { IdleReasoningPill } from './IdleReasoningPill';
import { ModelPickerPopover } from './ModelPickerPopover';
import type { MobileThinkingLevel } from './thinkingLevels';

/**
 * 待机：左粒子胶囊（短按展开 / 长按横滑调推理强度）+ 右供应商图标。
 * 点聊天 → 输入条向右展开占满，右侧图标宽度动画收回。
 * 点图标 → 轻薄菜单切换已开启模型。
 */

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
/** 右侧仅供应商图标 */
const MODEL_BTN_WIDTH = 48;
const EXPAND_MS = 280;

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
    onThinkingLevelChange
  } = props;

  const { colors } = useMobileTheme();
  const insets = useSafeAreaInsets();
  // StickyView 已贴键盘顶；弹起时收掉 Home Indicator 边距，避免输入条悬空
  const bottomPad = keyboardInset > 0 ? 8 : Math.max(10, insets.bottom);
  const sendActive = canSendNow || canAbortNow;

  const hasPrompt = toText(prompt).trim().length > 0;
  const hasModels = modelOptions.length > 0;
  const inputRef = useRef<TextInput>(null);
  const modelBtnRef = useRef<View>(null);
  // 仅用户点「聊天」后才展开；避免 Fast Refresh / 误 focus 卡住展开态把右侧模型藏掉
  const [composerOpen, setComposerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelAnchor, setModelAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const expandAnim = useRef(new RNAnimated.Value(0)).current;
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  /** 收起中：避免 blur + keyboardHide 双触发打两次动画 */
  const closingRef = useRef(false);
  /** openInput 后等 TextInput 挂载再 focus，避免 ref 仍为空导致键盘不弹 */
  const pendingFocusRef = useRef(false);

  const idle = !composerOpen && !hasPrompt;
  const selectedOption = modelOptions.find((m) => m.id === selectedModel.trim());
  const providerId = toText(selectedOption?.provider || selectedModel).trim() || 'synthetic';
  const modelA11y = hasModels
    ? `当前模型：${toText(inputModelLabel || selectedOption?.label || selectedModel)}，点击切换`
    : '打开模型设置';

  // 左浅右深对比（浅色：灰底聊天 / 黑底图标；深色：深灰聊天 / 白底图标）
  const modelBg = colors.isDark ? '#FFFFFF' : '#1A1A1F';
  const modelIconColor = colors.isDark ? '#1A1A1F' : '#FFFFFF';
  // 展开态：干净中性底 + 细边框层次
  const dockBg = colors.isDark ? '#2A2A2E' : '#FFFFFF';
  const dockBorder = colors.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)';
  const sendBg = canAbortNow
    ? colors.text
    : canSendNow
      ? (colors.isDark ? '#FFFFFF' : '#1A1A1F')
      : colors.isDark
        ? 'rgba(255,255,255,0.12)'
        : '#D0D0D6';
  const sendIcon = canAbortNow
    ? colors.background
    : canSendNow
      ? (colors.isDark ? '#1A1A1F' : '#FFFFFF')
      : colors.muted;

  const runExpand = useCallback(
    (open: boolean, onDone?: () => void) => {
      RNAnimated.timing(expandAnim, {
        toValue: open ? 1 : 0,
        duration: EXPAND_MS,
        easing: open ? Easing.out(Easing.cubic) : Easing.inOut(Easing.cubic),
        useNativeDriver: false
      }).start(({ finished }) => {
        if (finished) onDone?.();
      });
    },
    [expandAnim]
  );

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const openInput = useCallback(() => {
    closingRef.current = false;
    setModelPickerOpen(false);
    pendingFocusRef.current = true;
    setComposerOpen(true);
    runExpand(true);
  }, [runExpand]);

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
    (mode: 'animate' | 'snap' = 'animate') => {
      if (toText(promptRef.current).trim()) return;
      if (closingRef.current) {
        // 已在收起：仅允许 snap 打断（极端情况）
        if (mode === 'snap') {
          expandAnim.stopAnimation();
          expandAnim.setValue(0);
          setComposerOpen(false);
          closingRef.current = false;
        }
        return;
      }
      closingRef.current = true;
      setModelPickerOpen(false);
      const finish = () => {
        setComposerOpen(false);
        closingRef.current = false;
      };
      if (mode === 'snap') {
        expandAnim.stopAnimation();
        expandAnim.setValue(0);
        finish();
        return;
      }
      // 与展开对称：先播收回过渡，再卸下输入层
      runExpand(false, finish);
    },
    [expandAnim, runExpand]
  );

  const openModelPicker = useCallback(() => {
    Keyboard.dismiss();
    if (composerOpen && !toText(promptRef.current).trim()) {
      closeInput('animate');
    }
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
  }, [closeInput, composerOpen]);

  useImperativeHandle(
    ref,
    () => ({
      collapse: () => {
        Keyboard.dismiss();
        onDismissAttachmentPanel();
        if (toText(promptRef.current).trim()) return;
        closeInput('animate');
      }
    }),
    [closeInput, onDismissAttachmentPanel]
  );

  // 挂载时强制回到待机双按钮（清掉 Fast Refresh 残留的展开态 / 键盘）
  useEffect(() => {
    expandAnim.setValue(0);
    setComposerOpen(false);
    Keyboard.dismiss();
  }, [expandAnim]);

  useEffect(() => {
    if (hasPrompt) {
      closingRef.current = false;
      setComposerOpen(true);
      expandAnim.setValue(1);
    }
  }, [hasPrompt, expandAnim]);

  useEffect(() => {
    // 键盘收起时走同一套收回动画（勿 snap，否则没有过渡）
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const sub = Keyboard.addListener(hideEvent, () => {
      if (!toText(promptRef.current).trim()) closeInput('animate');
    });
    return () => sub.remove();
  }, [closeInput]);

  const idleLayerStyle = {
    ...StyleSheet.absoluteFillObject,
    opacity: expandAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0]
    }),
    zIndex: idle ? 2 : 0
  };
  const dockLayerStyle = {
    flex: 1,
    height: BTN_HEIGHT,
    opacity: hasPrompt
      ? 1
      : expandAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 1]
        })
  };

  const modelSlotStyle = {
    width: expandAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [MODEL_BTN_WIDTH, 0]
    }),
    marginLeft: expandAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [BTN_GAP, 0]
    }),
    opacity: expandAnim.interpolate({
      inputRange: [0, 0.55, 1],
      outputRange: [1, 0.2, 0]
    }),
    overflow: 'hidden' as const
  };
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
          if (h > 0) onLayoutHeight(h);
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

        {/* 左输入 / 右图标；展开时图标宽度动画收回 */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'nowrap',
            alignItems: 'center',
            width: '100%',
            minHeight: BTN_HEIGHT
          }}
        >
          <View style={{ flex: 1, height: BTN_HEIGHT }}>
            {/* 待机层常驻（无正文时）：与展开层用 expandAnim 交叉淡化，收起也有过渡 */}
            {!hasPrompt ? (
              <RNAnimated.View
                style={idleLayerStyle}
                pointerEvents={idle ? 'auto' : 'none'}
              >
                <IdleReasoningPill
                  isDark={colors.isDark}
                  thinkingLevel={thinkingLevel}
                  onThinkingLevelChange={(level) => onThinkingLevelChange?.(level)}
                  onOpenInput={openInput}
                  height={BTN_HEIGHT}
                  borderRadius={BTN_RADIUS}
                  active={idle}
                />
              </RNAnimated.View>
            ) : null}

            {composerOpen || hasPrompt ? (
              <RNAnimated.View
                style={[
                  dockLayerStyle,
                  {
                    borderRadius: BTN_RADIUS,
                    backgroundColor: dockBg,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: dockBorder,
                    paddingHorizontal: 6,
                    flexDirection: 'row',
                    alignItems: 'center',
                    overflow: 'hidden',
                    ...Platform.select({
                      ios: {
                        shadowColor: '#000',
                        shadowOpacity: colors.isDark ? 0.28 : 0.06,
                        shadowRadius: 10,
                        shadowOffset: { width: 0, height: 3 }
                      },
                      android: {
                        elevation: 2
                      },
                      default: {}
                    })
                  }
                ]}
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
                    setComposerOpen(true);
                    runExpand(true);
                  }}
                  onBlur={() => {
                    if (!toText(promptRef.current).trim()) closeInput('animate');
                  }}
                />

                <Pressable
                  style={[sendActive ? styles.actionBtnSend : styles.actionBtnDisabled, { backgroundColor: sendBg }]}
                  onPress={() => {
                    if (canAbortNow) {
                      onAbort();
                      return;
                    }
                    if (!canSendNow) return;
                    onSend();
                  }}
                  disabled={!sendActive}
                >
                  <RNAnimated.View style={{ opacity: actionIconAnim, transform: [{ scale: actionIconAnim }] }}>
                    <Feather name={canAbortNow ? 'square' : 'arrow-up'} size={canAbortNow ? 14 : 18} color={sendIcon} />
                  </RNAnimated.View>
                </Pressable>
              </RNAnimated.View>
            ) : null}
          </View>

          <RNAnimated.View
            pointerEvents={idle ? 'auto' : 'none'}
            style={[
              modelSlotStyle,
              {
                height: BTN_HEIGHT,
                justifyContent: 'center',
                flexGrow: 0,
                flexShrink: 0
              }
            ]}
          >
            <View
              ref={modelBtnRef}
              collapsable={false}
              style={{
                width: MODEL_BTN_WIDTH,
                height: MODEL_BTN_WIDTH,
                borderRadius: MODEL_BTN_WIDTH / 2,
                backgroundColor: modelBg,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}
            >
              <Pressable
                onPress={openModelPicker}
                hitSlop={8}
                style={{
                  width: '100%',
                  height: '100%',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                accessibilityRole="button"
                accessibilityLabel={modelA11y}
              >
                <ProviderIcon
                  providerId={providerId}
                  size={26}
                  color={modelIconColor}
                  backgroundColor="transparent"
                  padded={false}
                />
              </Pressable>
            </View>
          </RNAnimated.View>
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
        inputModelLabel={inputModelLabel || selectedModel}
        modelOptions={modelOptions}
        selectedModel={selectedModel}
        onSelectModel={(id) => onSelectModel?.(id)}
        onOpenModelManager={() => onOpenModelManager?.()}
        open={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        anchor={modelAnchor}
      />
    </>
  );
});

export const ChatComposer = React.memo(ChatComposerImpl);
