import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import type { ComposerAttachment, RecentImageItem } from './types';

type SlashCommandLike = {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  source: 'builtin' | 'command' | 'skill' | 'mcp';
};

export function useComposerUiController(props: {
  windowWidth: number;
  busy: boolean;
  sessionWorking: boolean;
  imageAttachments: ComposerAttachment[];
  slashCommands: SlashCommandLike[];
  setStatus: (message: string) => void;
}) {
  const { busy, imageAttachments, sessionWorking, setStatus, slashCommands, windowWidth } = props;
  const [prompt, setPrompt] = useState('');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentPanelVisible, setAttachmentPanelVisible] = useState(false);
  const [composerPickerOpen, setComposerPickerOpen] = useState(false);
  const [recentImages, setRecentImages] = useState<RecentImageItem[]>([]);
  const [recentImagesLoading, setRecentImagesLoading] = useState(false);
  const [recentImagesLoadingMore, setRecentImagesLoadingMore] = useState(false);
  const [recentImagesCursor, setRecentImagesCursor] = useState<string | undefined>(undefined);
  const [recentImagesHasNext, setRecentImagesHasNext] = useState(false);

  const recentImagesLoadingRef = useRef(false);
  const recentImagesLoadedAtRef = useRef(0);
  const actionIconAnim = useRef(new Animated.Value(1)).current;
  const attachmentPanelAnim = useRef(new Animated.Value(0)).current;
  const attachmentToggleAnim = useRef(new Animated.Value(0)).current;

  const builtinSlashCommands = useMemo<SlashCommandLike[]>(() => [
    { id: 'builtin-new', trigger: 'new', title: 'New session', description: '开始一个新会话', source: 'builtin' },
    { id: 'builtin-compact', trigger: 'compact', title: 'Compact', description: '压缩当前会话上下文', source: 'builtin' },
    { id: 'builtin-model', trigger: 'model', title: 'Model', description: '切换当前模型', source: 'builtin' },
    { id: 'builtin-agent', trigger: 'agent', title: 'Agent', description: '切换 agent', source: 'builtin' },
    { id: 'builtin-open', trigger: 'open', title: 'Open', description: '搜索文件、命令和会话', source: 'builtin' },
    { id: 'builtin-terminal', trigger: 'terminal', title: 'Terminal', description: '打开或聚焦终端', source: 'builtin' },
    { id: 'builtin-mcp', trigger: 'mcp', title: 'MCP', description: '切换 MCPs', source: 'builtin' },
    { id: 'builtin-workspace', trigger: 'workspace', title: 'Workspace', description: '在侧边栏启用或禁用多个工作区', source: 'builtin' },
    { id: 'builtin-init', trigger: 'init', title: 'Init', description: 'create/update AGENTS.md', source: 'builtin' },
    { id: 'builtin-review', trigger: 'review', title: 'Review', description: 'review changes [commit|branch|pr]', source: 'builtin' }
  ], []);

  const slashQuery = useMemo(() => {
    const m = prompt.match(/^\/(\S*)$/);
    return m ? m[1].toLowerCase() : '';
  }, [prompt]);

  const slashSuggestions = useMemo(() => {
    if (!slashOpen) return [];
    const all = [...builtinSlashCommands, ...slashCommands];
    const seen = new Set<string>();
    return all.filter((cmd) => {
      const key = cmd.trigger.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return !slashQuery || key.includes(slashQuery) || cmd.title.toLowerCase().includes(slashQuery);
    });
  }, [builtinSlashCommands, slashCommands, slashOpen, slashQuery]);

  const promptText = prompt.trim();
  const hasPromptText = promptText.length > 0;
  const hasSendAction = hasPromptText || imageAttachments.length > 0;
  const imageQueueBusy = imageAttachments.some((img) => img.status === 'processing' || img.status === 'uploading');
  const imageQueueFailed = imageAttachments.some((img) => img.status === 'failed');
  const composerWillAbort = sessionWorking && !hasSendAction;
  const canSendNow = !busy && hasSendAction && !imageQueueBusy && !imageQueueFailed;
  const canAbortNow = !busy && composerWillAbort;

  const recentTileSize = Math.max(70, Math.floor((Math.max(320, windowWidth - 80) - 18) / 4));
  const recentVisibleRows = Math.max(1, Math.min(3, Math.ceil((recentImages.length || 1) / 4)));
  const recentScrollerHeight = recentVisibleRows * recentTileSize + Math.max(0, recentVisibleRows - 1) * 6 + 8;

  const attachmentPanelStyle = {
    opacity: attachmentPanelAnim,
    transform: [
      {
        translateY: attachmentPanelAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0]
        })
      },
      {
        scale: attachmentPanelAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.96, 1]
        })
      }
    ]
  } as const;

  const handlePromptChange = useCallback((value: string) => {
    if (attachmentMenuOpen) setAttachmentMenuOpen(false);
    setPrompt(value);
    const isSlash = /^\//.test(value) && !value.includes(' ');
    setSlashOpen(isSlash);
    setSlashActiveIndex(0);
  }, [attachmentMenuOpen]);

  const handleSlashSelect = useCallback((trigger: string) => {
    setPrompt(`/${trigger} `);
    setSlashOpen(false);
  }, []);

  const handleToggleAttachmentMenu = useCallback(() => {
    setAttachmentMenuOpen((prev) => !prev);
  }, []);

  const handleDismissAttachmentPanel = useCallback(() => {
    setAttachmentMenuOpen(false);
  }, []);

  const openComposerPicker = useCallback(() => {
    setComposerPickerOpen(true);
  }, []);

  const closeComposerPicker = useCallback(() => {
    setComposerPickerOpen(false);
  }, []);

  const mediaAssetsToRecentItems = useCallback((assets: MediaLibrary.Asset[]): RecentImageItem[] => {
    return assets.map((asset) => ({
      id: asset.id,
      uri: asset.uri,
      filename: asset.filename || `photo-${asset.id}.jpg`,
      mediaType: String(asset.mediaType || '')
    }));
  }, []);

  const loadRecentImages = useCallback(async (opts?: { append?: boolean }) => {
    const append = Boolean(opts?.append);
    if (recentImagesLoadingRef.current) return;
    if (append && !recentImagesHasNext) return;
    if (!append && recentImages.length > 0 && Date.now() - recentImagesLoadedAtRef.current < 20_000) return;
    try {
      recentImagesLoadingRef.current = true;
      if (append) setRecentImagesLoadingMore(true);
      else setRecentImagesLoading(true);
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        setStatus('相册权限被拒绝');
        return;
      }
      const page = await MediaLibrary.getAssetsAsync({
        first: 12,
        after: append ? recentImagesCursor : undefined,
        mediaType: [MediaLibrary.MediaType.photo],
        sortBy: [MediaLibrary.SortBy.creationTime]
      });
      const items = mediaAssetsToRecentItems(page.assets);
      setRecentImages((prev) => append ? [...prev, ...items.filter((item) => !prev.some((old) => old.id === item.id))] : items);
      setRecentImagesCursor(page.endCursor || undefined);
      setRecentImagesHasNext(Boolean(page.hasNextPage));
      recentImagesLoadedAtRef.current = Date.now();
    } catch (e) {
      setStatus(`读取最近图片失败: ${String(e)}`);
    } finally {
      recentImagesLoadingRef.current = false;
      setRecentImagesLoading(false);
      setRecentImagesLoadingMore(false);
    }
  }, [mediaAssetsToRecentItems, recentImages, recentImagesCursor, recentImagesHasNext, setStatus]);

  const maybeLoadMoreRecentImages = useCallback((y: number, viewportH: number, contentH: number) => {
    if (!recentImagesHasNext || recentImagesLoadingRef.current) return;
    if (contentH - viewportH - y < 80) void loadRecentImages({ append: true });
  }, [loadRecentImages, recentImagesHasNext]);

  useEffect(() => {
    if (hasSendAction) setAttachmentMenuOpen(false);
  }, [hasSendAction]);

  useEffect(() => {
    actionIconAnim.setValue(0.7);
    Animated.timing(actionIconAnim, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [actionIconAnim, attachmentMenuOpen, hasSendAction]);

  useEffect(() => {
    Animated.timing(attachmentToggleAnim, {
      toValue: attachmentMenuOpen ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();

    if (attachmentMenuOpen) {
      setAttachmentPanelVisible(true);
      Animated.spring(attachmentPanelAnim, {
        toValue: 1,
        stiffness: 220,
        damping: 22,
        mass: 0.9,
        useNativeDriver: true
      }).start();
      void loadRecentImages();
      return;
    }

    Animated.timing(attachmentPanelAnim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) setAttachmentPanelVisible(false);
    });
  }, [attachmentMenuOpen, attachmentPanelAnim, attachmentToggleAnim, loadRecentImages]);

  return {
    prompt,
    setPrompt,
    slashOpen,
    setSlashOpen,
    slashActiveIndex,
    slashSuggestions,
    attachmentMenuOpen,
    setAttachmentMenuOpen,
    attachmentPanelVisible,
    recentImages,
    recentImagesLoading,
    recentImagesLoadingMore,
    recentImagesHasNext,
    composerPickerOpen,
    openComposerPicker,
    closeComposerPicker,
    actionIconAnim,
    attachmentToggleAnim,
    attachmentPanelStyle,
    recentScrollerHeight,
    canSendNow,
    canAbortNow,
    handlePromptChange,
    handleSlashSelect,
    handleToggleAttachmentMenu,
    handleDismissAttachmentPanel,
    maybeLoadMoreRecentImages
  };
}
