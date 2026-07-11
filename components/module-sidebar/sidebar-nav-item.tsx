'use client';

import Link from 'next/link';

import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import type { NavItem, SidebarBadges, SidebarCounts } from '@/lib/auth/roles';
import type { ModuleSidebarConfig } from '@/lib/sidebar/registry';

type SidebarNavItemProps = {
  item: NavItem;
  isActive: boolean;
  config: ModuleSidebarConfig;
  badges?: SidebarBadges;
  // Informational count chip (item.countKey → counts[countKey]) — see
  // NavItem.countKey. Optional; items without a countKey (i.e. every
  // non-SIS-Admin nav item today) render byte-identically to before.
  counts?: SidebarCounts;
};

const NAV_ACTIVE_CLASSES =
  'h-9 transition-colors ' +
  'data-[active=true]:bg-accent ' +
  'data-[active=true]:text-brand-indigo-deep ' +
  'data-[active=true]:font-semibold ' +
  'data-[active=true]:ring-1 data-[active=true]:ring-inset data-[active=true]:ring-brand-indigo-soft/40 ' +
  'data-[active=true]:hover:bg-accent ' +
  'data-[active=true]:[&_svg]:text-brand-indigo-deep';

export function SidebarNavItem({
  item,
  isActive,
  config,
  badges,
  counts,
}: SidebarNavItemProps) {
  const Icon = config.iconByHref[item.href] ?? config.fallbackIcon;
  const badge = item.badgeKey ? (badges?.[item.badgeKey] ?? 0) : 0;
  const count = item.countKey ? counts?.[item.countKey] : undefined;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={badge > 0 ? `${item.label} (${badge})` : item.label}
        className={NAV_ACTIVE_CLASSES}
      >
        <Link href={item.href}>
          <Icon />
          {item.step != null && (
            <span className="w-5 flex-shrink-0 text-right font-mono text-[10px] text-muted-foreground/60 group-data-[collapsible=icon]:hidden">
              {String(item.step).padStart(2, '0')}
            </span>
          )}
          <span>{item.label}</span>
          {badge > 0 && (
            <span className="ml-auto rounded-full bg-destructive px-1.5 text-[10px] font-semibold tabular-nums text-white group-data-[collapsible=icon]:hidden">
              {badge}
            </span>
          )}
          {badge === 0 && count != null && (
            <span className="ml-auto rounded-md border border-sidebar-border bg-sidebar-accent/40 px-1.5 font-mono text-[10px] text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
              {count}
            </span>
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
