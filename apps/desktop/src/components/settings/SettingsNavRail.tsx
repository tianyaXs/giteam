import type { ComponentType, SVGProps } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

export type SettingsNavItem = {
  id: string;
  title: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

type SettingsNavRailProps = {
  embedded?: boolean;
  items: SettingsNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onBack?: () => void;
};

const NAV_GROUPS: Array<{ id: string; label: string; itemIds: string[] }> = [
  { id: "prefs", label: "偏好", itemIds: ["general", "appearance", "notifications", "sounds"] },
  { id: "connect", label: "连接", itemIds: ["models", "mobile", "remoteRepos"] },
  { id: "system", label: "系统", itemIds: ["updates"] },
];

export function SettingsNavRail(props: SettingsNavRailProps) {
  const byId = new Map(props.items.map((item) => [item.id, item]));
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.itemIds.map((id) => byId.get(id)).filter(Boolean) as SettingsNavItem[],
  })).filter((group) => group.items.length > 0);

  // 未进分组的项（兜底），避免漏渲染
  const groupedIds = new Set(groups.flatMap((g) => g.items.map((i) => i.id)));
  const orphanItems = props.items.filter((item) => !groupedIds.has(item.id));
  if (orphanItems.length) {
    groups.push({ id: "more", label: "更多", itemIds: orphanItems.map((i) => i.id), items: orphanItems });
  }

  return (
    <aside
      className={cn(
        // 与会话栏同层：突出浮起，左落导航、右落内容
        "relative z-[3] flex h-full min-h-0 w-full flex-col rounded-l-[14px] border-r-0 bg-[var(--sidebar-bg)] shadow-[var(--gt-elev-sidebar)]",
        // 与 DesktopSidebar / 三色按钮安全区对齐，避免顶栏内容贴窗控件
        "pt-10 px-3 pb-4"
      )}
    >
      <div className="mb-4 shrink-0 px-1 pb-3">
        {props.embedded ? (
          <div className="px-2">
            <h1 className="text-[15px] font-semibold tracking-tight text-foreground">设置</h1>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground/80">偏好、连接与系统</p>
          </div>
        ) : (
          <Button
            variant="ghost"
            className="h-8 w-full justify-start gap-2 px-2 text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.045]"
            onClick={() => props.onBack?.()}
          >
            <span className="text-[15px] leading-none" aria-hidden="true">
              ←
            </span>
            <span className="text-[13px] font-medium leading-5">返回应用</span>
          </Button>
        )}
      </div>

      <nav aria-label="设置分区" className="gt-subtle-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-visible pr-0.5">
        {groups.map((group) => (
          <div key={group.id} className="flex flex-col gap-1">
            <div className="px-3 pb-1 text-[11px] font-medium tracking-[0.04em] text-muted-foreground/70">
              {group.label}
            </div>
            <SidebarMenu className="gap-0.5 overflow-visible">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = props.activeId === item.id;
                return (
                  <SidebarMenuItem key={item.id} className="overflow-visible">
                    <SidebarMenuButton
                      isActive={active}
                      aria-current={active ? "page" : undefined}
                      onClick={() => props.onSelect(item.id)}
                      className={cn(
                        "relative h-9 gap-2.5 overflow-visible rounded-lg px-3 py-2 font-medium transition-colors duration-150",
                        "focus-visible:ring-2 focus-visible:ring-foreground/20 [&_svg]:size-[17px] [&_svg]:shrink-0",
                        active
                          ? cn(
                              // 浅色：柔和灰底选中（Codex 式 pill）；深色：提亮面
                              "bg-black/[0.05] font-semibold text-foreground hover:bg-black/[0.05]",
                              "dark:bg-white/[0.12] dark:hover:bg-white/[0.12]",
                              "[&_svg]:opacity-100"
                            )
                          : cn(
                              "bg-transparent text-muted-foreground",
                              "hover:bg-black/[0.05] hover:text-foreground",
                              "dark:hover:bg-white/[0.045] dark:hover:text-foreground",
                              "[&_svg]:opacity-70 hover:[&_svg]:opacity-100"
                            )
                      )}
                    >
                      <Icon className="shrink-0" />
                      <span className="truncate text-[13px] leading-5">{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </div>
        ))}
      </nav>
    </aside>
  );
}
