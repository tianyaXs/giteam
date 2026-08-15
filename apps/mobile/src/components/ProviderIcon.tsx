import React, { useMemo } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { PROVIDER_ICON_XML, type ProviderIconName } from '../lib/provider-icons.generated';

const PROVIDER_ICON_ALIASES: Record<string, ProviderIconName> = {
  'azure-openai-responses': 'azure',
  fireworks: 'fireworks-ai',
  'kimi-coding': 'kimi-for-coding',
  kimi: 'kimi-for-coding',
  moonshot: 'moonshotai',
  'moonshot-cn': 'moonshotai-cn',
  gemini: 'google',
  'google-ai': 'google',
  together: 'togetherai',
  zhipu: 'zhipuai',
  glm: 'zhipuai',
  // Z.ai 与智谱同源品牌线，复用 zhipuai 图标以区别于 openai-compatible.* 自定义源
  zai: 'zhipuai',
  'z.ai': 'zhipuai',
  qwen: 'alibaba',
  dashscope: 'alibaba'
};

type ProviderIconProps = {
  providerId: string;
  size?: number;
  color?: string;
  backgroundColor?: string;
  /** 为 false 时不加外围留白，适合小圆形按钮内放大图标 */
  padded?: boolean;
};

export function ProviderIcon(props: ProviderIconProps) {
  const {
    providerId,
    size = 16,
    color = '#171717',
    backgroundColor = 'transparent',
    padded = true
  } = props;

  const iconName = useMemo(() => resolveProviderIconName(providerId), [providerId]);
  const xml = PROVIDER_ICON_XML[iconName].replace(/#171717/g, color);
  const box = padded ? size + 8 : size;

  return (
    <View
      style={{
        width: box,
        height: box,
        borderRadius: padded ? 8 : 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor
      }}
    >
      <SvgXml xml={xml} width={size} height={size} />
    </View>
  );
}

function resolveProviderIconName(providerId: string): ProviderIconName {
  const candidates = providerIdCandidates(providerId);
  for (const id of candidates) {
    if (isProviderIconName(id)) return id;
    const alias = PROVIDER_ICON_ALIASES[id];
    if (alias) return alias;
  }
  // 自定义 / 未知供应商：沿用 synthetic 星标
  return 'synthetic';
}

/** 展开 openai-compatible.indemind → [full, indemind, openai-compatible] 供别名/图标匹配。 */
function providerIdCandidates(providerId: string): string[] {
  const id = (providerId || '').trim().toLowerCase();
  if (!id) return [];
  const out: string[] = [id];
  if (id.startsWith('openai-compatible.')) {
    const suffix = id.slice('openai-compatible.'.length).trim();
    if (suffix) out.push(suffix);
    out.push('openai-compatible');
  }
  const normalized = id
    .replace(/-openai-responses$/, '')
    .replace(/-ai-gateway$/, '')
    .replace(/-coding-plan$/, '')
    .replace(/-token-plan-(cn|ams|sgp)$/, '');
  if (normalized && normalized !== id) out.push(normalized);
  return out;
}

function isProviderIconName(value: string): value is ProviderIconName {
  return Object.prototype.hasOwnProperty.call(PROVIDER_ICON_XML, value);
}
