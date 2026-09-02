'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { ROLE_LABEL } from '@/lib/auth/role-labels';
import type { Role } from '@/lib/auth/roles';
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';

// The one place a view switch is actually performed.
//
// Three surfaces do it now — the sidebar profile popover, the topbar switcher
// on `/` and `/account`, and the "Switch to School Admin view" button on the
// wrong-view notice. They look nothing alike and share no markup, but the
// mechanics (post, toast, navigate, map the error to a sentence, hold a
// pending flag) must not drift: a switch that reports success differently
// depending on which control you used is the kind of inconsistency nobody
// reports and everybody notices.

/**
 * The route's error codes are pinned by `__tests__/auth/active-role-route.test.ts`
 * and must stay machine-shaped there — this maps them to what a school
 * administrator is allowed to read. `not_entitled` is the reachable one:
 * entitlement is recomputed on every request, so an admin whose last class was
 * pulled while the popover was open sees this instead of the raw code.
 * Anything unrecognised (a network failure, a 500, `invalid_body` — which this
 * UI should never trigger itself) gets the same neutral fallback rather than a
 * guess.
 */
export function switchErrorMessage(err: unknown, target: Role): string {
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

export type UseViewSwitch = {
  /** The role currently being switched to, or `null` when idle. */
  switchingTo: Role | null;
  /**
   * @param next Which view to switch into. A no-op if it is already active.
   * @param destination Where to land afterwards. Omit for `/` — see the route,
   *   which validates any destination given and echoes back what it accepted.
   */
  switchView: (next: Role, destination?: string) => Promise<void>;
};

export function useViewSwitch(activeRole: Role | null): UseViewSwitch {
  const router = useRouter();
  const [switchingTo, setSwitchingTo] = useState<Role | null>(null);

  // Deliberately not `useWriteAction`: this write NAVIGATES on success, so
  // there is no surface left behind to hold a busy state for or to refresh —
  // the arriving page IS the feedback. Same reasoning as new-sheet-form.tsx's
  // exemption in __tests__/ui/write-feedback-coverage.test.ts. `switchingTo`
  // stands in for its "hold a pending flag across the write" guidance.
  //
  // `/` has no sidebar and so no caption to confirm the switch landed, so the
  // success toast is raised BEFORE navigating (`Toaster` is mounted in the
  // root layout, so it survives the trip).
  //
  // Cleared in `finally`, not only on failure: `/` bounces `p_file_officer`
  // and `admissions` straight back to their own module (KD #173), where this
  // component instance can be the one that survives the round trip rather than
  // remounting — leaving every control disabled forever if only the failure
  // path cleared it.
  async function switchView(next: Role, destination?: string) {
    if (next === activeRole || switchingTo) return;
    setSwitchingTo(next);
    try {
      const res = await apiFetch<{ activeRole: Role; next?: string }>(
        '/api/account/active-role',
        jsonInit(
          'POST',
          destination === undefined
            ? { role: next }
            : { role: next, next: destination }
        )
      );
      toast.success(`Now viewing as ${ROLE_LABEL[next]}`);
      // The SERVER's answer, never the destination we asked for. The route
      // validates it and substitutes `/` for anything that is not an in-app
      // path, so trusting our own input here would put the check back on the
      // client where it proves nothing.
      router.push(res?.next ?? '/');
      router.refresh();
    } catch (err) {
      toast.error(switchErrorMessage(err, next));
    } finally {
      setSwitchingTo(null);
    }
  }

  return { switchingTo, switchView };
}
