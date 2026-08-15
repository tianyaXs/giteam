import React from 'react';
import Svg, { Rect } from 'react-native-svg';

/** 发送位声音波形图标：与 ComposerSendGlyph 同 24 viewBox / 默认 20 尺寸。 */
export function ComposerMicGlyph(props: { color: string; size?: number }) {
  const size = props.size ?? 20;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x={4.5} y={8} width={2.5} height={8} rx={1.25} fill={props.color} />
      <Rect x={9.25} y={4.5} width={2.5} height={15} rx={1.25} fill={props.color} />
      <Rect x={14} y={6.5} width={2.5} height={11} rx={1.25} fill={props.color} />
      <Rect x={18.75} y={9} width={2.5} height={6} rx={1.25} fill={props.color} />
    </Svg>
  );
}
