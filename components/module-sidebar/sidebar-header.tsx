'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import Link from 'next/link';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { isRouteAllowed, type Role } from '@/lib/auth/roles';
import {
  MODULE_ORDER,
  SIDEBAR_REGISTRY,
  type SidebarModule,
} from '@/lib/sidebar/registry';

type SidebarHeaderProps = {
  module: SidebarModule;
  role: Role | null;
};

export function ModuleSidebarHeader({ module, role }: SidebarHeaderProps) {
  const config = SIDEBAR_REGISTRY[module];
  const Icon = config.icon;

  // Allowed staff modules in lifecycle order. Parents (null role) +
  // p_file_officer users reach only one module — render a non-interactive
  // brand tile instead of a popover trigger.
  const allowedModules = MODULE_ORDER.filter((m) =>
    isRouteAllowed(SIDEBAR_REGISTRY[m].primaryHref, role)
  );
  const canSwitch = allowedModules.length > 1;

  if (!canSwitch) {
    return (
      <Link
        href={config.primaryHref}
        className="group flex items-center gap-3 rounded-lg px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <Icon className="size-4" />
        </div>
        <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/60">
            HFSE
          </span>
          <span className="truncate font-serif text-base font-semibold tracking-tight text-sidebar-foreground">
            {config.label}
          </span>
        </div>
      </Link>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/60">
              HFSE
            </span>
            <span className="truncate font-serif text-base font-semibold tracking-tight text-sidebar-foreground">
              {config.label}
            </span>
          </div>
          <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        sideOffset={8}
        className="w-[260px] p-1.5"
      >
        <div className="px-2 pb-1.5 pt-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            Switch module
          </p>
        </div>
        <ul className="flex flex-col gap-0.5">
          {allowedModules.map((m) => {
            const cfg = SIDEBAR_REGISTRY[m];
            const MIcon = cfg.icon;
            const isCurrent = m === module;
            return (
              <li key={m}>
                <Link
                  href={cfg.primaryHref}
                  data-active={isCurrent}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-accent"
                >
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                    <MIcon className="size-3.5" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      HFSE
                    </span>
                    <span className="truncate font-serif text-[13px] font-semibold tracking-tight text-foreground">
                      {cfg.label}
                    </span>
                  </div>
                  {isCurrent && (
                    <Check
                      className="size-3.5 shrink-0 text-brand-indigo-deep"
                      aria-hidden
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
