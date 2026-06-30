import { useCallback, useMemo } from 'react';
import type { ComponentProps, Dispatch, SetStateAction } from 'react';
import type { ChatComposer, ComposerPickerSheet } from '../../components/chat/ChatComposer';
import type { AlbumPickerOverlay } from '../../components/chat/MediaOverlays';
import type { ComposerAttachment, RecentImageItem } from '../media/types';
import type { ModelOption } from '../workspace/catalogUtils';

type ComposerAgentName = 'build' | 'plan';
type ChatComposerProps = ComponentProps<typeof ChatComposer>;
type AlbumPickerProps = ComponentProps<typeof AlbumPickerOverlay>;
type ComposerPickerProps = ComponentProps<typeof ComposerPickerSheet>;

export function useChatWorkspacePanelProps(params: {
  actionIconAnim: ChatComposerProps['actionIconAnim'];
  albumImages: AlbumPickerProps['albumImages'];
  albumImagesLoading: boolean;
  albumImagesLoadingMore: boolean;
  albumPickerOpen: boolean;
  albumPickerPurpose: 'attachment' | 'qr-scan';
  albumSelectedIds: string[];
  albumSelectedSet: Set<string>;
  attachRecentImage: (item: RecentImageItem) => Promise<void>;
  attachmentMenuOpen: boolean;
  attachmentPanelStyle: any;
  attachmentPanelVisible: boolean;
  attachmentToggleAnim: ChatComposerProps['attachmentToggleAnim'];
  autoAcceptPermissions: boolean;
  canAbortNow: boolean;
  canSendNow: boolean;
  closeAlbumPicker: () => void;
  closeComposerPicker: () => void;
  composerAgent: ComposerAgentName;
  composerModeOptions: Array<{ key: ComposerAgentName; label: string }>;
  composerPickerOpen: boolean;
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
  handleSendPrompt: () => void;
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
  openComposerPicker: () => void;
  prompt: string;
  recentImages: RecentImageItem[];
  recentImagesHasNext: boolean;
  recentImagesLoading: boolean;
  recentImagesLoadingMore: boolean;
  recentScrollerHeight: number;
  selectedMediaAlbumId: string;
  selectMediaAlbum: (albumId: string) => void;
  setAutoAcceptPermissions: Dispatch<SetStateAction<boolean>>;
  setPreviewImage: Dispatch<SetStateAction<{ uri: string; filename?: string } | null>>;
  slashActiveIndex: number;
  slashOpen: boolean;
  slashSuggestions: ChatComposerProps['slashSuggestions'];
  styles: Record<string, any>;
  toggleAlbumImage: (imageId: string) => void;
  confirmAlbumSelection: () => Promise<void>;
}) {
  const {
    actionIconAnim,
    albumImages,
    albumImagesLoading,
    albumImagesLoadingMore,
    albumPickerOpen,
    albumPickerPurpose,
    albumSelectedIds,
    albumSelectedSet,
    attachRecentImage,
    attachmentMenuOpen,
    attachmentPanelStyle,
    attachmentPanelVisible,
    attachmentToggleAnim,
    autoAcceptPermissions,
    canAbortNow,
    canSendNow,
    closeAlbumPicker,
    closeComposerPicker,
    composerAgent,
    composerModeOptions,
    composerPickerOpen,
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
    openComposerPicker,
    prompt,
    recentImages,
    recentImagesHasNext,
    recentImagesLoading,
    recentImagesLoadingMore,
    recentScrollerHeight,
    selectedMediaAlbumId,
    selectMediaAlbum,
    setAutoAcceptPermissions,
    setPreviewImage,
    slashActiveIndex,
    slashOpen,
    slashSuggestions,
    styles,
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

  const handleToggleAutoAccept = useCallback(() => {
    setAutoAcceptPermissions((value) => !value);
  }, [setAutoAcceptPermissions]);

  const composerProps = useMemo<ChatComposerProps>(() => ({
    styles,
    prompt,
    imageAttachments,
    attachmentMenuOpen,
    attachmentPanelVisible,
    attachmentToggleAnim,
    attachmentPanelStyle,
    actionIconAnim,
    inputModelLabel,
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
    onOpenComposerPicker: openComposerPicker,
    onAbort: handleAbortPrompt,
    onSend: handleSendPrompt,
    onSelectSlash: handleSlashSelect,
    onCaptureCamera: handleCaptureCamera,
    onOpenAlbumPicker: handleOpenAlbumPicker,
    onPickFile: handlePickAttachmentFile,
    onRecentScroll: maybeLoadMoreRecentImages,
    onAttachRecentImage: handleAttachRecentImage
  }), [
    actionIconAnim,
    attachmentMenuOpen,
    attachmentPanelStyle,
    attachmentPanelVisible,
    attachmentToggleAnim,
    canAbortNow,
    canSendNow,
    handleAbortPrompt,
    handleAttachRecentImage,
    handleCaptureCamera,
    handleComposerHeight,
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
    maybeLoadMoreRecentImages,
    openComposerPicker,
    prompt,
    recentImages,
    recentImagesHasNext,
    recentImagesLoading,
    recentImagesLoadingMore,
    recentScrollerHeight,
    slashActiveIndex,
    slashOpen,
    slashSuggestions,
    styles
  ]);

  const albumPickerProps = useMemo<AlbumPickerProps>(() => ({
    styles,
    open: albumPickerOpen,
    purpose: albumPickerPurpose,
    mediaAlbums,
    selectedMediaAlbumId,
    albumSelectedIds,
    albumSelectedSet,
    albumImagesLoading,
    albumImagesLoadingMore,
    albumImages,
    onClose: closeAlbumPicker,
    onConfirm: handleConfirmAlbumSelection,
    onSelectAlbum: selectMediaAlbum,
    onToggleImage: toggleAlbumImage,
    onLoadMore: loadMoreAlbumImages
  }), [
    albumImages,
    albumImagesLoading,
    albumImagesLoadingMore,
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

  const composerPickerProps = useMemo<ComposerPickerProps>(() => ({
    styles,
    open: composerPickerOpen,
    backgroundColor: notebookColors.left,
    composerModeOptions,
    composerAgent,
    autoAcceptPermissions,
    modelOptions,
    selectedModel: model,
    onClose: closeComposerPicker,
    onSelectMode: handleComposerPickerMode,
    onToggleAutoAccept: handleToggleAutoAccept,
    onSelectModel: handleComposerPickerModel
  }), [
    autoAcceptPermissions,
    closeComposerPicker,
    composerAgent,
    composerModeOptions,
    composerPickerOpen,
    handleComposerPickerMode,
    handleComposerPickerModel,
    handleToggleAutoAccept,
    model,
    modelOptions,
    notebookColors.left,
    styles
  ]);

  return {
    albumPickerProps,
    composerPickerProps,
    composerProps,
    handleClosePreviewImage
  };
}
