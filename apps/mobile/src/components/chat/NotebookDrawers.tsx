import { Feather } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { toText } from '../../lib/text';

type ProjectOption = {
  worktree: string;
  name: string;
};

type SessionRow = {
  id: string;
  title: string;
  preview: string;
  timeLabel: string;
  active: boolean;
};

type QuickSkillRef = {
  key: string;
  name: string;
  subtitle: string;
  itemCount: number;
};

type QuickMcpRef = {
  key: string;
  name: string;
  subtitle: string;
  state: string;
};

type NotebookColors = {
  left: string;
  right: string;
  paper: string;
  text: string;
  muted: string;
  faint: string;
  line: string;
  ink: string;
};

export function LeftDrawerPanel(props: {
  styles: Record<string, any>;
  colors: NotebookColors;
  pulse: Animated.Value;
  currentWorkspaceName: string;
  workspaceSwitcherOpen: boolean;
  availableProjects: ProjectOption[];
  repoPath: string;
  sessionSearch: string;
  sessionRows: SessionRow[];
  showMoreButton: boolean;
  isEmpty: boolean;
  onToggleWorkspaceSwitcher: () => void;
  onNewSession: () => void;
  onSelectProject: (worktree: string, active: boolean) => void;
  onChangeSessionSearch: (value: string) => void;
  onSelectSession: (sessionId: string, active: boolean) => void;
  onShowMore: () => void;
}) {
  const {
    availableProjects,
    colors,
    currentWorkspaceName,
    isEmpty,
    onChangeSessionSearch,
    onNewSession,
    onSelectProject,
    onSelectSession,
    onShowMore,
    onToggleWorkspaceSwitcher,
    pulse,
    repoPath,
    sessionRows,
    sessionSearch,
    showMoreButton,
    styles,
    workspaceSwitcherOpen
  } = props;

  return (
    <View style={[styles.drawerPanelLeft, { backgroundColor: colors.left }]}>
      <View style={styles.drawerHead}>
        <Text maxFontSizeMultiplier={1.05} style={[styles.drawerTitle, styles.drawerLogoTitle, { color: colors.text }]}>
          Giteam
        </Text>
      </View>
      <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerList} showsVerticalScrollIndicator={false}>
        <View style={styles.leftSectionBlock}>
          <Text style={[styles.leftSectionLabel, { color: colors.faint }]}>Workspace</Text>
          <View style={styles.leftProjectRow}>
            <Pressable style={styles.leftProjectMain} onPress={onToggleWorkspaceSwitcher}>
              <View style={[styles.leftProjectIconBox, { borderColor: colors.line, backgroundColor: colors.paper }]}>
                <Feather name="folder" size={15} color={colors.text} />
              </View>
              <View style={styles.leftProjectTextBlock}>
                <View style={styles.leftProjectTitleRow}>
                  <Text numberOfLines={1} style={[styles.workspaceSwitcherTitle, { color: colors.text }]}>
                    {currentWorkspaceName}
                  </Text>
                  <Feather name="chevron-down" size={15} color={colors.faint} />
                </View>
              </View>
            </Pressable>
            <Pressable style={[styles.leftProjectCompose, { borderColor: colors.line, backgroundColor: colors.paper }]} onPress={onNewSession}>
              <Feather name="edit-3" size={16} color={colors.muted} />
            </Pressable>
          </View>
          {workspaceSwitcherOpen ? (
            <View style={[styles.workspaceSwitcherSheetInline, { borderColor: colors.line, backgroundColor: colors.paper }]}>
              {availableProjects.map((project) => {
                const active = repoPath.trim() === project.worktree.trim();
                return (
                  <Pressable key={project.worktree} style={styles.workspaceSwitcherInlineItem} onPress={() => onSelectProject(project.worktree, active)}>
                    <Text numberOfLines={1} style={[styles.workspaceSwitcherItemTitle, { color: active ? colors.text : colors.muted }]}>
                      {toText(project.name)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
        <View style={styles.leftSearchShell}>
          <Feather name="search" size={18} color={colors.faint} />
          <TextInput
            style={[styles.drawerSessionSearchMinimal, { color: colors.text }]}
            value={sessionSearch}
            onChangeText={onChangeSessionSearch}
            autoCapitalize="none"
            placeholder="搜索会话"
            placeholderTextColor={colors.faint}
          />
        </View>
        <Animated.View style={{ opacity: pulse }}>
          <View style={styles.directoryGroupPlain}>
            {sessionRows.map((session) => (
              <Pressable
                key={session.id}
                style={session.active ? [styles.directorySessionPlainRow, styles.directorySessionPlainRowActive] : styles.directorySessionPlainRow}
                onPress={() => onSelectSession(session.id, session.active)}
              >
                <View style={session.active ? styles.leftSessionRailActive : styles.leftSessionRail} />
                <View style={styles.directorySessionPlainBody}>
                  <View style={styles.directorySessionPlainHead}>
                    <Text
                      maxFontSizeMultiplier={1.08}
                      numberOfLines={1}
                      style={[session.active ? styles.directorySessionPlainTitleActive : styles.directorySessionPlainTitle, { color: colors.text }]}
                    >
                      {session.title}
                    </Text>
                    {session.timeLabel ? <Text style={[styles.directorySessionPlainTime, { color: colors.faint }]}>{session.timeLabel}</Text> : null}
                  </View>
                  {session.preview ? (
                    <Text numberOfLines={1} style={[styles.directorySessionPlainMeta, { color: session.active ? colors.muted : colors.faint }]}>
                      {session.preview}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
          {showMoreButton ? (
            <Pressable style={styles.drawerMoreBtn} onPress={onShowMore}>
              <Text style={[styles.drawerMoreTxt, { color: colors.muted }]}>查看更多会话</Text>
            </Pressable>
          ) : null}
        </Animated.View>
        {isEmpty ? <Text style={[styles.drawerEmpty, styles.leftHandText, { color: colors.muted }]}>暂无匹配会话</Text> : null}
      </ScrollView>
    </View>
  );
}

export function RightDrawerPanel(props: {
  styles: Record<string, any>;
  colors: NotebookColors;
  pulse: Animated.Value;
  currentWorkspaceName: string;
  serverUrl: string;
  repoPath: string;
  token: string;
  noAuthToken: string;
  pairCode: string;
  extensionsLoading: boolean;
  visibleQuickSkillRefs: QuickSkillRef[];
  visibleQuickMcpRefs: QuickMcpRef[];
  onInsertQuickReference: (text: string) => void;
  onResetAuth: () => void;
}) {
  const {
    colors,
    currentWorkspaceName,
    extensionsLoading,
    noAuthToken,
    onInsertQuickReference,
    onResetAuth,
    pairCode,
    pulse,
    repoPath,
    serverUrl,
    styles,
    token,
    visibleQuickMcpRefs,
    visibleQuickSkillRefs
  } = props;

  const serverLabel = toText(serverUrl).trim().replace(/^https?:\/\//i, '');
  const workspaceLabel = currentWorkspaceName || toText(repoPath).split(/[\\/]/).filter(Boolean).pop() || '未选择';

  return (
    <View style={[styles.drawerPanelRight, { backgroundColor: colors.right }]}>
      <View style={styles.drawerHead}>
        <View style={styles.drawerHeadTop}>
          <View>
            <Text style={[styles.drawerEyebrow, styles.rightHandText, { color: colors.faint }]}>工作区</Text>
            <Text style={[styles.drawerTitle, { color: colors.text }]}>资源</Text>
            <Text style={[styles.drawerModelStatus, styles.rightHandText, { color: colors.muted }]}>连接与能力</Text>
          </View>
        </View>
      </View>
      <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerList} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: pulse }}>
          <View style={[styles.extensionSectionCard, styles.drawerConnectionCard, { backgroundColor: colors.paper, borderColor: colors.line }]}>
            <View style={styles.extensionSectionHead}>
              <View style={styles.extensionHeroOrbNeutral}>
                <Feather name="radio" size={18} color="#3b332b" />
              </View>
              <View style={styles.extensionHeroCopy}>
                <Text style={styles.extensionHeroTitle}>当前连接</Text>
                <Text style={styles.extensionHeroSub}>
                  {token === noAuthToken ? '免鉴权访问' : pairCode.trim() ? '配对已生效' : '访问令牌已启用'}
                </Text>
              </View>
            </View>
            <View style={styles.drawerConnectionMeta}>
              <View style={styles.drawerConnectionRow}>
                <Text style={styles.drawerConnectionLabel}>服务地址</Text>
                <Text numberOfLines={1} style={styles.drawerConnectionValue}>
                  {serverLabel || '未连接'}
                </Text>
              </View>
              <View style={styles.drawerConnectionRow}>
                <Text style={styles.drawerConnectionLabel}>工作区</Text>
                <Text numberOfLines={1} style={styles.drawerConnectionValue}>
                  {workspaceLabel}
                </Text>
              </View>
            </View>
            <Pressable style={[styles.drawerLogoutAction, { backgroundColor: colors.ink }]} onPress={onResetAuth}>
              <Feather name="log-out" size={15} color="#fffdf7" />
              <Text style={styles.drawerLogoutActionText}>退出授权</Text>
            </Pressable>
          </View>

          <View style={styles.quickPanelGrid}>
            <View style={[styles.quickPanelCard, { backgroundColor: colors.paper, borderColor: colors.line }]}>
              <View style={styles.extensionSectionHead}>
                <View style={styles.extensionHeroOrb}>
                  <Feather name="zap" size={18} color="#3b332b" />
                </View>
                <View style={styles.extensionHeroCopy}>
                  <Text style={styles.extensionHeroTitle}>技能</Text>
                  <Text style={styles.extensionHeroSub}>已安装能力</Text>
                </View>
              </View>
              {visibleQuickSkillRefs.length > 0 ? (
                <View style={styles.quickRefWrap}>
                  {visibleQuickSkillRefs.map((skill) => (
                    <Pressable key={skill.key} style={styles.quickRefChip} onPress={() => onInsertQuickReference(`use ${skill.name}`)}>
                      <View style={styles.quickRefChipTop}>
                        <Feather name="zap" size={12} color="#5d5345" />
                        <Text numberOfLines={1} style={styles.quickRefChipTitle}>
                          {skill.name}
                        </Text>
                      </View>
                      <Text numberOfLines={1} style={styles.quickRefChipSub}>
                        {skill.itemCount > 1 ? `${skill.subtitle} · ${skill.itemCount} 项` : skill.subtitle}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : !extensionsLoading ? (
                <Text style={[styles.drawerEmpty, styles.rightHandText]}>暂无已安装技能</Text>
              ) : null}
            </View>

            <View style={[styles.quickPanelCard, { backgroundColor: colors.paper, borderColor: colors.line }]}>
              <View style={styles.extensionSectionHead}>
                <View style={styles.extensionHeroOrbAlt}>
                  <Feather name="server" size={18} color="#3b332b" />
                </View>
                <View style={styles.extensionHeroCopy}>
                  <Text style={styles.extensionHeroTitle}>MCP</Text>
                  <Text style={styles.extensionHeroSub}>已配置服务</Text>
                </View>
              </View>
              {visibleQuickMcpRefs.length > 0 ? (
                <View style={styles.quickRefWrap}>
                  {visibleQuickMcpRefs.map((mcp) => (
                    <Pressable key={mcp.key} style={styles.quickRefChip} onPress={() => onInsertQuickReference(`use the ${mcp.name} mcp server`)}>
                      <View style={styles.quickRefChipTop}>
                        <Feather name="server" size={12} color="#5d5345" />
                        <Text numberOfLines={1} style={styles.quickRefChipTitle}>
                          {mcp.name}
                        </Text>
                      </View>
                      <Text numberOfLines={1} style={styles.quickRefChipSub}>
                        {mcp.state}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : !extensionsLoading ? (
                <Text style={[styles.drawerEmpty, styles.rightHandText]}>暂无已配置服务</Text>
              ) : null}
            </View>
          </View>

          {extensionsLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <ActivityIndicator size="small" color="#7c766c" />
              <Text style={[styles.drawerEmpty, styles.rightHandText, { marginTop: 8 }]}>正在载入资源...</Text>
            </View>
          ) : null}
        </Animated.View>
      </ScrollView>
    </View>
  );
}
