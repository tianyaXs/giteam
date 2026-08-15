import { useCallback, useMemo } from 'react';
import type { ComponentProps, Dispatch, SetStateAction } from 'react';
import type { ChatComposer } from '../../components/chat/ChatComposer';
import type { AlbumPickerOverlay } from '../../components/chat/MediaOverlays';
import type { ComposerAttachment, RecentImageItem } from '../media/types';
import type { ModelOption } from '../workspace/catalogUtils';

type ComposerAgentName = 'build' | 'plan';
type ChatComposerProps = ComponentProps<typeof ChatComposer>;
type AlbumPickerProps = ComponentProps<typeof AlbumPickerOverlay>;

/**
 * 组装 composer / 相册选择器 props。
 *
 * 阶段 3 重构后：模型选择改为 ChatComposer 内嵌的 ModelPickerPopover（自管 open/close），
 * 故不再有 composerPickerProps；模式（build/plan）与模型回调直接进 composerProps。
 * 自动批准已上移到右侧设置抽屉（useNotebookDrawerRenderers → ConnectionDrawer）。
 */
export function useChatWorkspacePanelProps(params: {
  actionIconAnim: ChatComposerProps['actionIconAnim'];
  albumImages: AlbumPickerProps['albumImages'];
  albumImagesLoading: boolean;
  albumImagesLoadingMore: boolean;
  freshAlbumImageIdSet?: Set<string>;
  albumPickerOpen: boolean;
  albumPickerPurpose: 'attachment' | 'qr-scan';
  albumExitMode?: 'slide' | 'quick';
  albumSelectedIds: string[];
  albumSelectedSet: Set<string>;
  attachRecentImage: (item: RecentImageItem) => Promise<void>;
  attachmentMenuOpen: boolean;
  attachmentPanelStyle: any;
  attachmentBubbleItemStyles?: ChatComposerProps['attachmentBubbleItemStyles'];
  attachmentPanelVisible: boolean;
  attachmentToggleAnim: ChatComposerProps['attachmentToggleAnim'];
  canAbortNow: boolean;
  canSendNow: boolean;
  closeAlbumPicker: () => void;
  composerAgent: ComposerAgentName;
  composerModeOptions: Array<{ key: ComposerAgentName; label: string }>;
  handleAbortPrompt: () => void;
  handleCaptureCamera: () => void;
  handleComposerHeight: (height: number) => void;
  handleComposerPickerMode: (mode: ComposerAgentName) => void;
  handleComposerPickerModel: (modelId: string) => void;
  handleDismissAttachmentPanel: () => void;
  handleOpenAlbumPicker: () => void;
  handleOpenPreviewImage: (image: { uri: string; filename?: string }) => void;
  handlePickAttachmentFile: () => void;
  handlePromptChange: (value: string) => void;
  handleRemoveAttachment: (id: string) => void;
  handleSendPrompt: (customPrompt?: string) => void | Promise<void>;
  handleSlashSelect: (trigger: string) => void;
  handleToggleAttachmentMenu: () => void;
  imageAttachments: ComposerAttachment[];
  inputModelLabel: string;
  keyboardInset: number;
  loadMoreAlbumImages: () => void;
  mediaAlbums: AlbumPickerProps['mediaAlbums'];
  maybeLoadMoreRecentImages: (y: number, viewportH: number, contentH: number) => void;
  model: string;
  modelOptions: ModelOption[];
  notebookColors: { left: string };
  onOpenModelManager: () => void;
  onSpeechStatus?: (message: string) => void;
  hasConversationContent: boolean;
  sessionId: string;
  prompt: string;
  recentImages: RecentImageItem[];
  recentImagesHasNext: boolean;
  recentImagesLoading: boolean;
  recentImagesLoadingMore: boolean;
  recentScrollerHeight: number;
  selectedMediaAlbumId: string;
  selectMediaAlbum: (albumId: string) => void;
  setPreviewImage: Dispatch<SetStateAction<{ uri: string; filename?: string } | null>>;
  slashActiveIndex: number;
  slashOpen: boolean;
  slashSuggestions: ChatComposerProps['slashSuggestions'];
  styles: Record<string, any>;
  thinkingLevel: ChatComposerProps['thinkingLevel'];
  onThinkingLevelChange: ChatComposerProps['onThinkingLevelChange'];
  toggleAlbumImage: (imageId: string) => void;
  confirmAlbumSelection: () => Promise<void>;
}) {
  const {
    actionIconAnim,
    albumImages,
    albumImagesLoading,
    albumImagesLoadingMore,
    freshAlbumImageIdSet,
    albumPickerOpen,
    albumPickerPurpose,
    albumExitMode = 'slide',
    albumSelectedIds,
    albumSelectedSet,
    attachRecentImage,
    attachmentMenuOpen,
    attachmentPanelStyle,
    attachmentBubbleItemStyles,
    attachmentPanelVisible,
    attachmentToggleAnim,
    canAbortNow,
    canSendNow,
    closeAlbumPicker,
    composerAgent,
    composerModeOptions,
    confirmAlbumSelection,
    handleAbortPrompt,
    handleCaptureCamera,
    handleComposerHeight,
    handleComposerPickerMode,
    handleComposerPickerModel,
    handleDismissAttachmentPanel,
    handleOpenAlbumPicker,
    handleOpenPreviewImage,
    handlePickAttachmentFile,
    handlePromptChange,
    handleRemoveAttachment,
    handleSendPrompt,
    handleSlashSelect,
    handleToggleAttachmentMenu,
    imageAttachments,
    inputModelLabel,
    keyboardInset,
    loadMoreAlbumImages,
    mediaAlbums,
    maybeLoadMoreRecentImages,
    model,
    modelOptions,
    notebookColors,
    onOpenModelManager,
    onSpeechStatus,
    hasConversationContent,
    sessionId,
    prompt,
    recentImages,
    recentImagesHasNext,
    recentImagesLoading,
    recentImagesLoadingMore,
    recentScrollerHeight,
    selectedMediaAlbumId,
    selectMediaAlbum,
    setPreviewImage,
    slashActiveIndex,
    slashOpen,
    slashSuggestions,
    styles,
    thinkingLevel,
    onThinkingLevelChange,
    toggleAlbumImage
  } = params;

  const handleAttachRecentImage = useCallback((item: RecentImageItem) => {
    void attachRecentImage(item);
  }, [attachRecentImage]);

  const handleConfirmAlbumSelection = useCallback(() => {
    void confirmAlbumSelection();
  }, [confirmAlbumSelection]);

  const handleClosePreviewImage = useCallback(() => {
    setPreviewImage(null);
  }, [setPreviewImage]);

  const composerProps = useMemo<ChatComposerProps>(() => ({
    styles,
    prompt,
    imageAttachments,
    attachmentMenuOpen,
    attachmentPanelVisible,
    attachmentToggleAnim,
    attachmentPanelStyle,
    attachmentBubbleItemStyles,
    actionIconAnim,
    inputModelLabel,
    composerModeOptions,
    composerAgent,
    modelOptions,
    selectedModel: model,
    onSelectMode: handleComposerPickerMode,
    onSelectModel: handleComposerPickerModel,
    onOpenModelManager,
    sessionId,
    hasConversationContent,
    canSendNow,
    canAbortNow,
    slashOpen,
    slashActiveIndex,
    slashSuggestions,
    recentScrollerHeight,
    recentImages,
    recentImagesLoading,
    recentImagesLoadingMore,
    recentImagesHasNext,
    keyboardInset,
    onLayoutHeight: handleComposerHeight,
    onPromptChange: handlePromptChange,
    onToggleAttachmentMenu: handleToggleAttachmentMenu,
    onDismissAttachmentPanel: handleDismissAttachmentPanel,
    onOpenAttachmentPreview: handleOpenPreviewImage,
    onRemoveAttachment: handleRemoveAttachment,
    onAbort: handleAbortPrompt,
    onSend: handleSendPrompt,
    onSpeechStatus,
    onSelectSlash: handleSlashSelect,
    onCaptureCamera: handleCaptureCamera,
    onOpenAlbumPicker: handleOpenAlbumPicker,
    onPickFile: handlePickAttachmentFile,
    onRecentScroll: maybeLoadMoreRecentImages,
    onAttachRecentImage: handleAttachRecentImage,
    thinkingLevel,
    onThinkingLevelChange
  }), [
    actionIconAnim,
    attachmentMenuOpen,
    attachmentPanelStyle,
    attachmentBubbleItemStyles,
    attachmentPanelVisible,
    attachmentToggleAnim,
    canAbortNow,
    canSendNow,
    composerAgent,
    composerModeOptions,
    handleAbortPrompt,
    handleAttachRecentImage,
    handleCaptureCamera,
    handleComposerHeight,
    handleComposerPickerMode,
    handleComposerPickerModel,
    handleDismissAttachmentPanel,
    handleOpenAlbumPicker,
    handleOpenPreviewImage,
    handlePickAttachmentFile,
    handlePromptChange,
    handleRemoveAttachment,
    handleSendPrompt,
    handleSlashSelect,
    handleToggleAttachmentMenu,
    hasConversationContent,
    imageAttachments,
    inputModelLabel,
    keyboardInset,
    maybeLoadMoreRecentImages,
    model,
    modelOptions,
    onOpenModelManager,
    onSpeechStatus,
    onThinkingLevelChange,
    prompt,
    recentImages,
    recentImagesHasNext,
    recentImagesLoading,
    recentImagesLoadingMore,
    recentScrollerHeight,
    sessionId,
    slashActiveIndex,
    slashOpen,
    slashSuggestions,
    styles,
    thinkingLevel
  ]);

  const albumPickerProps = useMemo<AlbumPickerProps>(() => ({
    styles,
    open: albumPickerOpen,
    exitMode: albumExitMode,
    purpose: albumPickerPurpose,
    mediaAlbums,
    selectedMediaAlbumId,
    albumSelectedIds,
    albumSelectedSet,
    albumImagesLoading,
    albumImagesLoadingMore,
    albumImages,
    freshAlbumImageIdSet,
    onClose: closeAlbumPicker,
    onConfirm: handleConfirmAlbumSelection,
    onSelectAlbum: selectMediaAlbum,
    onToggleImage: toggleAlbumImage,
    onLoadMore: loadMoreAlbumImages
  }), [
    albumImages,
    albumImagesLoading,
    albumImagesLoadingMore,
    freshAlbumImageIdSet,
    albumExitMode,
    albumPickerOpen,
    albumPickerPurpose,
    albumSelectedIds,
    albumSelectedSet,
    closeAlbumPicker,
    handleConfirmAlbumSelection,
    loadMoreAlbumImages,
    mediaAlbums,
    selectedMediaAlbumId,
    selectMediaAlbum,
    styles,
    toggleAlbumImage
  ]);

  // notebookColors 目前仅留作扩展占位（旧 composerPickerProps 曾用 left 作背景色）。
  void notebookColors;

  return {
    albumPickerProps,
    composerProps,
    handleClosePreviewImage
  };
}
