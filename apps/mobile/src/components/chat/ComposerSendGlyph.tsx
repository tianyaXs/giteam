import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

/** 对齐桌面 AgentComposer SendIcon：细描边上箭头 / 实心圆角停止方块。统一 20 视口，避免 Send/Stop 切换「一大一小」。 */
export function ComposerSendGlyph(props: {
  busy: boolean;
  color: string;
  size?: number;
}) {
  const size = props.size ?? 20;
  if (props.busy) {
    // 固定 14×14 方块（相对 24 viewBox），Send/Stop 外框同 size 时视觉重量接近。
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
        <Rect x={5} y={5} width={14} height={14} rx={3} fill={props.color} />
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
