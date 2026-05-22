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

  todoSwipeShell: {
    borderRadius: 22,
    overflow: "hidden",
  },

  todoSwipeHint: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingLeft: 18,
    backgroundColor: "#eef5ee",
  },

  todoSwipeHintText: {
    color: "#3a8f82",
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
    borderColor: "rgba(65,54,38,0.10)",
    backgroundColor: "#fffdf7",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    shadowColor: "#503c1e",
    shadowOpacity: 0.08,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },

  todoDock: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(65,54,38,0.10)",
    backgroundColor: "#fffdf7",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    shadowColor: "#503c1e",
    shadowOpacity: 0.07,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2,
  },

  inputDock: {
    marginHorizontal: 12,
    marginBottom: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(65,54,38,0.10)",
    backgroundColor: "#fffdf7",
    minHeight: 92,
    paddingLeft: 14,
    paddingRight: 12,
    paddingTop: 12,
    paddingBottom: 10,
    flexDirection: "column",
    alignItems: "stretch",
    gap: 10,
    shadowColor: "#503c1e",
    shadowOpacity: 0.07,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
    zIndex: 3,
  },

  attachmentBackdrop: {
    ...StyleSheet.absoluteFillObject,
    top: 58,
    bottom: 86,
    backgroundColor: "rgba(248,245,238,0.62)",
    zIndex: 2,
  },

  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },

  inputToolbar: { flexDirection: "row", alignItems: "center", gap: 10 },

  inputToolbarSpacer: { flex: 1 },

  autoToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 10,
    paddingRight: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#f1eadf",
    borderWidth: 1,
    borderColor: "#ded6ca",
  },

  autoToggleActive: {
    backgroundColor: "#e7f2ee",
    borderColor: "#c8ded7",
    shadowColor: "#3a8f82",
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
    backgroundColor: "#fffdf7",
    borderWidth: 1.5,
    borderColor: "#d8cec0",
  },

  autoToggleText: {
    color: "#7c766c",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  autoToggleTextActive: { color: "#2f7f74" },

  autoToggleKnob: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#a69d8e",
  },

  autoToggleKnobActive: { backgroundColor: "#3a8f82" },

  inputMain: {
    minHeight: 30,
    maxHeight: 96,
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 8,
    color: "#24211d",
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "top",
    fontFamily: FONT_UI_REGULAR,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },

  actionBtnStop: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ece8df",
  },

  actionBtnSend: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#24211d",
  },

  actionBtnDisabled: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
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
    backgroundColor: "#f1eadf",
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 170,
  },

  modelMiniText: {
    color: "#3a352e",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
    flexShrink: 1,
    fontFamily: FONT_UI_MEDIUM,
  },

  actionBtnStopTxt: { color: "#7c766c", fontSize: 12, fontWeight: "700" },

  actionBtnSendTxt: { color: "#fff", fontSize: 18, fontWeight: "700" },

  actionBtnGhost: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f4efe6",
    borderWidth: 1,
    borderColor: "#ddd4c5",
  },

  actionBtnGhostTxt: {
    color: "#24211d",
    fontSize: 22,
    lineHeight: 22,
    fontWeight: "500",
  },

  slashPopover: {
    marginTop: 8,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e7edf5",
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

  slashItemActive: { backgroundColor: "#f2f6fb" },

  slashItemMain: { flex: 1, minWidth: 0, gap: 2 },

  slashItemTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  slashTrigger: { color: "#1f2937", fontSize: 15, fontWeight: "600" },

  slashTitle: { color: "#475569", fontSize: 13 },

  slashDesc: { color: "#94a3b8", fontSize: 12 },

  slashSource: { color: "#94a3b8", fontSize: 11, textTransform: "uppercase" },

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
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#d7dee8",
    overflow: "hidden",
    shadowColor: "#334155",
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
    backgroundColor: "rgba(15,23,42,0.58)",
  },

  attachmentStateFailed: { backgroundColor: "rgba(185,28,28,0.68)" },

  attachmentStateText: { color: "#ffffff", fontSize: 10, fontWeight: "700" },

  attachmentChip: {},

  attachmentName: { display: "none" },

  attachmentRemove: {
    position: "absolute",
    right: 4,
    top: 4,
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,23,42,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.7)",
  },

  attachmentRemoveTxt: {
    color: "#ffffff",
    fontSize: 14,
    lineHeight: 14,
    fontWeight: "700",
  },

  imagePickBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },

  imagePickBtnTxt: {
    color: "#334155",
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 20,
  },

  attachmentPanel: {
    paddingTop: 12,
    gap: 12,
  },

  attachmentMenuRow: { flexDirection: "row", gap: 8 },

  attachmentMenuCard: {
    flex: 1,
    minHeight: 88,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e7edf5",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  attachmentMenuIcon: { fontSize: 24 },

  attachmentMenuIconShell: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e7edf5",
  },

  attachmentMenuLabel: { color: "#334155", fontSize: 14, fontWeight: "500" },

  recentHeaderRow: { flexDirection: "row", alignItems: "center" },

  recentHeaderTitle: { color: "#64748b", fontSize: 13, fontWeight: "500" },

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
    backgroundColor: "#f1f5f9",
  },

  recentLoadingState: {
    width: "100%",
    minHeight: 74,
    borderRadius: 14,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#edf2f7",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  recentLoadingText: { color: "#64748b", fontSize: 12, fontWeight: "500" },

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

  recentLoadHintText: { color: "#94a3b8", fontSize: 11, fontWeight: "600" },

  recentEmptyState: {
    width: "100%",
    minHeight: 80,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },

  recentEmptyText: { color: "#94a3b8", fontSize: 12 },

  quickPanelGrid: {
    gap: 12,
  },

  quickPanelCard: {
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 15,
    paddingHorizontal: 15,
    gap: 12,
    shadowColor: "#503c1e",
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
    borderColor: "rgba(65,54,38,0.10)",
    backgroundColor: "#fffdf7",
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
    color: "#25231d",
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    fontFamily: FONT_UI_MEDIUM,
  },

  quickRefChipSub: {
    color: "#7c766c",
    fontSize: 11,
    lineHeight: 15,
    fontFamily: FONT_TEXT_SERIF,
  },

  quickPanelHint: {
    alignSelf: "flex-start",
    color: "#6f6657",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    fontFamily: FONT_UI_MEDIUM,
    backgroundColor: "#f4efe6",
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
    backgroundColor: "#f7f3ea",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 34,
    maxHeight: "80%",
    shadowColor: "#503c1e",
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
    color: "#24211d",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    fontFamily: FONT_DISPLAY_SERIF,
  },

  composerPickerCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: "#ece8df",
    alignItems: "center",
    justifyContent: "center",
  },

  composerPickerSegment: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 999,
    backgroundColor: "#f3f5f8",
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
    backgroundColor: "#ffffff",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  composerPickerChipText: { color: "#7c8798", fontSize: 14, fontWeight: "700" },

  composerPickerChipTextActive: { color: "#182131" },

  composerPickerList: { maxHeight: 400 },

  composerPickerItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,253,247,0.62)",
    borderWidth: 1,
    borderColor: "rgba(65,54,38,0.08)",
    marginBottom: 8,
  },

  composerPickerItemActive: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#f0e9dc",
    borderWidth: 1,
    borderColor: "rgba(65,54,38,0.16)",
    marginBottom: 8,
  },

  composerPickerItemMain: { flex: 1, gap: 4 },

  composerPickerItemTitle: {
    color: "#24211d",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  composerPickerItemTitleActive: {
    color: "#24211d",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  composerPickerItemSub: {
    color: "#7c766c",
    fontSize: 12,
    lineHeight: 16,
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  composerPickerCheck: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: "#ece8df",
    alignItems: "center",
    justifyContent: "center",
  },

  composerPickerSection: { marginBottom: 8 },

  composerPickerSectionTitle: {
    color: "#9a9182",
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

  composerPickerRowActive: { backgroundColor: "#f0e9dc" },

  composerPickerRowText: {
    color: "#5d5345",
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "600",
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  composerPickerRowTextActive: { color: "#24211d", fontWeight: "800" },

  composerPickerDivider: {
    height: 1,
    backgroundColor: "rgba(65,54,38,0.10)",
    marginVertical: 8,
  },

  composerPickerSwitch: {
    width: 48,
    height: 28,
    borderRadius: 999,
    backgroundColor: "#ece8df",
    padding: 3,
    justifyContent: "center",
  },

  composerPickerSwitchActive: { backgroundColor: "#d8cec0" },

  composerPickerSwitchThumb: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: "#fffdf7",
    shadowColor: "#503c1e",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },

  composerPickerSwitchThumbActive: { alignSelf: "flex-end" },
} satisfies MobileNamedStyles;
