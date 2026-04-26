"use client";

import { Check, ChevronsUpDown, Home } from "lucide-react";
import Link from "next/link";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isRouteAllowed, type Role } from "@/lib/auth/roles";
import { MODULE_ORDER, SIDEBAR_REGISTRY } from "@/lib/sidebar/registry";

// Used only by the neutral (dashboard) group (the `/` picker + `/account`)
// where there is no module sidebar to host the popover. Mirrors the
// sidebar header's switcher visually so the surface stays consistent.

type TopbarModuleSwitcherProps = {
  role: Role | null;
};

export function TopbarModuleSwitcher({ role }: TopbarModuleSwitcherProps) {
  const allowedModules = MODULE_ORDER.filter((m) =>
    isRouteAllowed(SIDEBAR_REGISTRY[m].primaryHref, role),
  );
  const canSwitch = allowedModules.length > 1;

  if (!canSwitch) {
    return (
      <div className="flex items-center gap-2.5">
        <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <Home className="size-3.5" />
        </div>
        <span className="font-serif text-sm font-semibold tracking-tight text-foreground">
          Home
        </span>
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Home className="size-3.5" />
          </div>
          <div className="flex flex-col items-start leading-none">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              HFSE
            </span>
            <span className="font-serif text-sm font-semibold tracking-tight text-foreground">
              Home
            </span>
          </div>
          <ChevronsUpDown className="ml-1 size-3.5 shrink-0 text-muted-foreground/60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[260px] p-1.5">
        <div className="px-2 pb-1.5 pt-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            Open module
          </p>
        </div>
        <ul className="flex flex-col gap-0.5">
          {allowedModules.map((m) => {
            const cfg = SIDEBAR_REGISTRY[m];
            const MIcon = cfg.icon;
            return (
              <li key={m}>
                <Link
                  href={cfg.primaryHref}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
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
                  <Check className="invisible size-3.5 shrink-0" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
