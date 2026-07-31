import { useEffect, useRef, useState } from "react";
import { normalizeModelRef } from "./opencodeModels";

type StoredModelSelection = {
  draft?: string;
  session?: Record<string, string>;
};

export function useOpencodeModelSelection(storageKey: string) {
  const [savedModels, setSavedModels] = useState<string[]>([]);
  const [draftModel, setDraftModel] = useState("");
  const [sessionModel, setSessionModel] = useState<Record<string, string>>({});
  const loadedRef = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setDraftModel("");
        setSessionModel({});
        return;
      }
      const parsed = JSON.parse(raw) as StoredModelSelection | null;
      setDraftModel(normalizeModelRef(String(parsed?.draft || "")));
      const storedSession = parsed?.session && typeof parsed.session === "object" ? parsed.session : {};
      const nextSession: Record<string, string> = {};
      for (const [sessionId, modelRef] of Object.entries(storedSession || {})) {
        const normalized = normalizeModelRef(String(modelRef || ""));
        if (sessionId && normalized) nextSession[sessionId] = normalized;
      }
      setSessionModel(nextSession);
    } catch {
      setDraftModel("");
      setSessionModel({});
    } finally {
      loadedRef.current = true;
    }
  }, [storageKey]);

  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          draft: draftModel || "",
          session: sessionModel || {}
        })
      );
    } catch {
      // ignore unavailable storage
    }
  }, [draftModel, sessionModel, storageKey]);

  const rememberSavedModel = (modelRef: string) => {
    const normalized = normalizeModelRef(modelRef);
    if (!normalized) return;
    setSavedModels((prev) => [normalized, ...prev.filter((model) => model !== normalized)].slice(0, 64));
  };

  const selectModel = (modelRef: string, sessionId: string) => {
    const normalized = normalizeModelRef(modelRef);
    if (!normalized) return "";
    if (sessionId.trim()) {
      setSessionModel((prev) => ({ ...prev, [sessionId.trim()]: normalized }));
    } else {
      setDraftModel(normalized);
    }
    rememberSavedModel(normalized);
    return normalized;
  };

  return {
    savedModels,
    draftModel,
    sessionModel,
    rememberSavedModel,
    selectModel
  };
}
