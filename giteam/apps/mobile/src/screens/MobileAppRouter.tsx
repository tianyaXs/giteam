import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppRenderBoundary } from '../components/AppRenderBoundary';
import { GiteamStartupAnimation } from '../components/GiteamStartupAnimation';
import { AuthConnectScreen, DiscoverConnectScreen, ScannerConnectScreen } from './MobileEntryScreens';

export function MobileAppRouter(props: {
  albumPickerOverlay: React.ReactNode;
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
  fontsReady: boolean;
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
  onOpenScanner: () => void;
  onPairPromptCancel: () => void;
  onPairPromptChange: (value: string) => void;
  onPairPromptConfirm: () => void;
  onPickQrFromAlbum: () => void;
  onRescanDiscover: () => void;
  onRescanScanner: () => void;
  onResetAuthStatus: () => void;
  onScannerReady: () => void;
  pairCode: string;
  pairPromptHostPort: string;
  pairPromptOpen: boolean;
  pairPromptValue: string;
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
    albumPickerOverlay,
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
    fontsReady,
    gestureRootStyle,
    launchOverlay,
    onAuthSubmit,
    onBarcodeScanned,
    onCancelScanner,
    onChangePairCode,
    onChangeServerUrl,
    onCloseDiscover,
    onConnectDiscoverPress,
    onMountScannerError,
    onOpenScanner,
    onPairPromptCancel,
    onPairPromptChange,
    onPairPromptConfirm,
    onPickQrFromAlbum,
    onRescanDiscover,
    onRescanScanner,
    onResetAuthStatus,
    onScannerReady,
    pairCode,
    pairPromptHostPort,
    pairPromptOpen,
    pairPromptValue,
    safeStyle,
    scannerOpen,
    serverUrlInput,
    startupStyles,
    statusText
  } = props;

  if (!appReady) {
    return (
      <View style={startupStyles.launchScreen}>
        <GiteamStartupAnimation animate={false} fontsReady={fontsReady} fontFamily={fontFamily} />
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
      <>
        <ScannerConnectScreen
          styles={startupStyles}
          CameraViewCompat={CameraViewCompat}
          onCancel={onCancelScanner}
          onPickFromAlbum={onPickQrFromAlbum}
          onRescan={onRescanScanner}
          onCameraReady={onScannerReady}
          onMountError={onMountScannerError}
          onBarcodeScanned={onBarcodeScanned}
        />
        {albumPickerOverlay}
      </>
    );
  }

  if (!authed) {
    return (
      <>
      <AppRenderBoundary name="auth-screen" styles={startupStyles}>
        <AuthConnectScreen
          styles={startupStyles}
          backgroundColor={backgroundColor}
          busy={busy}
          statusText={statusText}
          serverUrlInput={serverUrlInput}
          pairCode={pairCode}
          launchOverlay={launchOverlay}
          onChangeServerUrl={onChangeServerUrl}
          onChangePairCode={onChangePairCode}
          onOpenScanner={onOpenScanner}
          onResetStatus={onResetAuthStatus}
          onSubmit={onAuthSubmit}
        />
      </AppRenderBoundary>
      {albumPickerOverlay}
      </>
    );
  }

  return (
    <GestureHandlerRootView style={gestureRootStyle}>
      <SafeAreaView style={safeStyle}>
        <AppRenderBoundary name="chat-screen" styles={startupStyles}>
          {chatScreen}
        </AppRenderBoundary>
        {launchOverlay}
        {albumPickerOverlay}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
