import { Platform, StyleSheet } from "react-native";
import type { MobileNamedStyles } from "./mobileStyleTypes";

export const pairingStyles = {
  pairPromptMask: { ...StyleSheet.absoluteFillObject, zIndex: 50 },

  pairPromptBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.32)",
  },

  pairPromptCard: {
    position: "absolute",
    left: "7%",
    right: "7%",
    top: "32%",
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },

  pairPromptTitle: { color: "#111827", fontSize: 14, fontWeight: "800" },

  pairPromptSub: { color: "#64748b", fontSize: 12 },

  pairPromptInput: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d4ddea",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    color: "#111827",
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },

  pairPromptActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 2,
  },

  pairPromptBtnGhost: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#eef2f7",
  },

  pairPromptBtnGhostTxt: { color: "#334155", fontSize: 13, fontWeight: "700" },

  pairPromptBtnPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#111827",
  },

  pairPromptBtnPrimaryTxt: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
} satisfies MobileNamedStyles;
