import { Platform } from "react-native";
import {
  FONT_DISPLAY_SERIF,
  FONT_TEXT_SERIF,
  FONT_UI_MEDIUM,
  FONT_UI_REGULAR,
  HANDWRITTEN_TEXT_FONT,
} from "./mobileFonts";
import type { MobileNamedStyles } from "./mobileStyleTypes";

export const drawerStyles = {
  drawerPanelLeft: {
    flex: 1,
    backgroundColor: "#f7f3ea",
    paddingTop: 38,
    paddingHorizontal: 18,
    paddingBottom: 22,
  },

  drawerPanelRight: {
    flex: 1,
    backgroundColor: "#f7f3ea",
    paddingTop: 38,
    paddingHorizontal: 18,
    paddingBottom: 22,
  },

  leftHandText: { fontFamily: FONT_UI_REGULAR },

  rightHandText: { fontFamily: FONT_UI_REGULAR },

  drawerHead: { gap: 8, marginBottom: 18, paddingHorizontal: 14 },

  drawerHeadTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },

  notebookPageTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  notebookHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginLeft: "auto",
  },

  themeTextBtn: {
    marginLeft: "auto",
    paddingHorizontal: 2,
    paddingVertical: 6,
  },

  notebookGhostBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(38,35,29,0.16)",
    backgroundColor: "rgba(255,250,242,0.64)",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },

  notebookGhostBtnText: {
    color: "#4b4337",
    fontSize: 12,
    lineHeight: 15,
    fontFamily: FONT_UI_MEDIUM,
  },

  themeSwitchBtn: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },

  themeSwitchText: { fontSize: 11, fontWeight: "800", lineHeight: 14 },

  drawerEyebrow: {
    color: "#958b78",
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontFamily: FONT_UI_MEDIUM,
  },

  drawerHeaderMetaText: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
    fontFamily: FONT_TEXT_SERIF,
  },

  drawerSectionLabel: {
    color: "#8b806d",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 9,
    marginTop: 8,
  },

  drawerAgentSegment: {
    flexDirection: "row",
    alignItems: "center",
    padding: 4,
    borderRadius: 999,
    backgroundColor: "#f3f5f8",
    gap: 6,
    alignSelf: "stretch",
  },

  drawerAgentChip: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },

  drawerAgentChipActive: {
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

  drawerAgentChipText: { color: "#7c8798", fontSize: 14, fontWeight: "700" },

  drawerAgentChipTextActive: { color: "#182131" },

  drawerLogoutBtn: {
    width: 32,
    height: 32,
    marginTop: -6,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  drawerLogoutImage: { width: 16, height: 16 },

  drawerConnectionCard: {
    gap: 12,
  },

  drawerConnectionMeta: {
    gap: 8,
  },

  drawerConnectionRow: {
    gap: 4,
  },

  drawerConnectionLabel: {
    color: "#9a9182",
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontFamily: FONT_UI_MEDIUM,
  },

  drawerConnectionValue: {
    color: "#3b332b",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: FONT_TEXT_SERIF,
  },

  drawerLogoutAction: {
    height: 40,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  drawerLogoutActionText: {
    color: "#fffdf7",
    fontSize: 13,
    fontWeight: "800",
    fontFamily: FONT_UI_MEDIUM,
  },

  drawerMetaRow: { flexDirection: "row", alignItems: "center", gap: 10 },

  drawerMetaChip: {
    borderRadius: 999,
    backgroundColor: "#f3f7fd",
    borderWidth: 1,
    borderColor: "#d5e1f0",
    color: "#5a6b82",
    fontSize: 12,
    lineHeight: 15,
    paddingHorizontal: 11,
    paddingVertical: 5,
    overflow: "hidden",
  },

  drawerModelStatus: {
    color: "#6a788d",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 2,
  },

  drawerModelRowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  drawerModelCheckBadge: {
    borderRadius: 999,
    backgroundColor: "#d9e9ff",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  drawerModelCheckText: { color: "#24538a", fontSize: 11, fontWeight: "800" },

  drawerModelListItem: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e4ebf3",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 9,
    shadowColor: "#0f172a",
    shadowOpacity: 0.035,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },

  drawerModelListItemActive: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#bfd6f5",
    backgroundColor: "#eef5ff",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 9,
    shadowColor: "#7ba7df",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },

  drawerModelListTitle: { color: "#27384e", fontSize: 15, fontWeight: "700" },

  drawerModelListTitleActive: {
    color: "#1d4d86",
    fontSize: 15,
    fontWeight: "800",
  },

  drawerModelListSub: { color: "#74839a", fontSize: 12, lineHeight: 18 },

  drawerModelListSubActive: { color: "#4a6891", fontSize: 12, lineHeight: 18 },

  drawerProviderPill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "#f4f7fb",
  },

  drawerProviderPillActive: { backgroundColor: "#dfeafc" },

  drawerProviderPillText: { color: "#6d7b90", fontSize: 11, fontWeight: "700" },

  drawerProviderPillTextActive: { color: "#315b90" },

  drawerTitle: {
    color: "#26231d",
    fontWeight: "800",
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -1.2,
    fontFamily: FONT_DISPLAY_SERIF,
  },

  drawerNewBtn: {
    borderRadius: 999,
    backgroundColor: "#26231d",
    borderWidth: 1,
    borderColor: "#26231d",
    paddingVertical: 7,
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 12,
  },

  drawerNewTxt: {
    color: "#fbfaf6",
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONT_UI_MEDIUM,
    includeFontPadding: false,
  },

  drawerScroll: { flex: 1 },

  drawerList: { paddingBottom: 28, paddingTop: 2 },

  leftActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },

  leftRoundAction: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fffdf7",
    borderWidth: 1,
    borderColor: "rgba(65,54,38,0.08)",
    shadowColor: "#503c1e",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },

  leftRoundActionSoft: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#24211d",
    shadowColor: "#503c1e",
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },

  leftStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
  },

  leftStatusDotOn: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#22c78a",
  },

  leftStatusDotOff: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#c9b99f",
  },

  leftStatusText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    marginTop: 0,
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  leftSectionBlock: { marginTop: 0, marginBottom: 16, paddingHorizontal: 14 },

  leftSectionLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    marginBottom: 10,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  leftProjectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },

  leftProjectMain: {
    flex: 1,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  leftProjectIconBox: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f0c15b",
    borderWidth: 1,
    borderColor: "rgba(65,54,38,0.12)",
  },

  leftProjectTextBlock: { flex: 1, justifyContent: "center", gap: 2 },

  leftProjectTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
  },

  leftProjectCompose: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,253,247,0.42)",
    borderWidth: 1,
    borderColor: "rgba(65,54,38,0.08)",
  },

  leftProjectChevron: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  directoryPaper: {
    borderRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 17,
    paddingBottom: 20,
    shadowColor: "#4c4438",
    shadowOpacity: 0.04,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },

  directoryPaperTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 14,
    gap: 14,
  },

  directoryPaperHeading: { flex: 1, gap: 3 },

  directoryPaperLabel: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    letterSpacing: 0.2,
  },

  directoryPaperMeta: { fontSize: 11, lineHeight: 15, fontWeight: "600" },

  directorySectionCaption: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    marginBottom: 8,
    letterSpacing: 0.3,
  },

  workspaceSwitcherRow: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },

  workspaceSwitcherCopy: { flex: 1, gap: 2 },

  workspaceSwitcherTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "700",
    letterSpacing: -0.05,
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  workspaceSwitcherSub: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "500",
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  workspaceSwitcherChevron: { fontSize: 18, lineHeight: 18, fontWeight: "600" },

  workspaceSwitcherSheet: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 6,
    marginBottom: 12,
  },

  workspaceSwitcherItem: {
    minHeight: 38,
    borderRadius: 12,
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  workspaceSwitcherItemTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "600",
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  workspaceSwitcherSheetInline: {
    borderWidth: 1,
    borderRadius: 14,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },

  workspaceSwitcherInlineItem: { minHeight: 32, justifyContent: "center" },

  directoryGroup: { marginBottom: 18 },

  directoryGroupPlain: { gap: 4 },

  directoryWorkspaceRow: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 2,
    paddingBottom: 4,
  },

  directoryWorkspaceTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    letterSpacing: -0.15,
  },

  directoryActiveDot: { width: 5, height: 5, borderRadius: 999, marginTop: 1 },

  directorySessionRow: {
    minHeight: 34,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 2,
    paddingVertical: 5,
  },

  directorySessionActive: {
    minHeight: 36,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(38,35,29,0.06)",
  },

  directorySessionActiveSlate: {
    shadowColor: "#9aa5b1",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },

  directoryBullet: { width: 6, height: 6, borderRadius: 999, opacity: 0.72 },

  directoryBulletSpacer: { width: 6, height: 6 },

  directorySessionTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "600",
    letterSpacing: -0.03,
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  drawerSessionSearchMinimal: {
    flex: 1,
    height: 38,
    paddingHorizontal: 0,
    fontSize: 14,
    fontFamily: HANDWRITTEN_TEXT_FONT,
    color: "#24211d",
    borderBottomWidth: 0,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },

  leftSearchShell: {
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(65,54,38,0.08)",
    backgroundColor: "#f8f4ec",
    paddingHorizontal: 12,
    marginHorizontal: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  directorySessionPlainRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 0,
    minHeight: 62,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "transparent",
    borderBottomWidth: 1,
    borderColor: "rgba(65,54,38,0.06)",
    position: "relative",
  },

  directorySessionPlainRowActive: {
    backgroundColor: "rgba(255,253,247,0.58)",
    borderRadius: 14,
    borderBottomWidth: 1,
    borderColor: "rgba(65,54,38,0.10)",
    paddingHorizontal: 14,
  },

  leftSessionRail: {
    position: "absolute",
    left: 0,
    top: 12,
    width: 3,
    height: 36,
    borderRadius: 999,
    backgroundColor: "transparent",
  },

  leftSessionRailActive: {
    position: "absolute",
    left: 0,
    top: 12,
    width: 3,
    height: 36,
    borderRadius: 999,
    backgroundColor: "#24211d",
  },

  directorySessionPlainBody: { flex: 1, gap: 4 },

  directorySessionPlainHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  directorySessionPlainTitle: {
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "600",
    letterSpacing: -0.05,
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  directorySessionPlainTitleActive: {
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    letterSpacing: -0.06,
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  directorySessionPlainTime: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "600",
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  directorySessionPlainMeta: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "500",
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  workspaceSectionCard: {
    borderRadius: 2,
    borderLeftWidth: 3,
    borderColor: "#26231d",
    backgroundColor: "rgba(255,252,245,0.72)",
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 12,
    gap: 12,
    marginBottom: 18,
  },

  workspaceCurrentRow: { flexDirection: "row", alignItems: "center", gap: 12 },

  workspaceCurrentBadge: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: "#26231d",
    alignItems: "center",
    justifyContent: "center",
  },

  workspaceCurrentBadgeText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
  },

  workspaceCurrentCopy: { flex: 1, gap: 2 },

  workspaceCurrentTitle: { color: "#26231d", fontSize: 16, fontWeight: "800" },

  workspaceCurrentPath: { color: "#8d826f", fontSize: 11 },

  workspaceMiniList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  workspaceMiniItem: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ded2be",
    backgroundColor: "#fffaf0",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },

  workspaceMiniItemActive: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#26231d",
    backgroundColor: "#26231d",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },

  workspaceMiniItemText: { color: "#5f5749", fontSize: 12, fontWeight: "700" },

  workspaceMiniItemTextActive: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },

  drawerItemGap: { marginBottom: 8 },

  drawerMoreBtn: {
    alignItems: "center",
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,253,247,0.50)",
    borderWidth: 1,
    borderColor: "rgba(65,54,38,0.08)",
  },

  drawerMoreTxt: {
    color: "#7c766c",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  drawerSessionSearch: {
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ddd2c0",
    backgroundColor: "#fffaf2",
    paddingHorizontal: 13,
    marginBottom: 12,
    color: "#26231d",
    fontSize: 13,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },

  drawerItem: {
    borderRadius: 0,
    backgroundColor: "transparent",
    borderBottomWidth: 1,
    borderColor: "rgba(38,35,29,0.12)",
    paddingHorizontal: 2,
    paddingVertical: 14,
    gap: 6,
    minHeight: 68,
  },

  drawerItemActive: {
    borderRadius: 14,
    backgroundColor: "#fffaf2",
    borderWidth: 1,
    borderColor: "#d6c7ad",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
    minHeight: 72,
  },

  drawerItemHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  drawerItemTitle: { color: "#26231d", fontWeight: "800", fontSize: 15 },

  drawerItemTime: { color: "#9a907f", fontSize: 11 },

  drawerItemPreview: { color: "#6f6657", fontSize: 12, lineHeight: 18 },

  drawerEmpty: { color: "#7d8897", marginTop: 14, fontSize: 12 },

  extensionSectionCard: {
    borderRadius: 18,
    backgroundColor: "rgba(255,253,247,0.72)",
    borderWidth: 1,
    borderColor: "rgba(65,54,38,0.10)",
    marginBottom: 14,
    padding: 15,
    gap: 13,
  },

  extensionSectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    justifyContent: "flex-start",
  },

  extensionHeroCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e8edf4",
    marginBottom: 10,
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },

  extensionHeroCardAlt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e8edf4",
    marginBottom: 10,
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },

  extensionHeroOrb: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: "#f0e9dc",
    alignItems: "center",
    justifyContent: "center",
  },

  extensionHeroOrbAlt: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: "#f0e9dc",
    alignItems: "center",
    justifyContent: "center",
  },

  extensionHeroOrbNeutral: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: "#ece6db",
    alignItems: "center",
    justifyContent: "center",
  },

  extensionHeroOrbText: {
    color: "#3b332b",
    fontSize: 16,
    fontWeight: "800",
    fontFamily: FONT_UI_MEDIUM,
  },

  extensionHeroCopy: { flex: 1, gap: 3 },

  extensionHeroTitle: {
    color: "#25231d",
    fontSize: 16,
    fontWeight: "900",
    fontFamily: FONT_UI_MEDIUM,
  },

  extensionHeroSub: {
    color: "#7c766c",
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONT_TEXT_SERIF,
  },

  extensionSectionGap: { height: 16 },

  extensionCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 12,
    borderRadius: 17,
    backgroundColor: "rgba(255,253,247,0.58)",
    borderWidth: 1,
    borderColor: "rgba(65,54,38,0.08)",
    marginBottom: 8,
    shadowColor: "#0f172a",
    shadowOpacity: 0.02,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 0,
  },

  extensionCardIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#f4eadb",
    alignItems: "center",
    justifyContent: "center",
  },

  extensionCardIconMcp: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#f4eadb",
    alignItems: "center",
    justifyContent: "center",
  },

  extensionCardMain: { flex: 1, gap: 2, paddingTop: 1 },

  extensionCardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  extensionCardTitle: {
    color: "#25231d",
    fontSize: 13,
    fontWeight: "800",
    fontFamily: FONT_UI_MEDIUM,
  },

  extensionCardSub: {
    color: "#7c766c",
    fontSize: 11,
    lineHeight: 16,
    fontFamily: FONT_TEXT_SERIF,
  },

  extensionStatePill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "#f0e9dc",
    color: "#5d5345",
    fontSize: 10,
    fontWeight: "700",
    fontFamily: FONT_UI_MEDIUM,
    overflow: "hidden",
  },
} satisfies MobileNamedStyles;
