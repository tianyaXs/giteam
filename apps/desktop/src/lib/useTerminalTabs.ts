import { useMemo, useRef, useState } from "react";
import {
  createTerminalTabState,
  readTerminalTabSnapshot,
  type TerminalTabState
} from "./terminalState";

export function useTerminalTabs() {
  const initialSnapshot = useMemo(() => readTerminalTabSnapshot(), []);
  const fallbackTabs = useMemo(() => [createTerminalTabState("terminal-1", "终端 1")], []);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTabState[]>(() => initialSnapshot?.tabs || fallbackTabs);
  const [activeTerminalTabId, setActiveTerminalTabId] = useState(() => initialSnapshot?.activeId || "terminal-1");
  const [terminalSidebarVisible, setTerminalSidebarVisible] = useState(true);
  const terminalTabCounterRef = useRef(initialSnapshot?.counter || 2);
  const terminalSeqRef = useRef<Record<string, number>>(
    Object.fromEntries((initialSnapshot?.tabs || fallbackTabs).map((tab) => [tab.id, 0]))
  );
  const terminalBufferedOutputRef = useRef<Record<string, string>>({});

  return {
    terminalTabs,
    setTerminalTabs,
    activeTerminalTabId,
    setActiveTerminalTabId,
    terminalSidebarVisible,
    setTerminalSidebarVisible,
    terminalTabCounterRef,
    terminalSeqRef,
    terminalBufferedOutputRef
  };
}
