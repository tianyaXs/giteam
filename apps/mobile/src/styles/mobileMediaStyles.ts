import { StyleSheet } from "react-native";
import type { MobileNamedStyles } from "./mobileStyleTypes";

export const mediaStyles = {
  qrAlbumOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: "#1f1f1f",
  },

  albumOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    justifyContent: "flex-end",
  },

  albumBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.36)",
  },

  albumSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 86,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#252526",
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 18,
    overflow: "hidden",
  },

  qrAlbumSheet: {
    flex: 1,
    backgroundColor: "#1f1f1f",
    paddingTop: 22,
    paddingHorizontal: 0,
    paddingBottom: 0,
  },

  albumHeaderRow: {
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  albumHeaderBtn: {
    minWidth: 62,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },

  albumHeaderBtnDisabled: { opacity: 0.45 },

  albumHeaderBtnText: { color: "#d4d4d4", fontSize: 15, fontWeight: "700" },

  albumHeaderBtnTextDisabled: { color: "#9da5b4" },

  albumTitle: { color: "#d4d4d4", fontSize: 17, fontWeight: "800" },

  qrAlbumCloseBtn: {
    width: 60,
    height: 56,
    marginLeft: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  qrAlbumTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    height: 48,
    borderRadius: 999,
    backgroundColor: "#d4d4d4",
  },

  qrAlbumTitle: {
    color: "#252526",
    fontSize: 16,
    fontWeight: "800",
  },

  qrAlbumConfirmBtn: {
    minWidth: 92,
    height: 56,
    marginRight: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "#d4d4d4",
  },

  qrAlbumConfirmText: {
    color: "#252526",
    fontSize: 16,
    fontWeight: "700",
  },

  albumPickerBar: { maxHeight: 42, marginHorizontal: -2, marginBottom: 4 },

  albumPickerBarContent: { gap: 8, paddingHorizontal: 2, paddingVertical: 4 },

  qrAlbumPickerBar: {
    maxHeight: 0,
    marginBottom: 0,
  },

  qrAlbumPickerBarContent: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },

  albumPickerChip: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3c3c3c",
    backgroundColor: "#1e1e1e",
    alignItems: "center",
    justifyContent: "center",
  },

  albumPickerChipActive: { backgroundColor: "#d4d4d4", borderColor: "#d4d4d4" },

  albumPickerChipText: {
    maxWidth: 160,
    color: "#9da5b4",
    fontSize: 13,
    fontWeight: "700",
  },

  albumPickerChipTextActive: { color: "#252526" },

  qrAlbumPickerChip: {
    display: "none",
  },

  qrAlbumPickerChipActive: {
    display: "none",
  },

  qrAlbumPickerChipText: {
    display: "none",
  },

  qrAlbumPickerChipTextActive: {
    display: "none",
  },

  albumLoadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },

  albumLoadingText: { color: "#9da5b4", fontSize: 13 },

  albumGrid: { paddingTop: 8, paddingBottom: 18 },

  qrAlbumGrid: {
    paddingTop: 18,
    paddingBottom: 24,
  },

  albumLoadingMore: {
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },

  albumThumbCell: { flex: 1, padding: 3 },

  qrAlbumThumbCell: { flex: 1, padding: 1 },

  albumThumbCard: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#222325",
  },

  qrAlbumThumbCard: {
    width: "100%",
    aspectRatio: 1,
    overflow: "hidden",
    backgroundColor: "#2c2c2c",
  },

  albumThumbImage: { width: "100%", height: "100%" },

  albumSelectBadge: {
    position: "absolute",
    right: 6,
    top: 6,
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.55)",
  },

  albumSelectBadgeOn: {
    backgroundColor: "#10A37F",
    borderWidth: 0,
    borderColor: "transparent",
  },

  qrAlbumSelectBadge: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.5)",
  },

  qrAlbumSelectBadgeOn: {
    backgroundColor: "#10A37F",
    borderWidth: 0,
    borderColor: "transparent",
  },

  albumSelectText: { color: "transparent", fontSize: 12, fontWeight: "700" },

  albumSelectTextOn: { color: "#FFFFFF" },

  albumEmptyText: {
    width: "100%",
    paddingVertical: 40,
    textAlign: "center",
    color: "#9da5b4",
    fontSize: 14,
  },

  imagePreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
    zIndex: 10000,
    elevation: 10000,
  },

  imagePreviewBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.92)",
  },

  imagePreviewSafe: {
    flex: 1,
  },

  imagePreviewToolbar: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 8,
  },

  imagePreviewCloseHit: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
  },

  imagePreviewCloseTxt: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontWeight: "600",
  },

  imagePreviewStage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },

  imagePreviewImage: {
    width: "100%",
    height: "100%",
    backgroundColor: "transparent",
  },

  imagePreviewCard: {
    width: "92%",
    maxHeight: "86%",
    borderRadius: 18,
    backgroundColor: "#252526",
    padding: 12,
    gap: 10,
  },

  imagePreviewButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#1e1e1e",
  },

  imagePreviewButtonText: { color: "#d4d4d4", fontSize: 13, fontWeight: "600" },

  photoCameraScreen: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "#d4d4d4",
  },

  photoCameraOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -80,
    bottom: 0,
    zIndex: 9998,
    elevation: 9998,
    backgroundColor: "#d4d4d4",
  },

  photoCameraView: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },

  photoCameraControls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 128,
    paddingBottom: 28,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.32)",
  },

  photoCameraTextButton: {
    width: 76,
    alignItems: "center",
    justifyContent: "center",
  },

  photoCameraText: { color: "#252526", fontSize: 16, fontWeight: "600" },

  photoCameraShutter: {
    width: 72,
    height: 72,
    borderRadius: 999,
    borderWidth: 4,
    borderColor: "#252526",
    alignItems: "center",
    justifyContent: "center",
  },

  photoCameraShutterDisabled: { opacity: 0.45 },

  photoCameraShutterInner: {
    width: 54,
    height: 54,
    borderRadius: 999,
    backgroundColor: "#252526",
  },

  cameraBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
  },

  cameraBtnTxt: { fontSize: 16 },
} satisfies MobileNamedStyles;
