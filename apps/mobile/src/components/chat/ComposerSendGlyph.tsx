import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

/** 对齐桌面 AgentComposer SendIcon：细描边上箭头 / 白色圆角停止方块。 */
export function ComposerSendGlyph(props: {
  busy: boolean;
  color: string;
  size?: number;
}) {
  const size = props.size ?? 20;
  if (props.busy) {
    // 与桌面一致：圆角实心方块，留出圆钮内边距
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
        <Rect x={6} y={6} width={12} height={12} rx={2.5} fill={props.color} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path
        d="M12 3.25V18.25"
        fill="none"
        stroke={props.color}
        strokeWidth={1.75}
        strokeLinecap="round"
      />
      <Path
        d="M5.75 10L12 3.25L18.25 10"
        fill="none"
        stroke={props.color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
