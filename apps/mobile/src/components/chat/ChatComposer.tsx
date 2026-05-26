import React from 'react';
import { ActivityIndicator, Animated, Image, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { toText } from '../../lib/text';

type ComposerAttachment = {
  id: string;
  uri: string;
  filename: string;
  mime: string;
  dataUrl: string;
  status?: 'processing' | 'ready' | 'uploading' | 'failed';
  statusText?: string;
};

type RecentImageItem = {
  id: string;
  uri: string;
  filename: string;
  mediaType?: string;
};

type SlashCommand = {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  source: 'builtin' | 'command' | 'skill' | 'mcp';
};

type ModelOption = {
  id: string;
  label: string;
};

type ComposerModeOption = {
  key: 'build' | 'plan';
  label: string;
};

function ChatComposerImpl(props: {
  styles: Record<string, any>;
  prompt: string;
  imageAttachments: ComposerAttachment[];
  attachmentMenuOpen: boolean;
  attachmentPanelVisible: boolean;
  attachmentToggleAnim: Animated.Value;
  attachmentPanelStyle: any;
  actionIconAnim: Animated.Value;
  inputModelLabel: string;
  canSendNow: boolean;
  canAbortNow: boolean;
  slashOpen: boolean;
  slashActiveIndex: number;
  slashSuggestions: SlashCommand[];
  recentScrollerHeight: number;
  recentImages: RecentImageItem[];
  recentImagesLoading: boolean;
  recentImagesLoadingMore: boolean;
  recentImagesHasNext: boolean;
  keyboardInset: number;
  onLayoutHeight: (height: number) => void;
  onPromptChange: (value: string) => void;
  onToggleAttachmentMenu: () => void;
  onDismissAttachmentPanel: () => void;
  onOpenAttachmentPreview: (img: { uri: string; filename?: string }) => void;
  onRemoveAttachment: (id: string) => void;
  onOpenComposerPicker: () => void;
  onAbort: () => void;
  onSend: () => void;
  onSelectSlash: (trigger: string) => void;
  onCaptureCamera: () => void;
  onOpenAlbumPicker: () => void;
  onPickFile: () => void;
  onRecentScroll: (y: number, viewportH: number, contentH: number) => void;
  onAttachRecentImage: (item: RecentImageItem) => void;
}) {
  const {
    actionIconAnim,
    attachmentMenuOpen,
    attachmentPanelStyle,
    attachmentPanelVisible,
    attachmentToggleAnim,
    canAbortNow,
    canSendNow,
    imageAttachments,
    inputModelLabel,
    keyboardInset,
    onAbort,
    onAttachRecentImage,
    onCaptureCamera,
    onDismissAttachmentPanel,
    onLayoutHeight,
    onOpenAlbumPicker,
    onOpenAttachmentPreview,
    onOpenComposerPicker,
    onPickFile,
    onPromptChange,
    onRecentScroll,
    onRemoveAttachment,
    onSelectSlash,
    onSend,
    onToggleAttachmentMenu,
    prompt,
    recentImages,
    recentImagesHasNext,
    recentImagesLoading,
    recentImagesLoadingMore,
    recentScrollerHeight,
    slashActiveIndex,
    slashOpen,
    slashSuggestions,
    styles
  } = props;
  const composerLift = Platform.OS === 'android' && keyboardInset > 0 ? 8 : 0;

  return (
    <>
      {attachmentPanelVisible ? <Pressable style={styles.attachmentBackdrop} onPress={onDismissAttachmentPanel} /> : null}
      <Animated.View
        style={[styles.inputDock, composerLift > 0 ? { marginBottom: composerLift } : null]}
        onLayout={(evt) => {
          const h = Math.ceil(Number(evt.nativeEvent.layout?.height || 0));
          if (h > 0) onLayoutHeight(h);
        }}
      >
        {imageAttachments.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.attachmentRow}
            style={styles.attachmentScroller}
          >
            {imageAttachments.map((img) => (
              <Pressable key={img.id} style={styles.attachmentTile} onPress={() => onOpenAttachmentPreview({ uri: img.uri, filename: img.filename })}>
                <Image source={{ uri: img.uri }} style={styles.attachmentThumb} resizeMode="cover" />
                {img.status && img.status !== 'ready' ? (
                  <View style={img.status === 'failed' ? [styles.attachmentStateOverlay, styles.attachmentStateFailed] : styles.attachmentStateOverlay}>
                    {img.status === 'processing' || img.status === 'uploading' ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                    <Text style={styles.attachmentStateText}>{img.statusText || (img.status === 'failed' ? '失败' : '处理中')}</Text>
                  </View>
                ) : null}
                <Pressable style={styles.attachmentRemove} onPress={() => onRemoveAttachment(img.id)} hitSlop={8}>
                  <Text style={styles.attachmentRemoveTxt}>×</Text>
                </Pressable>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <TextInput
          style={styles.inputMain}
          value={toText(prompt)}
          onChangeText={onPromptChange}
          placeholder="向 Giteam 询问任何事，输入 / 使用命令"
          placeholderTextColor="#c6cbd3"
          multiline
        />
        <View style={styles.inputToolbar}>
          <Pressable style={styles.cameraBtn} onPress={onToggleAttachmentMenu} hitSlop={8}>
            <Animated.View
              style={{
                transform: [
                  {
                    rotate: attachmentToggleAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '90deg']
                    })
                  }
                ]
              }}
            >
              <Feather name={attachmentMenuOpen ? 'x' : 'plus'} size={22} color="#111827" />
            </Animated.View>
          </Pressable>
          <View style={styles.inputToolbarSpacer} />
          <Pressable style={styles.modelMiniPill} onPress={onOpenComposerPicker}>
            <Text numberOfLines={1} style={styles.modelMiniText}>
              {inputModelLabel}
            </Text>
          </Pressable>
          <Pressable
            style={canSendNow || canAbortNow ? styles.actionBtnSend : styles.actionBtnDisabled}
            onPress={() => {
              if (canAbortNow) {
                onAbort();
                return;
              }
              if (!canSendNow) return;
              onSend();
            }}
            disabled={!canSendNow && !canAbortNow}
          >
            <Animated.View
              style={{
                opacity: actionIconAnim,
                transform: [{ scale: actionIconAnim }]
              }}
            >
              <Feather
                name={canAbortNow ? 'square' : 'arrow-up'}
                size={canAbortNow ? 16 : 20}
                color={canSendNow || canAbortNow ? '#ffffff' : '#8d949e'}
              />
            </Animated.View>
          </Pressable>
        </View>
        {slashOpen && slashSuggestions.length > 0 ? (
          <ScrollView style={styles.slashPopover} keyboardShouldPersistTaps="handled">
            {slashSuggestions.map((cmd, idx) => (
              <Pressable
                key={cmd.id}
                style={[styles.slashItem, idx === slashActiveIndex ? styles.slashItemActive : null]}
                onPress={() => onSelectSlash(cmd.trigger)}
              >
                <View style={styles.slashItemMain}>
                  <View style={styles.slashItemTopRow}>
                    <Text style={styles.slashTrigger}>/{cmd.trigger}</Text>
                    <Text style={styles.slashSource}>{cmd.source}</Text>
                  </View>
                  <Text style={styles.slashTitle}>{cmd.title}</Text>
                  {cmd.description ? (
                    <Text numberOfLines={1} style={styles.slashDesc}>
                      {cmd.description}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {attachmentPanelVisible ? (
          <Animated.View style={[styles.attachmentPanel, attachmentPanelStyle]}>
            <View style={styles.attachmentMenuRow}>
              <Pressable style={styles.attachmentMenuCard} onPress={onCaptureCamera}>
                <View style={styles.attachmentMenuIconShell}>
                  <Feather name="camera" size={22} color="#1f2937" />
                </View>
                <Text style={styles.attachmentMenuLabel}>Camera</Text>
              </Pressable>
              <Pressable style={styles.attachmentMenuCard} onPress={onOpenAlbumPicker}>
                <View style={styles.attachmentMenuIconShell}>
                  <Feather name="image" size={22} color="#1f2937" />
                </View>
                <Text style={styles.attachmentMenuLabel}>Photos</Text>
              </Pressable>
              <Pressable style={styles.attachmentMenuCard} onPress={onPickFile}>
                <View style={styles.attachmentMenuIconShell}>
                  <Feather name="folder" size={22} color="#1f2937" />
                </View>
                <Text style={styles.attachmentMenuLabel}>Files</Text>
              </Pressable>
            </View>
            <View style={styles.recentHeaderRow}>
              <Text style={styles.recentHeaderTitle}>Recent Images</Text>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              style={[styles.recentScroller, { height: recentScrollerHeight }]}
              contentContainerStyle={styles.recentScrollerContent}
              scrollEventThrottle={16}
              onScroll={(evt) => {
                const y = Number(evt.nativeEvent.contentOffset?.y || 0);
                const viewportH = Number(evt.nativeEvent.layoutMeasurement?.height || 0);
                const contentH = Number(evt.nativeEvent.contentSize?.height || 0);
                onRecentScroll(y, viewportH, contentH);
              }}
            >
              <View style={styles.recentGrid}>
                {recentImages.map((item) => (
                  <Pressable key={item.id} style={styles.recentThumbCard} onPress={() => onAttachRecentImage(item)}>
                    <Image source={{ uri: item.uri }} style={styles.recentThumbImage} resizeMode="cover" />
                  </Pressable>
                ))}
                {recentImages.length === 0 && recentImagesLoading ? (
                  <View style={styles.recentLoadingState}>
                    <ActivityIndicator size="small" color="#64748b" />
                    <Text style={styles.recentLoadingText}>Loading recent images</Text>
                  </View>
                ) : null}
                {recentImages.length === 0 && !recentImagesLoading ? (
                  <View style={styles.recentEmptyState}>
                    <Feather name="image" size={18} color="#94a3b8" />
                    <Text style={styles.recentEmptyText}>No recent images</Text>
                  </View>
                ) : null}
                {recentImagesLoadingMore ? (
                  <View style={styles.recentLoadingMore}>
                    <ActivityIndicator size="small" />
                  </View>
                ) : null}
                {recentImagesHasNext && !recentImagesLoadingMore ? (
                  <View style={styles.recentLoadHint}>
                    <Text style={styles.recentLoadHintText}>Scroll to load more</Text>
                  </View>
                ) : null}
              </View>
            </ScrollView>
          </Animated.View>
        ) : null}
      </Animated.View>
    </>
  );
}

export const ChatComposer = React.memo(ChatComposerImpl);

export function ComposerPickerSheet(props: {
  styles: Record<string, any>;
  open: boolean;
  backgroundColor: string;
  composerModeOptions: ComposerModeOption[];
  composerAgent: 'build' | 'plan';
  autoAcceptPermissions: boolean;
  modelOptions: ModelOption[];
  selectedModel: string;
  onClose: () => void;
  onSelectMode: (mode: 'build' | 'plan') => void;
  onToggleAutoAccept: () => void;
  onSelectModel: (id: string) => void;
}) {
  const {
    autoAcceptPermissions,
    backgroundColor,
    composerAgent,
    composerModeOptions,
    modelOptions,
    onClose,
    onSelectMode,
    onSelectModel,
    onToggleAutoAccept,
    open,
    selectedModel,
    styles
  } = props;
  if (!open) return null;
  return (
    <View style={styles.composerPickerOverlay}>
      <Pressable style={styles.composerPickerBackdrop} onPress={onClose} />
      <View style={[styles.composerPickerSheet, { backgroundColor }]}>
        <View style={styles.composerPickerHeader}>
          <Text style={styles.composerPickerTitle}>Model & Mode</Text>
          <Pressable style={styles.composerPickerCloseBtn} onPress={onClose}>
            <Feather name="x" size={20} color="#7c766c" />
          </Pressable>
        </View>
        <View style={styles.composerPickerSection}>
          <Text style={styles.composerPickerSectionTitle}>Mode</Text>
          {composerModeOptions.map((option) => {
            const active = composerAgent === option.key;
            return (
              <Pressable
                key={option.key}
                style={active ? [styles.composerPickerRow, styles.composerPickerRowActive] : styles.composerPickerRow}
                onPress={() => onSelectMode(option.key)}
              >
                <Text style={active ? [styles.composerPickerRowText, styles.composerPickerRowTextActive] : styles.composerPickerRowText}>
                  {option.label}
                </Text>
                {active ? <Feather name="check" size={18} color="#111827" /> : null}
              </Pressable>
            );
          })}
        </View>
        <View style={styles.composerPickerDivider} />
        <View style={styles.composerPickerSection}>
          <View style={styles.composerPickerRow}>
            <Text style={styles.composerPickerRowText}>Auto Accept</Text>
            <Pressable
              style={autoAcceptPermissions ? [styles.composerPickerSwitch, styles.composerPickerSwitchActive] : styles.composerPickerSwitch}
              onPress={onToggleAutoAccept}
            >
              <View
                style={
                  autoAcceptPermissions
                    ? [styles.composerPickerSwitchThumb, styles.composerPickerSwitchThumbActive]
                    : styles.composerPickerSwitchThumb
                }
              />
            </Pressable>
          </View>
        </View>
        <View style={styles.composerPickerDivider} />
        <ScrollView style={styles.composerPickerList} contentContainerStyle={{ paddingBottom: 20 }}>
          {modelOptions.map((opt) => {
            const active = selectedModel.trim() === opt.id;
            return (
              <Pressable
                key={opt.id}
                style={active ? [styles.composerPickerItem, styles.composerPickerItemActive] : styles.composerPickerItem}
                onPress={() => onSelectModel(opt.id)}
              >
                <View style={styles.composerPickerItemMain}>
                  <Text style={active ? styles.composerPickerItemTitleActive : styles.composerPickerItemTitle}>{toText(opt.label)}</Text>
                  <Text style={styles.composerPickerItemSub}>{toText(opt.id)}</Text>
                </View>
                {active ? (
                  <View style={styles.composerPickerCheck}>
                    <Feather name="check" size={16} color="#5d5345" />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
