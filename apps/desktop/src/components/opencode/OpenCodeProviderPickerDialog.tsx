import { resolveProviderAliasWithNames } from "../../lib/opencodeModels";
import { OpenCodeProviderList } from "./OpenCodeProviderList";
import { OpenCodeProviderModelList } from "./OpenCodeProviderModelList";
import { PlusIcon } from "../icons";

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
    <div className="modal-mask" onClick={onClose}>
      <div className="modal-card settings-card opencode-provider-picker-card" onClick={(event) => event.stopPropagation()}>
        <div className="env-setup-head">
          <div className="opencode-provider-picker-title">
            <h3>Provider & Model Manager</h3>
          </div>
          <div className="toolbar">
            {loading ? (
              <span className="opencode-inline-loading" aria-live="polite">
                <span />
                读取中
              </span>
            ) : null}
            <button className="chip" onClick={onClose}>Close</button>
          </div>
        </div>
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
          <button
            className="chip opencode-provider-add-btn"
            title="新增自定义提供商"
            aria-label="新增自定义提供商"
            onClick={onOpenCustomProvider}
          >
            <PlusIcon />
          </button>
        </div>
        <div className="settings-model-lists opencode-provider-picker-grid">
          <div className="settings-model-col" style={{ maxHeight: 420 }}>
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
          <div className="settings-model-col" style={{ maxHeight: 420 }}>
            {!selectedProvider ? (
              <div className="small muted opencode-provider-empty">先从左侧选择一个提供商。</div>
            ) : (
              <div className="opencode-provider-right-panel">
                <div className="opencode-provider-panel-head">
                  <div className="opencode-provider-panel-title">
                    <strong>{displayName}</strong>
                    <small className="small muted">{`${providerId} · ${providerTag}`}</small>
                  </div>
                  <div className="opencode-provider-panel-actions">
                    <button
                      type="button"
                      className="chip opencode-provider-menu-trigger"
                      title="更多操作"
                      onClick={() => onToggleProviderMenu(providerId)}
                    >
                      ...
                    </button>
                    {menuOpen ? (
                      <div className="opencode-provider-menu">
                        <button
                          type="button"
                          className="opencode-provider-menu-item"
                          onClick={() => onOpenAuthDialog(providerId, displayName)}
                        >
                          更新 API Key
                        </button>
                        {getProviderSource(providerId) !== "env" ? (
                          <button
                            type="button"
                            className="opencode-provider-menu-item danger"
                            disabled={disconnectingProvider === providerId}
                            onClick={() => onDisconnectProvider(providerId)}
                          >
                            {disconnectingProvider === providerId ? "处理中..." : "断开连接"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="opencode-provider-connect">
                  <div className="small muted" style={{ marginBottom: "var(--gt-space-2)" }}>
                    {connected
                      ? `${displayName} 已连接。若 API Key 已变更，可在此更新（写入 OpenCode auth.json）。`
                      : `${displayName} 未连接。请先输入 API Key 连接（写入 OpenCode auth.json），再选择模型。`}
                  </div>
                  <input
                    className="path-input"
                    placeholder={connected ? "输入新的 API 密钥" : "API 密钥"}
                    value={keyValue}
                    onChange={(event) => onConnectApiKeyChange(providerId, displayName, event.target.value)}
                  />
                  <div className="toolbar" style={{ marginTop: "var(--gt-space-2-5)" }}>
                    <button
                      className="chip"
                      disabled={connectBusy || connectProviderId !== providerId || !connectApiKey.trim()}
                      onClick={() => onConnectProvider(providerId, connected)}
                    >
                      {connectBusy ? "Saving..." : (connected ? "更新密钥" : "连接")}
                    </button>
                  </div>
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
    </div>
  );
}
