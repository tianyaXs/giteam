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
    backgroundColor: "#ffffff",
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

  albumHeaderBtnText: { color: "#1f2937", fontSize: 15, fontWeight: "700" },

  albumHeaderBtnTextDisabled: { color: "#94a3b8" },

  albumTitle: { color: "#111827", fontSize: 17, fontWeight: "800" },

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
    backgroundColor: "#3b3b3b",
  },

  qrAlbumTitle: {
    color: "#ffffff",
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
    backgroundColor: "#3b3b3b",
  },

  qrAlbumConfirmText: {
    color: "#ffffff",
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
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },

  albumPickerChipActive: { backgroundColor: "#111827", borderColor: "#111827" },

  albumPickerChipText: {
    maxWidth: 160,
    color: "#64748b",
    fontSize: 13,
    fontWeight: "700",
  },

  albumPickerChipTextActive: { color: "#ffffff" },

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

  albumLoadingText: { color: "#64748b", fontSize: 13 },

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
    backgroundColor: "#eef2f7",
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
    backgroundColor: "rgba(15,23,42,0.34)",
    borderWidth: 1.5,
    borderColor: "#ffffff",
  },

  albumSelectBadgeOn: { backgroundColor: "#1f2937" },

  qrAlbumSelectBadge: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 2,
    borderColor: "#ffffff",
  },

  qrAlbumSelectBadgeOn: {
    backgroundColor: "rgba(255,255,255,0.22)",
  },

  albumSelectText: { color: "#ffffff", fontSize: 12, fontWeight: "800" },

  albumSelectTextOn: { color: "#ffffff" },

  albumEmptyText: {
    width: "100%",
    paddingVertical: 40,
    textAlign: "center",
    color: "#94a3b8",
    fontSize: 14,
  },

  imagePreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
    elevation: 10000,
  },

  imagePreviewBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.72)",
  },

  imagePreviewCard: {
    width: "92%",
    maxHeight: "86%",
    borderRadius: 18,
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 10,
  },

  imagePreviewToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },

  imagePreviewButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#f1f5f9",
  },

  imagePreviewButtonText: { color: "#1f2937", fontSize: 13, fontWeight: "600" },

  imagePreviewImage: {
    width: "100%",
    height: 520,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
  },

  photoCameraScreen: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "#000",
  },

  photoCameraOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -80,
    bottom: 0,
    zIndex: 9998,
    elevation: 9998,
    backgroundColor: "#000",
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

  photoCameraText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },

  photoCameraShutter: {
    width: 72,
    height: 72,
    borderRadius: 999,
    borderWidth: 4,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },

  photoCameraShutterDisabled: { opacity: 0.45 },

  photoCameraShutterInner: {
    width: 54,
    height: 54,
    borderRadius: 999,
    backgroundColor: "#ffffff",
  },

  cameraBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f7f1e6",
    borderWidth: 1,
    borderColor: "#e7dccb",
  },

  cameraBtnTxt: { fontSize: 16 },
} satisfies MobileNamedStyles;
