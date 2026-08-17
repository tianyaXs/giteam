import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMobileTheme } from '../../features/theme/ThemeProvider';
import { useThemeOverride } from '../../features/theme/useThemeOverride';
import { startThemeCircularReveal } from '../../features/theme/ThemeCircularReveal';
import { useSpeechInputSetting } from '../../features/speech/useSpeechInputSetting';
import { useFocusModeSetting } from '../../features/chat/useFocusModeSetting';
import { SettingsModelsPanel } from '../../features/workspace/ModelManagerScreen';
import { toText } from '../../lib/text';
import type { ProjectTreeNode, DrawerSessionRow } from '../../features/chat/useLeftDrawerController';
import { AccordionBody } from '../AccordionBody';
import { MobileConfirmDialog } from './MobileConfirmDialog';

/**
 * ChatGPT 风格中性色板（抽屉自持，与 themes.ts 数值协调）。
 */
type DrawerPalette = {
  bg: string;
  surface: string;
  hover: string;
  text: string;
  sub: string;
  faint: string;
  line: string;
  dot: string;
  warn: string;
  danger: string;
  dangerText: string;
};

const LIGHT: DrawerPalette = {
  bg: '#FFFFFF',
  surface: '#F3F3F5',
  hover: '#F0F0F3',
  text: '#1A1A1F',
  sub: '#5C5C66',
  faint: '#9A9AA4',
  line: 'rgba(0,0,0,0.07)',
  dot: '#10A37F',
  warn: '#E08A3C',
  danger: '#E3484F',
  dangerText: '#FFFFFF'
};

const DARK: DrawerPalette = {
  bg: '#1B1B1D',
  surface: '#2A2A2E',
  hover: '#2F2F34',
  text: '#EDEDF0',
  sub: '#A8A8B3',
  faint: '#74747E',
  line: 'rgba(255,255,255,0.08)',
  dot: '#10A37F',
  warn: '#E0A03C',
  danger: '#E3484F',
  dangerText: '#FFFFFF'
};

const DRAWER_STYLES = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 4,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  newChatBtn: {
    alignSelf: 'stretch',
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center'
  },
  footer: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth
  }
});

function useDrawerPalette(): DrawerPalette {
  const { colors } = useMobileTheme();
  return colors.isDark ? DARK : LIGHT;
}

function HoverRow(props: {
  active?: boolean;
  hoverColor: string;
  radius?: number;
  marginH?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  children: React.ReactNode;
}) {
  const { active, hoverColor, radius = 10, marginH = 0, onPress, onLongPress, children } = props;
  const isActive = !!active;
  const sv = useSharedValue(isActive ? 1 : 0);
  useEffect(() => {
    sv.value = withTiming(isActive ? 1 : 0, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [isActive, sv]);
  const aStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sv.value, [0, 1], ['transparent', hoverColor]) as string
  }));
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      onPressIn={() => {
        if (!isActive) sv.value = withTiming(1, { duration: 130 });
      }}
      onPressOut={() => {
        if (!isActive) sv.value = withTiming(0, { duration: 200 });
      }}
    >
      <Animated.View style={[{ borderRadius: radius, marginHorizontal: marginH }, aStyle]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

function StatusDot(props: { color: string; pulsing?: boolean; size?: number }) {
  const { color, pulsing = false, size = 8 } = props;
  const op = useSharedValue(1);
  useEffect(() => {
    if (pulsing) {
      op.value = withRepeat(withTiming(0.3, { duration: 760, easing: Easing.inOut(Easing.ease) }), -1, true);
    } else {
      op.value = withTiming(1, { duration: 200 });
    }
  }, [pulsing, op]);
  const aStyle = useAnimatedStyle(() => ({ opacity: op.value }));
  return (
    <Animated.View
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, aStyle]}
    />
  );
}

const SessionRowView = React.memo(function SessionRowView(props: {
  session: DrawerSessionRow;
  palette: DrawerPalette;
  indent?: boolean;
  onSelect: (sessionId: string, worktree: string, active: boolean) => void;
  onRequestArchive?: (session: DrawerSessionRow) => void;
}) {
  const { session, palette: p, indent, onSelect, onRequestArchive } = props;
  const busy = session.status === 'busy' || session.status === 'retry';
  const title = toText(session.title).trim() || '新会话';

  return (
    <HoverRow
      active={session.active}
      hoverColor={p.hover}
      radius={10}
      marginH={8}
      onPress={() => onSelect(session.id, session.worktree, session.active)}
      onLongPress={onRequestArchive ? () => onRequestArchive(session) : undefined}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 44,
          paddingLeft: indent ? 48 : 14,
          paddingRight: 14,
          paddingVertical: 10
        }}
      >
        <RNText
          numberOfLines={1}
          style={{
            flex: 1,
            fontSize: 15.5,
            color: p.text,
            fontWeight: session.active ? '600' : '400',
            opacity: session.active ? 1 : 0.88
          }}
        >
          {title}
        </RNText>
        {busy ? (
          <View style={{ marginLeft: 8 }}>
            <StatusDot color={p.warn} pulsing size={7} />
          </View>
        ) : null}
      </View>
    </HoverRow>
  );
});

function truncateProjectLabel(name: string, max = 12): string {
  const raw = toText(name).trim();
  if (!raw) return '';
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

function NewTaskFooterButton(props: {
  projectName: string;
  onPress: () => void;
  dark: boolean;
}) {
  const { projectName, onPress, dark } = props;
  const nextTitle = truncateProjectLabel(projectName) || '新聊天';
  const [displayTitle, setDisplayTitle] = useState(nextTitle);
  const labelWidthSv = useSharedValue(0);
  const opacitySv = useSharedValue(1);
  const widthsRef = useRef<Record<string, number>>({});
  const animGenRef = useRef(0);
  const displayRef = useRef(nextTitle);
  displayRef.current = displayTitle;

  const finishSwap = useCallback(
    (target: string, gen: number) => {
      if (animGenRef.current !== gen) return;
      setDisplayTitle(target);
      const w = widthsRef.current[target];
      if (typeof w === 'number' && w > 0) {
        labelWidthSv.value = withTiming(Math.max(8, w), {
          duration: 340,
          easing: Easing.out(Easing.cubic)
        });
      }
      opacitySv.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) });
    },
    [labelWidthSv, opacitySv]
  );

  useEffect(() => {
    if (nextTitle === displayRef.current) return;
    const gen = ++animGenRef.current;
    const known = widthsRef.current[nextTitle];
    if (typeof known === 'number' && known > 0) {
      labelWidthSv.value = withTiming(Math.max(8, known), {
        duration: 340,
        easing: Easing.out(Easing.cubic)
      });
    }
    opacitySv.value = withTiming(0, { duration: 130, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (!finished) return;
      runOnJS(finishSwap)(nextTitle, gen);
    });
  }, [finishSwap, labelWidthSv, nextTitle, opacitySv]);

  const rememberWidth = useCallback(
    (key: string, w: number) => {
      if (w <= 0) return;
      widthsRef.current[key] = w;
      if (key === displayRef.current) {
        if (labelWidthSv.value <= 0) {
          labelWidthSv.value = w;
        } else if (Math.abs(labelWidthSv.value - w) > 1) {
          labelWidthSv.value = withTiming(w, {
            duration: 340,
            easing: Easing.out(Easing.cubic)
          });
        }
      }
    },
    [labelWidthSv]
  );

  const labelBoxStyle = useAnimatedStyle(() => ({
    width: labelWidthSv.value > 0 ? labelWidthSv.value : undefined,
    overflow: 'hidden' as const,
    opacity: opacitySv.value
  }));

  const fg = dark ? '#1A1A1F' : '#FFFFFF';
  const bg = dark ? '#FFFFFF' : '#1A1A1F';

  return (
    <Pressable onPress={onPress} style={{ flex: 1, marginRight: 12 }} accessibilityLabel={`${nextTitle}，新建聊天`}>
      <View style={[DRAWER_STYLES.newChatBtn, { backgroundColor: bg, overflow: 'hidden' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Feather name="edit" size={16} color={fg} style={{ marginRight: 8 }} />
          <Animated.View style={labelBoxStyle}>
            <RNText numberOfLines={1} style={{ fontSize: 15, fontWeight: '600', color: fg }}>
              {displayTitle}
            </RNText>
          </Animated.View>
        </View>
        <RNText
          numberOfLines={1}
          pointerEvents="none"
          style={{ position: 'absolute', opacity: 0, fontSize: 15, fontWeight: '600' }}
          onLayout={(evt) => rememberWidth(displayTitle, Math.ceil(evt.nativeEvent.layout.width))}
        >
          {displayTitle}
        </RNText>
        {nextTitle !== displayTitle ? (
          <RNText
            numberOfLines={1}
            pointerEvents="none"
            style={{ position: 'absolute', opacity: 0, fontSize: 15, fontWeight: '600' }}
            onLayout={(evt) => rememberWidth(nextTitle, Math.ceil(evt.nativeEvent.layout.width))}
          >
            {nextTitle}
          </RNText>
        ) : null}
      </View>
    </Pressable>
  );
}

export function SessionListDrawer(props: {
  sessionSearch: string;
  projectTrees: ProjectTreeNode[];
  searchSessionRows: DrawerSessionRow[];
  isEmpty: boolean;
  currentWorkspaceName: string;
  onPressProject: (worktree: string, hasSessions: boolean) => void;
  onNewSession: () => void;
  onChangeSessionSearch: (value: string) => void;
  onSelectSession: (sessionId: string, worktree: string, active: boolean) => void;
  onArchiveSession?: (sessionId: string, worktree: string) => void;
  onShowMore: (worktree: string) => void;
  onOpenSettings?: () => void;
}) {
  const {
    isEmpty,
    currentWorkspaceName,
    onArchiveSession,
    onChangeSessionSearch,
    onNewSession,
    onOpenSettings,
    onSelectSession,
    onShowMore,
    onPressProject,
    projectTrees,
    searchSessionRows,
    sessionSearch
  } = props;
  const insets = useSafeAreaInsets();
  const { colors } = useMobileTheme();
  const p = useDrawerPalette();
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [headerWidth, setHeaderWidth] = React.useState(0);
  const searchInputRef = useRef<TextInput>(null);
  const searchProgress = useSharedValue(0);
  const searching = sessionSearch.trim().length > 0 || searchOpen;
  const [archiveDialog, setArchiveDialog] = useState<
    | { mode: 'confirm'; sessionId: string; worktree: string; title: string }
    | { mode: 'blocked' }
    | null
  >(null);

  // 抽屉铺满到底；底栏自行吃 insets.bottom，避免 SafeArea 底边露出突兀白条
  const footerPad = Math.max(10, insets.bottom);

  const requestArchiveSession = useCallback(
    (session: DrawerSessionRow) => {
      if (!onArchiveSession) return;
      const busy = session.status === 'busy' || session.status === 'retry';
      if (busy) {
        setArchiveDialog({ mode: 'blocked' });
        return;
      }
      setArchiveDialog({
        mode: 'confirm',
        sessionId: session.id,
        worktree: session.worktree,
        title: toText(session.title).trim() || '新会话'
      });
    },
    [onArchiveSession]
  );

  const closeArchiveDialog = useCallback(() => {
    setArchiveDialog(null);
  }, []);

  const confirmArchiveDialog = useCallback(() => {
    if (!archiveDialog || archiveDialog.mode !== 'confirm' || !onArchiveSession) {
      setArchiveDialog(null);
      return;
    }
    const { sessionId, worktree } = archiveDialog;
    setArchiveDialog(null);
    onArchiveSession(sessionId, worktree);
  }, [archiveDialog, onArchiveSession]);

  const focusSearchInput = React.useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  const finishCloseSearch = React.useCallback(() => {
    setSearchOpen(false);
  }, []);

  const openSearch = React.useCallback(() => {
    setSearchOpen(true);
    searchProgress.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(focusSearchInput)();
    });
  }, [focusSearchInput, searchProgress]);

  const closeSearch = React.useCallback(() => {
    Keyboard.dismiss();
    onChangeSessionSearch('');
    searchProgress.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(finishCloseSearch)();
    });
  }, [finishCloseSearch, onChangeSessionSearch, searchProgress]);

  const titleAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(searchProgress.value, [0, 0.45], [1, 0]),
    transform: [{ translateX: interpolate(searchProgress.value, [0, 1], [0, -12]) }]
  }));

  const searchShellStyle = useAnimatedStyle(() => {
    const maxW = Math.max(headerWidth, 36);
    return {
      width: interpolate(searchProgress.value, [0, 1], [36, maxW]),
      paddingLeft: interpolate(searchProgress.value, [0, 1], [0, 12])
    };
  });

  const searchFieldStyle = useAnimatedStyle(() => ({
    opacity: interpolate(searchProgress.value, [0.35, 1], [0, 1]),
    flex: 1
  }));

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <View style={[DRAWER_STYLES.header, Platform.OS === 'ios' ? { paddingTop: Math.max(insets.top, 8) } : null]}>
        <View
          style={{ flex: 1, height: 44, justifyContent: 'center' }}
          onLayout={(evt) => {
            const w = Math.ceil(evt.nativeEvent.layout.width);
            if (w > 0 && w !== headerWidth) setHeaderWidth(w);
          }}
        >
          <Animated.View style={[{ flex: 1, justifyContent: 'center', paddingRight: 44 }, titleAnimStyle]} pointerEvents={searchOpen ? 'none' : 'auto'}>
            <RNText style={{ fontSize: 20, fontWeight: '700', color: p.text, letterSpacing: -0.3 }}>Giteam</RNText>
          </Animated.View>

          <Animated.View
            style={[
              {
                position: 'absolute',
                right: 0,
                top: 4,
                height: 36,
                borderRadius: 18,
                backgroundColor: p.surface,
                flexDirection: 'row',
                alignItems: 'center',
                overflow: 'hidden'
              },
              searchShellStyle
            ]}
          >
            <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }, searchFieldStyle]}>
              <Feather name="search" size={15} color={p.faint} style={{ marginRight: 8 }} />
              <TextInput
                ref={searchInputRef}
                style={{ flex: 1, height: 36, fontSize: 15, color: p.text, padding: 0 }}
                value={sessionSearch}
                onChangeText={onChangeSessionSearch}
                autoCapitalize="none"
                placeholder="搜索会话"
                placeholderTextColor={p.faint}
                editable={searchOpen}
              />
            </Animated.View>
            <Pressable
              onPress={() => {
                if (searchOpen) closeSearch();
                else openSearch();
              }}
              hitSlop={8}
              accessibilityLabel={searchOpen ? '关闭搜索' : '搜索会话'}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Feather name={searchOpen ? 'x' : 'search'} size={16} color={p.text} />
            </Pressable>
          </Animated.View>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1, minHeight: 0 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        {searching && sessionSearch.trim() ? (
          <>
            <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4 }}>
              <RNText style={{ fontSize: 13, fontWeight: '600', color: p.text }}>搜索结果</RNText>
            </View>
            {searchSessionRows.map((session) => (
              <SessionRowView
                key={`${session.worktree}:${session.id}`}
                session={session}
                palette={p}
                onSelect={onSelectSession}
                onRequestArchive={onArchiveSession ? requestArchiveSession : undefined}
              />
            ))}
            {searchSessionRows.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 }}>
                <RNText style={{ fontSize: 14, color: p.sub }}>无匹配会话</RNText>
              </View>
            ) : null}
          </>
        ) : (
          <>
            <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4 }}>
              <RNText style={{ fontSize: 13, fontWeight: '600', color: p.text }}>最近</RNText>
            </View>
            {projectTrees.map((project) => {
              const hasSessions = project.hasSessions ?? project.totalCount > 0;
              // 有会话时只标会话选中，避免目录+会话双重高亮；空项目才用目录选中态
              const projectRowActive = project.isCurrent && !hasSessions;
              return (
                <View key={project.worktree || project.id}>
                  <HoverRow
                    active={projectRowActive}
                    hoverColor={p.hover}
                    radius={12}
                    marginH={8}
                    onPress={() => onPressProject(project.worktree, hasSessions)}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        minHeight: 44,
                        paddingHorizontal: 10,
                        paddingVertical: 8
                      }}
                    >
                      <View
                        style={{
                          width: 2,
                          height: 14,
                          borderRadius: 1,
                          marginRight: 10,
                          backgroundColor: project.isCurrent ? p.text : 'transparent',
                          opacity: project.isCurrent ? 0.55 : 0
                        }}
                      />
                      <Feather
                        name="folder"
                        size={18}
                        color={project.isCurrent ? p.text : p.sub}
                        style={{ marginRight: 10 }}
                      />
                      <RNText
                        numberOfLines={1}
                        style={{
                          flex: 1,
                          fontSize: 16,
                          color: p.text,
                          fontWeight: project.isCurrent ? '600' : '500'
                        }}
                      >
                        {toText(project.name)}
                      </RNText>
                      {hasSessions ? (
                        <RNText style={{ fontSize: 12, fontWeight: '500', color: p.faint, marginLeft: 8 }}>
                          {project.totalCount}
                        </RNText>
                      ) : (
                        <RNText style={{ fontSize: 12, color: project.isCurrent ? p.sub : p.faint, marginLeft: 8 }}>
                          {project.isCurrent ? '当前' : '空'}
                        </RNText>
                      )}
                    </View>
                  </HoverRow>

                  {hasSessions ? (
                    <AccordionBody open={project.expanded}>
                      {project.sessions.map((session) => (
                        <SessionRowView
                          key={`${session.worktree}:${session.id}`}
                          session={session}
                          palette={p}
                          indent
                          onSelect={onSelectSession}
                          onRequestArchive={onArchiveSession ? requestArchiveSession : undefined}
                        />
                      ))}
                      {project.showMore ? (
                        <HoverRow
                          hoverColor={p.hover}
                          radius={12}
                          marginH={8}
                          onPress={() => onShowMore(project.worktree)}
                        >
                          <View style={{ alignItems: 'flex-start', paddingVertical: 10, paddingLeft: 48 }}>
                            <RNText style={{ fontSize: 14, fontWeight: '500', color: p.sub }}>加载更多</RNText>
                          </View>
                        </HoverRow>
                      ) : null}
                    </AccordionBody>
                  ) : null}
                </View>
              );
            })}

            {isEmpty && projectTrees.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
                <RNText style={{ fontSize: 15, fontWeight: '600', color: p.sub }}>暂无项目</RNText>
                <RNText style={{ marginTop: 6, fontSize: 13, color: p.faint, textAlign: 'center' }}>
                  请先在桌面端导入仓库
                </RNText>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <View
        style={[
          DRAWER_STYLES.footer,
          {
            paddingBottom: footerPad,
            borderTopColor: p.line,
            backgroundColor: p.bg
          }
        ]}
      >
        <NewTaskFooterButton
          projectName={currentWorkspaceName}
          onPress={onNewSession}
          dark={colors.isDark}
        />
        <Pressable onPress={onOpenSettings} accessibilityLabel="打开设置">
          <View
            style={[
              DRAWER_STYLES.avatarBtn,
              { backgroundColor: p.surface }
            ]}
          >
            <Feather name="settings" size={18} color={p.text} />
          </View>
        </Pressable>
      </View>

      <MobileConfirmDialog
        visible={!!archiveDialog}
        title={archiveDialog?.mode === 'blocked' ? '无法归档' : '归档会话'}
        message={
          archiveDialog?.mode === 'blocked'
            ? '进行中的会话不能归档，请先等待结束或停止生成。'
            : archiveDialog?.mode === 'confirm'
              ? `确定归档「${archiveDialog.title}」吗？归档后侧栏将不再显示该会话。`
              : ''
        }
        cancelLabel="取消"
        confirmLabel={archiveDialog?.mode === 'blocked' ? '知道了' : '归档'}
        destructive={archiveDialog?.mode === 'confirm'}
        noticeOnly={archiveDialog?.mode === 'blocked'}
        onCancel={closeArchiveDialog}
        onConfirm={confirmArchiveDialog}
      />
    </View>
  );
}

export function ConnectionDrawer(props: {
  currentWorkspaceName: string;
  serverUrl: string;
  token: string;
  onClose?: () => void;
  onOpenDrawer?: () => void;
  onResetAuth: () => void;
  autoAcceptPermissions: boolean;
  onToggleAutoAccept: () => void;
  settingsTab?: 'general' | 'models';
  onModelsChanged?: () => void;
}) {
  const {
    autoAcceptPermissions,
    currentWorkspaceName: _currentWorkspaceName,
    onClose,
    onOpenDrawer,
    onToggleAutoAccept,
    onResetAuth,
    serverUrl,
    token,
    settingsTab = 'general',
    onModelsChanged
  } = props;
  void _currentWorkspaceName;
  const insets = useSafeAreaInsets();
  const p = useDrawerPalette();
  const { colors } = useMobileTheme();
  const override = useThemeOverride();
  const themeBtnRef = React.useRef<View>(null);
  const [language, setLanguage] = React.useState<'zh-CN' | 'en'>('zh-CN');
  const languageLabel = language === 'zh-CN' ? '简体中文' : 'English';
  const [tab, setTab] = React.useState<'general' | 'models'>(settingsTab);
  const speechInput = useSpeechInputSetting();
  const focusMode = useFocusModeSetting();
  const showSpeechDownloadUi = speechInput.needsDownload;

  React.useEffect(() => {
    setTab(settingsTab);
  }, [settingsTab]);

  const startAppearanceReveal = React.useCallback(() => {
    const to = override === 'light' ? 'dark' : 'light';
    const node = themeBtnRef.current;
    if (!node || typeof (node as any).measureInWindow !== 'function') {
      startThemeCircularReveal({ x: 40, y: 120 }, to);
      return;
    }
    (node as View).measureInWindow((x, y, w, h) => {
      startThemeCircularReveal(
        {
          x: x + w / 2,
          y: y + h / 2
        },
        to
      );
    });
  }, [override]);

  const cycleLanguage = () => {
    setLanguage((prev) => (prev === 'zh-CN' ? 'en' : 'zh-CN'));
  };

  const pageBg = colors.background;
  const cardBg = colors.card;
  const divider = colors.border;

  return (
    <View style={{ flex: 1, backgroundColor: pageBg }}>
      <View
        style={{
          height: 52,
          marginTop: Platform.OS === 'ios' ? Math.max(insets.top, 6) : 0,
          paddingHorizontal: 10,
          flexDirection: 'row',
          alignItems: 'center'
        }}
      >
        <Pressable
          onPress={onOpenDrawer}
          hitSlop={8}
          accessibilityLabel="打开左侧面板"
          style={{
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Feather name="menu" size={22} color={p.text} />
        </Pressable>
        <RNText
          style={{
            flex: 1,
            marginHorizontal: 10,
            fontSize: 17,
            fontWeight: '600',
            color: p.text
          }}
        >
          设置
        </RNText>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityLabel="完成并返回聊天"
          style={{
            height: 34,
            paddingHorizontal: 10,
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <RNText style={{ fontSize: 15, fontWeight: '500', color: p.sub }}>完成</RNText>
        </Pressable>
      </View>

      <View
        style={{
          marginHorizontal: 16,
          marginBottom: 12,
          padding: 3,
          borderRadius: 10,
          backgroundColor: colors.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
          flexDirection: 'row'
        }}
      >
        {([
          { key: 'general', label: '常规' },
          { key: 'models', label: '模型' }
        ] as const).map((item) => {
          const active = tab === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              style={{
                flex: 1,
                height: 32,
                borderRadius: 8,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? cardBg : 'transparent'
              }}
            >
              <RNText
                style={{
                  fontSize: 14,
                  fontWeight: active ? '600' : '500',
                  color: active ? p.text : p.faint
                }}
              >
                {item.label}
              </RNText>
            </Pressable>
          );
        })}
      </View>

      <View
        style={{ flex: 1, display: tab === 'general' ? 'flex' : 'none' }}
        pointerEvents={tab === 'general' ? 'auto' : 'none'}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 4,
            paddingBottom: Math.max(32, insets.bottom + 24)
          }}
        >
          <View style={{ borderRadius: 12, backgroundColor: cardBg, overflow: 'hidden', marginBottom: 16 }}>
            <SettingsRow
              title="外观"
              dividerColor={divider}
              textColor={p.text}
              mutedColor={p.faint}
                  trailing={
                <View ref={themeBtnRef} collapsable={false}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={override === 'light' ? '切换到深色模式' : '切换到浅色模式'}
                    hitSlop={8}
                    onPress={startAppearanceReveal}
                    style={({ pressed }) => ({
                      width: 36,
                      height: 36,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: pressed ? 0.65 : 1
                    })}
                  >
                    <Feather
                      name={override === 'light' ? 'moon' : 'sun'}
                      size={20}
                      color={p.text}
                    />
                  </Pressable>
                </View>
              }
            />
            <SettingsRow
              title="语言"
              value={languageLabel}
              dividerColor={divider}
              textColor={p.text}
              mutedColor={p.faint}
              onPress={cycleLanguage}
            />
            <SettingsRow
              title="自动批准工具"
              dividerColor={divider}
              textColor={p.text}
              mutedColor={p.faint}
              trailing={
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: autoAcceptPermissions }}
                  onPress={onToggleAutoAccept}
                  hitSlop={6}
                  style={{
                    width: 46,
                    height: 28,
                    borderRadius: 999,
                    paddingHorizontal: 2,
                    backgroundColor: autoAcceptPermissions
                      ? colors.primary
                      : colors.isDark
                        ? '#39393D'
                        : '#E5E5EA',
                    alignItems: autoAcceptPermissions ? 'flex-end' : 'flex-start',
                    justifyContent: 'center'
                  }}
                >
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 999,
                      backgroundColor: '#FFFFFF'
                    }}
                  />
                </Pressable>
              }
            />
            <SettingsRow
              title="专注模式"
              dividerColor={divider}
              textColor={p.text}
              mutedColor={p.faint}
              trailing={
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel="专注模式"
                  accessibilityHint="生成回复时收起顶栏和输入框"
                  accessibilityState={{ checked: focusMode.enabled }}
                  onPress={focusMode.toggle}
                  hitSlop={6}
                  style={{
                    width: 46,
                    height: 28,
                    borderRadius: 999,
                    paddingHorizontal: 2,
                    backgroundColor: focusMode.enabled
                      ? colors.primary
                      : colors.isDark
                        ? '#39393D'
                        : '#E5E5EA',
                    alignItems: focusMode.enabled ? 'flex-end' : 'flex-start',
                    justifyContent: 'center'
                  }}
                >
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 999,
                      backgroundColor: '#FFFFFF'
                    }}
                  />
                </Pressable>
              }
            />
            <View
              style={{
                paddingLeft: 16,
                paddingRight: 16,
                minHeight: 50,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: divider
              }}
            >
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  minWidth: 0
                }}
              >
                <RNText style={{ fontSize: 16, color: p.text, flexShrink: 0 }}>语音输入</RNText>
                {showSpeechDownloadUi && speechInput.downloading ? (
                  <>
                    <View
                      style={{
                        flex: 1,
                        height: 4,
                        borderRadius: 999,
                        overflow: 'hidden',
                        backgroundColor: colors.isDark
                          ? 'rgba(255,255,255,0.08)'
                          : 'rgba(0,0,0,0.06)',
                        minWidth: 48
                      }}
                    >
                      <View
                        style={{
                          width: `${Math.max(2, Math.min(100, speechInput.progressPercent))}%`,
                          height: '100%',
                          borderRadius: 999,
                          backgroundColor: colors.primary
                        }}
                      />
                    </View>
                    <RNText style={{ fontSize: 12, color: p.faint, flexShrink: 0 }}>
                      {Math.max(0, Math.min(100, speechInput.progressPercent))}%
                    </RNText>
                  </>
                ) : null}
                {showSpeechDownloadUi && speechInput.errorMessage && !speechInput.downloading ? (
                  <RNText
                    numberOfLines={1}
                    style={{ flex: 1, fontSize: 12, color: p.danger, minWidth: 0 }}
                  >
                    {speechInput.errorMessage}
                  </RNText>
                ) : null}
                {!showSpeechDownloadUi ? (
                  <RNText style={{ flex: 1, fontSize: 13, color: p.faint }} numberOfLines={1}>
                    系统听写
                  </RNText>
                ) : null}
              </View>
              {showSpeechDownloadUi ? (
                speechInput.downloading ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="取消下载"
                    onPress={speechInput.cancelDownload}
                    hitSlop={6}
                    style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
                  >
                    <RNText style={{ fontSize: 15, fontWeight: '500', color: p.faint }}>取消</RNText>
                  </Pressable>
                ) : speechInput.errorMessage ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="重试下载语音模型"
                    onPress={speechInput.retryDownload}
                    hitSlop={6}
                    style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
                  >
                    <RNText style={{ fontSize: 15, fontWeight: '500', color: colors.primary }}>
                      重试
                    </RNText>
                  </Pressable>
                ) : speechInput.modelReady ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="移除语音模型"
                    onPress={speechInput.removeModel}
                    hitSlop={8}
                    style={({ pressed }) => ({
                      width: 36,
                      height: 36,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: pressed ? 0.65 : 1
                    })}
                  >
                    <Feather name="trash-2" size={18} color={p.danger} />
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`下载语音模型，约 ${speechInput.sizeHintMb} MB`}
                    onPress={speechInput.startDownload}
                    hitSlop={6}
                    style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
                  >
                    <RNText style={{ fontSize: 15, fontWeight: '500', color: colors.primary }}>
                      下载
                    </RNText>
                  </Pressable>
                )
              ) : null}
            </View>
          </View>

          <Pressable
            onPress={onResetAuth}
            style={({ pressed }) => ({
              width: '100%',
              borderRadius: 12,
              backgroundColor: cardBg,
              paddingVertical: 15,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1
            })}
          >
            <RNText style={{ fontSize: 16, fontWeight: '500', color: p.danger, textAlign: 'center' }}>
              退出登录
            </RNText>
          </Pressable>
        </ScrollView>
      </View>

      <View
        style={{ flex: 1, display: tab === 'models' ? 'flex' : 'none' }}
        pointerEvents={tab === 'models' ? 'auto' : 'none'}
      >
        <SettingsModelsPanel
          active={tab === 'models'}
          serverUrl={serverUrl}
          token={token}
          onChanged={() => onModelsChanged?.()}
        />
      </View>
    </View>
  );
}

function SettingsRow(props: {
  title: string;
  value?: string;
  dividerColor: string;
  textColor: string;
  mutedColor: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
  last?: boolean;
}) {
  const { title, value, dividerColor, textColor, mutedColor, onPress, trailing, last } = props;
  const body = (
    <View
      style={{
        paddingLeft: 16,
        paddingRight: 16,
        minHeight: 50,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: dividerColor
      }}
    >
      <RNText style={{ flex: 1, fontSize: 16, color: textColor }}>{title}</RNText>
      {value ? <RNText style={{ fontSize: 15, color: mutedColor }}>{value}</RNText> : null}
      {trailing}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}>
      {body}
    </Pressable>
  );
}
