'use client';

import { Check, ChevronsUpDown, Eye, Loader2 } from 'lucide-react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ROLE_LABEL } from '@/lib/auth/role-labels';
import type { Role } from '@/lib/auth/roles';
import { useViewSwitch } from '@/components/view-switch/use-view-switch';
import { cn } from '@/lib/utils';

// The view switcher for the neutral (dashboard) group — `/` and `/account`.
//
// Those two pages have no module sidebar, so they had no profile popover and
// therefore no way to change view at all: a teaching admin who landed on `/`
// was stuck in whichever view she arrived in until she opened a module. That
// gap only became visible once the wrong-view notice started telling people to
// switch — a control we point at has to exist wherever they end up.
//
// Mirrors `TopbarModuleSwitcher` next to it rather than the sidebar's profile
// row: same trigger shape, same popover width, same row treatment, so the two
// controls in that header read as a pair. It renders NOTHING for an account
// with one view, exactly like the sidebar's "Switch view" section — which is
// every account but the six that also teach.

type TopbarViewSwitcherProps = {
  /** Every view this account may look through — see `getEntitledRoles`. */
  entitled: readonly Role[];
  /** The view currently rendered. Presentation only — see lib/auth/active-role.ts. */
  activeRole: Role | null;
};

export function TopbarViewSwitcher({
  entitled,
  activeRole,
}: TopbarViewSwitcherProps) {
  const { switchingTo, switchView } = useViewSwitch(activeRole);

  // One view is not a choice. Same test as the sidebar's `canSwitchViews`.
  if (entitled.length <= 1 || !activeRole) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg px-2 py-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Eye className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="flex flex-col items-start leading-none">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              Viewing as
            </span>
            <span className="text-[13px] font-medium text-foreground">
              {ROLE_LABEL[activeRole]}
            </span>
          </div>
          <ChevronsUpDown className="ml-1 size-3.5 shrink-0 text-muted-foreground/60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[240px] p-1.5">
        <div className="px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Switch view
        </div>
        {entitled.map((r) => {
          const active = r === activeRole;
          const pending = switchingTo === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => switchView(r)}
              // Only the OTHER rows go inert while a switch is in flight — the
              // row just clicked keeps focus rather than dropping it to
              // <body>, and `switchView` already no-ops a second click on it.
              disabled={switchingTo !== null && !pending}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground hover:bg-accent',
                switchingTo !== null && !pending && 'opacity-60'
              )}
            >
              {pending ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                // Rendered at zero opacity rather than omitted, so the rows
                // do not shift by an icon width when the active one moves.
                <Check
                  className={cn(
                    'size-4 shrink-0',
                    active ? 'opacity-100' : 'opacity-0'
                  )}
                />
              )}
              <span>{ROLE_LABEL[r]}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
