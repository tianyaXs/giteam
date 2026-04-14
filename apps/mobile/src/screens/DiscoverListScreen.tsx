import React from 'react';
import { Animated, FlatList, Pressable, SafeAreaView, Text, TextInput, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

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

  return (
    <SafeAreaView style={styles.discoverSafe}>
      <View style={styles.discoverListWrap}>
        <View style={styles.discoverTitleRow}>
          <View style={styles.discoverTitleSideLeft}>
            <Pressable style={styles.discoverBackBtn} onPress={onBack} hitSlop={10}>
              <Text style={styles.discoverBackIcon}>‹</Text>
            </Pressable>
          </View>
          <Text style={styles.discoverTitle}>{title}</Text>
          <View style={styles.discoverTitleSideRight} />
        </View>

        <View style={styles.discoverListMetaRow}>
          <Text style={styles.discoverListMetaText}>{discoveringUi ? '扫描中…' : `设备数：${devices.length}`}</Text>
          <Pressable style={styles.discoverRescanBtn} onPress={onRescan} disabled={discoveringUi}>
            <Text style={styles.discoverRescanTxt}>{discoveringUi ? '扫描中' : '重新扫描'}</Text>
          </Pressable>
        </View>

        <FlatList
          style={styles.discoverList}
          contentContainerStyle={styles.discoverListContent}
          data={devices}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.discoverListEmpty}>暂无设备</Text>}
          renderItem={({ item }) => {
            const title = `${item.host}:${item.port}`;
            const sub = item.offline ? '离线（历史记录）' : item.noAuth ? '无需验证码' : '需要验证码';
            const canConnect = !item.offline && connectingDiscoverId !== item.id;
            return (
              <View style={styles.discoverListItem}>
                <View style={styles.discoverListItemMain}>
                  <View style={item.offline ? styles.discoverDotOffline : styles.discoverDotOnline} />
                  <View style={styles.discoverListItemText}>
                    <Text numberOfLines={1} style={styles.discoverListItemTitle}>
                      {title}
                    </Text>
                    <Text numberOfLines={1} style={styles.discoverListItemSub}>
                      {sub}
                    </Text>
                  </View>
                </View>
                <Pressable
                  style={item.offline ? styles.discoverListConnectBtnOff : styles.discoverListConnectBtn}
                  onPress={() => onConnectPress(item)}
                  disabled={!canConnect}
                >
                  <Text style={item.offline ? styles.discoverListConnectTxtOff : styles.discoverListConnectTxt}>
                    {connectingDiscoverId === item.id ? '连接中…' : '连接'}
                  </Text>
                </Pressable>
              </View>
            );
          }}
        />

        {connectingDiscoverId ? (
          <View style={styles.discoverConnectProgressRow}>
            <View style={styles.discoverDeviceProgressTrack}>
              <Animated.View style={[styles.discoverDeviceProgressBar, { transform: [{ scaleX: connectProgressScaleX }] }]} />
            </View>
            <Text style={styles.discoverDeviceProgressText}>正在建立连接通道…</Text>
          </View>
        ) : null}

        {pairPromptOpen ? (
          <View style={styles.pairPromptMask}>
            <Pressable style={styles.pairPromptBackdrop} onPress={onPairPromptCancel} />
            <View style={styles.pairPromptCard}>
              <Text style={styles.pairPromptTitle}>输入验证码</Text>
              <Text style={styles.pairPromptSub} numberOfLines={2}>
                {pairPromptHostPort}
              </Text>
              <TextInput
                style={styles.pairPromptInput}
                value={pairPromptValue}
                onChangeText={onPairPromptChange}
                autoCapitalize="none"
                keyboardType="number-pad"
                placeholder="验证码"
                placeholderTextColor="#9aa6b6"
              />
              <View style={styles.pairPromptActions}>
                <Pressable style={styles.pairPromptBtnGhost} onPress={onPairPromptCancel}>
                  <Text style={styles.pairPromptBtnGhostTxt}>取消</Text>
                </Pressable>
                <Pressable style={styles.pairPromptBtnPrimary} onPress={onPairPromptConfirm}>
                  <Text style={styles.pairPromptBtnPrimaryTxt}>连接</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

