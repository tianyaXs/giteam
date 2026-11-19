import { normalizeModelRef, resolveProviderAliasWithNames } from "../../lib/agentModels";
import {
  isOpenAICompatibleProviderId,
  OPENAI_COMPATIBLE_PROVIDER_ID,
} from "../../lib/agentProviderCatalog";
import { PlusIcon } from "../icons";
import { AgentProviderModelList } from "./AgentProviderModelList";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type AgentProviderSettingsPanelProps = {
  providerSearch: string;
  modelSearch: string;
  /** 外层列表：仅已配置（已连接）的供应商 */
  providers: string[];
  /** 新增下拉：尚未配置的可选供应商（含 OpenAI Completions 模板） */
  availableProviders: string[];
  selectedProvider: string;
  connectedProviders: string[];
  providerNames: Record<string, string>;
  modelCountsByProvider: Record<string, number>;
  modelsByProvider: Record<string, string[]>;
  configuredModelsByProvider: Record<string, string[]>;
  configuredModelNamesByProvider: Record<string, Record<string, string>>;
  modelNamesByProvider: Record<string, Record<string, string>>;
  activeModel: string;
  hiddenModels: Set<string>;
  enabledModels: Set<string>;
  connectBusy: boolean;
  connectProviderId: string;
  connectApiKey: string;
  connectBaseUrl: string;
  connectName: string;
  inlineAuthOpenFor: string;
  onProviderSearchChange: (value: string) => void;
  onModelSearchChange: (value: string) => void;
  onSelectProvider: (provider: string, connected: boolean) => void;
  onConnectApiKeyChange: (providerId: string, providerName: string, value: string) => void;
  onConnectBaseUrlChange: (providerId: string, providerName: string, value: string) => void;
  onConnectNameChange: (providerId: string, providerName: string, value: string) => void;
  resolveProviderBaseUrlHint: (providerId: string) => string;
  onToggleInlineAuth: (providerId: string, providerName: string) => void;
  onConnectProvider: (providerId: string, connected: boolean) => void;
  onRemoveCustomProvider: (providerId: string) => void;
  removingProvider: string;
  onSelectModel: (modelRef: string) => void;
  onHideModel: (modelRef: string) => void;
  onEnableModel: (modelRef: string) => void;
  getProviderTag: (providerId: string) => string;
  canRemoveCustomProvider: (providerId: string) => boolean;
  getProviderDisplayName: (providerId: string) => string;
};

export function AgentProviderSettingsPanel({
  providerSearch,
  modelSearch,
  providers,
  availableProviders,
  selectedProvider,
  connectedProviders,
  providerNames,
  modelCountsByProvider,
  modelsByProvider,
  configuredModelsByProvider,
  configuredModelNamesByProvider,
  modelNamesByProvider,
  activeModel,
  hiddenModels,
  enabledModels,
  connectBusy,
  connectProviderId,
  connectApiKey,
  connectBaseUrl,
  connectName,
  inlineAuthOpenFor,
  onProviderSearchChange,
  onModelSearchChange,
  onSelectProvider,
  onConnectApiKeyChange,
  onConnectBaseUrlChange,
  onConnectNameChange,
  resolveProviderBaseUrlHint,
  onToggleInlineAuth,
  onConnectProvider,
  onRemoveCustomProvider,
  removingProvider,
  onSelectModel,
  onHideModel,
  onEnableModel,
  getProviderTag,
  canRemoveCustomProvider,
  getProviderDisplayName,
}: AgentProviderSettingsPanelProps) {
  const [confirmRemoveFor, setConfirmRemoveFor] = useState("");
  const [adding, setAdding] = useState(false);
  const [addProviderQuery, setAddProviderQuery] = useState("");
  const [addPickerOpen, setAddPickerOpen] = useState(true);

  const panelHeight = "h-[clamp(380px,calc(100svh-210px),760px)]";

  const configuredQuery = providerSearch.trim().toLowerCase();
  const configuredList = useMemo(() => {
    if (!configuredQuery) return providers;
    return providers.filter((id) => {
      const name = getProviderDisplayName(id).toLowerCase();
      return id.toLowerCase().includes(configuredQuery) || name.includes(configuredQuery);
    });
  }, [configuredQuery, getProviderDisplayName, providers]);

  const addOptions = useMemo(() => {
    const q = addProviderQuery.trim().toLowerCase();
    if (!q) return availableProviders;
    return availableProviders.filter((id) => {
      const name = getProviderDisplayName(id).toLowerCase();
      return id.toLowerCase().includes(q) || name.includes(q);
    });
  }, [addProviderQuery, availableProviders, getProviderDisplayName]);

  const resolved = resolveProviderAliasWithNames(selectedProvider, modelsByProvider, providerNames);
  const cfgResolved = resolveProviderAliasWithNames(selectedProvider, configuredModelsByProvider, providerNames);
  const providerId = adding
    ? (connectProviderId.trim() || availableProviders[0] || OPENAI_COMPATIBLE_PROVIDER_ID)
    : ((resolved || selectedProvider.trim()) || "");
  const configuredProviderId = (cfgResolved || providerId) || "";
  const pool = (providerId && !adding ? (modelsByProvider[providerId] ?? []) : []).slice().sort((a, b) => a.localeCompare(b));
  const modelQuery = modelSearch.trim().toLowerCase();
  const filteredModels = modelQuery ? pool.filter((model) => model.toLowerCase().includes(modelQuery)) : pool;
  const connected = !adding && connectedProviders.includes(providerId);
  const providerName = getProviderDisplayName(providerId);
  const keyValue = connectProviderId === providerId ? connectApiKey : "";
  const authOpen = adding || !connected || inlineAuthOpenFor === providerId;
  const confirmRemove = confirmRemoveFor === providerId;

  const activeNorm = normalizeModelRef(activeModel);
  const defaultModelLabel = useMemo(() => {
    if (!providerId || !activeNorm || adding) return "";
    if (!activeNorm.startsWith(`${providerId}/`)) return "";
    const modelId = activeNorm.slice(providerId.length + 1);
    return (
      modelNamesByProvider[providerId]?.[modelId]
      || configuredModelNamesByProvider[configuredProviderId]?.[modelId]
      || configuredModelNamesByProvider[providerId]?.[modelId]
      || modelId
    );
  }, [
    activeNorm,
    adding,
    configuredModelNamesByProvider,
    configuredProviderId,
    modelNamesByProvider,
    providerId,
  ]);

  const enabledCount = useMemo(() => {
    if (!providerId || adding) return 0;
    let count = 0;
    for (const modelId of pool) {
      const ref = normalizeModelRef(`${providerId}/${modelId}`);
      if (ref && enabledModels.has(ref) && !hiddenModels.has(ref)) count += 1;
    }
    return count;
  }, [adding, enabledModels, hiddenModels, pool, providerId]);

  function setAllModelsVisible(visible: boolean) {
    if (!providerId) return;
    for (const modelId of filteredModels) {
      const ref = normalizeModelRef(`${providerId}/${modelId}`);
      if (!ref) continue;
      const on = enabledModels.has(ref) && !hiddenModels.has(ref);
      if (visible && !on) onEnableModel(ref);
      if (!visible && on) onHideModel(ref);
    }
  }

  useEffect(() => {
    setConfirmRemoveFor("");
  }, [providerId, adding]);

  // 保存成功后 selected 会切到已配置项 → 退出新增态
  useEffect(() => {
    if (!adding) return;
    if (selectedProvider && providers.includes(selectedProvider)) {
      setAdding(false);
      setAddProviderQuery("");
    }
  }, [adding, providers, selectedProvider]);

  // 进入设置时若未选中已配置项，自动选第一个
  useEffect(() => {
    if (adding) return;
    if (providers.length === 0) return;
    if (selectedProvider && providers.includes(selectedProvider)) return;
    onSelectProvider(providers[0], true);
    // onSelectProvider 来自 App 内联闭包，不列入 deps，避免无意义重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding, providers, selectedProvider]);

  function beginAdd(preferredId?: string) {
    const nextId =
      preferredId
      || availableProviders.find((id) => id === OPENAI_COMPATIBLE_PROVIDER_ID)
      || availableProviders[0]
      || OPENAI_COMPATIBLE_PROVIDER_ID;
    setAdding(true);
    setAddProviderQuery("");
    setAddPickerOpen(true);
    setConfirmRemoveFor("");
    onSelectProvider(nextId, false);
  }

  function selectConfigured(id: string) {
    setAdding(false);
    setAddProviderQuery("");
    setAddPickerOpen(false);
    onSelectProvider(id, connectedProviders.includes(id));
  }

  function pickAddProvider(id: string) {
    onSelectProvider(id, false);
    setAddPickerOpen(false);
    setAddProviderQuery("");
  }

  const isCompat = isOpenAICompatibleProviderId(providerId);
  const canSave =
    !connectBusy
    && connectProviderId === providerId
    && !!connectApiKey.trim()
    && (!isCompat || (!!connectBaseUrl.trim() && !!connectName.trim()));

  return (
    <div className={`grid min-h-0 gap-5 xl:grid-cols-[minmax(280px,320px)_minmax(0,1fr)] ${panelHeight}`}>
      {/* 左：已配置供应商 */}
      <section className="flex min-h-0 flex-col rounded-xl border border-black/[0.06] bg-card p-3 shadow-[var(--gt-elev-card)] dark:border-transparent dark:bg-secondary/25 dark:shadow-none">
        <div className="mb-3 flex items-center gap-2">
          <Input
            className="h-9 border-transparent bg-background/80 px-3 text-[13px] shadow-none focus-visible:border-border"
            placeholder="搜索已配置…"
            value={providerSearch}
            onChange={(event) => onProviderSearchChange(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            className="h-9 shrink-0 gap-1.5 px-3 text-[13px]"
            onClick={() => beginAdd()}
            disabled={availableProviders.length === 0 && !adding}
          >
            <PlusIcon className="size-3.5" />
            新增
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-0.5 pr-1">
            {configuredList.length === 0 ? (
              <Empty className="min-h-48 border-0 p-4">
                <EmptyHeader>
                  <EmptyTitle>尚未配置供应商</EmptyTitle>
                  <EmptyDescription>点击「新增」选择供应商并填写参数后保存。</EmptyDescription>
                </EmptyHeader>
                <Button className="mt-3 h-9 gap-1.5 px-3 text-[13px]" variant="contrast" onClick={() => beginAdd()}>
                  <PlusIcon className="size-3.5" />
                  新增供应商
                </Button>
              </Empty>
            ) : (
              configuredList.map((id) => {
                const selected = !adding && selectedProvider === id;
                const count = modelCountsByProvider[id] || 0;
                return (
                  <button
                    key={`configured-${id}`}
                    type="button"
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "bg-muted text-foreground ring-1 ring-black/8 dark:bg-background dark:ring-white/10"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                    onClick={() => selectConfigured(id)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-1.5 shrink-0 rounded-full bg-[var(--success)]" aria-hidden />
                      <span className="truncate text-[13px] font-semibold leading-5 text-foreground">
                        {getProviderDisplayName(id)}
                      </span>
                    </span>
                    <span className="truncate pl-3.5 text-[11px] leading-4 text-muted-foreground">
                      {getProviderTag(id)} · {count} 模型
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </section>

      {/* 右：新增表单 / 详情 */}
      <section className="flex min-h-0 flex-col">
        {adding ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 px-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="m-0 text-[17px] font-semibold leading-7 text-foreground">新增供应商</h3>
                <p className="m-0 mt-1 text-[13px] leading-5 text-muted-foreground">
                  下拉选择供应商，填写参数后保存到本地配置。
                </p>
              </div>
              {providers.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 shrink-0 px-2 text-[13px] text-muted-foreground"
                  onClick={() => {
                    setAdding(false);
                    const fallback = providers.includes(selectedProvider) ? selectedProvider : providers[0];
                    if (fallback) selectConfigured(fallback);
                  }}
                >
                  取消
                </Button>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 rounded-xl bg-secondary/35 p-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">供应商</label>
                {/* 筛选框固定在列表外，避免 sticky 进滚动容器后位置跳动 */}
                <button
                  type="button"
                  className="flex h-10 w-full items-center justify-between rounded-lg bg-background px-3 text-left text-[14px] text-foreground shadow-[inset_0_0_0_1px_var(--chrome-line)] outline-none focus-visible:ring-2 focus-visible:ring-foreground/15"
                  onClick={() => setAddPickerOpen((open) => !open)}
                  aria-expanded={addPickerOpen}
                >
                  <span className="truncate">
                    {providerId === OPENAI_COMPATIBLE_PROVIDER_ID
                      ? `${getProviderDisplayName(providerId)} · 自定义端点`
                      : `${getProviderDisplayName(providerId)} · ${providerId}`}
                  </span>
                  <ChevronDown className={cn("size-4 shrink-0 opacity-50 transition-transform", addPickerOpen && "rotate-180")} />
                </button>
                {addPickerOpen ? (
                  <div className="flex h-64 flex-col overflow-hidden rounded-lg bg-background shadow-[inset_0_0_0_1px_var(--chrome-line)]">
                    <div className="shrink-0 border-b border-border/50 p-2">
                      <Input
                        className="h-8 border-transparent bg-secondary/60 px-2.5 text-[13px] shadow-none"
                        placeholder="筛选供应商…"
                        value={addProviderQuery}
                        onChange={(event) => setAddProviderQuery(event.target.value)}
                        autoFocus
                      />
                    </div>
                    <ScrollArea className="h-0 min-h-0 flex-1">
                      <div className="flex flex-col gap-0.5 p-1">
                        {addOptions.length === 0 ? (
                          <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">无匹配供应商</div>
                        ) : (
                          addOptions.map((id) => {
                            const selected = id === providerId;
                            const label = id === OPENAI_COMPATIBLE_PROVIDER_ID
                              ? `${getProviderDisplayName(id)} · 自定义端点`
                              : `${getProviderDisplayName(id)} · ${id}`;
                            return (
                              <button
                                key={`add-opt-${id}`}
                                type="button"
                                className={cn(
                                  "rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                                  selected
                                    ? "bg-secondary font-medium text-foreground"
                                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                                )}
                                onClick={() => pickAddProvider(id)}
                              >
                                {label}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                ) : null}
              </div>

              {isCompat ? (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground">显示名称</label>
                  <Input
                    className="h-10 border-transparent bg-background px-3 text-[14px] shadow-none focus-visible:border-border"
                    placeholder="例如 公司内网 vLLM"
                    value={connectProviderId === providerId ? connectName : ""}
                    onChange={(event) => onConnectNameChange(providerId, providerName, event.target.value)}
                  />
                </div>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">API Key</label>
                <Input
                  className="h-10 border-transparent bg-background px-3 text-[14px] shadow-none focus-visible:border-border"
                  placeholder="API 密钥"
                  value={keyValue}
                  onChange={(event) => onConnectApiKeyChange(providerId, providerName, event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">
                  Base URL{isCompat ? "" : "（可选）"}
                </label>
                <Input
                  className="h-10 border-transparent bg-background px-3 text-[14px] shadow-none focus-visible:border-border"
                  placeholder={
                    isCompat
                      ? "例如 http://127.0.0.1:8000/v1"
                      : `默认 ${resolveProviderBaseUrlHint(providerId) || "供应商预设"}`
                  }
                  value={connectProviderId === providerId ? connectBaseUrl : ""}
                  onChange={(event) => onConnectBaseUrlChange(providerId, providerName, event.target.value)}
                />
              </div>

              <div className="flex justify-end pt-1">
                <Button
                  className="h-9 px-4 text-[13px]"
                  variant="contrast"
                  disabled={!canSave}
                  onClick={() => onConnectProvider(providerId, false)}
                >
                  {connectBusy ? "保存中…" : "保存"}
                </Button>
              </div>
            </div>
          </div>
        ) : !providerId ? (
          <Empty className="min-h-0 flex-1 border-0 p-0">
            <EmptyHeader>
              <EmptyTitle>选择或新增供应商</EmptyTitle>
              <EmptyDescription>左侧选择已配置项，或点击新增填写参数。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="rounded-xl border border-black/[0.08] bg-card p-4 shadow-[var(--gt-elev-card)] dark:border-border/70 dark:shadow-none">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3 className="m-0 truncate text-[17px] font-semibold leading-7 text-foreground">{providerName}</h3>
                    <Badge variant="success">已连接</Badge>
                    <span className="text-[11px] text-muted-foreground">{getProviderTag(providerId)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-md bg-muted/70 px-2 py-1 text-[12px] text-foreground">
                      {defaultModelLabel ? (
                        <>默认模型 · <strong className="ml-1 font-semibold">{defaultModelLabel}</strong></>
                      ) : (
                        "未设置默认模型"
                      )}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {pool.length} 个模型 · 显示 {enabledCount}
                    </span>
                  </div>
                  {!defaultModelLabel ? (
                    <p className="m-0 mt-2 text-[12px] leading-5 text-muted-foreground">
                      在下方列表点击模型行，即可设为默认。
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canRemoveCustomProvider(providerId) ? (
                    confirmRemove ? (
                      <>
                        <Button className="h-8 px-3 text-[13px]" variant="outline" disabled={removingProvider === providerId} onClick={() => setConfirmRemoveFor("")}>
                          取消
                        </Button>
                        <Button className="h-8 px-3 text-[13px]" variant="destructive" disabled={removingProvider === providerId} onClick={() => onRemoveCustomProvider(providerId)}>
                          {removingProvider === providerId ? "删除中…" : "确认删除"}
                        </Button>
                      </>
                    ) : (
                      <Button
                        className="h-8 px-3 text-[13px] text-destructive hover:text-destructive"
                        variant="outline"
                        disabled={removingProvider === providerId}
                        onClick={() => setConfirmRemoveFor(providerId)}
                      >
                        删除
                      </Button>
                    )
                  ) : null}
                  <Button className="h-8 shrink-0 px-3 text-[13px]" variant="outline" onClick={() => onToggleInlineAuth(providerId, providerName)}>
                    {authOpen ? "收起" : "更新密钥"}
                  </Button>
                </div>
              </div>

              {authOpen ? (
                <div className="mt-3 flex flex-col gap-2.5 rounded-lg bg-muted/40 p-3">
                  {isCompat ? (
                    <Input
                      className="h-9 border-transparent bg-background px-3 text-[13px] shadow-none focus-visible:border-border"
                      placeholder="供应商名称"
                      value={connectProviderId === providerId ? connectName : ""}
                      onChange={(event) => onConnectNameChange(providerId, providerName, event.target.value)}
                    />
                  ) : null}
                  <Input
                    className="h-9 border-transparent bg-background px-3 text-[13px] shadow-none focus-visible:border-border"
                    placeholder="输入新的 API 密钥"
                    value={keyValue}
                    onChange={(event) => onConnectApiKeyChange(providerId, providerName, event.target.value)}
                  />
                  <Input
                    className="h-9 border-transparent bg-background px-3 text-[13px] shadow-none focus-visible:border-border"
                    placeholder={
                      isCompat
                        ? "Base URL（必填）"
                        : `Base URL（可选，默认 ${resolveProviderBaseUrlHint(providerId) || "供应商预设"}）`
                    }
                    value={connectProviderId === providerId ? connectBaseUrl : ""}
                    onChange={(event) => onConnectBaseUrlChange(providerId, providerName, event.target.value)}
                  />
                  <div className="flex justify-start">
                    <Button
                      className="h-8 px-3 text-[13px]"
                      variant="contrast"
                      disabled={!canSave}
                      onClick={() => onConnectProvider(providerId, true)}
                    >
                      {connectBusy ? "保存中…" : "保存连接"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 px-0.5">
                <span className="text-[12px] font-medium text-foreground">模型列表</span>
                <span className="text-[11px] text-muted-foreground">开关控制是否出现在选择器中</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 px-2 text-[12px] text-muted-foreground"
                    disabled={filteredModels.length === 0}
                    onClick={() => setAllModelsVisible(true)}
                  >
                    全部显示
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 px-2 text-[12px] text-muted-foreground"
                    disabled={filteredModels.length === 0}
                    onClick={() => setAllModelsVisible(false)}
                  >
                    全部隐藏
                  </Button>
                  <Input
                    className="h-8 w-[min(200px,36vw)] border-transparent bg-muted/50 px-2.5 text-[12px] shadow-none focus-visible:border-border"
                    placeholder="搜索模型…"
                    value={modelSearch}
                    onChange={(event) => onModelSearchChange(event.target.value)}
                  />
                </div>
              </div>

              {enabledCount === 0 && pool.length > 0 ? (
                <div className="rounded-lg border border-dashed border-border/80 bg-muted/25 px-3 py-2 text-[12px] text-muted-foreground">
                  当前没有显示中的模型。打开下方开关后，才会出现在对话的模型选择器里。
                </div>
              ) : null}

              <ScrollArea className="min-h-0 flex-1">
                <div className="pb-2 pr-1">
                  <AgentProviderModelList
                    models={filteredModels}
                    providerId={providerId}
                    configuredProviderId={configuredProviderId}
                    activeModel={activeModel}
                    configuredModelsByProvider={configuredModelsByProvider}
                    configuredModelNamesByProvider={configuredModelNamesByProvider}
                    modelNamesByProvider={modelNamesByProvider}
                    hiddenModels={hiddenModels}
                    enabledModels={enabledModels}
                    onSelectModel={onSelectModel}
                    onHideModel={onHideModel}
                    onEnableModel={onEnableModel}
                  />
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
