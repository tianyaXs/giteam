import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { toText } from '../../lib/text';
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
  sessionWorking: boolean;
  imageAttachments: ComposerAttachment[];
  slashCommands: SlashCommandLike[];
  setStatus: (message: string) => void;
}) {
  const { imageAttachments, sessionWorking, setStatus, slashCommands, windowWidth } = props;
  const [prompt, setPrompt] = useState('');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const suppressPromptChangeUntilRef = useRef(0);
  const lastClearedPromptRef = useRef('');
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentPanelVisible, setAttachmentPanelVisible] = useState(false);
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
  const attachmentBubbleAnims = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0)
  ]).current;

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
  // pending_retry 是发送失败收回，可直接重发，不当作处理失败拦截。
  const imageQueueFailed = imageAttachments.some((img) => img.status === 'failed');
  /**
   * 发送门闩：清空输入的同一帧就置位，覆盖「prompt 已空、sessionWorking 尚未 true」的空隙。
   * ChatGPT/Claude：发送后按钮保持 Stop，直至本轮真正结束；不因短窗 streaming 抖动闪回可发送。
   */
  const [turnAwaiting, setTurnAwaiting] = useState(false);
  /** 本轮是否已经见过 sessionWorking；未见过前用长 hold（新建会话 / 建连可能 >1s）。 */
  const sawWorkingThisTurnRef = useRef(false);

  useEffect(() => {
    if (!sessionWorking) return;
    sawWorkingThisTurnRef.current = true;
    setTurnAwaiting(true);
  }, [sessionWorking]);

  useEffect(() => {
    if (sessionWorking) return;
    if (!turnAwaiting) return;
    // 发送失败回填输入：本轮从未进入 working，立刻放行，勿卡 30s。
    if (hasSendAction && !sawWorkingThisTurnRef.current) {
      setTurnAwaiting(false);
      return;
    }
    // 尚未进入 working：拉长 hold，避免 createSession / 首包前误放行成可发送。
    // 已进入 working 再变 false：短 debounce，吃掉 SSE 重连 / status 抖一下。
    const holdMs = sawWorkingThisTurnRef.current ? 480 : 30_000;
    const timer = setTimeout(() => {
      setTurnAwaiting(false);
      sawWorkingThisTurnRef.current = false;
    }, holdMs);
    return () => clearTimeout(timer);
  }, [hasSendAction, sessionWorking, turnAwaiting]);

  const releaseTurnAwaiting = useCallback(() => {
    sawWorkingThisTurnRef.current = false;
    setTurnAwaiting(false);
  }, []);

  // 等待中永远优先 Stop（即使草稿未空）；结束后才允许发送。
  const turnInFlight = sessionWorking || turnAwaiting;
  const canAbortNow = turnInFlight;
  const canSendNow = hasSendAction && !turnInFlight && !imageQueueBusy && !imageQueueFailed;

  const recentTileSize = Math.max(70, Math.floor((Math.max(320, windowWidth - 80) - 18) / 4));
  const recentVisibleRows = Math.max(1, Math.min(3, Math.ceil((recentImages.length || 1) / 4)));
  const recentScrollerHeight = recentVisibleRows * recentTileSize + Math.max(0, recentVisibleRows - 1) * 6 + 8;

  const attachmentPanelStyle = {
    opacity: attachmentPanelAnim,
    transform: [
      {
        translateY: attachmentPanelAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [56, 0]
        })
      },
      {
        scale: attachmentPanelAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.98, 1]
        })
      }
    ]
  } as const;

  const attachmentBubbleItemStyles = attachmentBubbleAnims.map((anim) => ({
    opacity: anim,
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [14, 0]
        })
      },
      {
        scale: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.72, 1]
        })
      }
    ]
  })) as const;

  const clearPromptAfterSend = useCallback((sentText?: string) => {
    const cleared = toText(sentText).trim();
    lastClearedPromptRef.current = cleared;
    // 先闩门再清空：避免清空后一帧落入「空输入 + 非 working」→ 待机粒子闪现。
    sawWorkingThisTurnRef.current = false;
    setTurnAwaiting(true);
    // 仅挡住 IME 回填同一段；合法重输不同内容会立刻放行
    suppressPromptChangeUntilRef.current = Date.now() + 320;
    setPrompt('');
    setSlashOpen(false);
    setSlashActiveIndex(0);
  }, []);

  const handlePromptChange = useCallback((value: string) => {
    // 发送后短窗内忽略 IME 回填的同一段文字，避免「发出去了字还在」
    if (Date.now() < suppressPromptChangeUntilRef.current) {
      const next = toText(value).trim();
      if (!next || next === lastClearedPromptRef.current) {
        return;
      }
      suppressPromptChangeUntilRef.current = 0;
    }
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

  // 仅附件菜单切换时做图标过渡；勿绑 hasSendAction，否则清空/Stop 切换会缩放闪成「两套按钮」。
  useEffect(() => {
    actionIconAnim.setValue(0.7);
    Animated.timing(actionIconAnim, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [actionIconAnim, attachmentMenuOpen]);

  useEffect(() => {
    Animated.timing(attachmentToggleAnim, {
      toValue: attachmentMenuOpen ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();

    if (attachmentMenuOpen) {
      setAttachmentPanelVisible(true);
      attachmentBubbleAnims.forEach((anim) => anim.setValue(0));
      Animated.stagger(
        55,
        attachmentBubbleAnims.map((anim) =>
          Animated.spring(anim, {
            toValue: 1,
            stiffness: 280,
            damping: 18,
            mass: 0.7,
            useNativeDriver: true
          })
        )
      ).start();
      return;
    }

    Animated.parallel(
      attachmentBubbleAnims.map((anim) =>
        Animated.timing(anim, {
          toValue: 0,
          duration: 140,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true
        })
      )
    ).start(({ finished }) => {
      if (finished) setAttachmentPanelVisible(false);
    });
  }, [attachmentBubbleAnims, attachmentMenuOpen, attachmentToggleAnim]);

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
    actionIconAnim,
    attachmentToggleAnim,
    attachmentPanelStyle,
    attachmentBubbleItemStyles,
    recentScrollerHeight,
    canSendNow,
    canAbortNow,
    releaseTurnAwaiting,
    handlePromptChange,
    clearPromptAfterSend,
    handleSlashSelect,
    handleToggleAttachmentMenu,
    handleDismissAttachmentPanel,
    maybeLoadMoreRecentImages
  };
}
