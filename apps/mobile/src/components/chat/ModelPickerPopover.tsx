import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import { useMobileTheme } from '../../features/theme/ThemeProvider';
import { ProviderIcon } from '../ProviderIcon';
import { toText } from '../../lib/text';
import { closeModalAfterAnimation } from '../../lib/modalClose';

/**
 * 模型菜单：与展开后的模型选择器同宽、同色，向上浮出（分体卡片）。
 * 用 Modal 根节点与菜单实测高度算 top，避免 Dimensions/statusBar 错位撑大空隙。
 */
type ModelOption = { id: string; label: string; provider: string };
type Frame = { x: number; y: number; width: number; height: number };

const OPEN_MS = 220;
const CLOSE_MS = 160;
const FALLBACK_MENU_WIDTH = 220;
const MENU_RADIUS = 26;
/** 与按钮之间的分体间距（对齐上一版 git） */
const GAP_ABOVE_BUTTON = 8;

function shortModelLabel(label: string): string {
  const raw = toText(label).trim();
  if (!raw) return '模型';
  const s = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  return s.length > 28 ? `${s.slice(0, 26)}…` : s;
}

export function ModelPickerPopover(props: {
  modelOptions: ModelOption[];
  selectedModel: string;
  onSelectModel: (id: string) => void;
  open: boolean;
  onClose: () => void;
  anchor?: Frame | null;
  /** 与模型选择器同色底 */
  surfaceColor?: string;
  /** 与模型选择器图标/文字同色 */
  contentColor?: string;
}) {
  const {
    modelOptions,
    selectedModel,
    onSelectModel,
    open,
    onClose,
    anchor,
    surfaceColor,
    contentColor
  } = props;
  const { colors } = useMobileTheme();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const progress = useSharedValue(0);
  const rootRef = useRef<View>(null);
  const [rootFrame, setRootFrame] = useState<Frame | null>(null);
  const [menuHeight, setMenuHeight] = useState(0);

  const menuMaxHeight = Math.min(280, windowHeight * 0.42);

  const menuWidth = useMemo(() => {
    const w = Math.round(Number(anchor?.width || 0));
    if (w >= 48) return w;
    return FALLBACK_MENU_WIDTH;
  }, [anchor]);

  const measureRoot = useCallback(() => {
    rootRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        setRootFrame({ x, y, width, height });
      }
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setRootFrame(null);
      setMenuHeight(0);
      return;
    }
    measureRoot();
  }, [open, measureRoot, anchor]);

  const placement = useMemo(() => {
    if (!anchor) {
      return { right: 16, top: Math.max(24, windowHeight - 280), ready: true as const };
    }
    if (!rootFrame || menuHeight <= 0) {
      return { right: 16, top: 0, ready: false as const };
    }
    const right = Math.max(8, rootFrame.x + rootFrame.width - (anchor.x + anchor.width));
    const top = Math.round(anchor.y - rootFrame.y - menuHeight - GAP_ABOVE_BUTTON);
    return { right, top: Math.max(8, top), ready: true as const };
  }, [anchor, rootFrame, menuHeight, windowHeight]);

  // fallback：根节点未量到时仍用 window 公式，避免空白
  const fallbackBottom = useMemo(() => {
    if (!anchor) return 96;
    return Math.max(10, windowHeight - anchor.y + GAP_ABOVE_BUTTON);
  }, [anchor, windowHeight]);

  const fallbackRight = useMemo(() => {
    if (!anchor) return 16;
    return Math.max(10, windowWidth - (anchor.x + anchor.width));
  }, [anchor, windowWidth]);

  const startOpen = useCallback(() => {
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: OPEN_MS,
      easing: Easing.out(Easing.cubic)
    });
  }, [progress]);

  const startClose = useCallback(
    (cb: () => void) => {
      progress.value = withTiming(
        0,
        { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(cb)();
        }
      );
    },
    [progress]
  );

  useEffect(() => {
    if (open && (placement.ready || !anchor)) startOpen();
  }, [open, placement.ready, anchor, startOpen]);

  const handleClose = useCallback(() => {
    closeModalAfterAnimation(startClose, onClose, CLOSE_MS);
  }, [startClose, onClose]);

  const handleSelectModel = useCallback(
    (id: string) => {
      onSelectModel(id);
      closeModalAfterAnimation(startClose, onClose, CLOSE_MS);
    },
    [onSelectModel, startClose, onClose]
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP)
  }));

  const menuStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 1, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(progress.value, [0, 1], [12, 0], Extrapolation.CLAMP)
      }
    ]
  }));

  const sheetBg = surfaceColor || (colors.isDark ? '#FFFFFF' : '#1A1A1F');
  const fg = contentColor || (colors.isDark ? '#1A1A1F' : '#FFFFFF');
  const mutedFg = colors.isDark ? 'rgba(26,26,31,0.55)' : 'rgba(255,255,255,0.55)';
  const activeBg = colors.isDark ? 'rgba(26,26,31,0.08)' : 'rgba(255,255,255,0.12)';

  if (!open) return null;

  const useMeasured = placement.ready && !!anchor;

  return (
    <Modal transparent visible={open} animationType="none" statusBarTranslucent onRequestClose={handleClose}>
      <View ref={rootRef} style={styles.root} pointerEvents="box-none" onLayout={measureRoot}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} accessibilityLabel="关闭模型选择" />
        </Animated.View>

        <Animated.View
          style={[
            styles.menu,
            menuStyle,
            {
              width: menuWidth,
              backgroundColor: sheetBg,
              borderRadius: MENU_RADIUS,
              ...(useMeasured
                ? { right: placement.right, top: placement.top }
                : anchor
                  ? { right: fallbackRight, bottom: fallbackBottom, opacity: 0 }
                  : { right: fallbackRight, bottom: fallbackBottom }),
            }
          ]}
          onLayout={(e) => {
            const h = Math.ceil(e.nativeEvent.layout.height);
            if (h > 0 && h !== menuHeight) setMenuHeight(h);
          }}
        >
          <ScrollView
            style={{ maxHeight: menuMaxHeight }}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {modelOptions.map((opt) => {
              const active = selectedModel.trim() === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  style={[styles.item, active ? { backgroundColor: activeBg } : null]}
                  onPress={() => handleSelectModel(opt.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <ProviderIcon
                    providerId={opt.provider || opt.id}
                    size={18}
                    color={fg}
                    backgroundColor="transparent"
                    padded={false}
                  />
                  <Text numberOfLines={1} style={[styles.itemTitle, { color: fg }]}>
                    {shortModelLabel(opt.label || opt.id)}
                  </Text>
                  {active ? <View style={[styles.dot, { backgroundColor: fg }]} /> : null}
                </Pressable>
              );
            })}
            {modelOptions.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={[styles.empty, { color: mutedFg }]}>暂无可用模型</Text>
              </View>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.14)'
  },
  menu: {
    position: 'absolute',
    paddingTop: 6,
    paddingBottom: 6,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8
  },
  listContent: {
    paddingHorizontal: 6,
    gap: 2
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderRadius: 16,
    minHeight: 44
  },
  itemTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    includeFontPadding: false
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3
  },
  emptyWrap: {
    paddingVertical: 16,
    alignItems: 'center'
  },
  empty: {
    fontSize: 13,
    fontWeight: '500'
  }
});
