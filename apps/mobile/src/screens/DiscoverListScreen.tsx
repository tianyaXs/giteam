import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Animated, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMobileTheme } from '../features/theme/ThemeProvider';

export type DiscoverListRow = {
  id: string;
  host: string;
  port: number;
  noAuth: boolean;
  offline: boolean;
};

export type DiscoverListScreenStyles = Record<string, any>;

export function DiscoverListScreen(props: {
  styles: DiscoverListScreenStyles;
  discoverSafeStyle?: StyleProp<ViewStyle>;
  title: string;
  discoveringUi: boolean;
  devices: DiscoverListRow[];
  connectingDiscoverId: string;
  connectProgressScaleX: Animated.AnimatedInterpolation<number>;

  pairPromptOpen: boolean;
  pairPromptHostPort: string;
  pairPromptValue: string;

  onBack: () => void;
  onRescan: () => void;
  onConnectPress: (item: DiscoverListRow) => void;
  onPairPromptChange: (v: string) => void;
  onPairPromptCancel: () => void;
  onPairPromptConfirm: () => void;
}) {
  const {
    styles,
    title,
    discoveringUi,
    devices,
    connectingDiscoverId,
    connectProgressScaleX,
    pairPromptOpen,
    pairPromptHostPort,
    pairPromptValue,
    onBack,
    onRescan,
    onConnectPress,
    onPairPromptChange,
    onPairPromptCancel,
    onPairPromptConfirm
  } = props;
  const { colors } = useMobileTheme();

  return (
    <SafeAreaView style={[styles.discoverSafe, { backgroundColor: colors.background }]}>
      <View style={styles.discoverListWrap}>
        <View style={styles.discoverTitleRow}>
          <View style={styles.discoverTitleSideLeft}>
            <Pressable
              style={[styles.discoverBackBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={onBack}
              hitSlop={10}
            >
              <Text style={[styles.discoverBackIcon, { color: colors.text }]}>‹</Text>
            </Pressable>
          </View>
          <Text style={[styles.discoverTitle, { color: colors.text }]}>{title}</Text>
          <View style={styles.discoverTitleSideRight} />
        </View>

        <View style={styles.discoverListMetaRow}>
          <Text style={[styles.discoverListMetaText, { color: colors.muted }]}>
            {discoveringUi ? '扫描中…' : `设备数：${devices.length}`}
          </Text>
          <Pressable
            style={[styles.discoverRescanBtn, { backgroundColor: colors.primary }]}
            onPress={onRescan}
            disabled={discoveringUi}
          >
            <Text style={[styles.discoverRescanTxt, { color: colors.primaryText }]}>
              {discoveringUi ? '扫描中' : '重新扫描'}
            </Text>
          </Pressable>
        </View>

        <FlatList
          style={styles.discoverList}
          contentContainerStyle={styles.discoverListContent}
          data={devices}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={[styles.discoverListEmpty, { color: colors.muted }]}>暂无设备</Text>}
          renderItem={({ item }) => {
            const title = `${item.host}:${item.port}`;
            const sub = item.offline ? '离线（历史记录）' : item.noAuth ? '无需验证码' : '需要验证码';
            const canConnect = !item.offline && connectingDiscoverId !== item.id;
            return (
              <View style={[styles.discoverListItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.discoverListItemMain}>
                  <View
                    style={[
                      item.offline ? styles.discoverDotOffline : styles.discoverDotOnline,
                      !item.offline ? { backgroundColor: colors.primary } : null
                    ]}
                  />
                  <View style={styles.discoverListItemText}>
                    <Text numberOfLines={1} style={[styles.discoverListItemTitle, { color: colors.text }]}>
                      {title}
                    </Text>
                    <Text numberOfLines={1} style={[styles.discoverListItemSub, { color: colors.muted }]}>
                      {sub}
                    </Text>
                  </View>
                </View>
                <Pressable
                  style={[
                    item.offline ? styles.discoverListConnectBtnOff : styles.discoverListConnectBtn,
                    !item.offline
                      ? { backgroundColor: colors.primary }
                      : { backgroundColor: colors.sidebar }
                  ]}
                  onPress={() => onConnectPress(item)}
                  disabled={!canConnect}
                >
                  <Text
                    style={[
                      item.offline ? styles.discoverListConnectTxtOff : styles.discoverListConnectTxt,
                      { color: item.offline ? colors.muted : colors.primaryText }
                    ]}
                  >
                    {connectingDiscoverId === item.id ? '连接中…' : '连接'}
                  </Text>
                </Pressable>
              </View>
            );
          }}
        />

        {connectingDiscoverId ? (
          <View style={styles.discoverConnectProgressRow}>
            <View style={[styles.discoverDeviceProgressTrack, { backgroundColor: colors.card }]}>
              <Animated.View
                style={[
                  styles.discoverDeviceProgressBar,
                  { backgroundColor: colors.primary, transform: [{ scaleX: connectProgressScaleX }] }
                ]}
              />
            </View>
            <Text style={[styles.discoverDeviceProgressText, { color: colors.muted }]}>正在建立连接通道…</Text>
          </View>
        ) : null}

        {pairPromptOpen ? (
          <View style={styles.pairPromptMask}>
            <Pressable style={styles.pairPromptBackdrop} onPress={onPairPromptCancel} />
            <View style={[styles.pairPromptCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.pairPromptTitle, { color: colors.text }]}>输入验证码</Text>
              <Text style={[styles.pairPromptSub, { color: colors.muted }]} numberOfLines={2}>
                {pairPromptHostPort}
              </Text>
              <TextInput
                style={[styles.pairPromptInput, { color: colors.text, backgroundColor: colors.sidebar, borderColor: colors.border }]}
                value={pairPromptValue}
                onChangeText={onPairPromptChange}
                autoCapitalize="none"
                keyboardType="number-pad"
                placeholder="验证码"
                placeholderTextColor={colors.muted}
              />
              <View style={styles.pairPromptActions}>
                <Pressable
                  style={[styles.pairPromptBtnGhost, { borderColor: colors.border }]}
                  onPress={onPairPromptCancel}
                >
                  <Text style={[styles.pairPromptBtnGhostTxt, { color: colors.muted }]}>取消</Text>
                </Pressable>
                <Pressable
                  style={[styles.pairPromptBtnPrimary, { backgroundColor: colors.primary }]}
                  onPress={onPairPromptConfirm}
                >
                  <Text style={[styles.pairPromptBtnPrimaryTxt, { color: colors.primaryText }]}>连接</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

