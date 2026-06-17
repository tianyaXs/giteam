import { Fragment } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { cn } from "@/lib/utils";

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
    return (
      <Empty className="min-h-72 border-0">
        <EmptyHeader>
          <EmptyTitle>暂无供应商</EmptyTitle>
          <EmptyDescription>请检查 OpenCode `/provider` 是否可访问。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
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
              <div className="px-4 pb-2 pt-5 text-[15px] font-semibold text-muted-foreground">
                未连接
              </div>
            ) : null}
            <Button
              key={`provider-pick-${provider}`}
              variant="ghost"
              className={cn(
                "h-auto w-full justify-start rounded-xl px-3.5 py-3 text-left hover:bg-secondary/60 hover:text-foreground",
                props.selectedProvider === provider && "bg-secondary text-secondary-foreground hover:bg-secondary hover:text-secondary-foreground"
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                props.onSelectProvider(provider, connected);
              }}
              title={connected ? "已连接" : "未连接（需要在 OpenCode 中连接或配置）"}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="truncate text-[16px] font-semibold leading-6">{props.getProviderDisplayName(provider)}</span>
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="truncate text-[14px] leading-5 text-muted-foreground">{`${provider} · ${tag}`}</span>
                  <Badge variant="secondary" className="shrink-0 normal-case tracking-normal">{modelCount} 模型</Badge>
                  <Badge variant={connected ? "success" : "secondary"} className="shrink-0">
                    {connected ? "已连接" : "未连接"}
                  </Badge>
                </span>
              </span>
            </Button>
          </Fragment>
        );
      })}
    </>
  );
}
