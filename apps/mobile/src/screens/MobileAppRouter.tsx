import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView, View } from 'react-native';
import { AuthConnectScreen, DiscoverConnectScreen, ScannerConnectScreen } from './MobileEntryScreens';
import { GiteamStartupAnimation } from '../components/GiteamStartupAnimation';
import { AppRenderBoundary } from '../components/AppRenderBoundary';

export function MobileAppRouter(props: {
  appReady: boolean;
  authed: boolean;
  backgroundColor: string;
  busy: boolean;
  CameraViewCompat: any;
  chatScreen: React.ReactNode;
  connectProgressScaleX: any;
  connectingDiscoverId: string;
  discoverDeviceRows: any[];
  discoverOpen: boolean;
  discoveringUi: boolean;
  fontFamily: string;
  gestureRootStyle: any;
  launchOverlay: React.ReactNode;
  lastScanAtLabel: string;
  onAuthSubmit: () => void;
  onBarcodeScanned: (event: any) => void;
  onCancelScanner: () => void;
  onChangePairCode: (value: string) => void;
  onChangeServerUrl: (value: string) => void;
  onCloseDiscover: () => void;
  onConnectDiscoverPress: (item: any) => void;
  onMountScannerError: (event: any) => void;
  onOpenDiscover: () => void;
  onOpenScanner: () => void;
  onPairPromptCancel: () => void;
  onPairPromptChange: (value: string) => void;
  onPairPromptConfirm: () => void;
  onPickQrFromAlbum: () => void;
  onRescanDiscover: () => void;
  onRescanScanner: () => void;
  onScannerReady: () => void;
  onTogglePreferHttps: () => void;
  pairCode: string;
  pairPromptHostPort: string;
  pairPromptOpen: boolean;
  pairPromptValue: string;
  preferHttps: boolean;
  safeStyle: any;
  scanHitCount: number;
  scannerLocked: boolean;
  scannerOpen: boolean;
  scannerReady: boolean;
  serverUrlInput: string;
  startupStyles: Record<string, any>;
  statusText: string;
}) {
  const {
    appReady,
    authed,
    backgroundColor,
    busy,
    CameraViewCompat,
    chatScreen,
    connectProgressScaleX,
    connectingDiscoverId,
    discoverDeviceRows,
    discoverOpen,
    discoveringUi,
    fontFamily,
    gestureRootStyle,
    launchOverlay,
    lastScanAtLabel,
    onAuthSubmit,
    onBarcodeScanned,
    onCancelScanner,
    onChangePairCode,
    onChangeServerUrl,
    onCloseDiscover,
    onConnectDiscoverPress,
    onMountScannerError,
    onOpenDiscover,
    onOpenScanner,
    onPairPromptCancel,
    onPairPromptChange,
    onPairPromptConfirm,
    onPickQrFromAlbum,
    onRescanDiscover,
    onRescanScanner,
    onScannerReady,
    onTogglePreferHttps,
    pairCode,
    pairPromptHostPort,
    pairPromptOpen,
    pairPromptValue,
    preferHttps,
    safeStyle,
    scanHitCount,
    scannerLocked,
    scannerOpen,
    scannerReady,
    serverUrlInput,
    startupStyles,
    statusText
  } = props;

  if (!appReady) {
    return (
      <View style={startupStyles.launchScreen}>
        <GiteamStartupAnimation animate={false} fontFamily={fontFamily} />
      </View>
    );
  }

  if (discoverOpen) {
    return (
      <AppRenderBoundary name="discover-screen" styles={startupStyles}>
        <DiscoverConnectScreen
          styles={startupStyles}
          title="发现设备"
          discoveringUi={discoveringUi}
          devices={discoverDeviceRows}
          connectingDiscoverId={connectingDiscoverId}
          connectProgressScaleX={connectProgressScaleX}
          pairPromptOpen={pairPromptOpen}
          pairPromptHostPort={pairPromptHostPort}
          pairPromptValue={pairPromptValue}
          onBack={onCloseDiscover}
          onRescan={onRescanDiscover}
          onConnectPress={onConnectDiscoverPress}
          onPairPromptChange={onPairPromptChange}
          onPairPromptCancel={onPairPromptCancel}
          onPairPromptConfirm={onPairPromptConfirm}
        />
      </AppRenderBoundary>
    );
  }

  if (scannerOpen) {
    return (
      <ScannerConnectScreen
        styles={startupStyles}
        statusText={statusText}
        scannerReady={scannerReady}
        scannerLocked={scannerLocked}
        scanHitCount={scanHitCount}
        lastScanAtLabel={lastScanAtLabel}
        CameraViewCompat={CameraViewCompat}
        onCancel={onCancelScanner}
        onPickFromAlbum={onPickQrFromAlbum}
        onRescan={onRescanScanner}
        onCameraReady={onScannerReady}
        onMountError={onMountScannerError}
        onBarcodeScanned={onBarcodeScanned}
      />
    );
  }

  if (!authed) {
    return (
      <AppRenderBoundary name="auth-screen" styles={startupStyles}>
        <AuthConnectScreen
          styles={startupStyles}
          backgroundColor={backgroundColor}
          busy={busy}
          statusText={statusText}
          serverUrlInput={serverUrlInput}
          pairCode={pairCode}
          preferHttps={preferHttps}
          launchOverlay={launchOverlay}
          onChangeServerUrl={onChangeServerUrl}
          onChangePairCode={onChangePairCode}
          onTogglePreferHttps={onTogglePreferHttps}
          onOpenDiscover={onOpenDiscover}
          onOpenScanner={onOpenScanner}
          onSubmit={onAuthSubmit}
        />
      </AppRenderBoundary>
    );
  }

  return (
    <GestureHandlerRootView style={gestureRootStyle}>
      <SafeAreaView style={safeStyle}>
        <AppRenderBoundary name="chat-screen" styles={startupStyles}>
          {chatScreen}
        </AppRenderBoundary>
        {launchOverlay}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
