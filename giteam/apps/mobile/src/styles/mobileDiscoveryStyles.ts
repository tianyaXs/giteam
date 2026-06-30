import { StyleSheet } from "react-native";
import type { MobileNamedStyles } from "./mobileStyleTypes";

export const discoveryStyles = {
  discoverWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 20,
    justifyContent: "flex-start",
  },

  discoverSafe: { flex: 1, backgroundColor: "#f2f6fb" },

  discoverTitle: {
    color: "#2b394b",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    opacity: 0.9,
  },

  discoverTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 8,
  },

  discoverTitleSideLeft: {
    minWidth: 88,
    flexDirection: "row",
    justifyContent: "flex-start",
  },

  discoverTitleSideRight: { minWidth: 88 },

  discoverBackBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#e7eef8",
    borderWidth: 1,
    borderColor: "#d2deee",
  },

  discoverBackIcon: {
    color: "#1f2a3a",
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 24,
    marginTop: -2,
  },

  discoverListWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 16,
  },

  discoverListMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
    marginBottom: 12,
  },

  discoverListMetaText: { color: "#64748b", fontSize: 12, fontWeight: "600" },

  discoverRescanBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#111827",
  },

  discoverRescanTxt: { color: "#ffffff", fontSize: 12, fontWeight: "700" },

  discoverList: { flex: 1 },

  discoverListContent: { paddingBottom: 24, gap: 10 },

  discoverListEmpty: { color: "#94a3b8", fontSize: 12, marginTop: 10 },

  discoverListItem: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },

  discoverListItemMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    paddingRight: 10,
  },

  discoverListItemText: { flex: 1 },

  discoverListItemTitle: { color: "#111827", fontSize: 13, fontWeight: "700" },

  discoverListItemSub: { color: "#64748b", fontSize: 12, marginTop: 2 },

  discoverListConnectBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#111827",
  },

  discoverListConnectTxt: { color: "#ffffff", fontSize: 13, fontWeight: "700" },

  discoverListConnectBtnOff: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#e2e8f0",
  },

  discoverListConnectTxtOff: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "700",
  },

  discoverConnectProgressRow: { marginTop: 10, gap: 6 },

  senseStage: {
    flex: 1,
    alignSelf: "stretch",
    position: "relative",
    overflow: "hidden",
    justifyContent: "center",
  },

  senseTapBlank: {
    ...StyleSheet.absoluteFillObject,
  },

  senseWave: {
    position: "absolute",
    left: "50%",
    top: "50%",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(8,80,140,0.38)",
  },

  senseWaveSoft: {
    position: "absolute",
    left: "50%",
    top: "50%",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(8,80,140,0.24)",
  },

  senseCenterFloat: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -10,
    marginTop: -15,
    width: 20,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },

  senseCenterRipple: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -42,
    marginTop: -42,
    width: 84,
    height: 84,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.58)",
  },

  senseCenterRippleSoft: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -42,
    marginTop: -42,
    width: 84,
    height: 84,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(30,41,59,0.4)",
  },

  senseCenterPhone: {
    width: 18,
    height: 28,
    borderRadius: 5,
    borderWidth: 1.3,
    borderColor: "#111827",
    backgroundColor: "#111827",
    alignItems: "center",
    paddingTop: 3,
  },

  senseCenterPhoneNotch: {
    width: 6,
    height: 1.6,
    borderRadius: 2,
    backgroundColor: "#cbd5e1",
  },

  senseDevice: {
    position: "absolute",
    width: 56,
    height: 76,
    alignItems: "center",
    zIndex: 4,
  },

  senseDeviceIcon: {
    marginTop: 12,
    width: 36,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#0b1220",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 3,
  },

  senseDeviceIconHover: {
    marginTop: 11,
    width: 38,
    height: 40,
    borderRadius: 13,
    backgroundColor: "#0b1220",
    borderWidth: 1,
    borderColor: "#020617",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 3,
    shadowColor: "#0f172a",
    shadowOpacity: 0.32,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },

  senseDeviceIconOffline: {
    marginTop: 12,
    width: 36,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#6b7280",
    borderWidth: 1,
    borderColor: "#4b5563",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 3,
  },

  senseDeviceIconOfflineHover: {
    marginTop: 11,
    width: 38,
    height: 40,
    borderRadius: 13,
    backgroundColor: "#64748b",
    borderWidth: 1,
    borderColor: "#475569",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 3,
  },

  senseDeviceScreen: {
    width: 22,
    height: 2.8,
    borderRadius: 2,
    backgroundColor: "#475569",
    marginBottom: 2,
  },

  senseDeviceGlyph: {
    color: "#e2e8f0",
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 11,
  },

  discoverFooterSlot: {
    height: 162,
    width: "100%",
    justifyContent: "flex-end",
    position: "relative",
  },

  discoverDeviceCard: {
    position: "absolute",
    left: "6%",
    right: "6%",
    bottom: 14,
    width: "88%",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },

  discoverCardHeadRow: { flexDirection: "row", alignItems: "center", gap: 8 },

  discoverDotOnline: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#22c55e",
  },

  discoverDotOffline: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#94a3b8",
  },

  discoverDeviceCardTitle: {
    color: "#111827",
    fontSize: 13,
    fontWeight: "700",
  },

  discoverDeviceCardSub: { color: "#64748b", fontSize: 12 },

  discoverDeviceProgressTrack: {
    marginTop: 2,
    height: 6,
    borderRadius: 999,
    backgroundColor: "#eef2f7",
    overflow: "hidden",
  },

  discoverDeviceProgressBar: {
    height: 6,
    width: "100%",
    borderRadius: 999,
    backgroundColor: "#3b82f6",
    alignSelf: "stretch",
  },

  discoverDeviceProgressText: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "600",
  },

  discoverDeviceCardActions: { flexDirection: "row", marginTop: 2 },

  discoverCardConnectBtn: {
    minWidth: 112,
    height: 34,
    borderRadius: 14,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },

  discoverCardConnectBtnOffline: {
    minWidth: 112,
    height: 34,
    borderRadius: 14,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },

  discoverCardConnectText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },

  radarStage: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 336,
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#20364f",
    backgroundColor: "#06101c",
    overflow: "hidden",
    position: "relative",
  },

  radarBandOuter: {
    position: "absolute",
    left: "-8%",
    top: "-8%",
    width: "116%",
    height: "116%",
    borderRadius: 999,
    backgroundColor: "rgba(0,160,255,0.06)",
  },

  radarBandMid: {
    position: "absolute",
    left: "12%",
    top: "12%",
    width: "76%",
    height: "76%",
    borderRadius: 999,
    backgroundColor: "rgba(0,190,255,0.08)",
  },

  radarBandInner: {
    position: "absolute",
    left: "30%",
    top: "30%",
    width: "40%",
    height: "40%",
    borderRadius: 999,
    backgroundColor: "rgba(0,220,255,0.1)",
  },

  radarNebulaA: {
    position: "absolute",
    left: "15%",
    top: "18%",
    width: "38%",
    height: "38%",
    borderRadius: 999,
    backgroundColor: "rgba(90,70,255,0.09)",
  },

  radarNebulaB: {
    position: "absolute",
    right: "14%",
    bottom: "16%",
    width: "32%",
    height: "32%",
    borderRadius: 999,
    backgroundColor: "rgba(0,240,180,0.08)",
  },

  radarRingOuter: {
    position: "absolute",
    left: "8%",
    top: "8%",
    width: "84%",
    height: "84%",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(75,145,220,0.34)",
  },

  radarRingMid: {
    position: "absolute",
    left: "22%",
    top: "22%",
    width: "56%",
    height: "56%",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(85,160,235,0.3)",
  },

  radarRingInner: {
    position: "absolute",
    left: "36%",
    top: "36%",
    width: "28%",
    height: "28%",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(95,175,245,0.26)",
  },

  radarWave: {
    position: "absolute",
    left: "50%",
    top: "50%",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(0,236,255,0.62)",
  },

  radarWaveSoft: {
    position: "absolute",
    left: "50%",
    top: "50%",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(96,200,255,0.35)",
  },

  radarCoreGlow: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -36,
    marginTop: -36,
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: "rgba(0,228,255,0.16)",
  },

  radarCenterFloat: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -24,
    marginTop: -24,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },

  radarCenterOrb: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: "rgba(17,39,63,0.95)",
    borderWidth: 1,
    borderColor: "rgba(111,189,255,0.38)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#36d7ff",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },

  radarCenterPhone: {
    width: 14,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.4,
    borderColor: "#94dcff",
    backgroundColor: "rgba(84,146,205,0.22)",
    alignItems: "center",
    paddingTop: 2,
  },

  radarCenterPhoneNotch: {
    width: 6,
    height: 1.8,
    borderRadius: 2,
    backgroundColor: "rgba(180,226,255,0.86)",
  },

  radarBlip: {
    position: "absolute",
    width: 40,
    height: 58,
    alignItems: "center",
    zIndex: 4,
  },

  radarPlanetHalo: {
    position: "absolute",
    top: 2,
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: "rgba(68,193,255,0.22)",
  },

  radarPlanetHaloHover: {
    position: "absolute",
    top: 0,
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: "rgba(85,208,255,0.35)",
  },

  radarPlanetCore: {
    marginTop: 9,
    width: 14,
    height: 14,
    borderRadius: 999,
    backgroundColor: "#53c5ff",
    borderWidth: 1.5,
    borderColor: "rgba(231,248,255,0.96)",
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },

  radarPlanetCoreHover: {
    marginTop: 8,
    width: 16,
    height: 16,
    borderRadius: 999,
    backgroundColor: "#6ed3ff",
    borderWidth: 1.5,
    borderColor: "#f4f9ff",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    shadowColor: "#63d6ff",
    shadowOpacity: 0.58,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },

  radarPlanetHighlight: {
    marginTop: 2,
    marginLeft: 2,
    width: 5,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.72)",
  },

  radarPlanetShade: {
    position: "absolute",
    right: 1.5,
    bottom: 1.5,
    width: 4.5,
    height: 4.5,
    borderRadius: 999,
    backgroundColor: "rgba(5,33,76,0.4)",
  },

  radarPlanetSparkA: {
    position: "absolute",
    top: 6,
    right: 2,
    width: 3.5,
    height: 1.5,
    borderRadius: 2,
    backgroundColor: "rgba(142,228,255,0.92)",
    transform: [{ rotate: "28deg" }],
  },

  radarPlanetSparkB: {
    position: "absolute",
    top: 3,
    right: 5,
    width: 2,
    height: 2,
    borderRadius: 999,
    backgroundColor: "rgba(190,240,255,0.95)",
  },

  radarPlanetElectric: {
    position: "absolute",
    top: -2,
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1.2,
    borderColor: "rgba(92,217,255,0.88)",
    shadowColor: "#6de4ff",
    shadowOpacity: 0.55,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 0 },
  },

  radarBlipText: {
    marginTop: 5,
    fontSize: 9,
    color: "rgba(170,217,255,0.4)",
    maxWidth: 52,
    textAlign: "center",
  },

  radarBlipTextOn: {
    marginTop: 5,
    fontSize: 9,
    color: "rgba(195,235,255,0.92)",
    maxWidth: 52,
    textAlign: "center",
  },

  radarVignette: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(114,181,244,0.16)",
  },

  discoverHintText: {
    color: "#667b95",
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
  },

  discoverCloseBtn: {
    alignSelf: "center",
    width: 46,
    height: 46,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#cfdaea",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f6f9fe",
  },

  discoverCloseTxt: {
    color: "#60748d",
    fontSize: 26,
    lineHeight: 26,
    marginTop: -1,
  },
  // 旧的发现页列表样式已弃用（当前使用 discoverListWrap / discoverListItem 等）
} satisfies MobileNamedStyles;
