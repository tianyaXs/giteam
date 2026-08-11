import { StyleSheet } from "react-native";
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
    backgroundColor: "#252526",
    borderWidth: 1,
    borderColor: "rgba(60,60,60,0.6)",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
    shadowColor: "#d4d4d4",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },

  pairPromptTitle: { color: "#d4d4d4", fontSize: 14, fontWeight: "800" },

  pairPromptSub: { color: "#9da5b4", fontSize: 12 },

  pairPromptInput: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d4ddea",
    backgroundColor: "#252526",
    paddingHorizontal: 12,
    color: "#d4d4d4",
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
    backgroundColor: "#222325",
  },

  pairPromptBtnGhostTxt: { color: "#d4d4d4", fontSize: 13, fontWeight: "700" },

  pairPromptBtnPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#d4d4d4",
  },

  pairPromptBtnPrimaryTxt: {
    color: "#252526",
    fontSize: 13,
    fontWeight: "800",
  },
} satisfies MobileNamedStyles;
