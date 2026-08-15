import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Platform,
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
 * 模型菜单：与展开后的模型选择器同宽、同色，向上弹出（分体卡片）。
 *
 * 不用 Modal（Android 上与 measureInWindow 差状态栏）。
 * 同窗口绝对层：先量宿主偏移铺满 window，再按 anchor 算 top。
 * 所有测量只锁定一次，避免 onLayout/measure 回写造成上下抖。
 */
type ModelOption = { id: string; label: string; provider: string };
type Pt = { x: number; y: number };

const OPEN_MS = 220;
const CLOSE_MS = 160;
const FALLBACK_MENU_WIDTH = 220;
const MENU_RADIUS = 26;
const GAP_ABOVE_BUTTON = 6;

function shortModelLabel(label: string): string {
  const raw = toText(label).trim();
  if (!raw) return '模型';
  const s = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  return s.length > 28 ? `${s.slice(0, 26)}…` : s;
}

/** 同名模型跨供应商时加 provider 前缀，避免选择器看起来「只有一个」。 */
function pickerModelLabel(opt: ModelOption, duplicateShortLabels: Set<string>): string {
  const short = shortModelLabel(opt.label || opt.id);
  const provider = toText(opt.provider).trim();
  if (provider && duplicateShortLabels.has(short)) {
    const prefix = provider.includes('.') ? provider.slice(provider.lastIndexOf('.') + 1) : provider;
    return `${prefix}/${short}`;
  }
  return short;
}

export function ModelPickerPopover(props: {
  inputModelLabel?: string;
  modelOptions: ModelOption[];
  selectedModel: string;
  onSelectModel: (id: string) => void;
  onOpenModelManager?: () => void;
  open: boolean;
  onClose: () => void;
  anchor?: { x: number; y: number; width: number; height: number } | null;
  surfaceColor?: string;
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
  const hostRef = useRef<View>(null);
  const shiftLocked = useRef(false);
  const originLocked = useRef(false);
  const heightLocked = useRef(false);
  const openedAnim = useRef(false);

  const [shift, setShift] = useState<Pt | null>(null);
  const [origin, setOrigin] = useState<Pt | null>(null);
  const [menuHeight, setMenuHeight] = useState(0);

  const menuMaxHeight = Math.min(280, windowHeight * 0.42);

  const menuWidth = useMemo(() => {
    const w = Math.round(Number(anchor?.width || 0));
    if (w >= 48) return w;
    return FALLBACK_MENU_WIDTH;
  }, [anchor]);

  const duplicateShortLabels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const opt of modelOptions) {
      const short = shortModelLabel(opt.label || opt.id);
      counts.set(short, (counts.get(short) || 0) + 1);
    }
    const dup = new Set<string>();
    for (const [label, count] of counts) {
      if (count > 1) dup.add(label);
    }
    return dup;
  }, [modelOptions]);

  const positioned = Boolean(anchor && origin && menuHeight > 0);

  const menuLeft = useMemo(() => {
    if (!anchor || !origin) return 16;
    return Math.round(anchor.x - origin.x);
  }, [anchor, origin]);

  const menuTop = useMemo(() => {
    if (!anchor || !origin || menuHeight <= 0) return 0;
    return Math.max(8, Math.round(anchor.y - origin.y - menuHeight - GAP_ABOVE_BUTTON));
  }, [anchor, origin, menuHeight]);

  const resetLocks = useCallback(() => {
    shiftLocked.current = false;
    originLocked.current = false;
    heightLocked.current = false;
    openedAnim.current = false;
    setShift(null);
    setOrigin(null);
    setMenuHeight(0);
    progress.value = 0;
  }, [progress]);

  const onHostLayout = useCallback(() => {
    if (!hostRef.current) return;
    if (!shiftLocked.current) {
      shiftLocked.current = true;
      hostRef.current.measureInWindow((x, y) => {
        setShift({ x: Math.round(x), y: Math.round(y) });
      });
      return;
    }
    if (!originLocked.current && shift) {
      originLocked.current = true;
      hostRef.current.measureInWindow((x, y) => {
        setOrigin({ x: Math.round(x), y: Math.round(y) });
      });
    }
  }, [shift]);

  const onMenuLayout = useCallback((h: number) => {
    if (heightLocked.current || h <= 0) return;
    heightLocked.current = true;
    setMenuHeight(Math.ceil(h));
  }, []);

  const startOpen = useCallback(() => {
    if (openedAnim.current) return;
    openedAnim.current = true;
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
    if (!open) resetLocks();
  }, [open, resetLocks]);

  useEffect(() => {
    if (open && positioned) startOpen();
  }, [open, positioned, startOpen]);

  const handleClose = useCallback(() => {
    closeModalAfterAnimation(startClose, onClose, CLOSE_MS);
  }, [startClose, onClose]);

  useEffect(() => {
    if (!open || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => sub.remove();
  }, [open, handleClose]);

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
        translateY: interpolate(progress.value, [0, 1], [10, 0], Extrapolation.CLAMP)
      }
    ]
  }));

  const sheetBg = surfaceColor || (colors.isDark ? '#FFFFFF' : '#1A1A1F');
  const fg = contentColor || (colors.isDark ? '#1A1A1F' : '#FFFFFF');
  const mutedFg = colors.isDark ? 'rgba(26,26,31,0.55)' : 'rgba(255,255,255,0.55)';
  const activeBg = colors.isDark ? 'rgba(26,26,31,0.08)' : 'rgba(255,255,255,0.12)';

  if (!open) return null;

  return (
    <View
      ref={hostRef}
      collapsable={false}
      pointerEvents="box-none"
      onLayout={onHostLayout}
      style={[
        styles.host,
        shift
          ? {
              top: -shift.y,
              left: -shift.x,
              width: windowWidth,
              height: windowHeight
            }
          : styles.hostPending
      ]}
    >
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} accessibilityLabel="关闭模型选择" />
      </Animated.View>

      <Animated.View
        style={[
          styles.menu,
          menuStyle,
          {
            width: menuWidth,
            left: menuLeft,
            top: positioned ? menuTop : -9999,
            backgroundColor: sheetBg,
            borderRadius: MENU_RADIUS
          }
        ]}
        onLayout={(e) => onMenuLayout(e.nativeEvent.layout.height)}
      >
        <ScrollView
          style={{ maxHeight: menuMaxHeight }}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          scrollEventThrottle={16}
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
                  {pickerModelLabel(opt, duplicateShortLabels)}
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
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    zIndex: 10000,
    elevation: 10000
  },
  hostPending: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0
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
