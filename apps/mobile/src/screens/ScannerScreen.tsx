import React from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

export function ScannerScreen(props: {
  styles: Record<string, any>;
  title: string;
  subtitle: string;
  hint1: string;
  hint2: string;
  hint3: string;
  statusText: string;

  onCancel: () => void;
  onPickFromAlbum: () => void;
  onRescan: () => void;

  CameraViewCompat: any;
  onCameraReady: () => void;
  onMountError: (e: any) => void;
  onBarcodeScanned: (e: any) => void;
  scannerReady: boolean;
  scannerLocked: boolean;
  scanHitCountText: string;
}) {
  const {
    styles,
    title,
    subtitle,
    hint1,
    hint2,
    hint3,
    statusText,
    onCancel,
    onPickFromAlbum,
    onRescan,
    CameraViewCompat,
    onCameraReady,
    onMountError,
    onBarcodeScanned
  } = props;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.scannerWrap}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <Text style={styles.scannerHintText}>{hint1}</Text>
        <Text style={styles.scannerHintText}>{hint2}</Text>
        <Text style={styles.scannerHintText}>{hint3}</Text>
        <View style={styles.scannerFrame}>
          <CameraViewCompat
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] as any }}
            onCameraReady={onCameraReady}
            onMountError={onMountError}
            onBarcodeScanned={onBarcodeScanned}
          />
        </View>
        <View style={styles.row}>
          <Pressable style={styles.btnSoft} onPress={onCancel}>
            <Text style={styles.btnSoftText}>取消</Text>
          </Pressable>
          <Pressable style={styles.btnSoft} onPress={onPickFromAlbum}>
            <Text style={styles.btnSoftText}>相册识别</Text>
          </Pressable>
          <Pressable style={styles.btnSoft} onPress={onRescan}>
            <Text style={styles.btnSoftText}>重新扫描</Text>
          </Pressable>
        </View>
        {statusText ? <Text style={styles.scannerStatusText}>{statusText}</Text> : <ActivityIndicator color="#60748d" size="small" />}
      </View>
    </SafeAreaView>
  );
}

