import { resolveProviderAliasWithNames } from "../../lib/opencodeModels";
import { OpenCodeProviderList } from "./OpenCodeProviderList";
import { OpenCodeProviderModelList } from "./OpenCodeProviderModelList";

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

  return (
    <div className="settings-model-inline">
      <div className="settings-model-head opencode-provider-picker-toolbar">
        <input
          className="path-input"
          placeholder="搜索提供商..."
          value={providerSearch}
          onChange={(event) => onProviderSearchChange(event.target.value)}
        />
        <input
          className="path-input"
          placeholder="搜索模型..."
          value={modelSearch}
          onChange={(event) => onModelSearchChange(event.target.value)}
        />
      </div>
      <div className="settings-model-lists opencode-provider-picker-grid">
        <div className="settings-model-col">
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
        <div className="settings-model-col">
          {!providerId ? (
            <div className="small muted opencode-provider-empty">先从左侧选择一个提供商。</div>
          ) : (
            <div className="opencode-provider-right-panel">
              <div className="opencode-provider-connect">
                <div
                  className="toolbar"
                  style={{
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: authOpen ? "var(--gt-space-2)" : "var(--gt-space-3)"
                  }}
                >
                  <div className="small muted">
                    {connected
                      ? `${providerName} 已连接。若 API Key 已变更，可在此更新（写入 OpenCode auth.json）。`
                      : `${providerName} 未连接。请先输入 API Key 连接（写入 OpenCode auth.json），再选择模型。`}
                  </div>
                  {connected ? (
                    <button className="chip" onClick={() => onToggleInlineAuth(providerId, providerName)}>
                      {authOpen ? "收起密钥编辑" : "更新 API Key"}
                    </button>
                  ) : null}
                </div>
                {authOpen ? (
                  <>
                    <input
                      className="path-input"
                      placeholder={connected ? "输入新的 API 密钥" : "API 密钥"}
                      value={keyValue}
                      onChange={(event) => onConnectApiKeyChange(providerId, providerName, event.target.value)}
                    />
                    <div className="toolbar" style={{ marginTop: "var(--gt-space-2-5)", marginBottom: connected ? "0" : "var(--gt-space-3)" }}>
                      <button
                        className="chip"
                        disabled={connectBusy || connectProviderId !== providerId || !connectApiKey.trim()}
                        onClick={() => onConnectProvider(providerId, connected)}
                      >
                        {connectBusy ? "Saving..." : (connected ? "更新密钥" : "连接")}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
              {connected ? (
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
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
