import { Platform, StatusBar, StyleSheet } from "react-native";
import { FONT_DISPLAY_SERIF, HANDWRITTEN_TEXT_FONT } from "./mobileFonts";
import { authStyles } from "./mobileAuthStyles";
import { chatStyles } from "./mobileChatStyles";
import { composerStyles } from "./mobileComposerStyles";
import { discoveryStyles } from "./mobileDiscoveryStyles";
import { drawerStyles } from "./mobileDrawerStyles";
import { mediaStyles } from "./mobileMediaStyles";
import { pairingStyles } from "./mobilePairingStyles";

export const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },

  safe: { flex: 1, backgroundColor: "#f7f8fa" },

  chatSafe: {
    flex: 1,
    backgroundColor: "#f7f8fa",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0,
  },

  launchScreen: {
    flex: 1,
    backgroundColor: "#f6f1e8",
    alignItems: "center",
    justifyContent: "center",
  },

  launchOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: "#f6f1e8",
    alignItems: "center",
    justifyContent: "center",
  },

  launchMarkWrap: {
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: -10 }],
  },

  launchPeopleRow: {
    width: 92,
    height: 46,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 7,
  },

  launchPersonTeal: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 6,
    borderColor: "#22b8ad",
    marginBottom: 2,
  },

  launchPersonCore: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 7,
    borderColor: "#18b7aa",
    marginBottom: 8,
  },

  launchPersonNavy: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 6,
    borderColor: "#07517f",
    marginBottom: 2,
  },

  launchWordmark: {
    marginTop: 10,
    color: "#07517f",
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

  centerText: { color: "#4a5565" },

  title: { color: "#1f2630", fontSize: 28, fontWeight: "700" },

  subtitle: { color: "#6f7c8f", fontSize: 14 },

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
    color: "#f5f7fb",
    fontSize: 15,
    lineHeight: 22,
    fontFamily: HANDWRITTEN_TEXT_FONT,
  },

  bubbleAssistantText: { color: "#2f3948", lineHeight: 20 },

  row: { flexDirection: "row", gap: 8 },

  boundaryWrap: {
    margin: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#efcaca",
    backgroundColor: "#fff7f7",
    gap: 6,
  },

  boundaryTitle: { color: "#8a2f2f", fontWeight: "700" },

  boundaryText: { color: "#6f3b3b", fontSize: 12 },

  btnSoft: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e8edf3",
  },

  btnSoftText: { color: "#39485d", fontWeight: "600" },

  scannerStatusText: { color: "#4d5e76", fontSize: 13, lineHeight: 18 },

  ...authStyles,
  ...chatStyles,
  ...mediaStyles,
  ...composerStyles,
  ...drawerStyles,
  ...discoveryStyles,
  ...pairingStyles,
});
