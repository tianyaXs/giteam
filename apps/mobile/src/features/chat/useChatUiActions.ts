import { useCallback } from 'react';
import { toText } from '../../lib/text';
import type { ComposerAttachment } from '../media/types';

export function useChatUiActions(params: {
  inputDockHeight: number;
  closeComposerPicker: () => void;
  copyMessageText: (text: string) => Promise<void>;
  onSendPrompt: (customPrompt?: string) => Promise<void>;
  onAbort: () => Promise<void>;
  captureWithCamera: () => Promise<void>;
  openAlbumPicker: () => Promise<void>;
  pickImageFromLibrary: (mode: 'file' | 'album') => Promise<void>;
  setPreviewImage: (value: { uri: string; filename?: string } | null) => void;
  setExpandedThinkCards: React.Dispatch<React.SetStateAction<Set<string>>>;
  setInputDockHeight: (value: number) => void;
  setImageAttachments: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>;
  setAttachmentMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setComposerAgent: (value: 'build' | 'plan') => void;
  setModel: (value: string) => void;
}) {
  const {
    captureWithCamera,
    closeComposerPicker,
    copyMessageText,
    inputDockHeight,
    onAbort,
    onSendPrompt,
    openAlbumPicker,
    pickImageFromLibrary,
    setAttachmentMenuOpen,
    setComposerAgent,
    setExpandedThinkCards,
    setImageAttachments,
    setInputDockHeight,
    setModel,
    setPreviewImage
  } = params;

  const handleOpenPreviewImage = useCallback((img: { uri: string; filename?: string }) => {
    setPreviewImage({ uri: img.uri, filename: img.filename });
  }, [setPreviewImage]);

  const handleCopyMessage = useCallback((text: string) => {
    void copyMessageText(text);
  }, [copyMessageText]);

  const handleCopyImage = useCallback((uri: string) => {
    void copyMessageText(uri);
  }, [copyMessageText]);

  const handleThinkCardToggle = useCallback((id: string) => {
    setExpandedThinkCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [setExpandedThinkCards]);

  const handleComposerHeight = useCallback((height: number) => {
    if (Math.abs(height - inputDockHeight) > 2) setInputDockHeight(height);
  }, [inputDockHeight, setInputDockHeight]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setImageAttachments((prev) => prev.filter((item) => item.id !== id));
  }, [setImageAttachments]);

  const handleCaptureCamera = useCallback(() => {
    setAttachmentMenuOpen(false);
    void captureWithCamera();
  }, [captureWithCamera, setAttachmentMenuOpen]);

  const handleOpenAlbumPicker = useCallback(() => {
    setAttachmentMenuOpen(false);
    void openAlbumPicker();
  }, [openAlbumPicker, setAttachmentMenuOpen]);

  const handlePickAttachmentFile = useCallback(() => {
    setAttachmentMenuOpen(false);
    void pickImageFromLibrary('file');
  }, [pickImageFromLibrary, setAttachmentMenuOpen]);

  const handleSendPrompt = useCallback(() => {
    void onSendPrompt();
  }, [onSendPrompt]);

  const handleAbortPrompt = useCallback(() => {
    void onAbort();
  }, [onAbort]);

  const handleComposerPickerMode = useCallback((mode: 'build' | 'plan') => {
    setComposerAgent(mode);
  }, [setComposerAgent]);

  const handleComposerPickerModel = useCallback((id: string) => {
    setModel(toText(id));
    closeComposerPicker();
  }, [closeComposerPicker, setModel]);

  return {
    handleAbortPrompt,
    handleCaptureCamera,
    handleComposerHeight,
    handleComposerPickerMode,
    handleComposerPickerModel,
    handleCopyImage,
    handleCopyMessage,
    handleOpenAlbumPicker,
    handleOpenPreviewImage,
    handlePickAttachmentFile,
    handleRemoveAttachment,
    handleSendPrompt,
    handleThinkCardToggle
  };
}
