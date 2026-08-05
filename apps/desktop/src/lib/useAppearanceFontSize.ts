import { useEffect, useState } from "react";
import { loadLocalString, saveLocalString } from "./localPreferences";
import { IS_TAURI } from "./platform";

const UI_ZOOM_KEY = "giteam.appearance.ui-zoom.v1";
const CODE_FONT_SIZE_KEY = "giteam.appearance.code-font-size.v1";

const UI_ZOOM_MIN = 80;
const UI_ZOOM_MAX = 125;
const UI_ZOOM_DEFAULT = 100;
const CODE_FONT_MIN = 10;
const CODE_FONT_MAX = 18;
const CODE_FONT_DEFAULT = 12;

/** 界面缩放取值范围（百分比），供设置面板复用。 */
export const UI_ZOOM_RANGE = { min: UI_ZOOM_MIN, max: UI_ZOOM_MAX, default: UI_ZOOM_DEFAULT } as const;
/** 代码字号取值范围（px），供设置面板复用。 */
export const CODE_FONT_RANGE = { min: CODE_FONT_MIN, max: CODE_FONT_MAX, default: CODE_FONT_DEFAULT } as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// 代码字号发布订阅：让 TerminalPanel / MonacoDiffViewer 解耦订阅当前字号，
// 无需从 App 层层透传 prop；字号变化时订阅组件自动 re-render。
let codeFontSizeCurrent = CODE_FONT_DEFAULT;
const codeFontSizeListeners = new Set<(value: number) => void>();

function emitCodeFontSize(value: number): void {
  codeFontSizeCurrent = value;
  codeFontSizeListeners.forEach((listener) => listener(value));
}

/** 订阅代码字号；返回当前值并在变化时触发组件更新。 */
export function useCodeFontSize(): number {
  const [value, setValue] = useState(codeFontSizeCurrent);
  useEffect(() => {
    codeFontSizeListeners.add(setValue);
    return () => {
      codeFontSizeListeners.delete(setValue);
    };
  }, []);
  return value;
}

export function useAppearanceFontSize() {
  const [uiZoom, setUiZoom] = useState(
    () => clamp(Number(loadLocalString(UI_ZOOM_KEY, String(UI_ZOOM_DEFAULT))) || UI_ZOOM_DEFAULT, UI_ZOOM_MIN, UI_ZOOM_MAX)
  );
  const [codeFontSize, setCodeFontSize] = useState(
    () => clamp(Number(loadLocalString(CODE_FONT_SIZE_KEY, String(CODE_FONT_DEFAULT))) || CODE_FONT_DEFAULT, CODE_FONT_MIN, CODE_FONT_MAX)
  );

  // 界面缩放：Tauri 用 webview 原生 setZoom（引擎层缩放整个视口，vh/vw 同比变化、
  // 不会出现底部白块）；CSS zoom 挂 <html> 只缩放文档布局、视口单位不重算，zoom≠100%
  // 时 .wb 的 100vh 视觉缩短、下方露出 viewport 默认白底，正是 Windows 缩放白块根因。
  // setZoom 失败（权限缺失/平台不支持）或 web 环境自动退回 CSS zoom，保证缩放始终生效。
  useEffect(() => {
    const factor = uiZoom / 100;
    const applyCssZoom = () => {
      document.documentElement.style.zoom = `${uiZoom}%`;
    };
    if (IS_TAURI) {
      // 动态 import，避免 web 构建把 Tauri API 打进 bundle。
      import("@tauri-apps/api/webview")
        .then(({ getCurrentWebview }) => getCurrentWebview().setZoom(factor))
        .catch(applyCssZoom);
    } else {
      applyCssZoom();
    }
    saveLocalString(UI_ZOOM_KEY, String(uiZoom));
  }, [uiZoom]);

  // 代码字号：写入 token 供 code/pre/textarea 消费，并通过订阅广播给编辑器与终端。
  useEffect(() => {
    document.documentElement.style.setProperty("--gt-code-font-size", `${codeFontSize}px`);
    saveLocalString(CODE_FONT_SIZE_KEY, String(codeFontSize));
    emitCodeFontSize(codeFontSize);
  }, [codeFontSize]);

  return {
    uiZoom,
    codeFontSize,
    setUiZoom,
    setCodeFontSize
  };
}
