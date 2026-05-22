import React from 'react';
import { ActivityIndicator, Animated, Pressable, SafeAreaView, ScrollView, StatusBar, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { DiscoverListScreen, type DiscoverListRow } from './DiscoverListScreen';
import { ScannerScreen } from './ScannerScreen';

export function DiscoverConnectScreen(props: {
  styles: Record<string, any>;
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
  return <DiscoverListScreen {...props} />;
}

export function ScannerConnectScreen(props: {
  styles: Record<string, any>;
  statusText: string;
  scannerReady: boolean;
  scannerLocked: boolean;
  scanHitCount: number;
  lastScanAtLabel: string;
  CameraViewCompat: any;
  onCancel: () => void;
  onPickFromAlbum: () => void;
  onRescan: () => void;
  onCameraReady: () => void;
  onMountError: (e: any) => void;
  onBarcodeScanned: (e: any) => void;
}) {
  const {
    CameraViewCompat,
    lastScanAtLabel,
    onBarcodeScanned,
    onCameraReady,
    onCancel,
    onMountError,
    onPickFromAlbum,
    onRescan,
    scanHitCount,
    scannerLocked,
    scannerReady,
    statusText,
    styles
  } = props;

  return (
    <ScannerScreen
      styles={styles}
      title="扫码连接桌面端"
      subtitle="扫描设置页中的二维码即可授权"
      hint1={scannerReady ? (scannerLocked ? '已识别，处理中...' : '识别器已就绪，请将二维码放入框内') : '正在初始化相机...'}
      hint2={`识别回调次数: ${scanHitCount} ${lastScanAtLabel ? `· 最近: ${lastScanAtLabel}` : ''}`}
      hint3="如果实时扫描无反应，可点“相册识别”作为兜底。"
      statusText={statusText}
      onCancel={onCancel}
      onPickFromAlbum={onPickFromAlbum}
      onRescan={onRescan}
      CameraViewCompat={CameraViewCompat}
      onCameraReady={onCameraReady}
      onMountError={onMountError}
      onBarcodeScanned={onBarcodeScanned}
      scannerReady={scannerReady}
      scannerLocked={scannerLocked}
      scanHitCountText=""
    />
  );
}

export function AuthConnectScreen(props: {
  styles: Record<string, any>;
  backgroundColor: string;
  busy: boolean;
  statusText: string;
  serverUrlInput: string;
  pairCode: string;
  preferHttps: boolean;
  launchOverlay?: React.ReactNode;
  onChangeServerUrl: (value: string) => void;
  onChangePairCode: (value: string) => void;
  onTogglePreferHttps: () => void;
  onOpenDiscover: () => void;
  onOpenScanner: () => void;
  onSubmit: () => void;
}) {
  const {
    backgroundColor,
    busy,
    launchOverlay,
    onChangePairCode,
    onChangeServerUrl,
    onOpenDiscover,
    onOpenScanner,
    onSubmit,
    onTogglePreferHttps,
    pairCode,
    preferHttps,
    serverUrlInput,
    statusText,
    styles
  } = props;
  const showAuthNotice = busy || (statusText && statusText.trim() && statusText.trim() !== '准备就绪');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor }]}>
      <StatusBar barStyle="dark-content" backgroundColor={backgroundColor} translucent={false} />
      <ScrollView style={styles.authScroll} contentContainerStyle={styles.authContainerCenter} keyboardShouldPersistTaps="handled">
        <View style={styles.authPageFrame}>
          <View style={styles.authHeroPanel}>
            <View style={styles.authHeroOrb} />
            <View style={styles.authFormWrap}>
              <View style={styles.authHeroCopy}>
                <Text style={styles.authKicker}>Remote AI Assistant</Text>
                <Text style={styles.authTitle}>Giteam</Text>
                <Text style={styles.authSub}>连接远程 AI 助手，在手机上继续桌面端任务与会话</Text>
              </View>

              <View style={styles.authCard}>
                <View style={styles.authFieldGroup}>
                  <Text style={styles.authFieldLabel}>服务地址</Text>
                  <View style={styles.authUrlRow}>
                    <TextInput
                      style={styles.authInputUrl}
                      value={serverUrlInput}
                      onChangeText={onChangeServerUrl}
                      autoCapitalize="none"
                      placeholder="输入地址或 IP:端口，如 43.161.223.16:41000"
                      placeholderTextColor="#9aa6b6"
                    />
                    <Pressable style={styles.authScanInlineBtn} onPress={onOpenScanner}>
                      <View style={styles.authScanIconFrame}>
                        <View style={styles.authScanIconLt} />
                        <View style={styles.authScanIconRt} />
                        <View style={styles.authScanIconLb} />
                        <View style={styles.authScanIconRb} />
                      </View>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.authFieldGroup}>
                  <Text style={styles.authFieldLabel}>验证码（选填）</Text>
                  <TextInput
                    style={styles.authInput}
                    value={pairCode}
                    onChangeText={onChangePairCode}
                    autoCapitalize="none"
                    keyboardType="number-pad"
                    placeholder="输入验证码，免授权模式可留空"
                    placeholderTextColor="#9aa6b6"
                  />
                </View>

                <View style={styles.authAssistRow}>
                  <Pressable style={styles.authTinyCheckWrap} onPress={onTogglePreferHttps}>
                    <View style={preferHttps ? styles.authTinyCheckOn : styles.authTinyCheckOff} />
                    <Text style={styles.authTinyText}>优先使用 HTTPS</Text>
                  </Pressable>
                  <View style={styles.authPillRow}>
                    <Pressable style={styles.authSecondaryPill} onPress={onOpenDiscover} disabled={busy}>
                      <Feather name="wifi" size={14} color="#5d5345" />
                      <Text style={styles.authSecondaryPillText}>发现设备</Text>
                    </Pressable>
                    <Pressable style={styles.authSecondaryPill} onPress={onOpenScanner} disabled={busy}>
                      <Feather name="maximize" size={14} color="#5d5345" />
                      <Text style={styles.authSecondaryPillText}>扫码</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.authActionRow}>
                  <Pressable style={styles.authConnectBtn} onPress={onSubmit} disabled={busy}>
                    <Text style={styles.authConnectBtnText}>{busy ? '连接中…' : '连接远程助手'}</Text>
                  </Pressable>
                </View>

                {showAuthNotice ? (
                  <View style={styles.authNoticeRow}>
                    {busy ? <ActivityIndicator color="#60748d" size="small" /> : null}
                    <Text numberOfLines={2} style={styles.authNoticeText}>
                      {statusText}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.authFootHint}>
                    <Feather name="link-2" size={14} color="#8d826f" />
                    <Text style={styles.authFootHintText}>支持手输服务地址、发现局域网设备，或直接扫描连接二维码。</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
      {launchOverlay}
    </SafeAreaView>
  );
}
