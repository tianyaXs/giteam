import React from 'react';
import { Text, View } from 'react-native';
import { toText } from '../lib/text';

type AppRenderBoundaryProps = {
  name: string;
  styles: Record<string, any>;
  children: React.ReactNode;
};

type AppRenderBoundaryState = {
  error: string;
};

export class AppRenderBoundary extends React.Component<AppRenderBoundaryProps, AppRenderBoundaryState> {
  constructor(props: AppRenderBoundaryProps) {
    super(props);
    this.state = { error: '' };
  }

  static getDerivedStateFromError(err: unknown): AppRenderBoundaryState {
    return { error: toText(err) || '渲染异常' };
  }

  componentDidCatch(err: unknown) {
    // eslint-disable-next-line no-console
    console.error(`[RenderBoundary:${this.props.name}]`, err);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { styles } = this.props;
    return (
      <View style={styles.boundaryWrap}>
        <Text style={styles.boundaryTitle}>渲染已降级</Text>
        <Text style={styles.boundaryText}>{this.state.error}</Text>
      </View>
    );
  }
}
