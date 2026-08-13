import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import { useMobileTheme } from '../features/theme/ThemeProvider';
import {
  describePermissionInteraction,
  type AgentPermissionReply,
  type PermissionInteraction
} from '../lib/agentPermissions';

type Props = {
  request: PermissionInteraction;
  submitState?: 'idle' | 'submitting' | 'submitted' | 'failed';
  submitError?: string;
  onReply: (requestId: string, reply: AgentPermissionReply) => void;
};

export function PermissionDock({
  request,
  submitState = 'idle',
  submitError,
  onReply
}: Props) {
  const { colors } = useMobileTheme();
  const view = describePermissionInteraction(request);
  const locked = submitState === 'submitting' || submitState === 'submitted';

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          backgroundColor: colors.card,
          borderRadius: 12,
          marginHorizontal: 12,
          marginBottom: 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          ...Platform.select({
            ios: {
              shadowColor: '#000000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: colors.isDark ? 0.4 : 0.08,
              shadowRadius: 8
            },
            android: { elevation: 3 },
            default: {}
          })
        },
        header: {
          paddingHorizontal: 14,
          paddingTop: 12,
          paddingBottom: 8
        },
        title: {
          fontSize: 14,
          fontWeight: '600',
          color: colors.text
        },
        subtitle: {
          marginTop: 4,
          fontSize: 12,
          color: colors.muted,
          lineHeight: 17
        },
        targetBox: {
          marginHorizontal: 14,
          marginBottom: 12,
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderRadius: 8,
          backgroundColor: colors.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'
        },
        targetText: {
          fontSize: 12,
          lineHeight: 17,
          color: colors.text,
          fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })
        },
        actions: {
          flexDirection: 'row',
          gap: 8,
          paddingHorizontal: 14,
          paddingBottom: 12
        },
        btn: {
          flex: 1,
          minHeight: 36,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 8
        },
        btnGhost: {
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          backgroundColor: 'transparent'
        },
        btnPrimary: {
          backgroundColor: colors.primary
        },
        btnDanger: {
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          backgroundColor: 'transparent'
        },
        btnText: {
          fontSize: 13,
          fontWeight: '600'
        },
        btnTextPrimary: {
          color: '#fff'
        },
        btnTextMuted: {
          color: colors.text
        },
        error: {
          marginHorizontal: 14,
          marginBottom: 10,
          fontSize: 12,
          color: '#d94848'
        },
        statusRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 14,
          paddingBottom: 12
        },
        statusText: {
          fontSize: 12,
          color: colors.muted
        }
      }),
    [colors]
  );

  const riskLabel = view.risk ? ` · ${view.risk}` : '';

  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={styles.header}>
        <Text style={styles.title}>需要批准工具</Text>
        <Text style={styles.subtitle}>
          {view.tool}
          {riskLabel}
          {' — 手机发起的会话需在此批准，否则会一直等到超时。'}
        </Text>
      </View>
      {view.target ? (
        <View style={styles.targetBox}>
          <Text style={styles.targetText} numberOfLines={6}>
            {view.target}
          </Text>
        </View>
      ) : null}
      {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
      {locked ? (
        <View style={styles.statusRow}>
          {submitState === 'submitting' ? <ActivityIndicator size="small" color={colors.muted} /> : null}
          <Text style={styles.statusText}>
            {submitState === 'submitted' ? '已提交' : '提交中…'}
          </Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="拒绝"
            disabled={locked}
            onPress={() => onReply(request.id, 'reject')}
            style={[styles.btn, styles.btnDanger]}
          >
            <Text style={[styles.btnText, styles.btnTextMuted]}>拒绝</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="允许一次"
            disabled={locked}
            onPress={() => onReply(request.id, 'once')}
            style={[styles.btn, styles.btnGhost]}
          >
            <Text style={[styles.btnText, styles.btnTextMuted]}>允许一次</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="始终允许"
            disabled={locked}
            onPress={() => onReply(request.id, 'always')}
            style={[styles.btn, styles.btnPrimary]}
          >
            <Text style={[styles.btnText, styles.btnTextPrimary]}>始终允许</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
