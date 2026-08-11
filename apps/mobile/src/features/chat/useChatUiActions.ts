import { useCallback } from 'react';
import { toText } from '../../lib/text';
import type { ComposerAttachment } from '../media/types';

export function useChatUiActions(params: {
  inputDockHeight: number;
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
  sessionId: string;
  /** 切模型时同步到服务端已有会话（ref="provider/modelId"）。 */
  onPersistSessionModel: (sessionId: string, modelRef: string) => void;
}) {
  const {
    captureWithCamera,
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
    setPreviewImage,
    sessionId,
    onPersistSessionModel
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

  // 选模型回调：ModelPickerPopover 选中后自管关闭浮层，这里只切模型 + 同步服务端已有会话。
  const handleComposerPickerModel = useCallback((id: string) => {
    const ref = toText(id);
    setModel(ref);
    // 同步到服务端已有会话（新会话由 createSession 用当前 model）。
    const sid = toText(sessionId).trim();
    if (sid) onPersistSessionModel(sid, ref);
  }, [onPersistSessionModel, sessionId, setModel]);

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
