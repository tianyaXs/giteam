import { useEffect, useRef, useState } from "react";
import { normalizeModelRef } from "./agentModels";

/**
 * 模型选择存储 v2：只持久化「草稿预选」与「最近使用」。
 *
 * 有活动会话时，provider/model 的唯一真相是服务端 session（React 里挂在
 * AgentChatSession.provider/model 上），不再把 sessionId→model 影子映射写入
 * localStorage——那正是「UI 显示 A、实际跑 B」反复穿帮的根因。
 */
type StoredModelSelectionV2 = {
  version: 2;
  draft?: string;
  saved?: string[];
};

/** 旧版 v1：曾把 session 映射当真相，启动时丢弃 session 段。 */
type StoredModelSelectionV1 = {
  draft?: string;
  session?: Record<string, string>;
};

function readStoredSelection(storageKey: string): { draft: string; saved: string[] } {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { draft: "", saved: [] };
    const parsed = JSON.parse(raw) as (StoredModelSelectionV2 & StoredModelSelectionV1) | null;
    const draft = normalizeModelRef(String(parsed?.draft || ""));
    const savedRaw = Array.isArray(parsed?.saved) ? parsed!.saved! : [];
    const saved = savedRaw
      .map((item) => normalizeModelRef(String(item || "")))
      .filter(Boolean)
      .slice(0, 64);
    return { draft, saved };
  } catch {
    return { draft: "", saved: [] };
  }
}

export function useAgentModelSelection(storageKey: string) {
  const [savedModels, setSavedModels] = useState<string[]>([]);
  const [draftModel, setDraftModel] = useState("");
  const loadedRef = useRef(false);

  useEffect(() => {
    const stored = readStoredSelection(storageKey);
    setDraftModel(stored.draft);
    setSavedModels(stored.saved);
    loadedRef.current = true;
    // 立刻以 v2 格式回写，清掉旧 session 影子映射。
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: 2,
          draft: stored.draft || "",
          saved: stored.saved || []
        } satisfies StoredModelSelectionV2)
      );
    } catch {
      // ignore
    }
  }, [storageKey]);

  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: 2,
          draft: draftModel || "",
          saved: savedModels || []
        } satisfies StoredModelSelectionV2)
      );
    } catch {
      // ignore unavailable storage
    }
  }, [draftModel, savedModels, storageKey]);

  const rememberSavedModel = (modelRef: string) => {
    const normalized = normalizeModelRef(modelRef);
    if (!normalized) return;
    setSavedModels((prev) => [normalized, ...prev.filter((model) => model !== normalized)].slice(0, 64));
  };

  /** 仅更新草稿预选（无活动会话时的新建默认）；有会话时请改 AgentChatSession + setModel。 */
  const selectDraftModel = (modelRef: string) => {
    const normalized = normalizeModelRef(modelRef);
    if (!normalized) return "";
    setDraftModel(normalized);
    rememberSavedModel(normalized);
    return normalized;
  };

  return {
    savedModels,
    draftModel,
    rememberSavedModel,
    selectDraftModel,
    /** @deprecated 兼容旧调用名：等价于 selectDraftModel（不再写 session 映射）。 */
    selectModel: (modelRef: string, _sessionId?: string) => selectDraftModel(modelRef)
  };
}
