'use client';

import { ChevronRight } from 'lucide-react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  useSidebar,
} from '@/components/ui/sidebar';
import type {
  NavSection,
  SidebarBadges,
  SidebarCounts,
} from '@/lib/auth/roles';
import { isCollapsibleGroup, sumGroupBadges } from '@/lib/sidebar/group-state';
import type { ModuleSidebarConfig } from '@/lib/sidebar/registry';

import {
  NAV_BADGE_CLASSES,
  NAV_COUNT_CLASSES,
  NAV_GROUP_LABEL_CLASSES,
} from './chrome';
import { SidebarNavItem } from './sidebar-nav-item';

type SidebarNavGroupProps = {
  section: NavSection;
  activeHref: string | undefined;
  config: ModuleSidebarConfig;
  badges: SidebarBadges;
  counts: SidebarCounts;
  isExpanded: boolean;
  onToggle: () => void;
};

export function SidebarNavGroup({
  section,
  activeHref,
  config,
  badges,
  counts,
  isExpanded,
  onToggle,
}: SidebarNavGroupProps) {
  const { state } = useSidebar();

  // The indent rail, borrowed from `SidebarMenuSub` (sidebar.tsx:648) so nested
  // rows read the same everywhere in the app.
  //
  // Only on LABELLED groups: the rail says "these rows belong to the heading
  // above". The unlabelled first group — every module's Dashboard row — has no
  // heading to belong to, so a rail there would point at nothing. Dropped in
  // icon mode for the same reason `SidebarMenuSub` hides itself: the labels are
  // gone, so the line would be left hanging.
  const showRail = Boolean(section.label) && state !== 'collapsed';
  const railClasses = showRail
    ? 'ml-2 border-l border-sidebar-border pl-2.5'
    : undefined;

  const items = (
    <SidebarGroupContent className={railClasses}>
      <SidebarMenu>
        {section.items.map((item) => (
          <SidebarNavItem
            key={item.href}
            item={item}
            isActive={item.href === activeHref}
            config={config}
            badges={badges}
            counts={counts}
            activeHref={activeHref}
          />
        ))}
      </SidebarMenu>
    </SidebarGroupContent>
  );

  // Flat rendering, used in two cases:
  //
  //  1. The group isn't collapsible — no label, or a single item, where a
  //     toggle would hide one row.
  //  2. The whole sidebar is in icon mode. The primitive hides group labels
  //     there (`group-data-[collapsible=icon]:opacity-0`), so there would be
  //     nothing left to click and a closed group would strand its items.
  //
  // The label markup below is byte-identical to what shipped before this
  // component existed. `__tests__/ui/module-sidebar-group-label.test.tsx` pins
  // it, and it exists because hint chrome leaked into every module once.
  if (!isCollapsibleGroup(section) || state === 'collapsed') {
    return (
      <SidebarGroup>
        {section.label &&
          (section.hint ? (
            <SidebarGroupLabel
              className={
                'flex items-baseline justify-between gap-2 ' +
                NAV_GROUP_LABEL_CLASSES
              }
            >
              <span>{section.label}</span>
              <span className="font-normal normal-case tracking-normal text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">
                {section.hint}
              </span>
            </SidebarGroupLabel>
          ) : (
            <SidebarGroupLabel className={NAV_GROUP_LABEL_CLASSES}>
              {section.label}
            </SidebarGroupLabel>
          ))}
        {items}
      </SidebarGroup>
    );
  }

  const hiddenBadges = sumGroupBadges(section.items, badges);

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onToggle}
      className="group/nav-group"
    >
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger
            className={
              'w-full gap-2 hover:text-sidebar-foreground/80 [&>svg]:size-3.5 ' +
              NAV_GROUP_LABEL_CLASSES
            }
          >
            <span className="flex-1 text-left">{section.label}</span>

            {/* The right slot carries whatever the current state cannot show.
                Closed, that is the badges being hidden — every badge in the app
                lives inside a labelled group, so without this a closed group
                silently swallows the one signal that says something needs
                doing. Open, the items speak for themselves, so the slot returns
                to the cadence hint. */}
            {isExpanded
              ? section.hint && (
                  <span className="font-normal normal-case tracking-normal text-sidebar-foreground/40">
                    {section.hint}
                  </span>
                )
              : hiddenBadges > 0 && (
                  <span className={NAV_BADGE_CLASSES}>{hiddenBadges}</span>
                )}
            {!isExpanded && hiddenBadges === 0 && (
              <span className={NAV_COUNT_CLASSES}>{section.items.length}</span>
            )}

            <ChevronRight
              className="text-sidebar-foreground/40 motion-safe:transition-transform motion-safe:duration-200 group-data-[state=open]/nav-group:rotate-90"
              aria-hidden
            />
          </CollapsibleTrigger>
        </SidebarGroupLabel>

        <CollapsibleContent>{items}</CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
