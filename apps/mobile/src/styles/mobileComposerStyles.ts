import { Platform, StyleSheet } from "react-native";
import {
  FONT_DISPLAY_SERIF,
  FONT_TEXT_SERIF,
  FONT_UI_MEDIUM,
  FONT_UI_REGULAR,
  HANDWRITTEN_TEXT_FONT,
} from "./mobileFonts";
import type { MobileNamedStyles } from "./mobileStyleTypes";

export const composerStyles = {
  todoDockWrap: {
    marginHorizontal: 12,
    marginBottom: 8,
  },

  todoProgressBubbleRoot: {
    position: "absolute",
    top: 52,
    right: 0,
    left: 0,
    bottom: 0,
    zIndex: 40,
    elevation: 40,
  },

  todoProgressBubbleBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },

  todoProgressBubbleAnchor: {
    position: "absolute",
    top: 10,
    right: 12,
    alignItems: "flex-end",
    maxWidth: 280,
  },

  /** morph 外壳：宽高/圆角由动画驱动 */
  todoProgressMorphShell: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
    alignItems: "stretch",
  },

  todoProgressCollapsedLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },

  todoProgressMenuLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
  },

  todoProgressBubble: {
    minWidth: 40,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },

  /** 已在 morph 外壳内，去掉重复描边与阴影 */
  todoProgressBubbleInMorph: {
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
    backgroundColor: "transparent",
  },

  /** 气泡 morph 成菜单后的内容（尺寸由外壳动画） */
  todoProgressMorphMenu: {
    width: 248,
    maxWidth: "86%",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },

  todoProgressMorphMenuInShell: {
    width: "100%",
    maxWidth: "100%",
    borderWidth: 0,
    borderRadius: 0,
    shadowOpacity: 0,
    elevation: 0,
    backgroundColor: "transparent",
  },

  todoProgressBubbleText: {
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
  },

  todoProgressMenuWrap: {
    marginTop: 8,
    width: 248,
    maxWidth: "86%",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },

  todoProgressMenuHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },

  todoProgressMenuTitle: {
    fontSize: 12,
    fontWeight: "500",
  },

  todoProgressMenuCount: {
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },

  todoProgressMenuScroll: {
    maxHeight: 220,
  },

  todoProgressMenuScrollContent: {
    gap: 8,
    paddingBottom: 2,
  },

  todoProgressMenuRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },

  todoProgressMenuRowText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "400",
  },

  todoSwipeShell: {
    borderRadius: 22,
    overflow: "hidden",
  },

  todoSwipeHint: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingLeft: 18,
    backgroundColor: "#2d2d2d",
  },

  todoSwipeHintText: {
    color: "#10A37F",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
  },

  questionDockWrap: {
    marginHorizontal: 12,
    marginBottom: 8,
  },

  todoDockCompact: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#3c3c3c",
    backgroundColor: "#252526",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    shadowColor: "#d4d4d4",
    shadowOpacity: 0.08,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },

  todoDock: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#3c3c3c",
    backgroundColor: "#252526",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    shadowColor: "#d4d4d4",
    shadowOpacity: 0.07,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2,
  },

  inputDock: {
    marginHorizontal: 16,
    marginBottom: 0,
    borderRadius: 28,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "#FFFFFF",
    minHeight: 54,
    paddingLeft: 4,
    paddingRight: 4,
    paddingTop: 4,
    paddingBottom: 4,
    flexDirection: "column",
    alignItems: "stretch",
    gap: 0,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    zIndex: 3,
  },

  // attachmentBackdrop 已移除：附件面板不再使用灰色遮罩

  attachmentBubbleDock: {
    position: "absolute",
    left: 2,
    bottom: "100%",
    marginBottom: 10,
    zIndex: 20,
  },

  attachmentBubbleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  attachmentBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },

  attachmentBubbleIcon: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },

  attachmentBubbleLabel: {
    fontSize: 13,
    fontWeight: "600",
    includeFontPadding: false,
  },

  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },

  inputToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
    minHeight: 52,
    paddingVertical: 0,
  },

  /** 双区 dock：左输入区 + 右模型区（默认收起） */
  inputZones: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: "transparent",
    padding: 3,
    position: "relative",
  },

  inputZoneOuter: {
    width: "50%",
    borderRadius: 18,
    overflow: "hidden",
  },

  inputZone: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 6,
    minHeight: 38,
    borderRadius: 18,
    paddingHorizontal: 12,
    overflow: "hidden",
  },

  inputZoneExpanded: {
    flex: 1,
  },

  modelZoneOuter: {
    width: "50%",
    borderRadius: 18,
    overflow: "hidden",
  },

  modelZone: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    minHeight: 38,
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },

  modelZoneDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    marginVertical: 10,
    opacity: 0.35,
  },

  modelZoneIconShell: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },

  modelZoneLabel: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 17,
    flexShrink: 1,
    fontFamily: FONT_UI_MEDIUM,
    maxWidth: 90,
  },

  modelZoneChevron: {
    marginLeft: -2,
    opacity: 0.7,
  },

  inputToolbarSpacer: { flex: 1 },

  autoToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 10,
    paddingRight: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#2d2d2d",
    borderWidth: 1,
    borderColor: "#3c3c3c",
  },

  autoToggleActive: {
    backgroundColor: "#2d2d2d",
    borderColor: "#3c3c3c",
    shadowColor: "#10A37F",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },

  autoToggleAura: {
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#252526",
    borderWidth: 1.5,
    borderColor: "#3c3c3c",
  },

  autoToggleText: {
    color: "#9da5b4",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  autoToggleTextActive: { color: "#10A37F" },

  autoToggleKnob: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#9da5b4",
  },

  autoToggleKnobActive: { backgroundColor: "#10A37F" },

  inputMain: {
    flex: 1,
    minHeight: 52,
    maxHeight: 120,
    paddingTop: Platform.OS === "ios" ? 15 : 14,
    paddingBottom: Platform.OS === "ios" ? 15 : 14,
    paddingHorizontal: 8,
    margin: 0,
    color: "#1A1A1F",
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "center",
    fontFamily: FONT_UI_REGULAR,
    includeFontPadding: false,
  },

  actionBtnStop: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2d2d2d",
  },

  actionBtnSend: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2,
  },

  actionBtnDisabled: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E8E8ED",
    borderWidth: 0,
    borderColor: "transparent",
    marginLeft: 2,
  },

  accessPill: { flexDirection: "row", alignItems: "center", gap: 6 },

  accessPillText: { color: "#d46b25", fontSize: 15, fontWeight: "700" },

  modelMiniPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#2d2d2d",
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 170,
  },

  modelMiniText: {
    color: "#d4d4d4",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
    flexShrink: 1,
    fontFamily: FONT_UI_MEDIUM,
  },

  actionBtnStopTxt: { color: "#9da5b4", fontSize: 12, fontWeight: "700" },

  actionBtnSendTxt: { color: "#252526", fontSize: 18, fontWeight: "700" },

  actionBtnGhost: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2d2d2d",
    borderWidth: 1,
    borderColor: "#3c3c3c",
  },

  actionBtnGhostTxt: {
    color: "#d4d4d4",
    fontSize: 22,
    lineHeight: 22,
    fontWeight: "500",
  },

  slashPopover: {
    marginTop: 8,
    backgroundColor: "#252526",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2d2d2d",
    overflow: "hidden",
    maxHeight: 320,
    shadowColor: "#c8d2df",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },

  slashItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },

  slashItemActive: { backgroundColor: "#222325" },

  slashItemMain: { flex: 1, minWidth: 0, gap: 2 },

  slashItemTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  slashTrigger: { color: "#d4d4d4", fontSize: 15, fontWeight: "600" },

  slashTitle: { color: "#9da5b4", fontSize: 13 },

  slashDesc: { color: "#9da5b4", fontSize: 12 },

  slashSource: { color: "#9da5b4", fontSize: 11, textTransform: "uppercase" },

  attachmentScroller: {
    maxHeight: 70,
    marginLeft: -2,
    marginRight: -2,
    marginBottom: 1,
  },

  attachmentRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 2,
    paddingTop: 2,
    paddingBottom: 4,
  },

  attachmentTile: {
    width: 62,
    height: 62,
    borderRadius: 12,
    backgroundColor: "#1e1e1e",
    borderWidth: 1,
    borderColor: "#d7dee8",
    overflow: "hidden",
    shadowColor: "#d4d4d4",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },

  attachmentThumb: { width: "100%", height: "100%", borderRadius: 11 },

  attachmentStateOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: "rgba(0,0,0,0.58)",
  },

  attachmentStateFailed: { backgroundColor: "rgba(185,28,28,0.68)" },

  /** 发送失败收回：轻遮罩 + 待重发，避免像处理失败那样刺眼 */
  attachmentStateRetry: { backgroundColor: "rgba(37,37,38,0.52)" },

  attachmentStateText: { color: "#252526", fontSize: 10, fontWeight: "700" },

  attachmentStateRetryText: { color: "rgba(255,255,255,0.92)", fontSize: 10, fontWeight: "700" },

  attachmentChip: {},

  attachmentName: { display: "none" },

  attachmentRemove: {
    position: "absolute",
    right: 3,
    top: 3,
    width: 18,
    height: 18,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 0,
  },

  attachmentRemoveTxt: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    lineHeight: 14,
    fontWeight: "500",
    includeFontPadding: false,
  },

  imagePickBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1e1e1e",
    borderWidth: 1,
    borderColor: "#3c3c3c",
  },

  imagePickBtnTxt: {
    color: "#d4d4d4",
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 20,
  },

  attachmentPanel: {
    paddingTop: 12,
    gap: 10,
  },

  recentHeaderRow: { flexDirection: "row", alignItems: "center" },

  recentHeaderTitle: { color: "#9da5b4", fontSize: 13, fontWeight: "500" },

  recentScroller: { maxHeight: 300 },

  recentScrollerContent: { paddingTop: 4, paddingBottom: 0 },

  recentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    alignContent: "flex-start",
    paddingBottom: 10,
  },

  recentThumbCard: {
    width: "23.5%",
    aspectRatio: 1,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#1e1e1e",
  },

  recentLoadingState: {
    width: "100%",
    minHeight: 74,
    borderRadius: 14,
    backgroundColor: "#1e1e1e",
    borderWidth: 1,
    borderColor: "#2d2d2d",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  recentLoadingText: { color: "#9da5b4", fontSize: 12, fontWeight: "500" },

  recentThumbImage: { width: "100%", height: "100%" },

  recentLoadingMore: {
    width: "100%",
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },

  recentLoadHint: {
    width: "100%",
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },

  recentLoadHintText: { color: "#9da5b4", fontSize: 11, fontWeight: "600" },

  recentEmptyState: {
    width: "100%",
    minHeight: 80,
    borderRadius: 12,
    backgroundColor: "#1e1e1e",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },

  recentEmptyText: { color: "#9da5b4", fontSize: 12 },

  quickPanelGrid: {
    gap: 12,
  },

  quickPanelCard: {
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 15,
    paddingHorizontal: 15,
    gap: 12,
    shadowColor: "#d4d4d4",
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },

  quickRefWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  quickRefChip: {
    minWidth: "47%",
    flexGrow: 1,
    flexBasis: "47%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#3c3c3c",
    backgroundColor: "#252526",
    paddingVertical: 11,
    paddingHorizontal: 12,
    gap: 5,
  },

  quickRefChipTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  quickRefChipTitle: {
    flex: 1,
    color: "#d4d4d4",
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    fontFamily: FONT_UI_MEDIUM,
  },

  quickRefChipSub: {
    color: "#9da5b4",
    fontSize: 11,
    lineHeight: 15,
    fontFamily: FONT_TEXT_SERIF,
  },

  quickPanelHint: {
    alignSelf: "flex-start",
    color: "#9da5b4",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    fontFamily: FONT_UI_MEDIUM,
    backgroundColor: "#2d2d2d",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  composerPickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    justifyContent: "flex-end",
  },

  composerPickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(36,33,29,0.28)",
  },

  composerPickerSheet: {
    backgroundColor: "#1e1e1e",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 34,
    maxHeight: "80%",
    shadowColor: "#d4d4d4",
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 10,
  },

  composerPickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },

  composerPickerTitle: {
    color: "#d4d4d4",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY_SERIF,
  },

  composerPickerCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: "#2d2d2d",
    alignItems: "center",
    justifyContent: "center",
  },

  composerPickerSegment: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 999,
    backgroundColor: "#1e1e1e",
    gap: 6,
    marginBottom: 16,
  },

  composerPickerChip: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },

  composerPickerChipActive: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#252526",
    shadowColor: "#d4d4d4",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  composerPickerChipText: { color: "#9da5b4", fontSize: 14, fontWeight: "700" },

  composerPickerChipTextActive: { color: "#182131" },

  composerPickerList: { maxHeight: 400 },

  composerPickerItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,253,247,0.62)",
    borderWidth: 1,
    borderColor: "#3c3c3c",
    marginBottom: 8,
  },

  composerPickerItemActive: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#2d2d2d",
    borderWidth: 1,
    borderColor: "rgba(65,54,38,0.16)",
    marginBottom: 8,
  },

  composerPickerItemMain: { flex: 1, gap: 4 },

  composerPickerItemTitle: {
    color: "#d4d4d4",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  composerPickerItemTitleActive: {
    color: "#d4d4d4",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  composerPickerItemSub: {
    color: "#9da5b4",
    fontSize: 12,
    lineHeight: 16,
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  composerPickerCheck: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: "#2d2d2d",
    alignItems: "center",
    justifyContent: "center",
  },

  composerPickerSection: { marginBottom: 8 },

  composerPickerSectionTitle: {
    color: "#9da5b4",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 8,
    marginLeft: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  composerPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255,253,247,0.34)",
    marginBottom: 6,
  },

  composerPickerRowActive: { backgroundColor: "#2d2d2d" },

  composerPickerRowText: {
    color: "#9da5b4",
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "600",
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  composerPickerRowTextActive: { color: "#d4d4d4", fontWeight: "800" },

  composerPickerDivider: {
    height: 1,
    backgroundColor: "#3c3c3c",
    marginVertical: 8,
  },

  composerPickerSwitch: {
    width: 48,
    height: 28,
    borderRadius: 999,
    backgroundColor: "#2d2d2d",
    padding: 3,
    justifyContent: "center",
  },

  composerPickerSwitchActive: { backgroundColor: "#3c3c3c" },

  composerPickerSwitchThumb: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: "#252526",
    shadowColor: "#d4d4d4",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },

  composerPickerSwitchThumbActive: { alignSelf: "flex-end" },
} satisfies MobileNamedStyles;
