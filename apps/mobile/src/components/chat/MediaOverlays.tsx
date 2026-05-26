import { Feather } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';

type AlbumImageItem = {
  id: string;
  uri: string;
};

type MediaAlbum = {
  id: string;
  title: string;
  assetCount?: number;
};

export function AlbumPickerOverlay(props: {
  styles: Record<string, any>;
  open: boolean;
  purpose?: 'attachment' | 'qr-scan';
  mediaAlbums: MediaAlbum[];
  selectedMediaAlbumId: string;
  albumSelectedIds: string[];
  albumSelectedSet: Set<string>;
  albumImagesLoading: boolean;
  albumImagesLoadingMore: boolean;
  albumImages: AlbumImageItem[];
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

  if (!open) return null;

  const isQrScan = purpose === 'qr-scan';
  const confirmLabel =
    albumSelectedIds.length > 0
      ? isQrScan
        ? '打开'
        : `添加 ${albumSelectedIds.length}`
      : isQrScan
        ? '打开'
        : '添加';

  return (
    <View style={isQrScan ? styles.qrAlbumOverlay : styles.albumOverlay}>
      {isQrScan ? null : <Pressable style={styles.albumBackdrop} onPress={onClose} />}
      <View style={isQrScan ? styles.qrAlbumSheet : styles.albumSheet}>
        <View style={styles.albumHeaderRow}>
          <Pressable style={isQrScan ? styles.qrAlbumCloseBtn : styles.albumHeaderBtn} onPress={onClose}>
            {isQrScan ? <Feather name="x" size={26} color="#ffffff" /> : <Text style={styles.albumHeaderBtnText}>取消</Text>}
          </Pressable>
          <View style={isQrScan ? styles.qrAlbumTitleWrap : null}>
            <Text style={isQrScan ? styles.qrAlbumTitle : styles.albumTitle}>{isQrScan ? '图片和视频' : '相册'}</Text>
            {isQrScan ? <Feather name="chevron-down" size={18} color="#ffffff" /> : null}
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
        {albumImagesLoading ? (
          <View style={styles.albumLoadingWrap}>
            <ActivityIndicator />
            <Text style={styles.albumLoadingText}>Loading photos...</Text>
          </View>
        ) : albumImages.length === 0 ? (
          <Text style={styles.albumEmptyText}>暂无照片</Text>
        ) : (
          <FlashList
            data={albumImages}
            numColumns={isQrScan ? 4 : 3}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={isQrScan ? styles.qrAlbumGrid : styles.albumGrid}
            extraData={albumSelectedIds}
            onEndReached={onLoadMore}
            onEndReachedThreshold={0.7}
            ListFooterComponent={albumImagesLoadingMore ? <View style={styles.albumLoadingMore}><ActivityIndicator size="small" /></View> : null}
            renderItem={({ item }) => {
              const selectedIndex = albumSelectedIds.indexOf(item.id);
              const selected = albumSelectedSet.has(item.id);
              return (
                <Pressable style={isQrScan ? styles.qrAlbumThumbCell : styles.albumThumbCell} onPress={() => onToggleImage(item.id)}>
                  <View style={isQrScan ? styles.qrAlbumThumbCard : styles.albumThumbCard}>
                    <Image source={{ uri: item.uri }} style={styles.albumThumbImage} resizeMode="cover" />
                    <View
                      style={[
                        isQrScan ? styles.qrAlbumSelectBadge : styles.albumSelectBadge,
                        selected ? (isQrScan ? styles.qrAlbumSelectBadgeOn : styles.albumSelectBadgeOn) : null
                      ]}
                    >
                      <Text style={[styles.albumSelectText, selected ? styles.albumSelectTextOn : null]}>{selected ? selectedIndex + 1 : ''}</Text>
                    </View>
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </View>
  );
}

export function ImagePreviewOverlay(props: {
  styles: Record<string, any>;
  image: { uri: string; filename?: string } | null;
  onClose: () => void;
}) {
  const { image, onClose, styles } = props;
  if (!image) return null;
  return (
    <View style={styles.imagePreviewOverlay}>
      <Pressable style={styles.imagePreviewBackdrop} onPress={onClose} />
      <View style={styles.imagePreviewCard}>
        <View style={styles.imagePreviewToolbar}>
          <Pressable style={styles.imagePreviewButton} onPress={onClose}>
            <Text style={styles.imagePreviewButtonText}>关闭</Text>
          </Pressable>
        </View>
        <Image source={{ uri: image.uri }} style={styles.imagePreviewImage} resizeMode="contain" />
      </View>
    </View>
  );
}
