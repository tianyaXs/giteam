import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

type GlyphProps = {
  color: string;
  size?: number;
};

export function NotebookListGlyph(props: GlyphProps) {
  const { color, size = 34 } = props;
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <Circle cx="11.6" cy="13.4" r="1.2" fill={color} />
      <Circle cx="11.3" cy="20.1" r="1.2" fill={color} />
      <Circle cx="11.8" cy="26.7" r="1.2" fill={color} />
      <Path d="M17 13.2C21.4 12.9 24.8 13 29.1 13.3" stroke={color} strokeWidth="2.35" strokeLinecap="round" />
      <Path d="M16.8 20.3C21.5 19.8 25 20.1 29.5 19.9" stroke={color} strokeWidth="2.35" strokeLinecap="round" />
      <Path d="M17.2 26.6C21.2 26.8 24.7 26.4 28.8 26.8" stroke={color} strokeWidth="2.35" strokeLinecap="round" />
    </Svg>
  );
}

export function NotebookGearGlyph(props: GlyphProps) {
  const { color, size = 34 } = props;
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <Path
        d="M20.1 11.3L21.6 13.9C22.2 14.1 22.8 14.3 23.3 14.6L26.1 13.7L28 16.9L25.9 18.9C26 19.5 26 20.1 25.9 20.7L28.1 22.7L26.3 26L23.4 25.2C22.9 25.5 22.3 25.8 21.7 25.9L20.3 28.7L16.5 28.6L15.2 25.8C14.6 25.6 14.1 25.3 13.6 25L10.8 25.7L9.1 22.4L11.3 20.5C11.2 19.9 11.2 19.3 11.4 18.7L9.3 16.7L11.3 13.5L14 14.4C14.5 14.1 15.1 13.9 15.7 13.7L17.2 11.2L20.1 11.3Z"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M18.6 17.4C20.1 17.3 21.6 18.4 21.7 20.1C21.8 21.8 20.6 22.9 18.9 23C17.4 23.1 16.1 22 16 20.4C15.9 18.8 17.1 17.5 18.6 17.4Z"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
