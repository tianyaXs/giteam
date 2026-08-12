import { Feather } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import {
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SCAN_SIZE = 248;
const CORNER = 22;
const CORNER_W = 3;

/**
 * 成熟扫码页结构（对齐微信 / Expo Camera 推荐）：
 * - CameraView 与遮罩同级绝对铺满，禁止把 UI 塞进 CameraView children
 * - 关闭与相册分区固定，避免绝对浮动按钮误触
 * - 取景框用实线角标，不用虚线框
 * - 锁定后卸掉 onBarcodeScanned，避免连扫
 */
export function ScannerScreen(props: {
  styles: Record<string, any>;
  title: string;
  locked?: boolean;
  onCancel: () => void;
  onPickFromAlbum: () => void;
  onRescan: () => void;
  CameraViewCompat: any;
  onCameraReady: () => void;
  onMountError: (e: any) => void;
  onBarcodeScanned: (e: any) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const {
    title,
    locked = false,
    onCancel,
    onPickFromAlbum,
    CameraViewCompat,
    onCameraReady,
    onMountError,
    onBarcodeScanned
  } = props;

  const frameLeft = (windowWidth - SCAN_SIZE) / 2;
  const frameTop = Math.max(insets.top + 96, (windowHeight - SCAN_SIZE) * 0.32);
  const maskPieces = useMemo(
    () => ({
      top: { height: frameTop },
      bottom: { top: frameTop + SCAN_SIZE, bottom: 0 },
      left: { top: frameTop, height: SCAN_SIZE, width: Math.max(0, frameLeft) },
      right: {
        top: frameTop,
        height: SCAN_SIZE,
        left: frameLeft + SCAN_SIZE,
        width: Math.max(0, windowWidth - frameLeft - SCAN_SIZE)
      }
    }),
    [frameLeft, frameTop, windowWidth]
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" translucent />

      <View style={styles.stage}>
        <CameraViewCompat
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onCameraReady={onCameraReady}
          onMountError={onMountError}
          onBarcodeScanned={locked ? undefined : onBarcodeScanned}
        />

        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={[styles.mask, styles.maskTop, maskPieces.top]} />
          <View style={[styles.mask, styles.maskBottom, maskPieces.bottom]} />
          <View style={[styles.mask, { left: 0 }, maskPieces.left]} />
          <View style={[styles.mask, maskPieces.right]} />

          <View
            style={[
              styles.frame,
              { top: frameTop, left: frameLeft, width: SCAN_SIZE, height: SCAN_SIZE }
            ]}
          >
            <View style={[styles.corner, styles.cornerTl]} />
            <View style={[styles.corner, styles.cornerTr]} />
            <View style={[styles.corner, styles.cornerBl]} />
            <View style={[styles.corner, styles.cornerBr]} />
          </View>
        </View>

        {/* 顶栏：仅关闭 */}
        <View
          style={[styles.topBar, { paddingTop: Math.max(insets.top, 12) + 4 }]}
          pointerEvents="box-none"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭扫码"
            hitSlop={16}
            onPress={onCancel}
            style={({ pressed }) => [styles.iconBtn, pressed ? styles.iconBtnPressed : null]}
          >
            <Feather name="x" size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* 底栏标题 */}
        <View
          style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 14) + 10 }]}
          pointerEvents="none"
        >
          <Text style={styles.title}>{title}</Text>
        </View>

        {/* 相册：仅图标，右下角 */}
        <View
          pointerEvents="box-none"
          style={[
            styles.albumAnchor,
            { paddingBottom: Math.max(insets.bottom, 16) + 20, paddingRight: 20 }
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="从相册选择二维码"
            hitSlop={12}
            onPress={onPickFromAlbum}
            style={({ pressed }) => [styles.albumBtn, pressed ? styles.iconBtnPressed : null]}
          >
            <Feather name="image" size={22} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000'
  },
  stage: {
    flex: 1,
    backgroundColor: '#000000',
    overflow: 'hidden'
  },
  mask: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.55)'
  },
  maskTop: {
    left: 0,
    right: 0,
    top: 0
  },
  maskBottom: {
    left: 0,
    right: 0
  },
  frame: {
    position: 'absolute'
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: '#FFFFFF'
  },
  cornerTl: {
    left: 0,
    top: 0,
    borderLeftWidth: CORNER_W,
    borderTopWidth: CORNER_W
  },
  cornerTr: {
    right: 0,
    top: 0,
    borderRightWidth: CORNER_W,
    borderTopWidth: CORNER_W
  },
  cornerBl: {
    left: 0,
    bottom: 0,
    borderLeftWidth: CORNER_W,
    borderBottomWidth: CORNER_W
  },
  cornerBr: {
    right: 0,
    bottom: 0,
    borderRightWidth: CORNER_W,
    borderBottomWidth: CORNER_W
  },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 20,
    elevation: 20,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center'
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 18,
    elevation: 18,
    paddingTop: 18,
    paddingHorizontal: 24,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)'
  },
  title: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: 0.2
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)'
  },
  iconBtnPressed: {
    opacity: 0.72
  },
  albumAnchor: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 22,
    elevation: 22,
    justifyContent: 'flex-end',
    alignItems: 'flex-end'
  },
  albumBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)'
  }
});
