import { useRef, type KeyboardEvent } from "react";

type PromptHistoryDirection = "older" | "newer";

function historySessionKey(sessionId: string): string {
  return sessionId.trim() || "__draft__";
}

export function shouldUsePromptHistoryKey(
  event: KeyboardEvent<HTMLTextAreaElement>,
  direction: PromptHistoryDirection
): boolean {
  const target = event.currentTarget;
  const start = target.selectionStart ?? 0;
  const end = target.selectionEnd ?? 0;
  if (start !== end) return false;
  return direction === "older" ? start === 0 : end === target.value.length;
}

export function useOpencodePromptHistory(input: {
  activeSessionId: string;
  currentInput: string;
  onApplyHistory: (value: string) => void;
}) {
  const historyBySessionRef = useRef<Record<string, string[]>>({});
  const historyIndexBySessionRef = useRef<Record<string, number>>({});
  const historyDraftBySessionRef = useRef<Record<string, string>>({});

  const getCurrentSessionKey = () => historySessionKey(input.activeSessionId);

  const recordHistoryEntry = (sessionId: string, prompt: string) => {
    const key = historySessionKey(sessionId);
    const value = prompt.trim();
    if (!value) return;
    const prev = historyBySessionRef.current[key] || [];
    historyBySessionRef.current[key] = [value, ...prev.filter((item) => item !== value)].slice(0, 80);
    historyIndexBySessionRef.current[key] = -1;
    historyDraftBySessionRef.current[key] = "";
  };

  const captureDraft = (value: string) => {
    const key = getCurrentSessionKey();
    historyIndexBySessionRef.current[key] = -1;
    historyDraftBySessionRef.current[key] = value;
  };

  const browseHistory = (direction: PromptHistoryDirection) => {
    const key = getCurrentSessionKey();
    const history = historyBySessionRef.current[key] || [];
    if (history.length === 0) return;
    const currentIndex = historyIndexBySessionRef.current[key] ?? -1;
    if (direction === "older") {
      if (currentIndex < 0) {
        historyDraftBySessionRef.current[key] = input.currentInput;
      }
      const nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, history.length - 1);
      historyIndexBySessionRef.current[key] = nextIndex;
      input.onApplyHistory(history[nextIndex] || "");
      return;
    }
    if (currentIndex <= 0) {
      historyIndexBySessionRef.current[key] = -1;
      input.onApplyHistory(historyDraftBySessionRef.current[key] || "");
      return;
    }
    const nextIndex = currentIndex - 1;
    historyIndexBySessionRef.current[key] = nextIndex;
    input.onApplyHistory(history[nextIndex] || "");
  };

  return {
    recordHistoryEntry,
    captureDraft,
    browseHistory
  };
}
