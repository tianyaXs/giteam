import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StatusBar, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function ScannerScreen(props: {
  styles: Record<string, any>;
  title: string;

  onCancel: () => void;
  onPickFromAlbum: () => void;
  onRescan: () => void;

  CameraViewCompat: any;
  onCameraReady: () => void;
  onMountError: (e: any) => void;
  onBarcodeScanned: (e: any) => void;
}) {
  const insets = useSafeAreaInsets();
  const {
    styles,
    title,
    onCancel,
    onPickFromAlbum,
    CameraViewCompat,
    onCameraReady,
    onMountError,
    onBarcodeScanned
  } = props;

  return (
    <View style={styles.scannerSafe}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <View style={styles.scannerWrap}>
        <View style={styles.scannerCamera}>
          <CameraViewCompat
            style={styles.scannerCameraPreview}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] as any }}
            onCameraReady={onCameraReady}
            onMountError={onMountError}
            onBarcodeScanned={onBarcodeScanned}
          />
          <View pointerEvents="box-none" style={styles.scannerOverlay}>
            <View pointerEvents="none" style={styles.scannerShade} />
            <View style={[styles.scannerTopBar, { paddingTop: Math.max(insets.top, 8) + 2 }]}>
              <Pressable hitSlop={12} style={styles.scannerTopBtn} onPress={onCancel}>
                <Feather name="x" size={20} color="#7d7467" />
              </Pressable>
            </View>
            <View pointerEvents="none" style={[styles.scannerModeBar, { paddingBottom: Math.max(insets.bottom, 12) + 6 }]}>
              <Text style={styles.scannerModeText}>{title}</Text>
              <View style={styles.scannerModeDot} />
            </View>
            <Pressable
              hitSlop={10}
              style={({ pressed }) => [
                styles.scannerAlbumBtn,
                { bottom: Math.max(insets.bottom, 12) + 92 },
                pressed ? styles.scannerAlbumBtnPressed : null
              ]}
              onPress={onPickFromAlbum}
            >
              <View style={styles.scannerAlbumBtnGlass}>
                <Feather name="image" size={20} color="#ffffff" />
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
