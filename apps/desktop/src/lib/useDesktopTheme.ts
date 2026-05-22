import { useEffect, useState } from "react";
import { invoke } from "./platform";
import { loadDesktopTheme, saveDesktopTheme, type DesktopTheme } from "./desktopPreferences";

export function useDesktopTheme(): [DesktopTheme, () => void] {
  const [theme, setTheme] = useState<DesktopTheme>(() => loadDesktopTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    saveDesktopTheme(theme);
    void invoke("set_window_theme", { theme }).catch(() => {
      // Ignore if running outside Tauri runtime.
    });
  }, [theme]);

  return [theme, () => setTheme((prev) => (prev === "dark" ? "light" : "dark"))];
}
