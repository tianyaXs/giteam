import { useEffect, useState } from "react";
import { loadLocalString, saveLocalString } from "./localPreferences";

const UI_FONT_SIZE_KEY = "giteam.appearance.ui-font-size.v1";
const CODE_FONT_SIZE_KEY = "giteam.appearance.code-font-size.v1";

function clampFontSize(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function useAppearanceFontSize() {
  const [uiFontSize, setUiFontSize] = useState(() => Number(loadLocalString(UI_FONT_SIZE_KEY, "13")) || 13);
  const [codeFontSize, setCodeFontSize] = useState(() => Number(loadLocalString(CODE_FONT_SIZE_KEY, "12")) || 12);

  useEffect(() => {
    const ui = clampFontSize(uiFontSize, 11, 18);
    const code = clampFontSize(codeFontSize, 10, 18);
    document.documentElement.style.setProperty("--gt-ui-font-size", `${ui}px`);
    document.documentElement.style.setProperty("--gt-code-font-size", `${code}px`);
    saveLocalString(UI_FONT_SIZE_KEY, String(ui));
    saveLocalString(CODE_FONT_SIZE_KEY, String(code));
  }, [uiFontSize, codeFontSize]);

  return {
    uiFontSize,
    codeFontSize,
    setUiFontSize,
    setCodeFontSize
  };
}
