import { resolveProviderAliasWithNames } from "../../lib/opencodeModels";
import { OpenCodeProviderList } from "./OpenCodeProviderList";
import { OpenCodeProviderModelList } from "./OpenCodeProviderModelList";
import { PlusIcon } from "../icons";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";

type OpenCodeProviderPickerDialogProps = {
  loading: boolean;
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
  providerActionMenuFor: string;
  disconnectingProvider: string;
  onClose: () => void;
  onOpenCustomProvider: () => void;
  onProviderSearchChange: (value: string) => void;
  onModelSearchChange: (value: string) => void;
  onSelectProvider: (provider: string, connected: boolean) => void;
  onConnectApiKeyChange: (providerId: string, providerName: string, value: string) => void;
  onToggleProviderMenu: (providerId: string) => void;
  onOpenAuthDialog: (providerId: string, providerName: string) => void;
  onConnectProvider: (providerId: string, connected: boolean) => void;
  onDisconnectProvider: (providerId: string) => void;
  onSelectModel: (modelRef: string) => void;
  onHideModel: (modelRef: string) => void;
  onEnableModel: (modelRef: string) => void;
  getProviderTag: (providerId: string) => string;
  getProviderSource: (providerId: string) => string;
  getProviderDisplayName: (providerId: string) => string;
};

export function OpenCodeProviderPickerDialog({
  loading,
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
  providerActionMenuFor,
  disconnectingProvider,
  onClose,
  onOpenCustomProvider,
  onProviderSearchChange,
  onModelSearchChange,
  onSelectProvider,
  onConnectApiKeyChange,
  onToggleProviderMenu,
  onOpenAuthDialog,
  onConnectProvider,
  onDisconnectProvider,
  onSelectModel,
  onHideModel,
  onEnableModel,
  getProviderTag,
  getProviderSource,
  getProviderDisplayName
}: OpenCodeProviderPickerDialogProps) {
  const resolved = resolveProviderAliasWithNames(selectedProvider, modelsByProvider, providerNames);
  const cfgResolved = resolveProviderAliasWithNames(selectedProvider, configuredModelsByProvider, providerNames);
  const providerId = (resolved || selectedProvider.trim()) || "";
  const configuredProviderId = (cfgResolved || providerId) || "";
  const connected = providerId ? connectedProviders.includes(providerId) : false;
  const configuredPool = configuredProviderId ? (configuredModelsByProvider[configuredProviderId] ?? []) : [];
  const providerPool = providerId ? (modelsByProvider[providerId] ?? []) : [];
  const pool = (providerPool.length > 0 ? providerPool : configuredPool).slice().sort((a, b) => a.localeCompare(b));
  const query = modelSearch.trim().toLowerCase();
  const filteredModels = query ? pool.filter((model) => model.toLowerCase().includes(query)) : pool;
  const displayName = getProviderDisplayName(providerId);
  const providerTag = getProviderTag(providerId);
  const keyValue = connectProviderId === providerId ? connectApiKey : "";
  const menuOpen = providerActionMenuFor === providerId;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[min(1040px,calc(100vw-32px))]">
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle className="text-2xl">Provider & Model Manager</DialogTitle>
            <DialogDescription className="text-[15px] leading-7">集中管理提供商连接、API Key 与可用模型。</DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            {loading ? (
              <span className="text-[14px] text-muted-foreground" aria-live="polite">
                读取中
              </span>
            ) : null}
            <DialogClose asChild>
              <Button variant="outline" size="sm">关闭</Button>
            </DialogClose>
          </div>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Input
            className="h-11 rounded-xl px-4 text-[16px] font-semibold shadow-sm"
            placeholder="搜索提供商..."
            value={providerSearch}
            onChange={(event) => onProviderSearchChange(event.target.value)}
          />
          <Input
            className="h-11 rounded-xl px-4 text-[16px] font-semibold shadow-sm"
            placeholder="搜索模型..."
            value={modelSearch}
            onChange={(event) => onModelSearchChange(event.target.value)}
          />
          <Button
            variant="outline"
            size="icon"
            title="新增自定义提供商"
            aria-label="新增自定义提供商"
            onClick={onOpenCustomProvider}
          >
            <PlusIcon />
          </Button>
        </div>
        <div className="grid min-h-[560px] gap-5 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.45fr)]">
          <Card className="min-h-0 overflow-hidden rounded-xl shadow-none">
            <CardContent className="h-full p-0">
              <ScrollArea className="h-[560px]">
                <div className="flex flex-col gap-1 p-3">
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
            </CardContent>
          </Card>
          <Card className="min-h-0 overflow-hidden rounded-xl shadow-none">
            <CardContent className="h-full p-0">
            {!selectedProvider ? (
              <Empty className="h-[560px] border-0">
                <EmptyHeader>
                  <EmptyTitle>选择提供商</EmptyTitle>
                  <EmptyDescription>先从左侧选择一个提供商，再连接密钥并管理模型。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex h-[560px] min-h-0 flex-col">
                <div className="flex flex-col gap-4 border-b border-border p-5">
                  <div className="flex items-start justify-between gap-5">
                    <div className="min-w-0">
                      <strong className="block truncate text-[17px] font-semibold leading-6">{displayName}</strong>
                      <span className="block truncate text-[14px] leading-5 text-muted-foreground">{`${providerId} · ${providerTag}`}</span>
                    </div>
                    <DropdownMenu
                      open={menuOpen}
                      onOpenChange={(open) => {
                        if (open !== menuOpen) onToggleProviderMenu(providerId);
                      }}
                    >
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="更多操作"
                        >
                          <span aria-hidden="true">...</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => onOpenAuthDialog(providerId, displayName)}>
                            更新 API Key
                          </DropdownMenuItem>
                          {getProviderSource(providerId) !== "env" ? (
                            <DropdownMenuItem
                              disabled={disconnectingProvider === providerId}
                              onClick={() => onDisconnectProvider(providerId)}
                            >
                              {disconnectingProvider === providerId ? "处理中..." : "断开连接"}
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <p className="m-0 max-w-[460px] text-[16px] font-medium leading-7 text-muted-foreground">
                    {connected
                      ? `${displayName} 已连接。若 API Key 已变更，可在此更新（写入 OpenCode auth.json）。`
                      : `${displayName} 未连接。请先输入 API Key 连接（写入 OpenCode auth.json），再选择模型。`}
                  </p>
                  <Input
                    className="h-10 rounded-lg px-3 text-[15px]"
                    placeholder={connected ? "输入新的 API 密钥" : "API 密钥"}
                    value={keyValue}
                    onChange={(event) => onConnectApiKeyChange(providerId, displayName, event.target.value)}
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

                {connected ? (
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="flex flex-col gap-3 p-5">
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
                ) : null}
              </div>
            )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
