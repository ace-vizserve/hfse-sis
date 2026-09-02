'use client';

import { Check, ChevronsUpDown, LogOut, Loader2, UserCog } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import type { Role } from '@/lib/auth/roles';
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<Role, string> = {
  teacher: 'Teacher',
  academic_coordinator: 'Academic Coordinator',
  school_admin: 'School Admin',
  superadmin: 'Superadmin',
  p_file_officer: 'P-File Officer',
  admissions: 'Admissions',
};

/**
 * The route's error codes are pinned by `__tests__/auth/active-role-route.test.ts`
 * and must stay machine-shaped there — this maps them to what a school
 * administrator is allowed to read. `not_entitled` is the reachable one: entitlement
 * is recomputed on every request, so an admin whose last class was pulled while
 * the popover was open sees this instead of the raw code. Anything unrecognised
 * (a network failure, a 500, `invalid_body` — which this UI should never trigger
 * itself) gets the same neutral fallback rather than a guess.
 */
function switchErrorMessage(err: unknown, target: Role): string {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    const code = (err.body as Record<string, unknown>).error;
    if (code === 'not_entitled') {
      return `You no longer have a ${ROLE_LABEL[target]} view.`;
    }
    if (code === 'unauthenticated') {
      return 'Your session has expired. Sign in again.';
    }
  }
  return 'Could not switch views. Try again.';
}

type SidebarProfileProps = {
  email: string;
  /** Every view this account may switch into — see `getEntitledRoles`. */
  entitled: readonly Role[];
  /** The view currently being rendered. Presentation only — see lib/auth/active-role.ts. */
  activeRole: Role | null;
};

function deriveInitials(email: string): string {
  return (
    email
      .split('@')[0]
      .split(/[._-]/)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('')
      .slice(0, 2) || 'HF'
  );
}

export function SidebarProfile({
  email,
  entitled,
  activeRole,
}: SidebarProfileProps) {
  const router = useRouter();
  const [switchingTo, setSwitchingTo] = useState<Role | null>(null);
  const initials = deriveInitials(email);
  // The caption follows the VIEW being rendered, not the account's own role —
  // that is what keeps the current view on screen without opening the popover.
  const roleLabel = activeRole ? ROLE_LABEL[activeRole] : '';
  const canSwitchViews = entitled.length > 1;

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  // Posts the chosen view, then leaves for `/` rather than refreshing this
  // page in place. Mr Ace, 2026-09-02: "i think redirect the user to index
  // route" — switching lenses while deep in a page that belongs to the OTHER
  // job can leave the viewer somewhere the new view's nav offers no way back
  // from, and `/` is coherent in either view. Because the whole point is
  // leaving this page, there is no surface left behind to refresh — the
  // arriving page IS the feedback, so this does not go through
  // `useWriteAction` (same reasoning as new-sheet-form.tsx's exemption in
  // __tests__/ui/write-feedback-coverage.test.ts). The local `switchingTo`
  // flag stands in for its "hold a pending flag across the write" guidance,
  // and disables every OTHER row so a double-click cannot fire two switches —
  // the row just clicked stays focusable-but-inert rather than `disabled`, so
  // a failed switch doesn't drop keyboard focus out to `<body>`.
  //
  // `/` has no sidebar and so no caption to confirm the switch landed — the
  // success toast is that confirmation, raised BEFORE navigating so it
  // survives the trip (`Toaster` is mounted in the root layout).
  //
  // `switchingTo` is cleared on both outcomes, not left for unmount to sort
  // out: `/` bounces `p_file_officer` and `admissions` straight back to their
  // own module (KD #173), where this layout instance can be the one that
  // survives the round trip rather than remounting — leaving every row
  // disabled forever if only the failure path cleared it.
  async function switchView(next: Role) {
    if (next === activeRole || switchingTo) return;
    setSwitchingTo(next);
    try {
      await apiFetch(
        '/api/account/active-role',
        jsonInit('POST', { role: next })
      );
      toast.success(`Now viewing as ${ROLE_LABEL[next]}`);
      router.push('/');
      router.refresh();
    } catch (err) {
      toast.error(switchErrorMessage(err, next));
    } finally {
      setSwitchingTo(null);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-indigo to-brand-navy text-[11px] font-semibold text-white shadow-brand-tile">
            {initials}
          </div>
          <div className="min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
            <div
              className="truncate text-xs font-medium text-sidebar-foreground"
              title={email}
            >
              {email}
            </div>
            <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/60">
              {roleLabel}
            </div>
          </div>
          <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[260px] p-0"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-3 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-indigo to-brand-navy text-xs font-semibold text-white shadow-brand-tile">
            {initials}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div
              className="truncate text-[13px] font-medium text-foreground"
              title={email}
            >
              {email}
            </div>
            <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {roleLabel}
            </div>
          </div>
        </div>
        {canSwitchViews && (
          <>
            <div className="p-1.5">
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
                    disabled={switchingTo !== null && !pending}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                      active
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground hover:bg-accent',
                      switchingTo !== null && !pending && 'opacity-60'
                    )}
                  >
                    {pending ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
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
            </div>
            <Separator />
          </>
        )}
        <div className="p-1.5">
          <Link
            href="/account"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <UserCog className="size-4 text-muted-foreground" />
            <span>Account</span>
          </Link>
          <Separator className="my-1.5" />
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <LogOut className="size-4" />
            <span>Sign out</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
