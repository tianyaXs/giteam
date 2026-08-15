import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing as RnEasing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import { LegendList } from '@legendapp/list/react-native';
import { toText } from '../../lib/text';

type AlbumImageItem = {
  id: string;
  uri: string;
};

type MediaAlbum = {
  id: string;
  title: string;
  assetCount?: number;
};

function AlbumThumbCell(props: {
  item: AlbumImageItem;
  fresh: boolean;
  selected: boolean;
  selectedIndex: number;
  isQrScan: boolean;
  styles: Record<string, any>;
  onToggle: () => void;
}) {
  const { fresh, isQrScan, item, onToggle, selected, selectedIndex, styles } = props;
  const opacity = useRef(new Animated.Value(fresh ? 0 : 1)).current;
  const translateY = useRef(new Animated.Value(fresh ? -10 : 0)).current;

  useEffect(() => {
    if (!fresh) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    opacity.setValue(0);
    translateY.setValue(-10);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 280,
        easing: RnEasing.out(RnEasing.cubic),
        useNativeDriver: true
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 280,
        easing: RnEasing.out(RnEasing.cubic),
        useNativeDriver: true
      })
    ]).start();
  }, [fresh, item.id, opacity, translateY]);

  return (
    <Pressable style={isQrScan ? styles.qrAlbumThumbCell : styles.albumThumbCell} onPress={onToggle}>
      <Animated.View
        style={[
          isQrScan ? styles.qrAlbumThumbCard : styles.albumThumbCard,
          { opacity, transform: [{ translateY }] }
        ]}
      >
        <Image source={{ uri: item.uri }} style={styles.albumThumbImage} resizeMode="cover" />
        <View
          style={[
            isQrScan ? styles.qrAlbumSelectBadge : styles.albumSelectBadge,
            selected ? (isQrScan ? styles.qrAlbumSelectBadgeOn : styles.albumSelectBadgeOn) : null
          ]}
        >
          <Text style={[styles.albumSelectText, selected ? styles.albumSelectTextOn : null]}>
            {selected ? selectedIndex + 1 : ''}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

export function AlbumPickerOverlay(props: {
  styles: Record<string, any>;
  open: boolean;
  /** confirm 用 quick，避免收起动画与多图写入叠帧；cancel 保留 slide。 */
  exitMode?: 'slide' | 'quick';
  purpose?: 'attachment' | 'qr-scan';
  mediaAlbums: MediaAlbum[];
  selectedMediaAlbumId: string;
  albumSelectedIds: string[];
  albumSelectedSet: Set<string>;
  albumImagesLoading: boolean;
  albumImagesLoadingMore: boolean;
  albumImages: AlbumImageItem[];
  freshAlbumImageIdSet?: Set<string>;
  onClose: () => void;
  onConfirm: () => void;
  onSelectAlbum: (albumId: string) => void;
  onToggleImage: (imageId: string) => void;
  onLoadMore: () => void;
}) {
  const {
    albumImages,
    albumImagesLoading,
    albumImagesLoadingMore,
    albumSelectedIds,
    albumSelectedSet,
    exitMode = 'slide',
    freshAlbumImageIdSet,
    mediaAlbums,
    onClose,
    onConfirm,
    onLoadMore,
    onSelectAlbum,
    onToggleImage,
    open,
    purpose = 'attachment',
    selectedMediaAlbumId,
    styles
  } = props;

  const isQrScan = purpose === 'qr-scan';
  const [mounted, setMounted] = useState(false);
  const panelAnim = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);
  const mountedRef = useRef(false);
  const exitModeRef = useRef(exitMode);
  exitModeRef.current = exitMode;
  const sheetTravel = Math.min(640, Math.round(Dimensions.get('window').height * 0.72));

  useEffect(() => {
    if (open) {
      closingRef.current = false;
      mountedRef.current = true;
      setMounted(true);
      panelAnim.stopAnimation();
      panelAnim.setValue(0);
      Animated.spring(panelAnim, {
        toValue: 1,
        stiffness: 220,
        damping: 26,
        mass: 0.95,
        useNativeDriver: true
      }).start();
      return;
    }

    if (!mountedRef.current || closingRef.current) return;
    closingRef.current = true;
    panelAnim.stopAnimation();
    const quick = exitModeRef.current === 'quick';
    Animated.timing(panelAnim, {
      toValue: 0,
      // 确认添加：短收起，尽快让出主线程给缩略图；取消：保留下滑手感。
      duration: quick ? 120 : 280,
      easing: quick ? RnEasing.out(RnEasing.quad) : RnEasing.in(RnEasing.cubic),
      useNativeDriver: true
    }).start(({ finished }) => {
      closingRef.current = false;
      if (!finished) return;
      mountedRef.current = false;
      setMounted(false);
    });
  }, [open, panelAnim]);

  if (!mounted) return null;

  const confirmLabel =
    albumSelectedIds.length > 0
      ? isQrScan
        ? '打开'
        : `添加 ${albumSelectedIds.length}`
      : isQrScan
        ? '打开'
        : '添加';

  const backdropStyle = {
    opacity: panelAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1]
    })
  };

  const sheetStyle = isQrScan
    ? {
        opacity: panelAnim,
        transform: [
          {
            translateY: panelAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [28, 0]
            })
          }
        ]
      }
    : {
        transform: [
          {
            translateY: panelAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [sheetTravel, 0]
            })
          }
        ]
      };

  const showInitialLoading = albumImagesLoading && albumImages.length === 0;

  return (
    <View style={isQrScan ? styles.qrAlbumOverlay : styles.albumOverlay} pointerEvents="box-none">
      {isQrScan ? null : (
        <Animated.View style={[styles.albumBackdrop, backdropStyle]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />
        </Animated.View>
      )}
      <Animated.View style={[isQrScan ? styles.qrAlbumSheet : styles.albumSheet, sheetStyle]}>
        <View style={styles.albumHeaderRow}>
          <Pressable style={isQrScan ? styles.qrAlbumCloseBtn : styles.albumHeaderBtn} onPress={onClose}>
            {isQrScan ? <Feather name="x" size={26} color="#252526" /> : <Text style={styles.albumHeaderBtnText}>取消</Text>}
          </Pressable>
          <View style={isQrScan ? styles.qrAlbumTitleWrap : null}>
            <Text style={isQrScan ? styles.qrAlbumTitle : styles.albumTitle}>{isQrScan ? '图片和视频' : '相册'}</Text>
            {isQrScan ? <Feather name="chevron-down" size={18} color="#252526" /> : null}
          </View>
          <Pressable
            style={[
              isQrScan ? styles.qrAlbumConfirmBtn : styles.albumHeaderBtn,
              albumSelectedIds.length === 0 ? styles.albumHeaderBtnDisabled : null
            ]}
            onPress={onConfirm}
            disabled={albumSelectedIds.length === 0}
          >
            <Text
              style={[
                isQrScan ? styles.qrAlbumConfirmText : styles.albumHeaderBtnText,
                albumSelectedIds.length === 0 ? styles.albumHeaderBtnTextDisabled : null
              ]}
            >
              {confirmLabel}
            </Text>
          </Pressable>
        </View>
        {isQrScan ? null : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.albumPickerBar} contentContainerStyle={styles.albumPickerBarContent}>
            {mediaAlbums.map((album) => (
              <Pressable
                key={album.id}
                style={album.id === selectedMediaAlbumId ? [styles.albumPickerChip, styles.albumPickerChipActive] : styles.albumPickerChip}
                onPress={() => onSelectAlbum(album.id)}
              >
                <Text
                  style={album.id === selectedMediaAlbumId ? [styles.albumPickerChipText, styles.albumPickerChipTextActive] : styles.albumPickerChipText}
                  numberOfLines={1}
                >
                  {album.title}
                  {album.assetCount ? ` ${album.assetCount}` : ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        {showInitialLoading ? (
          <View style={styles.albumLoadingWrap}>
            <ActivityIndicator />
            <Text style={styles.albumLoadingText}>Loading photos...</Text>
          </View>
        ) : albumImages.length === 0 ? (
          <Text style={styles.albumEmptyText}>暂无照片</Text>
        ) : (
          <LegendList
            data={albumImages}
            numColumns={isQrScan ? 4 : 3}
            estimatedItemSize={120}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={isQrScan ? styles.qrAlbumGrid : styles.albumGrid}
            extraData={`${albumSelectedIds.join(',')}:${freshAlbumImageIdSet ? freshAlbumImageIdSet.size : 0}`}
            onEndReached={onLoadMore}
            onEndReachedThreshold={0.7}
            ListFooterComponent={albumImagesLoadingMore ? <View style={styles.albumLoadingMore}><ActivityIndicator size="small" /></View> : null}
            renderItem={({ item }) => {
              const selectedIndex = albumSelectedIds.indexOf(item.id);
              const selected = albumSelectedSet.has(item.id);
              const fresh = Boolean(freshAlbumImageIdSet?.has(item.id));
              return (
                <AlbumThumbCell
                  item={item}
                  fresh={fresh}
                  selected={selected}
                  selectedIndex={selectedIndex}
                  isQrScan={isQrScan}
                  styles={styles}
                  onToggle={() => onToggleImage(item.id)}
                />
              );
            }}
          />
        )}
      </Animated.View>
    </View>
  );
}

export function ImagePreviewOverlay(props: {
  styles: Record<string, any>;
  image: { uri: string; filename?: string } | null;
  onClose: () => void;
}) {
  const { image, onClose, styles } = props;
  const visible = Boolean(image?.uri);
  const uri = toText(image?.uri).trim();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const closingRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      opacity.value = 0;
      translateY.value = 0;
      scale.value = 1;
      closingRef.current = false;
      return;
    }
    closingRef.current = false;
    opacity.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
    translateY.value = 0;
    scale.value = 1;
  }, [opacity, scale, translateY, visible, uri]);

  const finishClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    opacity.value = withTiming(0, { duration: 140, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  }, [onClose, opacity]);

  const panDismiss = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(12)
        .failOffsetX([-24, 24])
        .onUpdate((evt) => {
          'worklet';
          const dy = Math.max(0, evt.translationY);
          translateY.value = dy;
          const p = Math.min(1, dy / 280);
          opacity.value = 1 - p * 0.55;
          scale.value = 1 - p * 0.06;
        })
        .onEnd((evt) => {
          'worklet';
          const shouldClose = evt.translationY > 96 || evt.velocityY > 1100;
          if (shouldClose) {
            opacity.value = withTiming(0, { duration: 160 });
            translateY.value = withTiming(Math.max(320, evt.translationY + 120), { duration: 160 }, (finished) => {
              if (finished) runOnJS(onClose)();
            });
            return;
          }
          translateY.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) });
          opacity.value = withTiming(1, { duration: 180 });
          scale.value = withTiming(1, { duration: 180 });
        }),
    [onClose, opacity, scale, translateY]
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value
  }));

  const imageStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }]
  }));

  if (!visible || !uri) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={finishClose}>
      <View style={styles.imagePreviewOverlay} pointerEvents="box-none">
        <Reanimated.View style={[styles.imagePreviewBackdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={finishClose} accessibilityLabel="关闭图片" />
        </Reanimated.View>
        <SafeAreaView style={styles.imagePreviewSafe} pointerEvents="box-none">
          <View style={styles.imagePreviewToolbar} pointerEvents="box-none">
            <Pressable style={styles.imagePreviewCloseHit} onPress={finishClose} hitSlop={12}>
              <Text style={styles.imagePreviewCloseTxt}>关闭</Text>
            </Pressable>
          </View>
          <GestureDetector gesture={panDismiss}>
            <Reanimated.View style={[styles.imagePreviewStage, imageStyle]}>
              <Image source={{ uri }} style={styles.imagePreviewImage} resizeMode="contain" />
            </Reanimated.View>
          </GestureDetector>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
