import React, { memo, type ReactElement, type ReactNode, useCallback, useMemo, useRef } from 'react';
import { FlatList, Platform, ScrollView, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { lexer, type Token, type Tokenizer } from 'marked';
import Renderer from 'react-native-marked/dist/commonjs/lib/Renderer';
import Parser from 'react-native-marked/dist/commonjs/lib/Parser';
import type { RendererInterface } from 'react-native-marked/dist/typescript/lib/types';
import getStyles from 'react-native-marked/dist/commonjs/theme/styles';
import type { MarkedStyles } from 'react-native-marked';

class MobileMarkdownRenderer extends Renderer implements RendererInterface {
  constructor(private readonly codeTextStyle: TextStyle) {
    super();
  }

  code(text: string, language?: string, containerStyle?: ViewStyle): ReactNode {
    const label = language ? `${language}\n` : '';
    return (
      <ScrollView horizontal key={this.getKey()} contentContainerStyle={containerStyle}>
        <View>
          <Text selectable style={this.codeTextStyle}>
            {label}
            {text}
          </Text>
        </View>
      </ScrollView>
    );
  }
}

function useStreamingMarkdown(value: string, options: {
  renderer: RendererInterface;
  styles: MarkedStyles;
  streaming: boolean;
  tokenizer?: Tokenizer;
}) {
  const { renderer, streaming, styles, tokenizer } = options;
  const parser = useMemo(
    () =>
      new Parser({
        styles: getStyles(styles, 'light'),
        renderer
      }),
    [renderer, styles]
  );
  const cacheRef = useRef<{
    lastValue: string;
    lastNewContent: string;
    cachedTokens: Token[];
    cachedElements: ReactNode[];
  }>({
    lastValue: '',
    lastNewContent: '',
    cachedTokens: [],
    cachedElements: []
  });

  return useMemo(() => {
    if (!value) {
      cacheRef.current = {
        lastValue: '',
        lastNewContent: '',
        cachedTokens: [],
        cachedElements: []
      };
      return [];
    }

    if (value === cacheRef.current.lastValue) {
      return cacheRef.current.cachedElements;
    }

    if (!streaming || cacheRef.current.lastValue.length === 0 || value.length < cacheRef.current.lastValue.length) {
      const tokens = lexer(value, { gfm: true, tokenizer });
      const elements = parser.parse(tokens);
      cacheRef.current = streaming
        ? {
            lastValue: value,
            lastNewContent: value,
            cachedTokens: tokens,
            cachedElements: elements
          }
        : {
            lastValue: '',
            lastNewContent: '',
            cachedTokens: [],
            cachedElements: []
          };
      return elements;
    }

    const newContent = value.slice(cacheRef.current.lastValue.length);
    if (!newContent) return cacheRef.current.cachedElements;

    const lastTokenIndex = cacheRef.current.cachedTokens.length - 1;
    const lastToken = cacheRef.current.cachedTokens[lastTokenIndex];
    if (!lastToken) {
      const tokens = lexer(value, { gfm: true, tokenizer });
      const elements = parser.parse(tokens);
      cacheRef.current = {
        lastValue: value,
        lastNewContent: value,
        cachedTokens: tokens,
        cachedElements: elements
      };
      return elements;
    }

    let combinedText = lastToken.raw;
    if (lastToken.type === 'list') {
      const lastNewContent = cacheRef.current.lastNewContent;
      if (combinedText.endsWith('\n') && lastNewContent.endsWith(' ')) {
        combinedText = `${combinedText.slice(0, -1)} `;
      }
    }
    combinedText += newContent;
    if (lastToken.type === 'space' && lastTokenIndex > 0) {
      combinedText = cacheRef.current.cachedTokens[lastTokenIndex - 1].raw + combinedText;
    }

    const newTokens = lexer(combinedText, { gfm: true, tokenizer });
    const newElements = parser.parse(newTokens);
    const removeCount = lastToken.type === 'space' && lastTokenIndex > 0 ? 2 : 1;
    const mergedTokens = [
      ...cacheRef.current.cachedTokens.slice(0, Math.max(0, cacheRef.current.cachedTokens.length - removeCount)),
      ...newTokens
    ];
    const mergedElements = [
      ...cacheRef.current.cachedElements.slice(0, Math.max(0, cacheRef.current.cachedElements.length - removeCount)),
      ...newElements
    ];

    cacheRef.current = {
      lastValue: value,
      lastNewContent: newContent,
      cachedTokens: mergedTokens,
      cachedElements: mergedElements
    };
    return mergedElements;
  }, [parser, streaming, tokenizer, value]);
}

export const MobileMarkedMarkdown = memo(function MobileMarkedMarkdown(props: {
  value: string;
  styles: MarkedStyles;
  containerStyle?: ViewStyle;
  codeTextStyle: TextStyle;
  streaming: boolean;
}) {
  const { codeTextStyle, containerStyle, streaming, styles, value } = props;
  const renderer = useMemo(() => new MobileMarkdownRenderer(codeTextStyle), [codeTextStyle]);
  const rnElements = useStreamingMarkdown(value, { renderer, styles, streaming });

  const renderItem = useCallback(({ item }: { item: ReactNode }) => item as ReactElement, []);
  const keyExtractor = useCallback((_: ReactNode, index: number) => String(index), []);

  return (
    <FlatList
      data={rnElements}
      initialNumToRender={rnElements.length}
      keyExtractor={keyExtractor}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled={Platform.OS === 'android'}
      removeClippedSubviews={false}
      renderItem={renderItem}
      scrollEnabled={false}
      style={containerStyle}
    />
  );
});
