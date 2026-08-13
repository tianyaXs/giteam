import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

/** 对齐桌面 AgentComposer SendIcon：细描边上箭头 / 实心圆角停止方块。 */
export function ComposerSendGlyph(props: {
  busy: boolean;
  color: string;
  size?: number;
}) {
  const size = props.size ?? 20;
  if (props.busy) {
    // 圆钮内停止块放大：约 15/24，对比感强于旧版 12/24，并略大于桌面 13 以适配触控圆钮。
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
        <Rect x={4.5} y={4.5} width={15} height={15} rx={3.25} fill={props.color} />
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
