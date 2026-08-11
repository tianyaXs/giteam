import { StyleSheet } from "react-native";
import { FONT_DISPLAY_SERIF, HANDWRITTEN_TEXT_FONT } from "./mobileFonts";
import { authStyles } from "./mobileAuthStyles";
import { chatStyles } from "./mobileChatStyles";
import { composerStyles } from "./mobileComposerStyles";
import { discoveryStyles } from "./mobileDiscoveryStyles";
import { mediaStyles } from "./mobileMediaStyles";
import { pairingStyles } from "./mobilePairingStyles";

export const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },

  safe: { flex: 1, backgroundColor: "transparent" },

  chatSafe: {
    flex: 1,
    backgroundColor: "transparent",
  },

  launchScreen: {
    flex: 1,
    // 背景交给 GiteamStartupAnimation 跟主题，勿写死深色
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },

  launchOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },

  launchMarkWrap: {
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: -10 }],
  },

  launchWordmark: {
    marginTop: 10,
    color: "#d4d4d4",
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -1.2,
    fontFamily: FONT_DISPLAY_SERIF,
  },

  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },

  centerText: { color: "#9da5b4" },

  title: { color: "#d4d4d4", fontSize: 28, fontWeight: "700" },

  subtitle: { color: "#9da5b4", fontSize: 14 },

  bubbleAssistant: {
    width: "96%",
    maxWidth: "96%",
    alignSelf: "flex-start",
    flexShrink: 1,
    borderRadius: 0,
    paddingVertical: 4,
    paddingHorizontal: 2,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    overflow: "visible",
  },

  bubbleContent: { width: "100%", flexShrink: 1, minWidth: 0 },

  markdownBlock: { width: "100%", flexShrink: 1, minWidth: 0 },

  streamdownTextContainer: { width: "100%", flexShrink: 1, minWidth: 0 },

  bubbleUserText: {
    color: "#1A1A1A",
    fontSize: 15,
    lineHeight: 22,
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  bubbleAssistantText: { color: "#d4d4d4", lineHeight: 20 },

  row: { flexDirection: "row", gap: 8 },

  boundaryWrap: {
    margin: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#4a1d25",
    backgroundColor: "#2d2224",
    gap: 6,
  },

  boundaryTitle: { color: "#cf6679", fontWeight: "700" },

  boundaryText: { color: "#cf6679", fontSize: 12 },

  btnSoft: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2d2d2d",
  },

  btnSoftText: { color: "#d4d4d4", fontWeight: "600" },

  scannerStatusText: { color: "#9da5b4", fontSize: 13, lineHeight: 18 },

  ...authStyles,
  ...chatStyles,
  ...mediaStyles,
  ...composerStyles,
  ...discoveryStyles,
  ...pairingStyles,
});
