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
  const xml = useMemo(() => {
    const name = resolveProviderIconName(providerId);
    return PROVIDER_ICON_XML[name].replace(/#171717/g, color);
  }, [color, providerId]);

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
  const id = (providerId || '').trim().toLowerCase();
  if (isProviderIconName(id)) return id;
  const alias = PROVIDER_ICON_ALIASES[id];
  if (alias) return alias;
  const normalized = id
    .replace(/-openai-responses$/, '')
    .replace(/-ai-gateway$/, '')
    .replace(/-coding-plan$/, '')
    .replace(/-token-plan-(cn|ams|sgp)$/, '');
  if (isProviderIconName(normalized)) return normalized;
  return 'synthetic';
}

function isProviderIconName(value: string): value is ProviderIconName {
  return Object.prototype.hasOwnProperty.call(PROVIDER_ICON_XML, value);
}
