/**
 * `/account` must be reachable by EVERY role.
 *
 * The regression this exists to prevent (found 2026-07-30): the neutral
 * `(dashboard)` route group's layout ran the single-module redirects
 * (`p_file_officer` -> /p-files, `admissions` -> /admissions) that belong to
 * `/` alone. A layout runs for every child, and `/account` lives in that same
 * group with no other copy anywhere in `app/`, so those two roles bounced
 * straight back out of the one page that hosts the change-password form —
 * while `components/module-sidebar/sidebar-profile.tsx` linked all six roles
 * to it. Two of six roles could not change their password in the app.
 *
 * Nothing in the route table could catch this: `isRouteAllowed('/account', …)`
 * was — and still is — true for every role, because there is no `/account`
 * rule and unmatched prefixes default to allow. The gate that broke it was the
 * layout's own code, which is exactly what the second test reads.
 *
 * The layout is an async Server Component with a top-level Supabase call, so
 * it can't be imported and rendered here; this reads it as text, the same
 * mechanical check as __tests__/audit/allowlist-coverage.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ROLES, isRouteAllowed } from '@/lib/auth/roles';

const DASHBOARD_LAYOUT = 'app/(dashboard)/layout.tsx';
const HOME_PAGE = 'app/(dashboard)/page.tsx';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

/** Every `redirect('…')` target in a file, comments stripped so the prose
 *  explaining why the redirects moved out of the layout isn't mistaken for a
 *  live call. */
function redirectTargets(text: string): string[] {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/redirect\(\s*'([^']+)'/g)].map((m) => m[1]);
}

describe('/account reachability', () => {
  it('is allowed by ROUTE_ACCESS for every role', () => {
    const blocked = ROLES.filter((role) => !isRouteAllowed('/account', role));
    expect(blocked).toEqual([]);
  });

  // The real guard. A role-based redirect here applies to /account too.
  it('the (dashboard) layout redirects only unauthenticated sessions', () => {
    expect(redirectTargets(source(DASHBOARD_LAYOUT))).toEqual([
      '/login',
      '/login',
    ]);
  });

  // …and the module redirects must still exist, on the page where they belong.
  it('the home page still redirects the single-module roles', () => {
    const targets = redirectTargets(source(HOME_PAGE));
    expect(targets).toContain('/p-files');
    expect(targets).toContain('/admissions');
    expect(targets).toContain('/login');
  });
});
