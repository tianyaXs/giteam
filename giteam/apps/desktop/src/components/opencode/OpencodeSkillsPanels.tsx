import { useState, type ReactNode, type Ref } from "react";
import { ChevronDown, Search } from "lucide-react";
import { RefreshIcon, StarIcon } from "../icons";
import {
  INSTALLED_VIA_SKILLS_DESCRIPTION,
  type OpencodeInstalledSkillGroup,
  type OpencodeSkillInfo
} from "../../lib/opencodeSkillData";
import { type OpencodeSkillSearchResult } from "../../lib/opencodeSkillMarketplace";
import type {
  OpencodeSkillCatalogView,
  OpencodeSkillSearchMeta,
  OpencodeSkillSearchStrategy
} from "../../lib/useOpencodeSkillMarketplace";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { Skeleton } from "../ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { cn } from "@/lib/utils";

const skillSelectedSurface = "bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)]";
const skillToggleItemClass = "data-[state=on]:bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] data-[state=on]:text-foreground hover:bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)] hover:text-foreground";

function ModuleEmpty({ children, danger = false }: { children: string; danger?: boolean }) {
  return (
    <Empty className={cn("min-h-24 flex-none border border-dashed border-border bg-muted/30 p-4 md:p-6", danger && "border-destructive/40 bg-destructive/10")}>
      <EmptyHeader>
        <EmptyTitle className="text-sm">{danger ? "出现问题" : children}</EmptyTitle>
        {danger ? <EmptyDescription>{children}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}

function ScopeBadge({ scope, children }: { scope?: string; children?: ReactNode }) {
  const variant = scope === "global" ? "default" : scope === "project" ? "secondary" : "outline";

  return (
    <Badge variant={variant} className="shrink-0 rounded-md normal-case tracking-normal">
      {children || getSkillScopeLabel(scope)}
    </Badge>
  );
}

function SkillSkeletonList({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-md" />
      ))}
    </div>
  );
}

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
    return <ModuleEmpty>暂无已安装 Skills</ModuleEmpty>;
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
        <Card key={group.name} className="rounded-lg p-2 shadow-none">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="h-auto min-w-0 flex-1 justify-between gap-3 p-2 text-left"
              onClick={() => onReferenceSkill(skill)}
              title={`Use ${skill.name}`}
            >
              <div className="grid min-w-0 gap-1">
                <strong className="truncate text-base font-semibold">{skill.name}</strong>
                <small className="truncate text-[14px] text-muted-foreground">{skill.path || skill.location || skill.description || INSTALLED_VIA_SKILLS_DESCRIPTION}</small>
              </div>
              <ScopeBadge scope={scope} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              disabled={group.removableItems.length === 0 || removing}
              onClick={() => void onRemoveSkill(skill)}
              title={group.removableItems.length === 0 ? "该技能不可删除" : `删除 ${skill.name}`}
            >
              {removing ? "删除中..." : "删除"}
            </Button>
          </div>
        </Card>
      );
    }

    return (
      <Collapsible key={group.name} className="rounded-lg border border-border bg-card p-2 text-card-foreground">
        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="h-auto min-w-0 flex-1 justify-between gap-3 p-2 text-left"
              title={group.name}
            >
              <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <div className="grid min-w-0 gap-1">
                  <strong className="truncate text-base font-semibold">{group.name}</strong>
                  <small className="truncate text-[14px] text-muted-foreground">{group.description}</small>
                </div>
                <Badge variant="secondary" className="shrink-0 normal-case tracking-normal">{group.items.length} 项</Badge>
              </div>
              <ChevronDown aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            disabled={group.removableItems.length === 0 || removing}
            onClick={() => void onRemoveSkillGroup(group)}
            title={group.removableItems.length === 0 ? "该目录下没有可删除的已安装项" : `删除 ${group.name}`}
          >
            {removing ? "删除中..." : "删除"}
          </Button>
        </div>
        <CollapsibleContent className="mt-2 grid gap-2 border-t border-border pt-2">
          {group.items.map((skill) => {
            const scope = skill.scope || "source";
            return (
              <Button
                key={getSkillRemoveKey(skill)}
                variant="ghost"
                className="h-auto justify-between gap-3 p-2 text-left"
                onClick={() => onReferenceSkill(skill)}
                title={`Use ${skill.name}`}
              >
                <div className="grid min-w-0 gap-1">
                  <strong className="truncate text-base font-semibold">{skill.name}</strong>
                  <small className="truncate text-[14px] text-muted-foreground">{skill.path || skill.location || skill.description || INSTALLED_VIA_SKILLS_DESCRIPTION}</small>
                </div>
                <ScopeBadge scope={scope} />
              </Button>
            );
          })}
        </CollapsibleContent>
      </Collapsible>
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

    return (
      <div
        key={result.id || result.spec}
        className={cn(
          "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border/70 px-1 py-2 transition-colors last:border-b-0",
          selectedSpec === result.spec && cn("rounded-md border-b-transparent", skillSelectedSurface)
        )}
      >
        <Button
          variant="ghost"
          className="h-auto min-w-0 justify-start gap-3 rounded-md p-2 text-left hover:bg-transparent hover:text-foreground"
          onClick={() => void onSelectSkill(result)}
        >
          <span className="w-7 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
          <div className="grid min-w-0 flex-1 gap-1">
            <strong className="truncate text-base font-semibold">{result.skill}</strong>
            <small className="truncate text-[14px] text-muted-foreground">{result.package}</small>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-xs text-muted-foreground">{resultInstallSpec}</span>
            </div>
          </div>
          <div className="hidden min-w-28 justify-items-end gap-1 md:grid">
            <b className="inline-flex items-center gap-1 text-[14px] font-semibold"><StarIcon width={14} height={14} /> {result.installs}</b>
            {typeof result.change === "number" ? <small className="text-[14px] text-muted-foreground">{result.change >= 0 ? "+" : ""}{result.change} today</small> : null}
          </div>
        </Button>
        <Button
          variant={isInstallingThisSkill ? "secondary" : "outline"}
          size="sm"
          className="shrink-0"
          disabled={isInstallingThisSkill || busy}
          onClick={(event) => {
            event.stopPropagation();
            if (busy) return;
            void onInstallSkill(resultInstallSpec);
          }}
        >
          {isInstallingThisSkill ? "Installing" : "Get"}
        </Button>
        {isInstallingThisSkill ? (
          <pre className="col-span-full max-h-24 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-[14px] text-muted-foreground">
            {installLog || "正在启动安装日志..."}
          </pre>
        ) : null}
      </div>
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
    <div className="flex flex-col gap-3">
      {error ? <ModuleEmpty danger>{error}</ModuleEmpty> : null}
      <div className="grid gap-2">
        {groups.length === 0 ? <ModuleEmpty>暂无已安装 Skills。</ModuleEmpty> : groups.map((group) => {
          const removing = group.removableItems.some((skill) => removingKey === getSkillRemoveKey(skill));
          return (
            <Card key={group.name} className="rounded-lg shadow-none">
              <CardContent className="flex items-center gap-2 p-2">
                <div className="grid min-w-0 flex-1 gap-1 p-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <strong className="truncate text-base font-semibold">{group.name}</strong>
                    <Badge variant="secondary" className="shrink-0 normal-case tracking-normal">{group.items.length} 项</Badge>
                  </div>
                  <p className="m-0 truncate text-[14px] text-muted-foreground">{group.description}</p>
                </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`${group.name} actions`} title="Actions">
                    <span aria-hidden="true">...</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => void onRemoveSkillGroup(group)}
                      disabled={group.removableItems.length === 0 || removing}
                      title={group.removableItems.length > 0 ? "Uninstall skill group" : "Source skills need to be removed from source config"}
                    >
                      {removing ? "Removing" : "Uninstall"}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              </CardContent>
            </Card>
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
  searchMeta: OpencodeSkillSearchMeta | null;
  selectedMarketplaceSkill: OpencodeSkillSearchResult | null;
  marketplaceRows: OpencodeSkillSearchResult[];
  visibleMarketplaceRows: OpencodeSkillSearchResult[];
  initialLoading: boolean;
  searching: boolean;
  paging: boolean;
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void | Promise<void>;
  onSearchStrategyChange: (value: OpencodeSkillSearchStrategy) => void;
  onSwitchCatalogView: (value: OpencodeSkillCatalogView) => void;
  onRefreshSkills: () => void | Promise<void>;
  onScrollMarket: () => void;
  onSelectMarketplaceSkill: (skill: OpencodeSkillSearchResult) => void | Promise<void>;
  onInstallMarketplaceSkill: (spec: string) => void | Promise<void>;
  onInstallSelectedMarketplaceSkill: (scope: "project" | "global") => void | Promise<void>;
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
    searchMeta,
    selectedMarketplaceSkill,
    marketplaceRows,
    visibleMarketplaceRows,
    initialLoading,
    searching,
    paging,
    onSearchQueryChange,
    onSearch,
    onSearchStrategyChange,
    onSwitchCatalogView,
    onRefreshSkills,
    onScrollMarket,
    onSelectMarketplaceSkill,
    onInstallMarketplaceSkill,
    onInstallSelectedMarketplaceSkill,
    onReferenceSkill,
    onRemoveSkill,
    onRemoveSkillGroup
  } = props;
  const [marketTab, setMarketTab] = useState<OpencodeSkillCatalogView | "installed">("all-time");
  const installedView = marketTab === "installed";
  const activeMarketValue = installedView ? "installed" : catalogView;

  return (
    <div className="min-h-0">
      <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 overflow-auto rounded-md border border-border bg-background p-3" ref={marketListRef} onScroll={onScrollMarket}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3">
              <Search aria-hidden="true" className="text-muted-foreground" />
              <Input
                className="h-9 rounded-md border-0 bg-transparent shadow-none focus-visible:border-transparent focus-visible:ring-0"
                placeholder={searchStrategy === "ai" ? "Describe what you want to build or automate..." : "Search skills, sources, descriptions..."}
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void onSearch();
                }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
            <ToggleGroup
              type="single"
              value={searchStrategy}
              onValueChange={(value) => {
                if (!value) return;
                onSearchStrategyChange(value as OpencodeSkillSearchStrategy);
              }}
              className="justify-start"
              aria-label="搜索模式"
            >
              {([
                ["keyword", "关键词"],
                ["ai", "AI 语义"]
              ] as Array<[OpencodeSkillSearchStrategy, string]>).map(([strategy, label]) => (
                <ToggleGroupItem key={strategy} value={strategy} className={skillToggleItemClass}>{label}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <Separator />
          <ToggleGroup
            type="single"
            value={activeMarketValue}
            onValueChange={(value) => {
              if (!value) return;
              if (value === "installed") {
                setMarketTab("installed");
                return;
              }
              const next = value as OpencodeSkillCatalogView;
              setMarketTab(next);
              onSwitchCatalogView(next);
            }}
            className="flex-wrap justify-start py-3"
            aria-label="Skill 分类"
          >
            <ToggleGroupItem value="installed" className={skillToggleItemClass}>已安装</ToggleGroupItem>
            <ToggleGroupItem value="all-time" className={skillToggleItemClass}>全部</ToggleGroupItem>
            <ToggleGroupItem value="trending" className={skillToggleItemClass}>趋势</ToggleGroupItem>
            <ToggleGroupItem value="hot" className={skillToggleItemClass}>热门</ToggleGroupItem>
            <ToggleGroupItem value="official" className={skillToggleItemClass}>官方</ToggleGroupItem>
          </ToggleGroup>
          {skillsError ? <ModuleEmpty danger>{skillsError}</ModuleEmpty> : null}
          {skillInstallNotice ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{skillInstallNotice}</div> : null}
          {(skillBusy || skillInstallingSpec || skillInstallLog) ? (
            <Card className="rounded-lg shadow-none">
              <CardHeader className="flex-row items-center justify-between gap-3 p-3">
                <CardTitle>Install log</CardTitle>
                <Badge variant="secondary" className="normal-case tracking-normal">{skillInstallingSpec || "last install"}</Badge>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <pre className="max-h-32 overflow-auto rounded-md bg-muted/40 p-2 text-[14px] text-muted-foreground">{skillInstallLog || `正在启动安装 ${skillInstallingSpec || "skill"}...`}</pre>
              </CardContent>
            </Card>
          ) : null}
          <div className="flex flex-col gap-2 py-2 md:flex-row md:items-center md:justify-between">
            <span className="text-[14px] text-muted-foreground">
              {installedView
                ? `已安装 ${skills.length}`
                : searchResults.length > 0
                  ? `搜索结果 ${searchMeta?.count || searchResults.length}`
                  : marketplaceRows.length > 0
                    ? "Skills 市场"
                    : initialLoading
                      ? "加载中"
                      : "推荐"}
            </span>
            {installedView ? (
              <Button variant="ghost" size="sm" onClick={() => void onRefreshSkills()} disabled={skillsLoading}>
                <RefreshIcon />
                刷新
              </Button>
            ) : null}
          </div>
          {installedView ? (
            <div className="grid gap-2">
              <OpencodeInstalledSkillGroups
                groups={groups}
                removingKey={removingKey}
                onReferenceSkill={onReferenceSkill}
                onRemoveSkill={onRemoveSkill}
                onRemoveSkillGroup={onRemoveSkillGroup}
              />
            </div>
          ) : initialLoading ? (
            <SkillSkeletonList />
          ) : visibleMarketplaceRows.length > 0 ? (
            <>
              <div className={cn("grid gap-2", (searching || paging) && "opacity-70")}>
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
                <SkillSkeletonList rows={2} />
              ) : null}
            </>
          ) : (
            <Empty className="min-h-48 flex-none border border-dashed border-border bg-muted/30">
              <EmptyHeader>
                <EmptyTitle>没有找到匹配的 Skill</EmptyTitle>
                <EmptyDescription>试试切回关键词搜索、清空分类，或者改用更通用的描述词。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>

        <div className="min-h-0 rounded-md border border-border bg-background p-3">
          {selectedMarketplaceSkill ? (
            <div className="flex flex-col gap-3">
              <div className="grid gap-1">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <strong className="truncate text-base font-semibold">{selectedMarketplaceSkill.skill}</strong>
                </div>
                <span className="truncate text-[14px] text-muted-foreground">{selectedMarketplaceSkill.package}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="contrast" size="sm" disabled={skillBusy}>
                      {skillBusy ? "安装中..." : "安装"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => void onInstallSelectedMarketplaceSkill("project")}>安装到当前 Repo</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void onInstallSelectedMarketplaceSkill("global")}>安装到 Global</DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Separator />
              <div className="grid gap-1 text-[14px] text-muted-foreground">
                <span className="flex items-center gap-1"><StarIcon width={14} height={14} /><strong className="text-foreground">{selectedMarketplaceSkill.installs}</strong> Stars</span>
              </div>
            </div>
          ) : (
            <Empty className="min-h-48 flex-none border border-dashed border-border bg-muted/30">
              <EmptyHeader>
                <EmptyTitle>选择一个 Skill</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
          <Separator className="my-3" />
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="grid gap-1">
                <strong className="text-base font-semibold">已安装</strong>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void onRefreshSkills()} disabled={skillsLoading}>刷新</Button>
            </div>
            {groups.slice(0, 6).map((group) => (
              <Button variant="ghost" key={group.name} className="h-auto justify-between gap-3 p-2 text-left" onClick={() => onReferenceSkill(group.items[0])}>
                <div className="grid min-w-0 gap-1">
                  <strong className="truncate text-base font-semibold">{group.name}</strong>
                  <span className="truncate text-[14px] text-muted-foreground">{group.items.length > 1 ? `${group.items.length} 个子 Skills` : (group.items[0]?.name || INSTALLED_VIA_SKILLS_DESCRIPTION)}</span>
                </div>
                <ScopeBadge scope="project">{group.items.length} 项</ScopeBadge>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
