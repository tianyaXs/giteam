import { useCallback } from "react";
import { toText } from "../../lib/text";

export function useConnectionLogger() {
  return useCallback((message: string, level: "info" | "error" = "info") => {
    const text = toText(message).trim();
    if (!text) return;
    const tag = level === "error" ? "error" : "log";
    // eslint-disable-next-line no-console
    console[tag](`[mobile-conn] ${new Date().toISOString()} ${text}`);
  }, []);
}
