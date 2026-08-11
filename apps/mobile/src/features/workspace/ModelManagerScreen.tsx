import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { createMobileAgentClient } from '../../api/agent/client';
import type { AgentProviderInfo, MobileModelState } from '../../api/agent/types';
import { useMobileTheme } from '../../features/theme/ThemeProvider';
import { toText } from '../../lib/text';
import { MobileSwitch } from '../../components/ui/Switch';
import { ProviderIcon } from '../../components/ProviderIcon';
import { AccordionBody, AccordionChevron } from '../../components/AccordionBody';

/**
 * 模型开关列表：与桌面同一真相源（enabledModels/hiddenModels）。
 * 供应商默认收起，展开动效与项目树共用 AccordionBody。
 */

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  gemini: 'Google',
  xai: 'xAI',
  openrouter: 'OpenRouter',
  'kimi-for-coding': 'Kimi',
  'kimi-coding': 'Kimi',
  kimi: 'Kimi',
  deepseek: 'DeepSeek',
  moonshotai: 'Moonshot',
  'moonshotai-cn': 'Moonshot',
  zhipuai: '智谱',
  alibaba: '通义',
  groq: 'Groq',
  mistral: 'Mistral',
  azure: 'Azure',
  'openai-codex': 'OpenAI Codex',
  zai: 'Z.ai'
};

function providerLabel(p: string): string {
  return PROVIDER_LABELS[p] || p;
}

type GroupedModel = { ref: string; label: string };
type ProviderGroup = { key: string; models: GroupedModel[] };

export function SettingsModelsPanel(props: {
  active: boolean;
  serverUrl: string;
  token: string;
  onChanged: () => void;
}) {
  const { active, serverUrl, token, onChanged } = props;
  const { colors } = useMobileTheme();
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const client = useMemo(
    () => createMobileAgentClient({ baseUrl: serverUrl, token }),
    [serverUrl, token]
  );

  const load = useCallback(async () => {
    if (!serverUrl) return;
    setLoading(true);
    try {
      const [providers, state] = await Promise.all([
        client.listProviders().catch(() => [] as AgentProviderInfo[]),
        client.getMobileModelState().catch(() => null)
      ]);
      const grouped = new Map<string, GroupedModel[]>();
      for (const p of (providers as AgentProviderInfo[]) || []) {
        if (!p.hasCredential) continue;
        if (!grouped.has(p.provider)) grouped.set(p.provider, []);
        const arr = grouped.get(p.provider)!;
        for (const m of Array.isArray(p.models) ? p.models : []) {
          arr.push({
            ref: `${p.provider}/${m.modelId}`,
            label: toText(m.name) || m.modelId
          });
        }
      }
      setGroups(Array.from(grouped.entries()).map(([key, models]) => ({ key, models })));
      setExpanded(new Set());
      const s = (state || {}) as MobileModelState;
      setEnabled(new Set(Array.isArray(s.enabledModels) ? s.enabledModels : []));
      setHidden(new Set(Array.isArray(s.hiddenModels) ? s.hiddenModels : []));
    } catch {
      // 保留旧数据
    } finally {
      setLoading(false);
    }
  }, [client, serverUrl]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggle = useCallback(
    async (ref: string, next: boolean) => {
      const prevEnabled = enabled;
      const prevHidden = hidden;
      const nextEnabled = new Set(prevEnabled);
      const nextHidden = new Set(prevHidden);
      if (next) {
        nextEnabled.add(ref);
        nextHidden.delete(ref);
      } else {
        nextEnabled.delete(ref);
      }
      setEnabled(nextEnabled);
      setHidden(nextHidden);
      setBusyRef(ref);
      try {
        await client.setMobileModelVisibility({
          enabledModels: Array.from(nextEnabled),
          hiddenModels: Array.from(nextHidden)
        });
        onChanged();
      } catch {
        setEnabled(prevEnabled);
        setHidden(prevHidden);
      } finally {
        setBusyRef(null);
      }
    },
    [client, enabled, hidden, onChanged]
  );

  if (loading && groups.length === 0) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.hint, { color: colors.muted }]}>
        打开后会出现在聊天的模型选择器中，变更会同步到桌面端。
      </Text>
      {groups.map((group) => {
        const isOpen = expanded.has(group.key);
        const enabledCount = group.models.filter((m) => enabled.has(m.ref)).length;
        return (
          <View key={group.key} style={[styles.card, { backgroundColor: colors.card }]}>
            <Pressable onPress={() => toggleExpand(group.key)}>
              <View style={styles.providerRow}>
                <ProviderIcon
                  providerId={group.key}
                  size={16}
                  color={colors.text}
                  backgroundColor={colors.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}
                />
                <Text style={[styles.providerTitle, { color: colors.text }]} numberOfLines={1}>
                  {providerLabel(group.key)}
                </Text>
                <Text style={[styles.providerCount, { color: colors.muted }]}>
                  {enabledCount}/{group.models.length}
                </Text>
                <AccordionChevron expanded={isOpen} color={colors.muted} />
              </View>
            </Pressable>
            <AccordionBody open={isOpen}>
              {group.models.map((m) => {
                const isOn = enabled.has(m.ref);
                return (
                  <View key={m.ref} style={[styles.modelRow, { borderTopColor: colors.border }]}>
                    <Text style={[styles.modelLabel, { color: colors.text }]} numberOfLines={1}>
                      {m.label}
                    </Text>
                    <MobileSwitch
                      value={isOn}
                      onValueChange={(next) => void toggle(m.ref, next)}
                      disabled={busyRef === m.ref}
                    />
                  </View>
                );
              })}
            </AccordionBody>
          </View>
        );
      })}
      {groups.length === 0 ? (
        <Text style={[styles.empty, { color: colors.muted }]}>暂无已连接的供应商模型</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 32
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 48
  },
  hint: {
    fontSize: 12,
    marginBottom: 8,
    lineHeight: 18
  },
  card: {
    marginBottom: 10,
    borderRadius: 12,
    overflow: 'hidden'
  },
  providerRow: {
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center'
  },
  providerTitle: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
    fontWeight: '600'
  },
  providerCount: {
    fontSize: 12,
    marginRight: 8
  },
  // 与供应商标题左缘对齐：行内边距 12 + 图标槽 24 + 标题间距 10
  modelRow: {
    minHeight: 48,
    paddingLeft: 46,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth
  },
  modelLabel: {
    flex: 1,
    fontSize: 15,
    marginRight: 12
  },
  empty: {
    fontSize: 14,
    paddingTop: 40,
    textAlign: 'center'
  }
});
