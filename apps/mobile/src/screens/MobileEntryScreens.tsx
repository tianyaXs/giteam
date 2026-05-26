import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StatusBar, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
}) {
  const { busy, focusedField, pairCode, serverUrlInput, statusText } = props;
  const normalizedStatus = statusText.trim();
  const trimmedUrl = serverUrlInput.trim();
  const trimmedCode = pairCode.trim();
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
}) {
  const { styles, text } = props;
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
      <Text style={styles.authSub}>{displayed}</Text>
    </View>
  );
}

export function AuthConnectScreen(props: {
  styles: Record<string, any>;
  backgroundColor: string;
  busy: boolean;
  statusText: string;
  serverUrlInput: string;
  pairCode: string;
  launchOverlay?: React.ReactNode;
  onChangeServerUrl: (value: string) => void;
  onChangePairCode: (value: string) => void;
  onOpenScanner: () => void;
  onResetStatus: () => void;
  onSubmit: () => void;
}) {
  const {
    backgroundColor,
    busy,
    launchOverlay,
    onChangePairCode,
    onChangeServerUrl,
    onOpenScanner,
    onResetStatus,
    onSubmit,
    pairCode,
    serverUrlInput,
    statusText,
    styles,
  } = props;
  const [focusedField, setFocusedField] = useState<'server' | 'code' | null>(null);
  const guideText = buildGuideText({
    busy,
    focusedField,
    pairCode,
    serverUrlInput,
    statusText,
  });

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
                <FlowingGuide styles={styles} text={guideText} />
              </View>

              <View style={styles.authCard}>
                <View style={styles.authFieldGroup}>
                  <Text style={styles.authFieldLabel}>服务地址</Text>
                  <View style={styles.authUrlRow}>
                    <TextInput
                      style={styles.authInputUrl}
                      value={serverUrlInput}
                      onChangeText={(value) => {
                        onResetStatus();
                        onChangeServerUrl(value);
                      }}
                      onFocus={() => setFocusedField('server')}
                      onBlur={() => setFocusedField((prev) => (prev === 'server' ? null : prev))}
                      autoCapitalize="none"
                      placeholder="输入服务地址"
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
                  <Text style={styles.authFieldLabel}>验证码</Text>
                  <TextInput
                    style={styles.authInput}
                    value={pairCode}
                    onChangeText={(value) => {
                      onResetStatus();
                      onChangePairCode(value);
                    }}
                    onFocus={() => setFocusedField('code')}
                    onBlur={() => setFocusedField((prev) => (prev === 'code' ? null : prev))}
                    autoCapitalize="none"
                    keyboardType="number-pad"
                    placeholder="输入验证码，免授权模式可留空"
                    placeholderTextColor="#9aa6b6"
                  />
                </View>

                <View style={styles.authActionRow}>
                  <Pressable style={styles.authConnectBtn} onPress={onSubmit} disabled={busy}>
                    <Text style={styles.authConnectBtnText}>{busy ? '连接中…' : '连接远程助手'}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
      {launchOverlay}
    </SafeAreaView>
  );
}
