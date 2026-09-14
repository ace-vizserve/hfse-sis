import { redirect } from 'next/navigation';

import type { Role } from '@/lib/auth/roles';
import { getSessionUser, type SessionUser } from '@/lib/supabase/server';

/**
 * The page-level half of the three gates a route passes through.
 *
 * A request reaches a page only after the middleware has checked both the
 * session and `isRouteAllowed(pathname, role)` (`lib/supabase/proxy.ts`), and
 * after the module layout has checked the group's role union. This is the third
 * layer: the page stating, in its own file, who may read it.
 *
 * WHY IT EXISTS. 78 of 102 module pages already did this by hand; 24 did not,
 * and inherited their protection entirely from the two layers above. That is
 * not a hole today — the middleware's per-path check is stricter than the
 * layout's group-level union — but it makes those pages silently dependent on
 * layers they never mention, and any future change to either layer (moving the
 * layout's gate behind a Suspense boundary so the shell can paint, say) removes
 * a guarantee nobody can see from the page.
 *
 * ROLES MUST MATCH THE ROUTE TABLE. Pass the same set the page's ROUTE_ACCESS
 * row allows — `__tests__/auth/page-guard-coverage.test.ts` fails if a module
 * page has no guard at all, and `scripts/audit-unguarded-pages.perf.ts` prints
 * the governing rule for every page so the two can be compared.
 *
 * Redirects rather than throwing, matching what the 78 hand-written guards do:
 * `/login` when there is no session at all, `/` when there is one that this
 * page does not admit.
 */
export async function requirePageRoles(
  allowed: readonly Role[]
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!user.role || !allowed.includes(user.role)) redirect('/');
  return user;
}
