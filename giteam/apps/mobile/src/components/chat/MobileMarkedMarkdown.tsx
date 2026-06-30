import React, { memo } from 'react';
import { type TextStyle, type ViewStyle } from 'react-native';
import { StreamdownText } from 'react-native-streamdown';
import type { LinkPressEvent, MarkdownStyle } from 'react-native-enriched-markdown';

export const MobileMarkedMarkdown = memo(function MobileMarkedMarkdown(props: {
  value: string;
  styles: MarkdownStyle;
  containerStyle?: ViewStyle | TextStyle;
  streaming: boolean;
  onLinkPress?: (event: LinkPressEvent) => void | Promise<void>;
}) {
  const { containerStyle, onLinkPress, styles, value } = props;

  return (
    <StreamdownText
      containerStyle={containerStyle as any}
      markdown={value}
      markdownStyle={styles}
      onLinkPress={onLinkPress}
      selectable
    />
  );
});
