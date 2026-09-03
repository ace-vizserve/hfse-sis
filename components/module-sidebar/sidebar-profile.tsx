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
import { ROLE_LABEL } from '@/lib/auth/role-labels';
import type { Role } from '@/lib/auth/roles';
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

type SidebarProfileProps = {
  email: string;
  /**
   * Every role this account holds, from `sessionUser.roles`. One entry is not
   * a choice, so the "Switch view" section renders only above one.
   */
  roles: readonly Role[];
  /**
   * The role in force. This is the account's REAL role — it authorises, and it
   * is also what the caption reads — because switching now rewrites
   * `app_metadata.active_role` rather than painting a different view over a
   * fixed one.
   */
  role: Role | null;
};

/**
 * The route's error codes are pinned by `__tests__/auth/active-role-route.test.ts`
 * and must stay machine-shaped there — this maps them to what a school
 * administrator is allowed to read. `not_entitled` is the reachable one: the
 * route re-reads the account on every call, so an admin whose teacher role was
 * removed while this popover was open sees this instead of the raw code.
 * Anything unrecognised (a network failure, a 500, `invalid_body` — which this
 * UI should never trigger itself) gets the same neutral fallback.
 */
export function switchErrorMessage(err: unknown, target: Role): string {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    const code = (err.body as Record<string, unknown>).error;
    if (code === 'not_entitled') {
      return `You no longer have the ${ROLE_LABEL[target]} role.`;
    }
    if (code === 'switch_failed') {
      return `Could not switch to ${ROLE_LABEL[target]}. Try again.`;
    }
    if (code === 'unauthenticated') {
      return 'Your session has expired. Sign in again.';
    }
  }
  return 'Could not switch views. Try again.';
}

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

export function SidebarProfile({ email, roles, role }: SidebarProfileProps) {
  const router = useRouter();
  const [switchingTo, setSwitchingTo] = useState<Role | null>(null);
  const initials = deriveInitials(email);
  const roleLabel = role ? ROLE_LABEL[role] : '';
  const canSwitchViews = roles.length > 1;

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  // The one place in the app a role switch is performed.
  //
  // It always lands on `/` — Mr Ace's instruction (2026-09-02: "i think
  // redirect the user to index route"). Switching from the profile menu can
  // happen anywhere, including deep in a page belonging to the OTHER job, and
  // `/` is the one destination coherent in either role.
  //
  // Deliberately not `useWriteAction`: this write NAVIGATES on success, so
  // there is no surface left behind to hold a busy state for or to refresh —
  // the arriving page IS the feedback. Same reasoning as new-sheet-form.tsx's
  // exemption in __tests__/ui/write-feedback-coverage.test.ts. `switchingTo`
  // stands in for its "hold a pending flag across the write" guidance.
  //
  // `switchingTo` is cleared in `finally`, not only on failure: `/` bounces
  // `p_file_officer` and `admissions` straight back to their own module
  // (KD #173), where this component instance can survive the round trip rather
  // than remounting — leaving every row disabled forever if only the failure
  // path cleared it.
  async function switchView(next: Role) {
    if (next === role || switchingTo) return;
    setSwitchingTo(next);
    try {
      await apiFetch<{ role: Role }>(
        '/api/account/active-role',
        jsonInit('POST', { role: next })
      );
      // ⚠ THE SESSION HAS TO BE RE-MINTED BEFORE WE NAVIGATE, AND THIS IS THE
      // ONLY PLACE IN THE APP THAT DOES IT.
      //
      // The switch wrote `app_metadata.active_role` on the account. Every
      // server read of the role goes through `getClaims()`, which verifies the
      // access token LOCALLY and never re-fetches it — so the token this
      // browser is holding still says the old role, and can for up to an hour.
      // Navigating first would render the next page in the role we just left,
      // and look like the switch silently failed.
      //
      // `refreshSession()` exchanges the refresh token for a new access token
      // carrying the new `app_metadata`, and writes the cookies the server
      // reads. It is awaited, not fired alongside the navigation, because the
      // very next request has to carry the new token.
      //
      // A failure here is reported rather than swallowed: the role HAS changed
      // on the account, so a silent failure would leave the app rendering one
      // role while the account is another until the token next rotates — the
      // exact confusion this await exists to prevent. Signing out and back in
      // is the recovery, and it always works.
      const { error: refreshError } =
        await createClient().auth.refreshSession();
      if (refreshError) {
        toast.error(
          `You are now a ${ROLE_LABEL[next]}, but this browser is still showing the old one. Sign out and back in to finish.`
        );
        return;
      }

      // `/` has no sidebar and so no caption to confirm the switch landed, so
      // the toast is raised BEFORE navigating (`Toaster` is mounted in the root
      // layout, so it survives the trip).
      toast.success(`Now working as ${ROLE_LABEL[next]}`);
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
              {roles.map((r) => {
                const active = r === role;
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
