import { resolveProviderAliasWithNames } from "../../lib/opencodeModels";
import { OpenCodeProviderList } from "./OpenCodeProviderList";
import { OpenCodeProviderModelList } from "./OpenCodeProviderModelList";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";

type OpenCodeProviderSettingsPanelProps = {
  providerSearch: string;
  modelSearch: string;
  providers: string[];
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
  inlineAuthOpenFor: string;
  onProviderSearchChange: (value: string) => void;
  onModelSearchChange: (value: string) => void;
  onSelectProvider: (provider: string, connected: boolean) => void;
  onConnectApiKeyChange: (providerId: string, providerName: string, value: string) => void;
  onToggleInlineAuth: (providerId: string, providerName: string) => void;
  onConnectProvider: (providerId: string, connected: boolean) => void;
  onSelectModel: (modelRef: string) => void;
  onHideModel: (modelRef: string) => void;
  onEnableModel: (modelRef: string) => void;
  getProviderTag: (providerId: string) => string;
  getProviderDisplayName: (providerId: string) => string;
};

export function OpenCodeProviderSettingsPanel({
  providerSearch,
  modelSearch,
  providers,
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
  inlineAuthOpenFor,
  onProviderSearchChange,
  onModelSearchChange,
  onSelectProvider,
  onConnectApiKeyChange,
  onToggleInlineAuth,
  onConnectProvider,
  onSelectModel,
  onHideModel,
  onEnableModel,
  getProviderTag,
  getProviderDisplayName
}: OpenCodeProviderSettingsPanelProps) {
  const resolved = resolveProviderAliasWithNames(selectedProvider, modelsByProvider, providerNames);
  const cfgResolved = resolveProviderAliasWithNames(selectedProvider, configuredModelsByProvider, providerNames);
  const providerId = (resolved || selectedProvider.trim()) || "";
  const configuredProviderId = (cfgResolved || providerId) || "";
  const pool = (providerId ? (modelsByProvider[providerId] ?? []) : []).slice().sort((a, b) => a.localeCompare(b));
  const query = modelSearch.trim().toLowerCase();
  const filteredModels = query ? pool.filter((model) => model.toLowerCase().includes(query)) : pool;
  const connected = connectedProviders.includes(providerId);
  const providerName = getProviderDisplayName(providerId);
  const keyValue = connectProviderId === providerId ? connectApiKey : "";
  const authOpen = !connected || inlineAuthOpenFor === providerId;
  const panelHeight = "h-[clamp(380px,calc(100svh-210px),760px)]";
  const splitColumns = "xl:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.55fr)]";

  return (
    <div className="flex flex-col gap-[clamp(18px,2.4vh,28px)]">
      <div className={`grid gap-[clamp(14px,2vw,32px)] ${splitColumns}`}>
        <Input
          className="h-11 border-transparent bg-secondary/60 px-4 text-[15px] font-medium shadow-none focus-visible:border-border"
          placeholder="搜索提供商..."
          value={providerSearch}
          onChange={(event) => onProviderSearchChange(event.target.value)}
        />
        <Input
          className="h-11 border-transparent bg-secondary/60 px-4 text-[15px] font-medium shadow-none focus-visible:border-border"
          placeholder="搜索模型..."
          value={modelSearch}
          onChange={(event) => onModelSearchChange(event.target.value)}
        />
      </div>
      <div className={`grid min-h-0 gap-[clamp(18px,2.2vw,32px)] ${splitColumns}`}>
        <section className="min-h-0">
          <div className="mb-3 flex items-center justify-between px-1">
            <span className="text-[13px] font-medium text-muted-foreground">供应商</span>
            <Badge variant="secondary">{providers.length}</Badge>
          </div>
          <ScrollArea className={panelHeight}>
            <div className="flex flex-col gap-1 pr-2">
              <OpenCodeProviderList
                providers={providers}
                selectedProvider={selectedProvider}
                connectedProviders={connectedProviders}
                providerNames={providerNames}
                modelCountsByProvider={modelCountsByProvider}
                getProviderTag={getProviderTag}
                getProviderDisplayName={getProviderDisplayName}
                onSelectProvider={onSelectProvider}
              />
            </div>
          </ScrollArea>
        </section>
        <section className="min-h-0">
          {!providerId ? (
            <Empty className={`${panelHeight} border-0 p-0`}>
              <EmptyHeader>
                <EmptyTitle>选择提供商</EmptyTitle>
                <EmptyDescription>先从左侧选择一个提供商，再连接密钥并管理模型。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className={`flex ${panelHeight} min-h-0 flex-col`}>
              <div className="flex flex-col gap-4 px-1 pb-4">
                <div className="flex items-start justify-between gap-5">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <h3 className="m-0 truncate text-[18px] font-semibold leading-7 text-foreground">{providerName}</h3>
                      <Badge variant={connected ? "success" : "secondary"}>
                        {connected ? "已连接" : "未连接"}
                      </Badge>
                    </div>
                    <p className="m-0 mt-1 truncate text-[14px] leading-6 text-muted-foreground">{providerId}</p>
                  </div>
                  {connected ? (
                    <Button className="h-9 shrink-0 px-4 text-[14px]" variant="outline" onClick={() => onToggleInlineAuth(providerId, providerName)}>
                      {authOpen ? "收起密钥编辑" : "更新 API Key"}
                    </Button>
                  ) : null}
                </div>
                <p className="m-0 max-w-[640px] text-[15px] font-medium leading-7 text-muted-foreground">
                  {connected
                    ? `${providerName} 已连接。若 API Key 已变更，可在此更新（写入 OpenCode auth.json）。`
                    : `${providerName} 未连接。请先输入 API Key 连接（写入 OpenCode auth.json），再选择模型。`}
                </p>
                {authOpen ? (
                  <div className="flex flex-col gap-3 rounded-xl bg-secondary/45 p-3">
                    <Input
                      className="h-10 border-transparent bg-background px-3 text-[15px] shadow-none focus-visible:border-border"
                      placeholder={connected ? "输入新的 API 密钥" : "API 密钥"}
                      value={keyValue}
                      onChange={(event) => onConnectApiKeyChange(providerId, providerName, event.target.value)}
                    />
                    <div className="flex justify-start">
                      <Button
                        className="h-9 px-4 text-[14px]"
                        variant="contrast"
                        disabled={connectBusy || connectProviderId !== providerId || !connectApiKey.trim()}
                        onClick={() => onConnectProvider(providerId, connected)}
                      >
                        {connectBusy ? "Saving..." : (connected ? "更新密钥" : "连接")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
              <Separator className="mb-3 bg-border/60" />
              {connected ? (
                <ScrollArea className="min-h-0 flex-1">
                  <div className="flex flex-col gap-1 px-1 pb-2">
                    <OpenCodeProviderModelList
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
              ) : (
                <Empty className="min-h-80 border-0 p-0">
                  <EmptyHeader>
                    <EmptyTitle>连接提供商</EmptyTitle>
                    <EmptyDescription>保存 API Key 后即可管理该提供商的模型显示状态。</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
