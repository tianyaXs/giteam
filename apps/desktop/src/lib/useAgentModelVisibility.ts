import { useCallback, useEffect, useRef, useState } from "react";
import { loadModelRefSet, saveModelRefSet } from "./agentModels";

type AgentModelVisibility = {
  hiddenModels: Set<string>;
  enabledModels: Set<string>;
  hideModel: (modelRef: string) => void;
  enableModel: (modelRef: string) => void;
  /** 批量应用手机端同步回来的 enabled/hidden（双向同步 pull 路径专用）。 */
  applyMobileModelVisibility: (enabled: Set<string>, hidden: Set<string>) => void;
};

export function useAgentModelVisibility(storageKeys: {
  hidden: string;
  enabled: string;
}): AgentModelVisibility {
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(() => new Set());
  const [enabledModels, setEnabledModels] = useState<Set<string>>(() => new Set());
  const loadedRef = useRef(false);

  useEffect(() => {
    setHiddenModels(loadModelRefSet(storageKeys.hidden, "hidden"));
    setEnabledModels(loadModelRefSet(storageKeys.enabled, "enabled"));
    loadedRef.current = true;
  }, [storageKeys.enabled, storageKeys.hidden]);

  useEffect(() => {
    if (!loadedRef.current) return;
    saveModelRefSet(storageKeys.hidden, "hidden", hiddenModels);
  }, [hiddenModels, storageKeys.hidden]);

  useEffect(() => {
    if (!loadedRef.current) return;
    saveModelRefSet(storageKeys.enabled, "enabled", enabledModels);
  }, [enabledModels, storageKeys.enabled]);

  const hideModel = (modelRef: string) => {
    setHiddenModels((prev) => new Set([...prev, modelRef]));
    setEnabledModels((prev) => {
      const next = new Set(prev);
      next.delete(modelRef);
      return next;
    });
  };

  const enableModel = (modelRef: string) => {
    setHiddenModels((prev) => {
      const next = new Set(prev);
      next.delete(modelRef);
      return next;
    });
    setEnabledModels((prev) => new Set([...prev, modelRef]));
  };

  // 批量应用手机端同步回来的 enabled/hidden。内容相同时返回 prev（同引用），
  // React 跳过 re-render，从而不触发依赖此 state 的 push useEffect（防 push/pull 循环）。
  // useCallback 稳定引用，App.tsx 的 listen useEffect 不必每次 render 重订阅。
  const applyMobileModelVisibility = useCallback((enabled: Set<string>, hidden: Set<string>) => {
    setEnabledModels((prev) => (refSetEquals(prev, enabled) ? prev : new Set(enabled)));
    setHiddenModels((prev) => (refSetEquals(prev, hidden) ? prev : new Set(hidden)));
  }, []);

  return {
    hiddenModels,
    enabledModels,
    hideModel,
    enableModel,
    applyMobileModelVisibility
  };
}

function refSetEquals(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
