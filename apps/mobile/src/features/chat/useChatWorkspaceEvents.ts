import { useCallback } from 'react';

export function useChatWorkspaceEvents(params: {
  canLoadEarlierHistory: boolean;
  handleContentSizeChange: (
    contentHeight: number,
    opts: {
      canLoadEarlierHistory: boolean;
      loadingOlder: boolean;
      onLoadOlderMessages: () => void;
    }
  ) => void;
  handleListLayout: (height: number) => void;
  loadingOlder: boolean;
  markHistoryLoadAnchor: (source?: string) => boolean;
  onLoadOlderMessages: () => Promise<void>;
  onMessageListScroll: (scrollY: number, viewportHeight: number, contentHeight: number) => void;
}) {
  const {
    canLoadEarlierHistory,
    handleContentSizeChange,
    handleListLayout,
    loadingOlder,
    markHistoryLoadAnchor,
    onLoadOlderMessages,
    onMessageListScroll
  } = params;

  const handleLoadOlderMessages = useCallback(() => {
    if (!markHistoryLoadAnchor('endReached')) return;
    void onLoadOlderMessages();
  }, [markHistoryLoadAnchor, onLoadOlderMessages]);

  const handleWorkspaceScroll = useCallback((evt: any) => {
    const y = Number(evt.nativeEvent.contentOffset?.y || 0);
    const viewportH = Number(evt.nativeEvent.layoutMeasurement?.height || 0);
    const contentH = Number(evt.nativeEvent.contentSize?.height || 0);
    onMessageListScroll(y, viewportH, contentH);
  }, [onMessageListScroll]);

  const handleWorkspaceContentSizeChange = useCallback((_width: number, height: number) => {
    handleContentSizeChange(Number(height || 0), {
      canLoadEarlierHistory,
      loadingOlder,
      onLoadOlderMessages: handleLoadOlderMessages
    });
  }, [
    canLoadEarlierHistory,
    handleContentSizeChange,
    handleLoadOlderMessages,
    loadingOlder
  ]);

  const handleWorkspaceListLayout = useCallback((evt: any) => {
    handleListLayout(Number(evt.nativeEvent.layout?.height || 0));
  }, [handleListLayout]);

  return {
    handleLoadOlderMessages,
    handleWorkspaceContentSizeChange,
    handleWorkspaceListLayout,
    handleWorkspaceScroll
  };
}
