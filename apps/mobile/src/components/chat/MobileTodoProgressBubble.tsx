import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import type { MobileTodoCard } from '../../types';
import { toText } from '../../lib/text';
import { useMobileTheme } from '../../features/theme/ThemeProvider';

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
 * 生成中默认仅右上角进度气泡（如 0/1）；点击展开轻薄菜单，点空白收起。
 */
export const MobileTodoProgressBubble = React.memo(function MobileTodoProgressBubble(props: {
  card: MobileTodoCard;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onCollapse: () => void;
  styles: Record<string, any>;
}) {
  const { busy, card, expanded, onCollapse, onToggle, styles } = props;
  const { colors } = useMobileTheme();
  const meta = useMemo(() => todoMeta(card), [card]);
  const label = `${meta.done}/${meta.total || 0}`;
  const appearAnim = useRef(new Animated.Value(0)).current;
  const expandAnim = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const [menuMounted, setMenuMounted] = useState(expanded);

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
    if (expanded) {
      setMenuMounted(true);
      Animated.spring(expandAnim, {
        toValue: 1,
        stiffness: 280,
        damping: 22,
        mass: 0.8,
        useNativeDriver: true
      }).start();
      return;
    }
    Animated.timing(expandAnim, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) setMenuMounted(false);
    });
  }, [expandAnim, expanded]);

  const bubbleStyle = {
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
          outputRange: [0.82, 1]
        })
      }
    ]
  } as const;

  const menuStyle = {
    opacity: expandAnim,
    transform: [
      {
        translateY: expandAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [-8, 0]
        })
      },
      {
        scale: expandAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.94, 1]
        })
      }
    ]
  } as const;

  return (
    <View pointerEvents="box-none" style={styles.todoProgressBubbleRoot}>
      {menuMounted ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="收起进度"
          onPress={onCollapse}
          style={styles.todoProgressBubbleBackdrop}
        />
      ) : null}

      <Animated.View style={[styles.todoProgressBubbleAnchor, bubbleStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`进度 ${label}`}
          onPress={onToggle}
          style={[
            styles.todoProgressBubble,
            {
              backgroundColor: colors.card,
              borderColor: colors.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)'
            }
          ]}
        >
          <Text style={[styles.todoProgressBubbleText, { color: colors.muted }]}>{label}</Text>
        </Pressable>

        {menuMounted ? (
          <Animated.View
            pointerEvents={expanded ? 'auto' : 'none'}
            style={[
              styles.todoProgressMenuWrap,
              menuStyle,
              {
                backgroundColor: colors.card,
                borderColor: colors.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'
              }
            ]}
          >
            <View style={styles.todoProgressMenuHead}>
              <Text style={[styles.todoProgressMenuTitle, { color: colors.muted }]}>进度</Text>
              <Text style={[styles.todoProgressMenuCount, { color: colors.muted }]}>{label}</Text>
            </View>
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
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
});
