import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { LoaderCircle, Search, Sparkles, User } from "lucide-react";
import type { AppText } from "../../lib/generalSettings";
import type { AgentClient, AgentSessionSummary } from "../../lib/agent/client";
import type { AgentChatMessage } from "../../lib/agentSessions";
import type { RepositoryEntry } from "../../lib/types";
import type { SearchHit, SearchScope } from "../../lib/sessionSearch";
import { useSessionSearch } from "../../hooks/useSessionSearch";

export type SearchPanelProps = {
  open: boolean;
  onClose: () => void;
  text: AppText;
  scope: SearchScope;
  onScopeChange: (scope: SearchScope) => void;
  /** 数据源：仅用 getMessages；listSessions 由 App 注入。 */
  agentClient: Pick<AgentClient, "getMessages">;
  listSessions: () => Promise<AgentSessionSummary[]>;
  currentSessionId: string;
  currentSessionTitle: string;
  currentSessionUpdatedAt: number;
  currentMessages: AgentChatMessage[];
  currentRepoPath: string;
  repos: RepositoryEntry[];
  /** 选中命中：App 负责关闭面板并定位（当前会话滚动 / 跨会话切换+加载+定位）。
   * query 为当前搜索词，透传给消息流做正文关键词高亮。 */
  onSelect: (hit: SearchHit, query: string) => void;
};

const SCOPE_OPTIONS: Array<{ value: SearchScope; labelKey: keyof AppText }> = [
  { value: "current-session", labelKey: "searchScopeCurrentSession" },
  { value: "current-repo", labelKey: "searchScopeCurrentRepo" },
  { value: "all-repos", labelKey: "searchScopeAll" }
];

function HighlightedPreview({ preview, matchStart, matchEnd }: { preview: string; matchStart: number; matchEnd: number }) {
  const before = preview.slice(0, matchStart);
  const hit = preview.slice(matchStart, matchEnd);
  const after = preview.slice(matchEnd);
  return (
    <span className="min-w-0 truncate">
      <span className="text-muted-foreground/80">{before}</span>
      <mark className="rounded bg-primary/25 px-0.5 text-foreground">{hit}</mark>
      <span className="text-muted-foreground/80">{after}</span>
    </span>
  );
}

export function SearchPanel(props: SearchPanelProps) {
  const {
    open,
    onClose,
    text,
    scope,
    onScopeChange,
    agentClient,
    listSessions,
    currentSessionId,
    currentSessionTitle,
    currentSessionUpdatedAt,
    currentMessages,
    currentRepoPath,
    repos,
    onSelect
  } = props;

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // 输入法组合状态：拼音等 IME 未确认候选词前，回车/方向键交给输入法，避免误触发跳转。
  const composingRef = useRef(false);

  const reduceMotion = useReducedMotion();
  const { hits, loading, searched } = useSessionSearch({
    query,
    scope,
    agentClient,
    listSessions,
    currentSessionId,
    currentSessionTitle,
    currentSessionUpdatedAt,
    currentMessages,
    currentRepoPath,
    repos
  });

  // 打开时聚焦输入；关闭时复位查询与选中，避免下次打开残留旧结果。
  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  // 选中索引始终落在合法区间。
  useEffect(() => {
    if (activeIndex > hits.length - 1) setActiveIndex(Math.max(0, hits.length - 1));
  }, [hits.length, activeIndex]);

  // 键盘移动时把激活项滚入视口。
  useEffect(() => {
    const node = itemRefs.current[activeIndex];
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleClose = () => {
    setQuery("");
    setActiveIndex(0);
    onClose();
  };

  const selectIndex = (index: number) => {
    const hit = hits[index];
    if (!hit) return;
    onSelect(hit, query);
    handleClose();
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // 面板内 ⌘F：仅保持聚焦、阻止默认，不重复开关。
    if ((event.metaKey || event.ctrlKey) && (event.key === "f" || event.key === "F")) {
      event.preventDefault();
      return;
    }
    // 输入法组合中（如中文拼音未确认）：按键交给 IME，回车用于确认候选词而非跳转。
    if (event.nativeEvent.isComposing || composingRef.current) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (hits.length) setActiveIndex((i) => (i + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (hits.length) setActiveIndex((i) => (i - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectIndex(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
    }
  };

  const cardTransition = reduceMotion ? { duration: 0.01 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };
  const itemTransition = reduceMotion ? { duration: 0.01 } : { duration: 0.14, ease: "easeOut" as const };

  const showEmptyHint = !searched;
  const showNoResult = searched && hits.length === 0 && !loading;
  const showSearching = searched && hits.length === 0 && loading;

  const scopeOptions = useMemo(
    () => SCOPE_OPTIONS.map((opt) => ({ ...opt, label: text[opt.labelKey] })),
    [text]
  );

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[2700] flex items-start justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduceMotion ? { duration: 0.01 } : { duration: 0.16 }}
          role="dialog"
          aria-modal="true"
          aria-label={text.search}
        >
          {/* 遮罩：点击关闭 */}
          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={handleClose} aria-hidden="true" />
          <motion.div
            className="relative mt-[14vh] w-[min(640px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl"
            initial={reduceMotion ? false : { opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={cardTransition}
          >
            {/* 头部：搜索图标 + 输入 + 范围切换 + Esc 提示 */}
            <div className="flex items-center gap-2 px-4 py-3">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; }}
                onKeyDown={onInputKeyDown}
                placeholder={text.searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
                autoComplete="off"
                spellCheck={false}
                aria-label={text.search}
              />
              {loading ? (
                <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : null}
              <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-block">Esc</kbd>
            </div>

            {/* 范围切换 */}
            <div className="flex items-center gap-1 px-4 pb-2">
              {scopeOptions.map((opt) => {
                const active = opt.value === scope;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onScopeChange(opt.value);
                      setActiveIndex(0);
                      inputRef.current?.focus();
                    }}
                    data-active={active}
                    className={(
                      "rounded-md px-2 py-1 text-xs transition-[background-color,color,box-shadow] " +
                      "hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] " +
                      (active
                        ? "bg-[color-mix(in_srgb,#8f8270_18%,transparent)] font-medium text-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,#8f8270_24%,transparent)]"
                        : "text-muted-foreground")
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* 结果区 */}
            <div className="max-h-[min(420px,50vh)] overflow-y-auto border-t border-border px-2 py-2">
              {showEmptyHint ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">{text.searchEmptyHint}</div>
              ) : showSearching ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">{text.searchLoading}</div>
              ) : showNoResult ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">{text.searchNoResults}</div>
              ) : (
                <ul role="listbox" className="flex flex-col gap-0.5">
                  {hits.map((hit, index) => {
                    const active = index === activeIndex;
                    const RoleIcon = hit.role === "user" ? User : Sparkles;
                    return (
                      <li key={`${hit.sessionId}:${hit.messageId}`} role="option" aria-selected={active}>
                        <motion.button
                          ref={(node) => {
                            itemRefs.current[index] = node;
                          }}
                          type="button"
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => selectIndex(index)}
                          initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={itemTransition}
                          className={(
                            "flex w-full min-w-0 flex-col gap-1 rounded-lg px-3 py-2 text-left outline-none transition-[background-color,box-shadow] " +
                            (active
                              ? "bg-[color-mix(in_srgb,#8f8270_14%,transparent)] ring-1 ring-inset ring-[color-mix(in_srgb,#8f8270_24%,transparent)]"
                              : "hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]")
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2 text-xs">
                            <RoleIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="truncate font-medium text-foreground">{hit.sessionTitle || text.searchPlaceholder}</span>
                            {scope !== "current-session" && hit.repoName ? (
                              <span className="ml-auto shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{hit.repoName}</span>
                            ) : null}
                          </span>
                          <HighlightedPreview preview={hit.preview} matchStart={hit.matchStart} matchEnd={hit.matchEnd} />
                        </motion.button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
