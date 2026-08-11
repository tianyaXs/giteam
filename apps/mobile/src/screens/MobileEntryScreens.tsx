import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StatusBar, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMobileTheme } from '../features/theme/ThemeProvider';
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
    onBarcodeScanned,
    onCameraReady,
    onCancel,
    onMountError,
    onPickFromAlbum,
    onRescan,
    styles,
  } = props;

  return (
    <ScannerScreen
      styles={styles}
      title="扫一扫"
      onCancel={onCancel}
      onPickFromAlbum={onPickFromAlbum}
      onRescan={onRescan}
      CameraViewCompat={CameraViewCompat}
      onCameraReady={onCameraReady}
      onMountError={onMountError}
      onBarcodeScanned={onBarcodeScanned}
    />
  );
}

function analyzeServiceAddress(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return { hasHost: false, hasPort: false, hasCompleteHost: false };
  const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
  const hostPart = withoutScheme.split(/[/?#]/)[0].split(':')[0] || '';
  const ipv4Parts = hostPart.split('.');
  const isCompleteIpv4 =
    ipv4Parts.length === 4
    && ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
  const isLocalhost = hostPart === 'localhost';
  const isLikelyDomain = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(hostPart);
  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const url = new URL(normalized);
    return {
      hasHost: Boolean(url.hostname.trim()),
      hasCompleteHost: isCompleteIpv4 || isLocalhost || isLikelyDomain,
      hasPort: Boolean(url.port.trim()),
    };
  } catch {
    return {
      hasHost: /^[^:/?#\s]+$/.test(trimmed) || /^[^:/?#\s]+:\d{2,5}$/.test(trimmed),
      hasCompleteHost: isCompleteIpv4 || isLocalhost || isLikelyDomain,
      hasPort: /:\d{2,5}(?:[/?#]|$)/.test(trimmed),
    };
  }
}

function shouldUseStatusMessage(message: string) {
  const normalized = message.trim();
  if (!normalized || normalized === '准备就绪') return false;
  return ![
    '扫码器已打开，等待识别二维码...',
    '二维码已识别，正在校验...',
    '已捕获二维码，正在解析...',
    '正在识别相册二维码...',
    '已重置扫描器，请重新对准二维码',
  ].includes(normalized);
}

function buildGuideText(props: {
  busy: boolean;
  focusedField: 'server' | 'code' | null;
  pairCode: string;
  serverUrlInput: string;
  statusText: string;
  connectionMode?: 'local' | 'cloud';
}) {
  const { busy, focusedField, pairCode, serverUrlInput, statusText, connectionMode } = props;
  const normalizedStatus = statusText.trim();
  const trimmedUrl = serverUrlInput.trim();
  const trimmedCode = pairCode.trim();
  if (connectionMode === 'cloud') {
    if (busy) {
      return normalizedStatus && normalizedStatus !== '准备就绪'
        ? normalizedStatus
        : '正在通过云端中继连接本机助手...';
    }
    if (shouldUseStatusMessage(normalizedStatus)) return normalizedStatus;
    if (!trimmedCode) return '输入或扫码获取连接密钥，即可异地连接已上云的电脑。';
    return trimmedUrl ? '可以连接云端了。' : '密钥已填写；云端地址可留空使用默认值。';
  }
  const address = analyzeServiceAddress(trimmedUrl);
  const hasValidCode = !trimmedCode || trimmedCode.length >= 6;

  if (busy) {
    return normalizedStatus && normalizedStatus !== '准备就绪'
      ? normalizedStatus
      : '正在检查服务地址并尝试建立连接...';
  }

  if (focusedField === 'server') {
    if (!trimmedUrl) return '请填写你的服务地址。';
    if (!address.hasHost || !address.hasCompleteHost) return '继续填写服务地址。';
    if (!address.hasPort) return '服务地址里还缺少端口，例如 :4100';
    if (trimmedCode && !hasValidCode) return '验证码至少需要 6 位';
    return trimmedCode
      ? '可以连接了。'
      : '服务地址看起来没问题，验证码取决于你的授权方式。';
  }

  if (focusedField === 'code') {
    if (!trimmedUrl) return '先填写服务地址，这是必要的';
    if (!address.hasHost || !address.hasCompleteHost) return '服务地址还不完整，先把它补全。';
    if (!address.hasPort) return '服务地址还缺少端口，这是必要的';
    if (trimmedCode && !hasValidCode) return '验证码至少需要 6 位';
    return trimmedCode
      ? '验证码已填写，可以连接了'
      : '根据授权方式，决定是否填写验证码。';
  }

  if (shouldUseStatusMessage(normalizedStatus)) return normalizedStatus;
  if (!trimmedUrl) return '连接远程 AI 助手，在手机上继续桌面端任务与会话。';
  if (!address.hasHost || !address.hasCompleteHost) return '服务地址还不完整。';
  if (!address.hasPort) return '当前地址还缺少端口号，例如 :4100';
  if (trimmedCode && !hasValidCode) return '验证码至少需要 6 位';
  if (!trimmedCode) return '服务地址已经就绪，验证码取决于你的授权方式';
  return '可以连接了。';
}

function FlowingGuide(props: {
  styles: Record<string, any>;
  text: string;
  textColor?: string;
}) {
  const { styles, text, textColor } = props;
  const [displayed, setDisplayed] = useState(text);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!text) {
      setDisplayed('');
      return;
    }
    setDisplayed('');
    let index = 0;
    const step = () => {
      index += 1;
      setDisplayed(text.slice(0, index));
      if (index < text.length) {
        timerRef.current = setTimeout(step, text[index] === ' ' ? 20 : 34);
      }
    };
    timerRef.current = setTimeout(step, 60);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text]);

  return (
    <View style={styles.authGuideWrap}>
      <Text style={[styles.authSub, textColor ? { color: textColor } : null]}>{displayed}</Text>
    </View>
  );
}

export function AuthConnectScreen(props: {
  styles: Record<string, any>;
  backgroundColor: string;
  busy: boolean;
  statusText: string;
  connectionMode: 'local' | 'cloud';
  serverUrlInput: string;
  pairCode: string;
  accessKey: string;
  devicePickerOpen?: boolean;
  pendingDevices?: Array<{ id: string; name: string; online: boolean }>;
  launchOverlay?: React.ReactNode;
  onChangeConnectionMode: (mode: 'local' | 'cloud') => void;
  onChangeServerUrl: (value: string) => void;
  onChangePairCode: (value: string) => void;
  onChangeAccessKey: (value: string) => void;
  onOpenScanner: () => void;
  onResetStatus: () => void;
  onSubmit: () => void;
  onSelectCloudDevice?: (deviceId: string) => void;
  onCloseDevicePicker?: () => void;
}) {
  const {
    busy,
    connectionMode,
    launchOverlay,
    onChangeAccessKey,
    onChangeConnectionMode,
    onChangePairCode,
    onChangeServerUrl,
    onCloseDevicePicker,
    onOpenScanner,
    onResetStatus,
    onSelectCloudDevice,
    onSubmit,
    pairCode,
    accessKey,
    pendingDevices,
    devicePickerOpen,
    serverUrlInput,
    statusText,
    styles,
  } = props;
  const [focusedField, setFocusedField] = useState<'server' | 'code' | null>(null);
  const { colors } = useMobileTheme();
  const guideText = buildGuideText({
    busy,
    focusedField,
    pairCode: connectionMode === 'cloud' ? accessKey : pairCode,
    serverUrlInput,
    statusText,
    connectionMode,
  });

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={colors.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
        translucent={false}
      />
      <ScrollView style={styles.authScroll} contentContainerStyle={styles.authContainerCenter} keyboardShouldPersistTaps="handled">
        <View style={styles.authPageFrame}>
          <View style={styles.authHeroPanel}>
            <View style={[styles.authHeroOrb, { backgroundColor: colors.primarySoft }]} />
            <View style={styles.authFormWrap}>
              <View style={styles.authHeroCopy}>
                <Text style={[styles.authKicker, { color: colors.primary }]}>Remote AI Assistant</Text>
                <Text style={[styles.authTitle, { color: colors.text }]}>Giteam</Text>
                <FlowingGuide styles={styles} text={guideText} textColor={colors.muted} />
              </View>

              <View
                style={[
                  styles.authCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    shadowColor: colors.primary
                  }
                ]}
              >
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                  {([
                    ['local', '局域网'],
                    ['cloud', '云端'],
                  ] as const).map(([mode, label]) => {
                    const active = connectionMode === mode;
                    return (
                      <Pressable
                        key={mode}
                        onPress={() => {
                          onResetStatus();
                          onChangeConnectionMode(mode);
                        }}
                        style={{
                          flex: 1,
                          borderRadius: 10,
                          paddingVertical: 10,
                          alignItems: 'center',
                          backgroundColor: active ? colors.primary : colors.sidebar,
                          borderWidth: 1,
                          borderColor: active ? colors.primary : colors.border,
                        }}
                      >
                        <Text style={{ color: active ? colors.primaryText : colors.text, fontWeight: '600' }}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.authFieldGroup}>
                  <Text style={[styles.authFieldLabel, { color: colors.muted }]}>
                    {connectionMode === 'cloud' ? '云端地址' : '服务地址'}
                  </Text>
                  <View style={[styles.authUrlRow, { backgroundColor: colors.sidebar, borderColor: colors.border }]}>
                    <TextInput
                      style={[styles.authInputUrl, { color: colors.text }]}
                      value={serverUrlInput}
                      onChangeText={(value) => {
                        onResetStatus();
                        onChangeServerUrl(value);
                      }}
                      onFocus={() => setFocusedField('server')}
                      onBlur={() => setFocusedField((prev) => (prev === 'server' ? null : prev))}
                      autoCapitalize="none"
                      placeholder={
                        connectionMode === 'cloud' ? '留空则使用打包默认云地址' : '输入服务地址'
                      }
                      placeholderTextColor={colors.muted}
                    />
                    <Pressable
                      style={[styles.authScanInlineBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                      onPress={onOpenScanner}
                    >
                      <View style={styles.authScanIconFrame}>
                        <View style={[styles.authScanIconLt, { borderColor: colors.primaryText }]} />
                        <View style={[styles.authScanIconRt, { borderColor: colors.primaryText }]} />
                        <View style={[styles.authScanIconLb, { borderColor: colors.primaryText }]} />
                        <View style={[styles.authScanIconRb, { borderColor: colors.primaryText }]} />
                      </View>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.authFieldGroup}>
                  <Text style={[styles.authFieldLabel, { color: colors.muted }]}>
                    {connectionMode === 'cloud' ? '连接密钥' : '验证码'}
                  </Text>
                  <TextInput
                    style={[styles.authInput, { color: colors.text, backgroundColor: colors.sidebar, borderColor: colors.border }]}
                    value={connectionMode === 'cloud' ? accessKey : pairCode}
                    onChangeText={(value) => {
                      onResetStatus();
                      if (connectionMode === 'cloud') onChangeAccessKey(value);
                      else onChangePairCode(value);
                    }}
                    onFocus={() => setFocusedField('code')}
                    onBlur={() => setFocusedField((prev) => (prev === 'code' ? null : prev))}
                    autoCapitalize="none"
                    keyboardType={connectionMode === 'cloud' ? 'default' : 'number-pad'}
                    placeholder={
                      connectionMode === 'cloud'
                        ? '粘贴 gtm_aks_... 或扫码'
                        : '输入验证码，免授权模式可留空'
                    }
                    placeholderTextColor={colors.muted}
                  />
                </View>

                <View style={styles.authActionRow}>
                  <Pressable
                    style={[styles.authConnectBtn, { backgroundColor: colors.primary }]}
                    onPress={onSubmit}
                    disabled={busy}
                  >
                    <Text style={[styles.authConnectBtnText, { color: colors.primaryText }]}>
                      {busy ? '连接中…' : connectionMode === 'cloud' ? '连接云端助手' : '连接远程助手'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
      {devicePickerOpen ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 16, borderColor: colors.border, borderWidth: 1 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 6 }}>选择设备</Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 12 }}>工作区有多台 CLI 在线，请选择要连接的电脑。</Text>
            {(pendingDevices || []).map((device) => (
              <Pressable
                key={device.id}
                onPress={() => onSelectCloudDevice?.(device.id)}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  marginBottom: 8,
                  backgroundColor: colors.sidebar,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>{device.name || device.id}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                  {device.online ? '在线' : '离线'} · {device.id}
                </Text>
              </Pressable>
            ))}
            <Pressable onPress={onCloseDevicePicker} style={{ marginTop: 4, alignItems: 'center', paddingVertical: 10 }}>
              <Text style={{ color: colors.muted }}>取消</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {launchOverlay}
    </SafeAreaView>
  );
}
