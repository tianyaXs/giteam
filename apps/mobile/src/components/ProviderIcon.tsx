import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
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

const MONOGRAM_PALETTE = [
  '#2563EB',
  '#7C3AED',
  '#DB2777',
  '#DC2626',
  '#EA580C',
  '#CA8A04',
  '#16A34A',
  '#0D9488',
  '#0891B2',
  '#4F46E5'
];

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

  const resolved = useMemo(() => resolveProviderVisual(providerId), [providerId]);
  const box = padded ? size + 8 : size;

  if (resolved.kind === 'svg') {
    const xml = PROVIDER_ICON_XML[resolved.name].replace(/#171717/g, color);
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

  // 自定义 openai-compatible.* / 未知供应商：用首字母色块区分，避免全落成同一颗 synthetic 星
  const fontSize = Math.max(9, Math.round(size * 0.55));
  return (
    <View
      style={{
        width: box,
        height: box,
        borderRadius: padded ? 8 : size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: backgroundColor === 'transparent' ? resolved.bg : backgroundColor
      }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: resolved.bg
        }}
      >
        <Text style={{ color: '#FFFFFF', fontSize, fontWeight: '700', lineHeight: fontSize + 1 }}>
          {resolved.letter}
        </Text>
      </View>
    </View>
  );
}

type ProviderVisual =
  | { kind: 'svg'; name: ProviderIconName }
  | { kind: 'monogram'; letter: string; bg: string };

function resolveProviderVisual(providerId: string): ProviderVisual {
  const candidates = providerIdCandidates(providerId);
  for (const id of candidates) {
    if (isProviderIconName(id)) return { kind: 'svg', name: id };
    const alias = PROVIDER_ICON_ALIASES[id];
    if (alias) return { kind: 'svg', name: alias };
  }
  const label = customProviderLabel(providerId);
  return {
    kind: 'monogram',
    letter: monogramLetter(label),
    bg: monogramColor(label)
  };
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

function customProviderLabel(providerId: string): string {
  const id = (providerId || '').trim();
  if (!id) return '?';
  if (id.toLowerCase().startsWith('openai-compatible.')) {
    return id.slice('openai-compatible.'.length) || id;
  }
  const slash = id.indexOf('/');
  if (slash > 0) return id.slice(0, slash);
  return id;
}

function monogramLetter(label: string): string {
  const cleaned = label.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '');
  if (!cleaned) return '?';
  // 中文取首字；英文取首字母大写
  const ch = cleaned[0]!;
  if (/[\u4e00-\u9fff]/.test(ch)) return ch;
  return ch.toUpperCase();
}

function monogramColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return MONOGRAM_PALETTE[hash % MONOGRAM_PALETTE.length]!;
}

function isProviderIconName(value: string): value is ProviderIconName {
  return Object.prototype.hasOwnProperty.call(PROVIDER_ICON_XML, value);
}
