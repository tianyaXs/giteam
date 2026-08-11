import React, { memo } from 'react';
import { type TextStyle, type ViewStyle } from 'react-native';
import Markdown from 'react-native-markdown-display';

/** 纯 JS Markdown 渲染（react-native-markdown-display），不依赖原生模块，
 *  保证解析稳定；样式由调用方按主题生成。 */
export const MobileMarkedMarkdown = memo(function MobileMarkedMarkdown(props: {
  value: string;
  styles: Record<string, any>;
  containerStyle?: ViewStyle | TextStyle;
  streaming: boolean;
  onLinkPress?: (event: { url?: string }) => void | Promise<void>;
}) {
  const { onLinkPress, styles, value } = props;
  return (
    <Markdown
      style={styles as any}
      onLinkPress={(url) => {
        void onLinkPress?.({ url });
        return false;
      }}
    >
      {value}
    </Markdown>
  );
});
