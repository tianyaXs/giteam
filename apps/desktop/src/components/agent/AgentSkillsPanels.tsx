import { useState, type ReactNode, type Ref } from "react";
import { ChevronDown, Search } from "lucide-react";
import { RefreshIcon, StarIcon } from "../icons";
import {
  INSTALLED_VIA_SKILLS_DESCRIPTION,
  type AgentInstalledSkillGroup,
  type AgentSkillInfo
} from "../../lib/agentSkillData";
import { type AgentSkillSearchResult } from "../../lib/agentSkillMarketplace";
import type {
  AgentSkillCatalogView,
  AgentSkillSearchMeta
} from "../../lib/useAgentSkillMarketplace";
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

function getSkillRemoveKey(skill: AgentSkillInfo) {
  return `${skill.scope || "source"}:${skill.name}:${skill.path || skill.location || ""}`;
}

type InstalledSkillGroupsProps = {
  groups: AgentInstalledSkillGroup[];
  removingKey: string;
  onReferenceSkill: (skill: AgentSkillInfo) => void;
  onRemoveSkill: (skill: AgentSkillInfo) => void | Promise<void>;
  onRemoveSkillGroup: (group: AgentInstalledSkillGroup) => void | Promise<void>;
};

export function AgentInstalledSkillGroups(props: InstalledSkillGroupsProps) {
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
  rows: AgentSkillSearchResult[];
  selectedSpec?: string;
  installingSpec: string;
  installLog: string;
  busy: boolean;
  onSelectSkill: (skill: AgentSkillSearchResult) => void | Promise<void>;
  onInstallSkill: (spec: string) => void | Promise<void>;
};

export function AgentMarketplaceCards(props: MarketplaceCardsProps) {
  const { rows, selectedSpec, installingSpec, installLog, busy, onSelectSkill, onInstallSkill } = props;

  return rows.map((result, index) => {
    const resultInstallSpec = result.installSpec || result.spec;
    const isInstallingThisSkill = installingSpec === resultInstallSpec || installingSpec === result.spec;
    const installsText = String(result.installs || "");
    const isBuiltIn = resultInstallSpec.startsWith("giteam-builtin:");

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
            <b className="inline-flex items-center gap-1 text-[14px] font-semibold">
              {isBuiltIn ? null : <StarIcon width={14} height={14} />}
              {installsText}
            </b>
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
  groups: AgentInstalledSkillGroup[];
  removingKey: string;
  onRemoveSkillGroup: (group: AgentInstalledSkillGroup) => void | Promise<void>;
};

export function AgentSettingsSkillsGrid(props: SettingsSkillsGridProps) {
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
  groups: AgentInstalledSkillGroup[];
  skills: AgentSkillInfo[];
  skillsLoading: boolean;
  skillsError: string;
  removingKey: string;
  skillBusy: boolean;
  skillInstallingSpec: string;
  skillInstallNotice: string;
  skillInstallLog: string;
  marketListRef: Ref<HTMLDivElement>;
  searchQuery: string;
  searchResults: AgentSkillSearchResult[];
  catalogView: AgentSkillCatalogView;
  searchMeta: AgentSkillSearchMeta | null;
  selectedMarketplaceSkill: AgentSkillSearchResult | null;
  marketplaceRows: AgentSkillSearchResult[];
  visibleMarketplaceRows: AgentSkillSearchResult[];
  initialLoading: boolean;
  searching: boolean;
  paging: boolean;
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void | Promise<void>;
  onSwitchCatalogView: (value: AgentSkillCatalogView) => void;
  onRefreshSkills: () => void | Promise<void>;
  onScrollMarket: () => void;
  onSelectMarketplaceSkill: (skill: AgentSkillSearchResult) => void | Promise<void>;
  onInstallMarketplaceSkill: (spec: string) => void | Promise<void>;
  onInstallSelectedMarketplaceSkill: (scope: "project" | "global") => void | Promise<void>;
  onReferenceSkill: (skill: AgentSkillInfo) => void;
  onRemoveSkill: (skill: AgentSkillInfo) => void | Promise<void>;
  onRemoveSkillGroup: (group: AgentInstalledSkillGroup) => void | Promise<void>;
};

export function AgentSkillsMarketPanel(props: SkillsMarketPanelProps) {
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
  const [marketTab, setMarketTab] = useState<AgentSkillCatalogView | "installed">("all-time");
  const installedView = marketTab === "installed";
  const activeMarketValue = installedView ? "installed" : catalogView;

  return (
    <div className="min-h-0">
      <div className="min-h-0 overflow-auto rounded-md border border-border bg-background p-3" ref={marketListRef} onScroll={onScrollMarket}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3">
            <Search aria-hidden="true" className="text-muted-foreground" />
            <Input
              className="h-9 rounded-md border-0 bg-transparent shadow-none focus-visible:border-transparent focus-visible:ring-0"
              placeholder="Search skills, sources, descriptions..."
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void onSearch();
              }}
            />
          </div>
        </div>
        <Separator className="mt-3" />
        <ToggleGroup
          type="single"
          value={activeMarketValue}
          onValueChange={(value) => {
            if (!value) return;
            if (value === "installed") {
              setMarketTab("installed");
              return;
            }
            const next = value as AgentSkillCatalogView;
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
            <AgentInstalledSkillGroups
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
              <AgentMarketplaceCards
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
    </div>
  );
}
