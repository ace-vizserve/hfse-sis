'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import type { NavItem, SidebarBadges, SidebarCounts } from '@/lib/auth/roles';
import type { ModuleSidebarConfig } from '@/lib/sidebar/registry';

import {
  NAV_ACTIVE_CLASSES,
  NAV_BADGE_CLASSES,
  NAV_COUNT_CLASSES,
  NAV_SUB_ACTIVE_CLASSES,
} from './chrome';

type SidebarNavItemProps = {
  item: NavItem;
  isActive: boolean;
  config: ModuleSidebarConfig;
  badges?: SidebarBadges;
  // Informational count chip (item.countKey → counts[countKey]) — see
  // NavItem.countKey. Optional; items without a countKey (i.e. every
  // non-SIS-Admin nav item today) render byte-identically to before.
  counts?: SidebarCounts;
  // Needed only to mark the active CHILD. Items without children ignore it.
  activeHref?: string;
};

export function SidebarNavItem({
  item,
  isActive,
  config,
  badges,
  counts,
  activeHref,
}: SidebarNavItemProps) {
  const Icon = config.iconByHref[item.href] ?? config.fallbackIcon;
  const badge = item.badgeKey ? (badges?.[item.badgeKey] ?? 0) : 0;
  const count = item.countKey ? counts?.[item.countKey] : undefined;

  const children = item.children ?? [];
  const hasChildren = children.length > 0;
  const childIsActive = children.some((c) => c.href === activeHref);

  const [open, setOpen] = useState(childIsActive);

  // Landing on a child route opens its parent — same rule as the groups above:
  // you have to be able to see where you are. Additive, so it never reopens
  // something the viewer just closed.
  useEffect(() => {
    if (childIsActive) setOpen(true);
  }, [childIsActive]);

  const row = (
    <SidebarMenuButton
      asChild
      isActive={isActive}
      tooltip={badge > 0 ? `${item.label} (${badge})` : item.label}
      className={
        // Clearance for the expander, which is absolutely positioned at the
        // row's right edge and would otherwise sit on top of the badge.
        hasChildren ? NAV_ACTIVE_CLASSES + ' pr-7' : NAV_ACTIVE_CLASSES
      }
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
          <span className={'ml-auto ' + NAV_BADGE_CLASSES}>{badge}</span>
        )}
        {badge === 0 && count != null && (
          <span className={'ml-auto ' + NAV_COUNT_CLASSES}>{count}</span>
        )}
      </Link>
    </SidebarMenuButton>
  );

  if (!hasChildren) {
    return <SidebarMenuItem>{row}</SidebarMenuItem>;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/nav-child">
      <SidebarMenuItem>
        {/* The row stays a LINK. The parent is a real route of its own, so
            clicking it must go there; only the chevron toggles. Making the row
            itself the trigger would cost a click to reach a page that already
            exists. */}
        {row}

        <CollapsibleTrigger asChild>
          <SidebarMenuAction className="top-2 text-sidebar-foreground/40 hover:text-sidebar-foreground/70">
            <ChevronRight className="motion-safe:transition-transform motion-safe:duration-200 group-data-[state=open]/nav-child:rotate-90" />
            <span className="sr-only">
              {open ? 'Hide' : 'Show'} {item.label} pages
            </span>
          </SidebarMenuAction>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <SidebarMenuSub>
            {children.map((child) => (
              <SidebarMenuSubItem key={child.href}>
                <SidebarMenuSubButton
                  asChild
                  isActive={child.href === activeHref}
                  className={NAV_SUB_ACTIVE_CLASSES}
                >
                  <Link href={child.href}>
                    <span>{child.label}</span>
                    {child.badgeKey && (badges?.[child.badgeKey] ?? 0) > 0 && (
                      <span className={'ml-auto ' + NAV_BADGE_CLASSES}>
                        {badges?.[child.badgeKey]}
                      </span>
                    )}
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
