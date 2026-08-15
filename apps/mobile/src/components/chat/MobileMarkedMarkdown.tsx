import React, { memo } from 'react';
import { View, type TextStyle, type ViewStyle } from 'react-native';
import Markdown from 'react-native-markdown-display';

/** 纯 JS Markdown 渲染（react-native-markdown-display），不依赖原生模块，
 *  保证解析稳定；样式由调用方按主题生成。 */
export const MobileMarkedMarkdown = memo(
  function MobileMarkedMarkdown(props: {
    value: string;
    styles: Record<string, any>;
    containerStyle?: ViewStyle | TextStyle;
    streaming: boolean;
    onLinkPress?: (event: { url?: string }) => void | Promise<void>;
  }) {
    const { containerStyle, onLinkPress, styles, value } = props;
    return (
      // collapsable=false：避免父级高度变化时 Android 把这棵子树拆掉重挂，导致 markdown 短暂花屏。
      <View collapsable={false} style={containerStyle}>
        <Markdown
          style={styles as any}
          onLinkPress={(url) => {
            void onLinkPress?.({ url });
            return false;
          }}
        >
          {value}
        </Markdown>
      </View>
    );
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.streaming === next.streaming &&
    prev.styles === next.styles &&
    prev.containerStyle === next.containerStyle &&
    prev.onLinkPress === next.onLinkPress
);
