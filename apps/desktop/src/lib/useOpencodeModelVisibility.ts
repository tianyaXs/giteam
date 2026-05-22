import { useEffect, useRef, useState } from "react";
import { loadModelRefSet, saveModelRefSet } from "./opencodeModels";

type OpencodeModelVisibility = {
  hiddenModels: Set<string>;
  enabledModels: Set<string>;
  hideModel: (modelRef: string) => void;
  enableModel: (modelRef: string) => void;
};

export function useOpencodeModelVisibility(storageKeys: {
  hidden: string;
  enabled: string;
}): OpencodeModelVisibility {
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

  return {
    hiddenModels,
    enabledModels,
    hideModel,
    enableModel
  };
}
