import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentClient, AgentMessage, AgentSessionSummary } from "../lib/agent/client";
import type { AgentChatMessage } from "../lib/agentSessions";
import { normalizeWorkspacePath } from "../lib/workspaceBindings";
import type { RepositoryEntry } from "../lib/types";
import {
  type SearchHit,
  type SearchScope,
  type SearchSessionMeta,
  type SearchableItem,
  searchMessages,
  searchableItemFromAgentMessage
} from "../lib/sessionSearch";

export type UseSessionSearchArgs = {
  query: string;
  scope: SearchScope;
  /** 仅用到 getMessages；listSessions 由调用方注入，便于复用 App 已有数据/节流。 */
  agentClient: Pick<AgentClient, "getMessages">;
  listSessions: () => Promise<AgentSessionSummary[]>;
  currentSessionId: string;
  currentSessionTitle: string;
  currentSessionUpdatedAt: number;
  /** 当前会话已加载的消息（AgentChatMessage.content 即可搜索正文）。 */
  currentMessages: AgentChatMessage[];
  currentRepoPath: string;
  repos: RepositoryEntry[];
  maxConcurrentLoads?: number;
  maxResults?: number;
};

export type UseSessionSearchResult = {
  hits: SearchHit[];
  /** 跨会话异步加载进行中。 */
  loading: boolean;
  /** 已发起过一次有效搜索（区分"初始空"与"无结果"）。 */
  searched: boolean;
};

/** 并发受限的任务池：避免会话多时一次性发出上百个 getMessages IPC。 */
async function runWithLimit<T>(items: readonly T[], fn: (item: T) => Promise<void>, limit: number): Promise<void> {
  const queue = items.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function repoDisplayName(repos: readonly RepositoryEntry[], repoPath: string): string {
  const norm = normalizeWorkspacePath(repoPath);
  const found = repos.find((repo) => normalizeWorkspacePath(repo.path) === norm);
  if (found) return found.name;
  const base = repoPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return base || repoPath;
}

/**
 * 会话搜索编排器。
 * - 当前会话：即时同步匹配（无 IPC、无防抖），输入即出结果。
 * - 跨会话：180ms 防抖 → listSessions 按范围过滤 → updatedAtMs 倒序 → 并发加载（默认 6）
 *   → 缓存抽取后的可搜索单元 → 增量合并命中。世代 token(seq) 丢弃过期查询结果。
 * 结果顺序：当前会话命中在前，跨会话命中（按会话活跃度）在后。
 */
export function useSessionSearch(args: UseSessionSearchArgs): UseSessionSearchResult {
  const {
    query,
    scope,
    agentClient,
    listSessions,
    currentSessionId,
    currentSessionTitle,
    currentSessionUpdatedAt,
    currentMessages,
    currentRepoPath,
    repos,
    maxConcurrentLoads = 6,
    maxResults = 100
  } = args;

  // 跨会话缓存：sessionId → 已抽取的可搜索单元。已加载过的会话不再重复 IPC。
  const cacheRef = useRef<Map<string, SearchableItem[]>>(new Map());
  // 世代 token：每次新查询/范围自增，过期批次的 setHits 被丢弃，避免慢查询覆盖快查询。
  const seqRef = useRef(0);
  const [crossHits, setCrossHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  // 当前会话命中：纯同步派生，流式时随 currentMessages 实时更新。
  const currentHits = useMemo<SearchHit[]>(() => {
    const queryTrimmed = query.trim();
    if (!queryTrimmed || !currentSessionId) return [];
    const meta: SearchSessionMeta = {
      sessionId: currentSessionId,
      repoPath: currentRepoPath,
      repoName: repoDisplayName(repos, currentRepoPath),
      sessionTitle: currentSessionTitle,
      updatedAtMs: currentSessionUpdatedAt
    };
    const items = currentMessages.map((msg) => ({ messageId: msg.id, role: msg.role, text: msg.content }));
    return searchMessages({ query: queryTrimmed, session: meta, items });
  }, [query, currentSessionId, currentSessionTitle, currentSessionUpdatedAt, currentRepoPath, repos, currentMessages]);

  // 跨会话搜索（仅 current-repo / all-repos）。
  useEffect(() => {
    const queryTrimmed = query.trim();
    if (scope === "current-session" || !queryTrimmed) {
      setCrossHits([]);
      setLoading(false);
      return;
    }

    const seq = ++seqRef.current;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const all = await listSessions();
          if (cancelled || seq !== seqRef.current) return;
          const candidates = all
            .filter((s) => scope === "all-repos" || normalizeWorkspacePath(s.repoPath) === normalizeWorkspacePath(currentRepoPath))
            .filter((s) => s.sessionId !== currentSessionId) // 当前会话命中由 currentHits 负责，避免重复
            .filter((s) => s.messageCount !== 0) // 跳过空会话，省一次 IPC
            .sort((a, b) => b.updatedAtMs - a.updatedAtMs); // 最近活跃优先，命中更早浮现

          const acc: SearchHit[] = [];
          await runWithLimit(candidates, async (session) => {
            if (cancelled || seq !== seqRef.current || acc.length >= maxResults) return;
            let items = cacheRef.current.get(session.sessionId);
            if (!items) {
              let messages: AgentMessage[];
              try {
                messages = await agentClient.getMessages(session.sessionId);
              } catch {
                // 单会话加载失败不阻断整体搜索：静默跳过。
                return;
              }
              if (cancelled || seq !== seqRef.current) return;
              items = messages.map(searchableItemFromAgentMessage).filter((x): x is SearchableItem => x !== null);
              cacheRef.current.set(session.sessionId, items);
            }
            if (cancelled || seq !== seqRef.current) return;
            const meta: SearchSessionMeta = {
              sessionId: session.sessionId,
              repoPath: session.repoPath,
              repoName: repoDisplayName(repos, session.repoPath),
              sessionTitle: session.title || "",
              updatedAtMs: session.updatedAtMs
            };
            const hits = searchMessages({ query: queryTrimmed, session: meta, items });
            if (hits.length) {
              for (const hit of hits) {
                acc.push(hit);
                if (acc.length >= maxResults) break;
              }
              // 增量更新：每完成一个会话即刷新，最近会话的命中先冒出来。
              if (seq === seqRef.current && !cancelled) setCrossHits(acc.slice());
            }
          }, maxConcurrentLoads);

          if (cancelled || seq !== seqRef.current) return;
          setCrossHits(acc.slice(0, maxResults));
        } finally {
          if (seq === seqRef.current && !cancelled) setLoading(false);
        }
      })();
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, scope, currentRepoPath, currentSessionId, repos, agentClient, listSessions, maxConcurrentLoads, maxResults]);

  const queryTrimmed = query.trim();
  const searched = queryTrimmed.length > 0;
  const hits = scope === "current-session" ? currentHits : [...currentHits, ...crossHits];

  return { hits, loading, searched };
}
