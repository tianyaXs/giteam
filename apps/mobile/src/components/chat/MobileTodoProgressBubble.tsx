import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import Reanimated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import type { MobileTodoCard } from '../../types';
import { toText } from '../../lib/text';
import { useMobileTheme } from '../../features/theme/ThemeProvider';

const COLLAPSED_H = 32;
const EXPANDED_W = 248;
const MORPH_MS = 280;

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

function estimateMenuHeight(itemCount: number) {
  // head ~34 + rows ~26 + padding；滚动区上限约 220
  return Math.min(42 + 8 + Math.max(1, itemCount) * 26 + 10, 42 + 220 + 10);
}

function StatusDot(props: {
  status: MobileTodoCard['items'][number]['status'];
  busy: boolean;
  colors: { muted: string; text: string; border: string; card: string };
}) {
  const { busy, colors, status } = props;
  const done = status === 'completed';
  const running = status === 'in_progress';
  const cancelled = status === 'cancelled';
  return (
    <View
      style={{
        width: 14,
        height: 14,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: done || running ? colors.muted : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: cancelled ? 0.45 : 1
      }}
    >
      {done ? (
        <Text style={{ color: colors.card, fontSize: 9, fontWeight: '700', lineHeight: 11 }}>✓</Text>
      ) : running ? (
        <View
          style={{
            width: 4,
            height: 4,
            borderRadius: 999,
            backgroundColor: colors.card,
            opacity: busy ? 1 : 0.85
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * 进度胶囊：点击后同一外壳 morph 成任务菜单（宽高/圆角插值 + 内容交叉淡入）。
 */
export const MobileTodoProgressBubble = React.memo(function MobileTodoProgressBubble(props: {
  card: MobileTodoCard;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onCollapse: () => void;
  styles: Record<string, any>;
  /** 专注模式等场景下覆盖根定位（如 top） */
  rootStyle?: object;
}) {
  const { busy, card, expanded, onCollapse, onToggle, rootStyle, styles } = props;
  const { colors } = useMobileTheme();
  const meta = useMemo(() => todoMeta(card), [card]);
  const label = `${meta.done}/${meta.total || 0}`;
  const appearAnim = useRef(new Animated.Value(0)).current;

  const expand = useSharedValue(expanded ? 1 : 0);
  const collapsedW = useSharedValue(56);
  const expandedH = useSharedValue(estimateMenuHeight(meta.total));
  const [menuPresent, setMenuPresent] = useState(expanded);

  useEffect(() => {
    appearAnim.setValue(0);
    Animated.spring(appearAnim, {
      toValue: 1,
      stiffness: 260,
      damping: 20,
      mass: 0.75,
      useNativeDriver: true
    }).start();
  }, [appearAnim, card.id]);

  useEffect(() => {
    expandedH.value = Math.max(expandedH.value, estimateMenuHeight(meta.total));
  }, [expandedH, meta.total]);

  useEffect(() => {
    if (expanded) setMenuPresent(true);
    expand.value = withTiming(
      expanded ? 1 : 0,
      { duration: MORPH_MS, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished && !expanded) {
          runOnJS(setMenuPresent)(false);
        }
      }
    );
  }, [expand, expanded]);

  const shellStyle = {
    opacity: appearAnim,
    transform: [
      {
        translateY: appearAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [-10, 0]
        })
      },
      {
        scale: appearAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.86, 1]
        })
      }
    ]
  } as const;

  const shellChrome = {
    backgroundColor: colors.card,
    borderColor: colors.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)'
  };

  const morphShellStyle = useAnimatedStyle(() => {
    const width = interpolate(expand.value, [0, 1], [collapsedW.value, EXPANDED_W]);
    const height = interpolate(expand.value, [0, 1], [COLLAPSED_H, expandedH.value]);
    const borderRadius = interpolate(expand.value, [0, 1], [999, 16]);
    return {
      width,
      height,
      borderRadius,
      overflow: 'hidden' as const
    };
  });

  const collapsedLayerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expand.value, [0, 0.45, 1], [1, 0.15, 0]),
    transform: [{ scale: interpolate(expand.value, [0, 1], [1, 0.9]) }]
  }));

  const menuLayerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expand.value, [0, 0.35, 1], [0, 0.55, 1]),
    transform: [
      { translateY: interpolate(expand.value, [0, 1], [-8, 0]) },
      { scale: interpolate(expand.value, [0, 1], [0.96, 1]) }
    ]
  }));

  const backdropAnimStyle = useAnimatedStyle(() => ({
    opacity: expand.value
  }));

  return (
    <Reanimated.View pointerEvents="box-none" style={[styles.todoProgressBubbleRoot, rootStyle]}>
      {menuPresent ? (
        <Reanimated.View
          pointerEvents={expanded ? 'auto' : 'none'}
          style={[styles.todoProgressBubbleBackdrop, backdropAnimStyle]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="收起进度"
            onPress={onCollapse}
            style={StyleSheet.absoluteFill}
          />
        </Reanimated.View>
      ) : null}

      <Animated.View style={[styles.todoProgressBubbleAnchor, shellStyle]}>
        <Reanimated.View style={[styles.todoProgressMorphShell, shellChrome, morphShellStyle]}>
          <Reanimated.View
            pointerEvents={expanded ? 'none' : 'auto'}
            style={[styles.todoProgressCollapsedLayer, collapsedLayerStyle]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`进度 ${label}`}
              onPress={onToggle}
              onLayout={(evt) => {
                if (expanded) return;
                const w = Math.ceil(evt.nativeEvent.layout.width);
                if (w > 0 && Math.abs(w - collapsedW.value) > 1) {
                  collapsedW.value = Math.max(40, w);
                }
              }}
              style={[styles.todoProgressBubble, shellChrome, styles.todoProgressBubbleInMorph]}
            >
              <Text style={[styles.todoProgressBubbleText, { color: colors.muted }]}>{label}</Text>
            </Pressable>
          </Reanimated.View>

          {menuPresent ? (
            <Reanimated.View
              pointerEvents={expanded ? 'auto' : 'none'}
              style={[styles.todoProgressMenuLayer, menuLayerStyle]}
            >
              <View
                style={[styles.todoProgressMorphMenu, styles.todoProgressMorphMenuInShell]}
                onLayout={(evt) => {
                  const h = Math.ceil(evt.nativeEvent.layout.height);
                  if (h > 0 && Math.abs(h - expandedH.value) > 1) {
                    expandedH.value = h;
                  }
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="收起进度菜单"
                  onPress={onToggle}
                  style={styles.todoProgressMenuHead}
                >
                  <Text style={[styles.todoProgressMenuTitle, { color: colors.muted }]}>进度</Text>
                  <Text style={[styles.todoProgressMenuCount, { color: colors.muted }]}>{label}</Text>
                </Pressable>
                <ScrollView
                  style={styles.todoProgressMenuScroll}
                  contentContainerStyle={styles.todoProgressMenuScrollContent}
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                >
                  {card.items.map((item) => {
                    const current = meta.active?.id === item.id && item.status !== 'completed';
                    return (
                      <View key={item.id} style={styles.todoProgressMenuRow}>
                        <StatusDot status={item.status} busy={busy} colors={colors} />
                        <Text
                          numberOfLines={2}
                          style={[
                            styles.todoProgressMenuRowText,
                            { color: current ? colors.text : colors.muted }
                          ]}
                        >
                          {toText(item.content)}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            </Reanimated.View>
          ) : null}
        </Reanimated.View>
      </Animated.View>
    </Reanimated.View>
  );
});
