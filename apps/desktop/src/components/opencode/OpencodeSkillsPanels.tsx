import type { Ref } from "react";
import { PinIcon, RefreshIcon } from "../icons";
import {
  INSTALLED_VIA_SKILLS_DESCRIPTION,
  OPENCODE_SKILL_DISPLAY_BATCH_SIZE,
  type OpencodeSkillAudit,
  type OpencodeSkillDetail,
  type OpencodeInstalledSkillGroup,
  type OpencodeSkillInfo
} from "../../lib/opencodeSkillData";
import { formatSkillInstalls, skillQualityLabel, type OpencodeSkillSearchResult } from "../../lib/opencodeSkillMarketplace";
import type {
  OpencodeSkillCatalogView,
  OpencodeSkillSearchMeta,
  OpencodeSkillSearchStrategy
} from "../../lib/useOpencodeSkillMarketplace";

function getSkillScopeLabel(scope?: string) {
  return scope === "global" ? "Global" : scope === "project" ? "Repo" : "Source";
}

function getSkillRemoveKey(skill: OpencodeSkillInfo) {
  return `${skill.scope || "source"}:${skill.name}:${skill.path || skill.location || ""}`;
}

type InstalledSkillGroupsProps = {
  groups: OpencodeInstalledSkillGroup[];
  removingKey: string;
  onReferenceSkill: (skill: OpencodeSkillInfo) => void;
  onRemoveSkill: (skill: OpencodeSkillInfo) => void | Promise<void>;
  onRemoveSkillGroup: (group: OpencodeInstalledSkillGroup) => void | Promise<void>;
};

export function OpencodeInstalledSkillGroups(props: InstalledSkillGroupsProps) {
  const { groups, removingKey, onReferenceSkill, onRemoveSkill, onRemoveSkillGroup } = props;

  if (groups.length === 0) {
    return <div className="gt-module-empty">暂无已安装 Skills</div>;
  }

  return groups.map((group) => {
    const removing = group.removableItems.some((skill) => removingKey === getSkillRemoveKey(skill));
    const singleSkill = group.items[0];
    const canRenderFlat = group.items.length === 1
      && !!singleSkill
      && (singleSkill.sourceGroup || "").trim() === ""
      && group.name.trim() === singleSkill.name.trim();

    if (canRenderFlat) {
      const skill = singleSkill;
      const scope = skill.scope || "source";
      return (
        <div key={group.name} className="gt-installed-skill-group is-flat">
          <div className="gt-installed-skill-group-flat-row">
            <button
              type="button"
              className="gt-installed-skill-chip is-reference"
              onClick={() => onReferenceSkill(skill)}
              title={`Use ${skill.name}`}
            >
              <div>
                <strong>{skill.name}</strong>
                <small>{skill.path || skill.location || skill.description || INSTALLED_VIA_SKILLS_DESCRIPTION}</small>
              </div>
              <span className={`gt-scope-badge ${scope}`}>{getSkillScopeLabel(scope)}</span>
            </button>
            <button
              type="button"
              className="gt-installed-skill-delete"
              disabled={group.removableItems.length === 0 || removing}
              onClick={() => void onRemoveSkill(skill)}
              title={group.removableItems.length === 0 ? "该技能不可删除" : `删除 ${skill.name}`}
            >
              {removing ? "删除中..." : "删除"}
            </button>
          </div>
        </div>
      );
    }

    return (
      <details key={group.name} className="gt-installed-skill-group" open>
        <summary>
          <div className="gt-installed-skill-group-main" title={group.name}>
            <div>
              <strong>{group.name}</strong>
              <small>{group.description}</small>
            </div>
            <span>{group.items.length} 项</span>
          </div>
          <button
            type="button"
            className="gt-installed-skill-delete"
            disabled={group.removableItems.length === 0 || removing}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void onRemoveSkillGroup(group);
            }}
            title={group.removableItems.length === 0 ? "该目录下没有可删除的已安装项" : `删除 ${group.name}`}
          >
            {removing ? "删除中..." : "删除"}
          </button>
        </summary>
        <div className="gt-installed-skill-group-items">
          {group.items.map((skill) => {
            const scope = skill.scope || "source";
            return (
              <button
                key={getSkillRemoveKey(skill)}
                type="button"
                className="gt-installed-skill-chip is-reference"
                onClick={() => onReferenceSkill(skill)}
                title={`Use ${skill.name}`}
              >
                <div>
                  <strong>{skill.name}</strong>
                  <small>{skill.path || skill.location || skill.description || INSTALLED_VIA_SKILLS_DESCRIPTION}</small>
                </div>
                <span className={`gt-scope-badge ${scope}`}>{getSkillScopeLabel(scope)}</span>
              </button>
            );
          })}
        </div>
      </details>
    );
  });
}

type MarketplaceCardsProps = {
  rows: OpencodeSkillSearchResult[];
  selectedSpec?: string;
  installingSpec: string;
  installLog: string;
  busy: boolean;
  onSelectSkill: (skill: OpencodeSkillSearchResult) => void | Promise<void>;
  onInstallSkill: (spec: string) => void | Promise<void>;
};

export function OpencodeMarketplaceCards(props: MarketplaceCardsProps) {
  const { rows, selectedSpec, installingSpec, installLog, busy, onSelectSkill, onInstallSkill } = props;

  return rows.map((result, index) => {
    const resultInstallSpec = result.installSpec || result.spec;
    const isInstallingThisSkill = installingSpec === resultInstallSpec || installingSpec === result.spec;
    const quality = skillQualityLabel(result);

    return (
      <article
        key={result.id || result.spec}
        role="button"
        tabIndex={0}
        className={selectedSpec === result.spec ? "gt-skill-card-item active" : "gt-skill-card-item"}
        onClick={() => void onSelectSkill(result)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") void onSelectSkill(result);
        }}
      >
        <span className="gt-skill-card-rank">{String(index + 1).padStart(2, "0")}</span>
        <div className="gt-skill-card-copy">
          <strong>{result.skill}</strong>
          <small>{result.package}</small>
          <div className="gt-skill-card-tags">
            <span className={`gt-skill-quality ${quality}`}>{quality}</span>
            <span className="gt-skill-card-spec">{resultInstallSpec}</span>
          </div>
        </div>
        <div className="gt-skill-card-stats">
          <b><PinIcon width={14} height={14} /> {result.installs}</b>
          <small>{typeof result.change === "number" ? `${result.change >= 0 ? "+" : ""}${result.change} today` : "trusted listing"}</small>
        </div>
        <button
          className={isInstallingThisSkill ? "gt-skill-get-btn is-installing" : "gt-skill-get-btn"}
          type="button"
          disabled={isInstallingThisSkill || busy}
          onClick={(event) => {
            event.stopPropagation();
            if (busy) return;
            void onInstallSkill(resultInstallSpec);
          }}
        >
          {isInstallingThisSkill ? "Installing" : "Get"}
        </button>
        {isInstallingThisSkill ? <div className="gt-skill-card-install-log">{installLog || "正在启动安装日志..."}</div> : null}
      </article>
    );
  });
}

type SettingsSkillsGridProps = {
  error: string;
  groups: OpencodeInstalledSkillGroup[];
  removingKey: string;
  onRemoveSkillGroup: (group: OpencodeInstalledSkillGroup) => void | Promise<void>;
};

export function OpencodeSettingsSkillsGrid(props: SettingsSkillsGridProps) {
  const { error, groups, removingKey, onRemoveSkillGroup } = props;

  return (
    <div className="settings-skills-manager">
      {error ? <div className="gt-module-empty danger">{error}</div> : null}
      <div className="settings-skills-grid">
        {groups.length === 0 ? <div className="gt-module-empty">暂无已安装 Skills。</div> : groups.map((group) => {
          const removing = group.removableItems.some((skill) => removingKey === getSkillRemoveKey(skill));
          return (
            <article key={group.name} className="settings-skill-card">
              <div className="settings-skill-card-main">
                <div className="settings-skill-card-title">
                  <strong>{group.name}</strong>
                  <span>{group.items.length} 项</span>
                </div>
                <p>{group.description}</p>
              </div>
              <details className="settings-skill-menu">
                <summary aria-label={`${group.name} actions`} title="Actions"><span aria-hidden="true">...</span></summary>
                <div className="settings-skill-menu-panel">
                  <button
                    className="settings-skill-remove"
                    type="button"
                    disabled={group.removableItems.length === 0 || removing}
                    onClick={() => void onRemoveSkillGroup(group)}
                    title={group.removableItems.length > 0 ? "Uninstall skill group" : "Source skills need to be removed from source config"}
                  >
                    {removing ? "Removing" : "Uninstall"}
                  </button>
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </div>
  );
}

type SkillsMarketPanelProps = {
  groups: OpencodeInstalledSkillGroup[];
  skills: OpencodeSkillInfo[];
  skillsLoading: boolean;
  skillsError: string;
  skillsmpApiKey: string;
  removingKey: string;
  skillBusy: boolean;
  skillInstallingSpec: string;
  skillInstallNotice: string;
  skillInstallLog: string;
  marketListRef: Ref<HTMLDivElement>;
  searchQuery: string;
  searchStrategy: OpencodeSkillSearchStrategy;
  searchResults: OpencodeSkillSearchResult[];
  catalogView: OpencodeSkillCatalogView;
  catalogPage: number;
  catalogTotal: number;
  searchMeta: OpencodeSkillSearchMeta | null;
  selectedMarketplaceSkill: OpencodeSkillSearchResult | null;
  selectedSkillDetail: OpencodeSkillDetail | null;
  selectedSkillAudits: OpencodeSkillAudit[];
  selectedSkillLoading: boolean;
  showSkillInstallMenu: boolean;
  marketplaceRows: OpencodeSkillSearchResult[];
  visibleMarketplaceRows: OpencodeSkillSearchResult[];
  initialLoading: boolean;
  searching: boolean;
  paging: boolean;
  canAutoLoadMore: boolean;
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void | Promise<void>;
  onSearchStrategyChange: (value: OpencodeSkillSearchStrategy) => void;
  onSwitchCatalogView: (value: OpencodeSkillCatalogView) => void;
  onRefreshSkills: () => void | Promise<void>;
  onScrollMarket: () => void;
  onSelectMarketplaceSkill: (skill: OpencodeSkillSearchResult) => void | Promise<void>;
  onInstallMarketplaceSkill: (spec: string) => void | Promise<void>;
  onToggleSkillInstallMenu: () => void;
  onInstallSelectedMarketplaceSkill: (scope: "project" | "global") => void | Promise<void>;
  onLoadSelectedSkillDetails: () => void | Promise<void>;
  onReferenceSkill: (skill: OpencodeSkillInfo) => void;
  onRemoveSkill: (skill: OpencodeSkillInfo) => void | Promise<void>;
  onRemoveSkillGroup: (group: OpencodeInstalledSkillGroup) => void | Promise<void>;
};

export function OpencodeSkillsMarketPanel(props: SkillsMarketPanelProps) {
  const {
    groups,
    skills,
    skillsLoading,
    skillsError,
    skillsmpApiKey,
    removingKey,
    skillBusy,
    skillInstallingSpec,
    skillInstallNotice,
    skillInstallLog,
    marketListRef,
    searchQuery,
    searchStrategy,
    searchResults,
    catalogView,
    catalogPage,
    catalogTotal,
    searchMeta,
    selectedMarketplaceSkill,
    selectedSkillDetail,
    selectedSkillAudits,
    selectedSkillLoading,
    showSkillInstallMenu,
    marketplaceRows,
    visibleMarketplaceRows,
    initialLoading,
    searching,
    paging,
    canAutoLoadMore,
    onSearchQueryChange,
    onSearch,
    onSearchStrategyChange,
    onSwitchCatalogView,
    onRefreshSkills,
    onScrollMarket,
    onSelectMarketplaceSkill,
    onInstallMarketplaceSkill,
    onToggleSkillInstallMenu,
    onInstallSelectedMarketplaceSkill,
    onLoadSelectedSkillDetails,
    onReferenceSkill,
    onRemoveSkill,
    onRemoveSkillGroup
  } = props;

  return (
    <div className="gt-skill-market-shell">
      <details className="gt-installed-skills-collapsible">
        <summary>
          <span>已安装 Skills</span>
          <small>{groups.length} 组 / {skills.length} 项</small>
          <button
            type="button"
            className="gt-icon-chip"
            onClick={(event) => {
              event.preventDefault();
              void onRefreshSkills();
            }}
            title="刷新"
          >
            <RefreshIcon />
          </button>
        </summary>
        <div className="gt-installed-skill-grid">
          <OpencodeInstalledSkillGroups
            groups={groups}
            removingKey={removingKey}
            onReferenceSkill={onReferenceSkill}
            onRemoveSkill={onRemoveSkill}
            onRemoveSkillGroup={onRemoveSkillGroup}
          />
        </div>
      </details>

      <div className="gt-skill-market-layout">
        <main className="gt-skill-leaderboard-card" ref={marketListRef} onScroll={onScrollMarket}>
          <div className="gt-skill-market-toolbar">
            <div className="gt-skill-searchbox">
              <span aria-hidden="true">⌕</span>
              <input
                placeholder={searchStrategy === "ai" ? "Describe what you want to build or automate..." : "Search skills, sources, descriptions..."}
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void onSearch();
                }}
              />
            </div>
          </div>
          <div className="gt-skill-filterbar">
            <div className="gt-skill-mode-toggle" aria-label="搜索模式">
              {([
                ["keyword", "关键词"],
                ["ai", "AI 语义"]
              ] as Array<[OpencodeSkillSearchStrategy, string]>).map(([strategy, label]) => (
                <button key={strategy} type="button" className={searchStrategy === strategy ? "active" : ""} onClick={() => onSearchStrategyChange(strategy)}>{label}</button>
              ))}
            </div>
            <span className="gt-skill-filter-hint">
              {searchStrategy === "ai"
                ? (skillsmpApiKey ? "AI 语义搜索已启用" : "未配置 key 时会自动回退关键词搜索")
                : `按 stars 排序，首屏展示 ${OPENCODE_SKILL_DISPLAY_BATCH_SIZE} 条`}
            </span>
          </div>
          <div className="gt-skill-market-tabs">
            {([
              ["all-time", `All Time${catalogTotal ? ` (${formatSkillInstalls(catalogTotal)})` : ""}`],
              ["trending", "Trending (24h)"],
              ["hot", "Hot"],
              ["official", "Official"]
            ] as Array<[OpencodeSkillCatalogView, string]>).map(([view, label]) => (
              <button key={view} type="button" className={catalogView === view && searchResults.length === 0 ? "active" : ""} onClick={() => onSwitchCatalogView(view)}>{label}</button>
            ))}
          </div>
          {skillsError ? <div className="gt-module-empty danger">{skillsError}</div> : null}
          {skillInstallNotice ? <div className="gt-skill-inline-error">{skillInstallNotice}</div> : null}
          {(skillBusy || skillInstallingSpec || skillInstallLog) ? (
            <div className="gt-skill-install-log">
              <div><strong>Install log</strong><span>{skillInstallingSpec || "last install"}</span></div>
              <pre>{skillInstallLog || `正在启动安装 ${skillInstallingSpec || "skill"}...`}</pre>
            </div>
          ) : null}
          <div className="gt-skill-market-meta">
            <span>
              {searchResults.length > 0
                ? `Search · ${searchMeta?.searchType || "skillsmp"} · ${searchMeta?.count || searchResults.length} results`
                : marketplaceRows.length > 0
                  ? `${catalogView} leaderboard · page ${catalogPage + 1}`
                  : initialLoading
                    ? "正在整理 Skills 市场首页..."
                    : "展示本地推荐榜单"}
            </span>
          </div>
          {initialLoading ? (
            <div className="gt-skill-skeleton-list" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, idx) => <span key={idx} />)}
            </div>
          ) : visibleMarketplaceRows.length > 0 ? (
            <>
              <div className={searching || paging ? "gt-skill-card-list is-loading" : "gt-skill-card-list"}>
                <OpencodeMarketplaceCards
                  rows={visibleMarketplaceRows}
                  selectedSpec={selectedMarketplaceSkill?.spec}
                  installingSpec={skillInstallingSpec}
                  installLog={skillInstallLog}
                  busy={skillBusy}
                  onSelectSkill={onSelectMarketplaceSkill}
                  onInstallSkill={onInstallMarketplaceSkill}
                />
              </div>
              {(searching || paging) ? (
                <div className="gt-skill-skeleton-list gt-skill-inline-skeleton" aria-label="正在加载更多 skills">
                  {Array.from({ length: 2 }).map((_, idx) => <span key={idx} />)}
                </div>
              ) : null}
            </>
          ) : (
            <div className="gt-skill-inspector-empty gt-skill-empty-state"><strong>没有找到匹配的 Skill</strong><span>试试切回关键词搜索、清空分类，或者改用更通用的描述词。</span></div>
          )}
          <div className="gt-skill-market-pager">
            <span>{initialLoading ? "首次进入时会先准备精选榜单与已安装列表" : `已显示 ${visibleMarketplaceRows.length} / ${marketplaceRows.length}`}</span>
            {initialLoading ? <span className="muted">正在为你整理首页内容...</span> : paging ? <span className="gt-skill-auto-load is-loading">Loading more...</span> : canAutoLoadMore ? <span className="gt-skill-auto-load">滑到底部自动加载更多</span> : <span className="gt-skill-auto-load is-done">已到底部</span>}
          </div>
        </main>

        <aside className="gt-skill-inspector-card">
          {selectedMarketplaceSkill ? (
            <>
              <div className="gt-skill-inspector-head">
                <span className="gt-module-kicker">selected skill</span>
                <h3>{selectedMarketplaceSkill.skill}</h3>
                <p>{selectedMarketplaceSkill.package}</p>
                <span className={`gt-skill-quality ${skillQualityLabel(selectedMarketplaceSkill)}`}>{skillQualityLabel(selectedMarketplaceSkill)}</span>
              </div>
              <div className="gt-skill-inspector-actions gt-skill-install-wrap">
                <button className="chip primary" onClick={onToggleSkillInstallMenu} disabled={skillBusy}>{skillBusy ? "安装中..." : "安装"}</button>
                {showSkillInstallMenu ? (
                  <div className="gt-skill-install-menu">
                    <button type="button" onClick={() => void onInstallSelectedMarketplaceSkill("project")}>安装到当前 Repo</button>
                    <button type="button" onClick={() => void onInstallSelectedMarketplaceSkill("global")}>安装到 Global</button>
                  </div>
                ) : null}
                <button className="chip" onClick={() => void onLoadSelectedSkillDetails()} disabled={selectedSkillLoading}>查看详情</button>
              </div>
              <div className="gt-skill-inspector-stats">
                <span><strong>{selectedMarketplaceSkill.installs}</strong>Installs</span>
                <span><strong>{selectedSkillDetail?.files?.length || 0}</strong>Files</span>
                <span><strong>{selectedSkillAudits.length}</strong>Audits</span>
              </div>
              {selectedSkillLoading ? <div className="gt-module-empty">正在加载详情...</div> : null}
              <div className="gt-skill-audit-list">
                {selectedSkillAudits.length === 0 ? <div className="gt-module-empty">点击“查看详情”后加载文件快照和安全审计。</div> : null}
                {selectedSkillAudits.map((audit) => <div key={`${audit.provider}-${audit.slug}`} className={`gt-skill-audit-row ${audit.status}`}><strong>{audit.provider}</strong><span>{audit.riskLevel || audit.status}</span><p>{audit.summary || "No summary"}</p></div>)}
              </div>
              <div className="gt-skill-file-list">
                {(selectedSkillDetail?.files || []).slice(0, 8).map((file) => <div key={file.path}><strong>{file.path}</strong><span>{file.contents.split(/\r?\n/).length} lines</span></div>)}
              </div>
            </>
          ) : (
            <div className="gt-skill-inspector-empty"><strong>选择一个 Skill</strong><span>查看来源、质量信号，并像插件市场一样直接安装。</span></div>
          )}
          <div className="gt-installed-skills-mini">
            <div className="gt-installed-skills-head"><div><strong>已安装</strong><span>{groups.length} 组 / {skills.length} skills</span></div><button className="chip" onClick={() => void onRefreshSkills()} disabled={skillsLoading}>刷新</button></div>
            {groups.slice(0, 6).map((group) => (
              <button type="button" key={group.name} className="gt-installed-skill-row is-reference" onClick={() => onReferenceSkill(group.items[0])}>
                <div><strong>{group.name}</strong><span>{group.items.length > 1 ? `${group.items.length} 个子 Skills` : (group.items[0]?.name || INSTALLED_VIA_SKILLS_DESCRIPTION)}</span></div>
                <span className="gt-scope-badge project">{group.items.length} 项</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
