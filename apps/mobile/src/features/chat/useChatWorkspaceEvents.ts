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
  messageUserScrollingRef: React.MutableRefObject<boolean>;
  onLoadOlderMessages: () => Promise<void>;
  onMessageListScroll: (scrollY: number, viewportHeight: number, contentHeight: number) => void;
}) {
  const {
    canLoadEarlierHistory,
    handleContentSizeChange,
    handleListLayout,
    loadingOlder,
    messageUserScrollingRef,
    onLoadOlderMessages,
    onMessageListScroll
  } = params;

  const handleLoadOlderMessages = useCallback(() => {
    void onLoadOlderMessages();
  }, [onLoadOlderMessages]);

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
    if (loadingOlder) return;
    if (messageUserScrollingRef.current) return;
  }, [
    canLoadEarlierHistory,
    handleContentSizeChange,
    handleLoadOlderMessages,
    loadingOlder,
    messageUserScrollingRef
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
