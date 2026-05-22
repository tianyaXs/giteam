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
    selectedMediaAlbumId,
    styles
  } = props;

  if (!open) return null;

  return (
    <View style={styles.albumOverlay}>
      <Pressable style={styles.albumBackdrop} onPress={onClose} />
      <View style={styles.albumSheet}>
        <View style={styles.albumHeaderRow}>
          <Pressable style={styles.albumHeaderBtn} onPress={onClose}>
            <Text style={styles.albumHeaderBtnText}>取消</Text>
          </Pressable>
          <Text style={styles.albumTitle}>相册</Text>
          <Pressable
            style={[styles.albumHeaderBtn, albumSelectedIds.length === 0 ? styles.albumHeaderBtnDisabled : null]}
            onPress={onConfirm}
            disabled={albumSelectedIds.length === 0}
          >
            <Text style={[styles.albumHeaderBtnText, albumSelectedIds.length === 0 ? styles.albumHeaderBtnTextDisabled : null]}>
              {albumSelectedIds.length > 0 ? `添加 ${albumSelectedIds.length}` : '添加'}
            </Text>
          </Pressable>
        </View>
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
            numColumns={3}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.albumGrid}
            extraData={albumSelectedIds}
            onEndReached={onLoadMore}
            onEndReachedThreshold={0.7}
            ListFooterComponent={albumImagesLoadingMore ? <View style={styles.albumLoadingMore}><ActivityIndicator size="small" /></View> : null}
            renderItem={({ item }) => {
              const selectedIndex = albumSelectedIds.indexOf(item.id);
              const selected = albumSelectedSet.has(item.id);
              return (
                <Pressable style={styles.albumThumbCell} onPress={() => onToggleImage(item.id)}>
                  <View style={styles.albumThumbCard}>
                    <Image source={{ uri: item.uri }} style={styles.albumThumbImage} resizeMode="cover" />
                    <View style={[styles.albumSelectBadge, selected ? styles.albumSelectBadgeOn : null]}>
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
