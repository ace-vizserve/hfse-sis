'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { ROLE_LABEL } from '@/lib/auth/role-labels';
import type { Role } from '@/lib/auth/roles';
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';
import { createClient } from '@/lib/supabase/client';

/**
 * The route's error codes are pinned by `__tests__/auth/active-role-route.test.ts`
 * and must stay machine-shaped there — this maps them to what a school
 * administrator is allowed to read. `not_entitled` is the reachable one: the
 * route re-reads the account on every call, so an admin whose teacher role was
 * removed while the switcher was open sees this instead of the raw code.
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

/**
 * Performing a role switch — the ONE implementation, shared by the sidebar
 * profile menu and the account page.
 *
 * ⚠ IT LIVES IN A HOOK BECAUSE THERE MUST ONLY EVER BE ONE OF IT. The
 * `refreshSession()` call below is the only one in the repo (CLAUDE.md says
 * so, and that fact is load-bearing). A second copy of this function would be
 * a second place for the re-mint to be forgotten, and forgetting it does not
 * fail loudly — it renders the next page in the role the user just left.
 *
 * It always lands on `/` — Mr Ace's instruction (2026-09-02: "i think redirect
 * the user to index route"). A switch can be triggered from anywhere,
 * including deep inside a page belonging to the OTHER job, and `/` is the one
 * destination coherent in either role.
 *
 * Deliberately not `useWriteAction`: this write NAVIGATES on success, so there
 * is no surface left behind to hold a busy state for or to refresh — the
 * arriving page IS the feedback. Same reasoning as new-sheet-form.tsx's
 * exemption in `__tests__/ui/write-feedback-coverage.test.ts`. `switchingTo`
 * stands in for its "hold a pending flag across the write" guidance.
 */
export function useRoleSwitch(current: Role | null) {
  const router = useRouter();
  const [switchingTo, setSwitchingTo] = useState<Role | null>(null);

  async function switchRole(next: Role) {
    if (next === current || switchingTo) return;
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
      // Cleared in `finally`, not only on failure: `/` bounces `admissions`
      // straight back to their own module (KD #173), where the calling
      // component can survive the round trip rather than remounting — leaving
      // every control disabled forever if only the failure path cleared it.
      setSwitchingTo(null);
    }
  }

  return { switchingTo, switchRole };
}
