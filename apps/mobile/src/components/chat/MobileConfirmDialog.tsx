import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { useMobileTheme } from '../../features/theme/ThemeProvider';
import { closeModalAfterAnimation } from '../../lib/modalClose';

type MobileConfirmDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel?: string;
  confirmLabel?: string;
  /** 危险操作（归档等）用强调色确认钮 */
  destructive?: boolean;
  /** 仅提示：只显示一个关闭按钮 */
  noticeOnly?: boolean;
  onCancel: () => void;
  onConfirm?: () => void;
};

const OPEN_MS = 240;
const CLOSE_MS = 180;

/**
 * 应用内确认/提示浮层，替代系统 Alert，跟抽屉中性色板与动效一致。
 */
export function MobileConfirmDialog(props: MobileConfirmDialogProps) {
  const {
    visible,
    title,
    message,
    cancelLabel = '取消',
    confirmLabel = '确认',
    destructive = false,
    noticeOnly = false,
    onCancel,
    onConfirm
  } = props;
  const { colors } = useMobileTheme();
  const dark = colors.isDark;
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      closingRef.current = false;
      setMounted(true);
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }).start();
      return;
    }
    if (!mounted || closingRef.current) return;
    closingRef.current = true;
    closeModalAfterAnimation(
      (onFinished) => {
        Animated.timing(progress, {
          toValue: 0,
          duration: CLOSE_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true
        }).start(({ finished }) => {
          if (finished) onFinished();
        });
      },
      () => {
        closingRef.current = false;
        setMounted(false);
      },
      CLOSE_MS
    );
  }, [mounted, progress, visible]);

  if (!mounted) return null;

  const cardBg = dark ? '#2A2A2E' : '#FFFFFF';
  const text = dark ? '#EDEDF0' : '#1A1A1F';
  const muted = dark ? '#A8A8B3' : '#5C5C66';
  const line = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
  const softBtn = dark ? '#3A3A40' : '#F0F0F3';
  const softBtnText = text;
  const dangerBg = '#E3484F';
  const primaryBg = dark ? '#EDEDF0' : '#1A1A1F';
  const primaryText = dark ? '#1A1A1F' : '#FFFFFF';

  const backdropStyle = {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] })
  };
  const cardStyle = {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
    transform: [
      {
        scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] })
      },
      {
        translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] })
      }
    ]
  };

  const requestClose = () => {
    if (closingRef.current) return;
    onCancel();
  };

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      <View style={styles.root} pointerEvents="box-none">
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭对话框"
            style={StyleSheet.absoluteFill}
            onPress={requestClose}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: cardBg,
              borderColor: line,
              shadowColor: '#000'
            },
            cardStyle
          ]}
        >
          <Text style={[styles.title, { color: text }]}>{title}</Text>
          <Text style={[styles.message, { color: muted }]}>{message}</Text>

          <View style={styles.actions}>
            {noticeOnly ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={confirmLabel}
                onPress={requestClose}
                style={[styles.btn, styles.btnGrow, { backgroundColor: primaryBg }]}
              >
                <Text style={[styles.btnText, { color: primaryText }]}>{confirmLabel}</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={cancelLabel}
                  onPress={requestClose}
                  style={[styles.btn, styles.btnGrow, { backgroundColor: softBtn }]}
                >
                  <Text style={[styles.btnText, { color: softBtnText }]}>{cancelLabel}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={confirmLabel}
                  onPress={() => {
                    if (closingRef.current) return;
                    onConfirm?.();
                  }}
                  style={[
                    styles.btn,
                    styles.btnGrow,
                    { backgroundColor: destructive ? dangerBg : primaryBg }
                  ]}
                >
                  <Text
                    style={[
                      styles.btnText,
                      { color: destructive ? '#FFFFFF' : primaryText }
                    ]}
                  >
                    {confirmLabel}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)'
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 22,
    paddingHorizontal: 20,
    paddingBottom: 16,
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 8
  },
  message: {
    fontSize: 14.5,
    lineHeight: 21,
    marginBottom: 20
  },
  actions: {
    flexDirection: 'row',
    gap: 10
  },
  btn: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14
  },
  btnGrow: {
    flex: 1
  },
  btnText: {
    fontSize: 15.5,
    fontWeight: '600'
  }
});
