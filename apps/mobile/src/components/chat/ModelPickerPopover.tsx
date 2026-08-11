import React, { useCallback, useEffect, useMemo } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { Feather } from '@expo/vector-icons';
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
 * 轻薄模型菜单：锚定图标按钮右上，列出已开启模型。
 */
type ModelOption = { id: string; label: string; provider: string };

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const OPEN_MS = 220;
const CLOSE_MS = 160;
const MENU_WIDTH = 196;
const MENU_MAX_HEIGHT = Math.min(240, SCREEN_HEIGHT * 0.38);

function shortModelLabel(label: string): string {
  const raw = toText(label).trim();
  if (!raw) return '模型';
  const s = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  return s.length > 22 ? `${s.slice(0, 20)}…` : s;
}

export function ModelPickerPopover(props: {
  inputModelLabel?: string;
  modelOptions: ModelOption[];
  selectedModel: string;
  onSelectModel: (id: string) => void;
  onOpenModelManager: () => void;
  open: boolean;
  onClose: () => void;
  anchor?: { x: number; y: number; width: number; height: number } | null;
}) {
  const {
    modelOptions,
    selectedModel,
    onSelectModel,
    onOpenModelManager,
    open,
    onClose,
    anchor
  } = props;
  const { colors } = useMobileTheme();
  const progress = useSharedValue(0);

  const menuRight = useMemo(() => {
    if (!anchor) return 16;
    return Math.max(10, SCREEN_WIDTH - (anchor.x + anchor.width));
  }, [anchor]);

  const menuBottom = useMemo(() => {
    if (!anchor) return 96;
    return Math.max(10, SCREEN_HEIGHT - anchor.y + 6);
  }, [anchor]);

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
    if (open) startOpen();
  }, [open, startOpen]);

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

  const handleManager = useCallback(() => {
    closeModalAfterAnimation(startClose, onClose, CLOSE_MS, () => {
      onOpenModelManager();
    });
  }, [onOpenModelManager, startClose, onClose]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP)
  }));

  const menuStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.15, 1], [0, 1, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(progress.value, [0, 1], [10, 0], Extrapolation.CLAMP)
      },
      {
        scale: interpolate(progress.value, [0, 1], [0.96, 1], Extrapolation.CLAMP)
      }
    ]
  }));

  const sheetBg = colors.isDark ? 'rgba(40,40,44,0.96)' : 'rgba(255,255,255,0.97)';
  const borderColor = colors.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)';
  const activeBg = colors.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.045)';
  const iconColor = colors.isDark ? '#F2F2F2' : '#171717';

  if (!open) return null;

  return (
    <Modal transparent visible={open} animationType="none" statusBarTranslucent onRequestClose={handleClose}>
      <View style={styles.root} pointerEvents="box-none">
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} accessibilityLabel="关闭模型选择" />
        </Animated.View>

        <Animated.View
          style={[
            styles.menu,
            menuStyle,
            {
              width: MENU_WIDTH,
              right: menuRight,
              bottom: menuBottom,
              backgroundColor: sheetBg,
              borderColor
            }
          ]}
        >
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: colors.muted }]}>已开启</Text>
            <Pressable onPress={handleManager} hitSlop={10} accessibilityLabel="管理模型开关">
              <Feather name="settings" size={12} color={colors.muted} />
            </Pressable>
          </View>

          <ScrollView
            style={{ maxHeight: MENU_MAX_HEIGHT - 28 }}
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
                    size={13}
                    color={iconColor}
                    backgroundColor="transparent"
                  />
                  <Text numberOfLines={1} style={[styles.itemTitle, { color: colors.text }]}>
                    {shortModelLabel(opt.label || opt.id)}
                  </Text>
                  {active ? <View style={[styles.dot, { backgroundColor: colors.text }]} /> : null}
                </Pressable>
              );
            })}
            {modelOptions.length === 0 ? (
              <Pressable onPress={handleManager} style={styles.emptyWrap}>
                <Text style={[styles.empty, { color: colors.muted }]}>去开启模型</Text>
              </Pressable>
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
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
    paddingBottom: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 24
  },
  headerTitle: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3
  },
  listContent: {
    paddingHorizontal: 4,
    gap: 1
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 10,
    minHeight: 36
  },
  itemTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    includeFontPadding: false
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5
  },
  emptyWrap: {
    paddingVertical: 14,
    alignItems: 'center'
  },
  empty: {
    fontSize: 12,
    fontWeight: '500'
  }
});
