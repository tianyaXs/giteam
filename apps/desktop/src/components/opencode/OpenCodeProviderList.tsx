import { Fragment } from "react";

type OpenCodeProviderListProps = {
  providers: string[];
  selectedProvider: string;
  connectedProviders: string[];
  providerNames: Record<string, string>;
  modelCountsByProvider: Record<string, number>;
  getProviderTag: (provider: string) => string;
  getProviderDisplayName: (provider: string) => string;
  onSelectProvider: (provider: string, connected: boolean) => void;
};

export function OpenCodeProviderList(props: OpenCodeProviderListProps) {
  if (props.providers.length === 0) {
    return <div className="small muted" style={{ padding: 12 }}>暂无可用供应商目录。请检查 OpenCode `/provider` 是否可访问。</div>;
  }

  return (
    <>
      {props.providers.map((provider, idx) => {
        const connected = props.connectedProviders.includes(provider);
        const tag = props.getProviderTag(provider);
        const prev = idx > 0 ? props.providers[idx - 1] : "";
        const prevConnected = prev ? props.connectedProviders.includes(prev) : connected;
        const shouldSplit = idx > 0 && prevConnected && !connected;
        const modelCount = props.modelCountsByProvider[provider] || 0;
        return (
          <Fragment key={`provider-pick-wrap-${provider}`}>
            {shouldSplit ? (
              <div className="opencode-provider-divider small muted">
                未连接
              </div>
            ) : null}
            <button
              key={`provider-pick-${provider}`}
              className={props.selectedProvider === provider ? "file-item selected opencode-provider-row" : "file-item opencode-provider-row"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                props.onSelectProvider(provider, connected);
              }}
              title={connected ? "已连接" : "未连接（需要在 OpenCode 中连接或配置）"}
            >
              <span className="opencode-provider-row-main">
                {props.getProviderDisplayName(provider)}
                <small>{`${provider} · ${tag}`}</small>
              </span>
              <span className="opencode-provider-row-side">
                <small className="small muted">{modelCount} models</small>
                <span className={connected ? "opencode-provider-state connected" : "opencode-provider-state"}>
                  {connected ? "已连接" : "未连接"}
                </span>
              </span>
            </button>
          </Fragment>
        );
      })}
    </>
  );
}
