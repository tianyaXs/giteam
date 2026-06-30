import { useCallback } from 'react';

export function useChatWorkspaceEvents(params: {
  handleContentSizeChange: (
    contentHeight: number,
    opts: {
      loadingOlder: boolean;
    }
  ) => void;
  handleListLayout: (height: number) => void;
  loadingOlder: boolean;
  onMessageListScroll: (scrollY: number, viewportHeight: number, contentHeight: number) => void;
}) {
  const {
    handleContentSizeChange,
    handleListLayout,
    loadingOlder,
    onMessageListScroll
  } = params;

  const handleWorkspaceScroll = useCallback((evt: any) => {
    const y = Number(evt.nativeEvent.contentOffset?.y || 0);
    const viewportH = Number(evt.nativeEvent.layoutMeasurement?.height || 0);
    const contentH = Number(evt.nativeEvent.contentSize?.height || 0);
    onMessageListScroll(y, viewportH, contentH);
  }, [onMessageListScroll]);

  const handleWorkspaceContentSizeChange = useCallback((_width: number, height: number) => {
    handleContentSizeChange(Number(height || 0), {
      loadingOlder
    });
  }, [
    handleContentSizeChange,
    loadingOlder
  ]);

  const handleWorkspaceListLayout = useCallback((evt: any) => {
    handleListLayout(Number(evt.nativeEvent.layout?.height || 0));
  }, [handleListLayout]);

  return {
    handleWorkspaceContentSizeChange,
    handleWorkspaceListLayout,
    handleWorkspaceScroll
  };
}
