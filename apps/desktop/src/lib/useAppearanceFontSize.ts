import { useEffect, useState } from "react";
import { loadLocalString, saveLocalString } from "./localPreferences";

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

  // 界面缩放：CSS zoom 等比缩放整个文档，绕开 Tailwind 固定字号类对 token 的覆盖。
  // 无过程动画——值一变即一次性落位（唯一一次重排），干脆零瑕疵，VSCode/浏览器同款。
  useEffect(() => {
    document.documentElement.style.zoom = `${uiZoom}%`;
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
