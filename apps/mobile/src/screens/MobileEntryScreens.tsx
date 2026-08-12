import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Animated as RNAnimated,
  BackHandler,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  SlideInRight,
  SlideOutRight,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from 'react-native-reanimated';
import { ConnectionModeGlyph } from '../components/auth/ConnectionModeGlyphs';
import { useMobileTheme } from '../features/theme/ThemeProvider';
import {
  CONNECTION_MODE_OPTIONS,
  type ConnectionMode
} from '../lib/connectionMode';
import { DiscoverListScreen, type DiscoverListRow } from './DiscoverListScreen';
import { ScannerScreen } from './ScannerScreen';

export function DiscoverConnectScreen(props: {
  styles: Record<string, any>;
  title: string;
  discoveringUi: boolean;
  devices: DiscoverListRow[];
  connectingDiscoverId: string;
  connectProgressScaleX: RNAnimated.AnimatedInterpolation<number>;
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
  locked?: boolean;
  onCancel: () => void;
  onPickFromAlbum: () => void;
  onRescan: () => void;
  onCameraReady: () => void;
  onMountError: (e: any) => void;
  onBarcodeScanned: (e: any) => void;
}) {
  const {
    CameraViewCompat,
    locked,
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
      locked={locked}
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

type AuthStep = 'welcome' | 'pick' | 'form';
type CloudPhase = 'scan' | 'key';

const ENTER_EASE = Easing.out(Easing.cubic);
const EXIT_EASE = Easing.in(Easing.cubic);
const WELCOME_PART_MS = 520;
const WELCOME_PART_EASE = Easing.bezier(0.22, 1, 0.36, 1);

function SoftPressable(props: {
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  children: React.ReactNode;
}) {
  const { onPress, disabled, style, accessibilityLabel, children } = props;
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }]
  }));

  const onPressIn = () => {
    if (disabled) return;
    scale.value = withSpring(0.97, { damping: 28, stiffness: 380, mass: 0.6 });
  };
  const onPressOut = () => {
    scale.value = withSpring(1, { damping: 26, stiffness: 340, mass: 0.6 });
  };

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'button' : undefined}
    >
      <Animated.View style={[style, animStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

function ScanInlineButton(props: {
  styles: Record<string, any>;
  ink: string;
  onPress: () => void;
}) {
  const { styles, ink, onPress } = props;
  return (
    <SoftPressable
      style={[styles.authScanInlineBtn, { backgroundColor: ink }]}
      onPress={onPress}
    >
      <View style={styles.authScanIconFrame}>
        <View style={[styles.authScanIconLt, { borderColor: '#FFFFFF' }]} />
        <View style={[styles.authScanIconRt, { borderColor: '#FFFFFF' }]} />
        <View style={[styles.authScanIconLb, { borderColor: '#FFFFFF' }]} />
        <View style={[styles.authScanIconRb, { borderColor: '#FFFFFF' }]} />
      </View>
    </SoftPressable>
  );
}

function FieldShell(props: {
  styles: Record<string, any>;
  colors: { text: string; muted: string; sidebar: string; border: string };
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'number-pad';
  trailing?: React.ReactNode;
}) {
  const {
    styles,
    colors,
    value,
    onChangeText,
    placeholder,
    keyboardType = 'default',
    trailing
  } = props;

  return (
    <View style={[styles.authUrlRow, { backgroundColor: colors.sidebar, borderColor: colors.border }]}>
      <TextInput
        style={[styles.authInputUrl, { color: colors.text }]}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
      />
      {trailing}
    </View>
  );
}

export function AuthConnectScreen(props: {
  styles: Record<string, any>;
  backgroundColor: string;
  busy: boolean;
  statusText: string;
  connectionMode: ConnectionMode;
  serverUrlInput: string;
  pairCode: string;
  accessKey: string;
  devicePickerOpen?: boolean;
  pendingDevices?: Array<{ id: string; name: string; online: boolean }>;
  launchOverlay?: React.ReactNode;
  onChangeConnectionMode: (mode: ConnectionMode) => void;
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
  const [step, setStep] = useState<AuthStep>('welcome');
  const [cloudPhase, setCloudPhase] = useState<CloudPhase>('scan');
  const [welcomeLeaving, setWelcomeLeaving] = useState(false);
  const welcomePart = useSharedValue(0);
  const insets = useSafeAreaInsets();
  const { colors } = useMobileTheme();
  const statusVisible = Boolean(statusText.trim()) && statusText.trim() !== '准备就绪';
  const showTopBack = step === 'pick' || step === 'form';

  /** 引导页 CTA：用正文色反相，避开 ChatGPT 绿，更贴合中性品牌感 */
  const ctaBg = colors.text;
  const ctaFg = colors.background;

  const showConnect =
    connectionMode !== 'cloud'
    || cloudPhase === 'key';

  const welcomeBrandStyle = useAnimatedStyle(() => ({
    opacity: interpolate(welcomePart.value, [0, 0.85, 1], [1, 0.12, 0]),
    transform: [
      { translateY: interpolate(welcomePart.value, [0, 1], [0, -56]) },
      { scale: interpolate(welcomePart.value, [0, 1], [1, 0.96]) }
    ]
  }));

  const welcomeCtaStyle = useAnimatedStyle(() => ({
    opacity: interpolate(welcomePart.value, [0, 0.7, 1], [1, 0.18, 0]),
    transform: [
      { translateY: interpolate(welcomePart.value, [0, 1], [0, 64]) },
      { scale: interpolate(welcomePart.value, [0, 1], [1, 0.94]) }
    ]
  }));

  const finishWelcomeToPick = useCallback(() => {
    onResetStatus();
    setCloudPhase('scan');
    setWelcomeLeaving(false);
    setStep('pick');
  }, [onResetStatus]);

  const goWelcome = useCallback(() => {
    cancelAnimation(welcomePart);
    welcomePart.value = 0;
    onResetStatus();
    setCloudPhase('scan');
    setWelcomeLeaving(false);
    setStep('welcome');
  }, [onResetStatus, welcomePart]);

  const goPick = () => {
    if (welcomeLeaving || step !== 'welcome') return;
    setWelcomeLeaving(true);
    cancelAnimation(welcomePart);
    welcomePart.value = 0;
    welcomePart.value = withTiming(
      1,
      { duration: WELCOME_PART_MS, easing: WELCOME_PART_EASE },
      (finished) => {
        if (finished) runOnJS(finishWelcomeToPick)();
      }
    );
  };

  const openMode = (mode: ConnectionMode) => {
    onResetStatus();
    onChangeConnectionMode(mode);
    setCloudPhase('scan');
    setStep('form');
  };

  const backToPick = () => {
    onResetStatus();
    setCloudPhase('scan');
    setStep('pick');
  };

  const backFromForm = () => {
    if (connectionMode === 'cloud' && cloudPhase === 'key') {
      onResetStatus();
      setCloudPhase('scan');
      return;
    }
    backToPick();
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (devicePickerOpen) {
        onCloseDevicePicker?.();
        return true;
      }
      if (welcomeLeaving) {
        cancelAnimation(welcomePart);
        welcomePart.value = 0;
        setWelcomeLeaving(false);
        setStep('welcome');
        return true;
      }
      if (step === 'form') {
        if (connectionMode === 'cloud' && cloudPhase === 'key') {
          onResetStatus();
          setCloudPhase('scan');
          return true;
        }
        onResetStatus();
        setCloudPhase('scan');
        setStep('pick');
        return true;
      }
      if (step === 'pick') {
        goWelcome();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [
    cloudPhase,
    connectionMode,
    devicePickerOpen,
    goWelcome,
    onCloseDevicePicker,
    onResetStatus,
    step,
    welcomeLeaving,
    welcomePart
  ]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={colors.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
        translucent={false}
      />
      {showTopBack ? (
        <Animated.View
          key={`top-back-${step}`}
          entering={FadeIn.duration(280).easing(ENTER_EASE)}
          style={[styles.authTopBack, { top: insets.top + 6 }]}
        >
          <SoftPressable
            onPress={step === 'pick' ? goWelcome : backFromForm}
            style={styles.authTopBackBtn}
            accessibilityLabel="返回"
          >
            <Feather name="chevron-left" size={28} color={colors.text} />
          </SoftPressable>
        </Animated.View>
      ) : null}
      <ScrollView
        style={styles.authScroll}
        contentContainerStyle={styles.authGuideContainer}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View style={styles.authGuideStage}>
          {step === 'welcome' ? (
            <Animated.View
              key="welcome"
              entering={FadeIn.duration(420).easing(ENTER_EASE)}
              style={styles.authWelcomeBlock}
              pointerEvents={welcomeLeaving ? 'none' : 'auto'}
            >
              <Animated.View style={[styles.authWelcomeBrand, welcomeBrandStyle]}>
                <Animated.Text
                  entering={FadeInDown.duration(560).delay(80).easing(ENTER_EASE)}
                  style={[styles.authWelcomeLogo, { color: colors.text }]}
                >
                  Giteam
                </Animated.Text>
                <Animated.Text
                  entering={FadeInUp.duration(520).delay(220).easing(ENTER_EASE)}
                  style={[styles.authWelcomeTagline, { color: colors.muted }]}
                >
                  欢迎来到 Giteam
                </Animated.Text>
              </Animated.View>
              <Animated.View
                entering={FadeInUp.duration(500).delay(380).easing(ENTER_EASE)}
                style={[styles.authWelcomeCtaWrap, welcomeCtaStyle]}
              >
                <SoftPressable
                  style={[styles.authCompactBtn, { backgroundColor: ctaBg }]}
                  onPress={goPick}
                  disabled={welcomeLeaving}
                >
                  <Text style={[styles.authCompactBtnText, { color: ctaFg }]}>开始</Text>
                </SoftPressable>
              </Animated.View>
            </Animated.View>
          ) : null}

          {step === 'pick' ? (
            <Animated.View
              key="pick"
              entering={FadeInUp.duration(520).delay(40).easing(ENTER_EASE)}
              exiting={FadeOutDown.duration(220).easing(EXIT_EASE)}
              style={styles.authPickBlock}
            >
              <Animated.View
                entering={FadeInDown.duration(420).easing(ENTER_EASE)}
                style={styles.authPickHeader}
              >
                <Text style={[styles.authStepTitle, styles.authStepTitleCenter, { color: colors.text }]}>
                  使用方式
                </Text>
              </Animated.View>

              <View style={styles.authModeOrbit}>
                {CONNECTION_MODE_OPTIONS.map((option, index) => (
                  <Animated.View
                    key={option.id}
                    entering={FadeInUp.duration(360)
                      .delay(80 + index * 70)
                      .easing(ENTER_EASE)}
                    style={styles.authModeOrbitItem}
                  >
                    <SoftPressable
                      onPress={() => openMode(option.id)}
                      style={styles.authModeChoice}
                    >
                      <View
                        style={[
                          styles.authModeHalo,
                          { backgroundColor: colors.sidebar, borderColor: colors.border }
                        ]}
                      >
                        <ConnectionModeGlyph mode={option.id} color={colors.text} size={42} />
                      </View>
                      <Text style={[styles.authModeChoiceTitle, { color: colors.text }]}>
                        {option.title}
                      </Text>
                    </SoftPressable>
                  </Animated.View>
                ))}
              </View>
            </Animated.View>
          ) : null}

          {step === 'form' ? (
            <Animated.View
              key={`form-${connectionMode}`}
              entering={SlideInRight.duration(380).easing(ENTER_EASE)}
              exiting={SlideOutRight.duration(240).easing(EXIT_EASE)}
              style={styles.authFormBlock}
            >
              <Animated.View entering={FadeInDown.duration(360).easing(ENTER_EASE)}>
                <Text style={[styles.authStepTitle, styles.authStepTitleCenter, { color: colors.text }]}>
                  {CONNECTION_MODE_OPTIONS.find((item) => item.id === connectionMode)?.title || '连接'}
                </Text>
              </Animated.View>

              <View style={styles.authFormFields}>
                {connectionMode === 'cloud' && cloudPhase === 'scan' ? (
                  <Animated.View
                    key="cloud-scan"
                    entering={FadeInUp.duration(380).delay(50).easing(ENTER_EASE)}
                    exiting={FadeOut.duration(180)}
                    style={styles.authCloudScanBlock}
                  >
                    <SoftPressable
                      style={[styles.authHeroActionBtn, { backgroundColor: ctaBg }]}
                      onPress={onOpenScanner}
                    >
                      <Text style={[styles.authHeroActionBtnText, { color: ctaFg }]}>扫码</Text>
                    </SoftPressable>
                    <SoftPressable
                      onPress={() => {
                        onResetStatus();
                        setCloudPhase('key');
                      }}
                      style={styles.authSubtleLink}
                    >
                      <Text style={[styles.authSubtleLinkText, { color: colors.muted }]}>使用密钥</Text>
                    </SoftPressable>
                  </Animated.View>
                ) : null}

                {connectionMode === 'cloud' && cloudPhase === 'key' ? (
                  <Animated.View
                    key="cloud-key"
                    entering={FadeInUp.duration(360).delay(40).easing(ENTER_EASE)}
                    exiting={FadeOut.duration(160)}
                  >
                    <FieldShell
                      styles={styles}
                      colors={colors}
                      value={accessKey}
                      onChangeText={(value) => {
                        onResetStatus();
                        onChangeAccessKey(value);
                      }}
                      placeholder="连接密钥"
                    />
                  </Animated.View>
                ) : null}

                {connectionMode === 'local' ? (
                  <>
                    <Animated.View entering={FadeInUp.duration(360).delay(40).easing(ENTER_EASE)}>
                      <FieldShell
                        styles={styles}
                        colors={colors}
                        value={serverUrlInput}
                        onChangeText={(value) => {
                          onResetStatus();
                          onChangeServerUrl(value);
                        }}
                        placeholder="地址"
                        trailing={<ScanInlineButton styles={styles} ink={ctaBg} onPress={onOpenScanner} />}
                      />
                    </Animated.View>
                    <Animated.View entering={FadeInUp.duration(360).delay(110).easing(ENTER_EASE)}>
                      <FieldShell
                        styles={styles}
                        colors={colors}
                        value={pairCode}
                        onChangeText={(value) => {
                          onResetStatus();
                          onChangePairCode(value);
                        }}
                        placeholder="授权码"
                        keyboardType="number-pad"
                      />
                    </Animated.View>
                  </>
                ) : null}

                {connectionMode === 'custom' ? (
                  <>
                    <Animated.View entering={FadeInUp.duration(360).delay(40).easing(ENTER_EASE)}>
                      <FieldShell
                        styles={styles}
                        colors={colors}
                        value={serverUrlInput}
                        onChangeText={(value) => {
                          onResetStatus();
                          onChangeServerUrl(value);
                        }}
                        placeholder="服务地址"
                        trailing={<ScanInlineButton styles={styles} ink={ctaBg} onPress={onOpenScanner} />}
                      />
                    </Animated.View>
                    <Animated.View entering={FadeInUp.duration(360).delay(110).easing(ENTER_EASE)}>
                      <FieldShell
                        styles={styles}
                        colors={colors}
                        value={pairCode}
                        onChangeText={(value) => {
                          onResetStatus();
                          onChangePairCode(value);
                        }}
                        placeholder="密钥"
                      />
                    </Animated.View>
                  </>
                ) : null}
              </View>

              {statusVisible ? (
                <Animated.Text
                  key={statusText.trim()}
                  entering={FadeIn.duration(220)}
                  exiting={FadeOut.duration(160)}
                  style={[styles.authInlineStatus, { color: colors.muted }]}
                >
                  {statusText.trim()}
                </Animated.Text>
              ) : null}

              {showConnect ? (
                <Animated.View
                  key="connect"
                  entering={FadeInUp.duration(340).delay(120).easing(ENTER_EASE)}
                  exiting={FadeOut.duration(140)}
                  style={styles.authConnectWrap}
                >
                  {connectionMode === 'cloud' && cloudPhase === 'key' ? (
                    <SoftPressable
                      onPress={() => {
                        onResetStatus();
                        onOpenScanner();
                      }}
                      style={styles.authScanAboveConnect}
                    >
                      <Text style={[styles.authSubtleLinkText, { color: colors.muted }]}>扫码</Text>
                    </SoftPressable>
                  ) : null}
                  <SoftPressable
                    style={[
                      styles.authCompactBtn,
                      styles.authConnectBtnWide,
                      { backgroundColor: ctaBg, opacity: busy ? 0.72 : 1 }
                    ]}
                    onPress={onSubmit}
                    disabled={busy}
                  >
                    <Text style={[styles.authCompactBtnText, { color: ctaFg }]}>
                      {busy ? '连接中…' : '连接'}
                    </Text>
                  </SoftPressable>
                </Animated.View>
              ) : null}
            </Animated.View>
          ) : null}
        </View>
      </ScrollView>

      {devicePickerOpen ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(160)}
          style={styles.authDeviceOverlay}
        >
          <Pressable style={styles.authDeviceBackdrop} onPress={onCloseDevicePicker} />
          <Animated.View
            entering={FadeInUp.duration(280).easing(ENTER_EASE)}
            style={[styles.authDeviceSheet, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.authDeviceTitle, { color: colors.text }]}>选择设备</Text>
            {(pendingDevices || []).map((device) => (
              <SoftPressable
                key={device.id}
                onPress={() => onSelectCloudDevice?.(device.id)}
                style={styles.authDeviceRow}
              >
                <Text style={[styles.authDeviceName, { color: colors.text }]}>
                  {device.name || device.id}
                </Text>
                <Text style={[styles.authDeviceMeta, { color: colors.muted }]}>
                  {device.online ? '在线' : '离线'}
                </Text>
              </SoftPressable>
            ))}
            <SoftPressable onPress={onCloseDevicePicker} style={styles.authGhostBack}>
              <Text style={[styles.authGhostBackText, { color: colors.muted }]}>取消</Text>
            </SoftPressable>
          </Animated.View>
        </Animated.View>
      ) : null}
      {launchOverlay}
    </SafeAreaView>
  );
}
