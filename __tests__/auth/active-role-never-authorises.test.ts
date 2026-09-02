/**
 * THE GUARD. One rule, and the whole role-switcher feature is safe only while
 * it holds:
 *
 *        role authorises.  activeRole renders.
 *
 * `activeRole` is a value the VIEWER chooses. It is validated against their own
 * entitlement on every read (lib/auth/active-role.ts), so it can only ever name
 * a role they already hold — but "only ever" is a property of today's code, and
 * the moment an authorization gate branches on it, a cookie is deciding access.
 *
 * The failure this prevents is not hypothetical in shape: a nav or scope
 * surface starts reading the lens (that is what Phases 2 and 3 do), the
 * identifier spreads, and somebody reaches for it inside a route handler
 * because it is already in scope and reads like the right word. Nothing else in
 * the codebase would object — it type-checks, it runs, and it grants.
 *
 * So the gates are named explicitly and scanned. Comments are stripped first:
 * a line in `require-role.ts` saying "never read activeRole here" is exactly the
 * kind of note this repo wants, and it must not fail the build.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { globSync } from 'tinyglobby';

const ROOT = process.cwd();

// The route that OWNS the lens — it writes the cookie, so it is the one place
// in `app/api/**` the identifier belongs.
const LENS_ROUTE = 'app/api/account/active-role/route.ts';

// Every authorization gate in the app — the six files where a wrong answer is
// an access decision, not a rendering one.
//
//   require-role.ts        what API routes call
//   require-capability.ts  its capability sibling
//   proxy.ts               the edge gate in front of every page
//   permission-map.ts      "who holds what right now"
//   roles.ts               ⚠ `isRouteAllowed` IS the route gate. proxy.ts only
//                          imports it, so scanning the proxy alone would miss a
//                          lens branch written one file upstream of it.
//   capabilities.ts        ⚠ `can()` IS the capability decision. Same shape:
//                          require-capability.ts is the caller, this is the
//                          answer.
const GATES = [
  'lib/auth/require-role.ts',
  'lib/auth/require-capability.ts',
  'lib/supabase/proxy.ts',
  'lib/auth/permission-map.ts',
  'lib/auth/roles.ts',
  'lib/auth/capabilities.ts',
];

// ⚠ WHAT IS DELIBERATELY *NOT* IN `GATES`, AND MUST NOT BE ADDED.
//
// `lib/classroom/scope.ts` and the ~30 `app/**/page.tsx` / `layout.tsx` scoping
// branches are NOT gates, and putting them here would block Phase 3, which
// threads the lens through them BY DESIGN — `resolveClassroomScope` is meant to
// take it.
//
// The distinction is the whole invariant: a gate decides whether you may have
// the data at all, and it runs on `role`, the JWT claim. Scope narrowing
// decides which of the data you have ALREADY been authorised for is worth
// showing you, and it fails closed — a lens can only ever show a teaching
// admin LESS than their account role already reaches. The proxy, ROUTE_ACCESS,
// the page guards and RLS have all already said yes by the time any of those
// files run.
//
// So if you arrived here because a page or a scope resolver reads the lens:
// that is the feature working, not a hole in this test. Ruled 2026-09-02.
const NOT_GATES_BY_DESIGN = [
  'lib/classroom/scope.ts',
  'app/**/page.tsx',
  'app/**/layout.tsx',
];

// The two modules that DEFINE the lens. A gate importing either one is the same
// failure as a gate naming `activeRole` — and it is the failure the identifier
// scan alone cannot see, because a gate can branch on `view.entitled`, or pull
// `ACTIVE_ROLE_COOKIE` straight out of `cookies()`, without the word
// `activeRole` appearing anywhere in it.
const LENS_MODULES = ['@/lib/auth/view-context', '@/lib/auth/active-role'];

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

// Same approach as __tests__/auth/assignment-read-classification.test.ts: prose
// about the rule is welcome, code acting on it is not. A match sitting after a
// `//` is commented-out code and is correctly ignored too.
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// The cookie's name and its constant count as the lens too: a gate could read
// the raw cookie itself and never write `activeRole` once.
const LENS_IDENTIFIER =
  /\bactiveRole\b|\bACTIVE_ROLE_COOKIE\b|hfse_active_role/;

describe('activeRole never reaches an authorization gate', () => {
  it('scans the gates that actually decide, not just the ones that ask', () => {
    // A sanity check on the list itself: `isRouteAllowed` and `can()` are the
    // two functions that return the yes/no, and both live one file upstream of
    // the callers people think of as "the gate".
    expect(read('lib/auth/roles.ts')).toMatch(/export function isRouteAllowed/);
    expect(read('lib/auth/capabilities.ts')).toMatch(/export function can\(/);
  });

  it('does not gate the surfaces Phase 3 threads the lens through', () => {
    // Executable form of the NOT_GATES_BY_DESIGN ruling above — appending any
    // of these to GATES would block the feature, so it fails here first, next
    // to the reasoning.
    for (const path of NOT_GATES_BY_DESIGN) {
      expect(GATES).not.toContain(path);
    }
  });

  it('no gate imports the lens at all', () => {
    // Stronger than the identifier scan and aimed at what it cannot see: a gate
    // that branches on `view.entitled` from getViewContext, or reads the cookie
    // constant. If a gate cannot import the lens, it cannot consult it.
    const offenders: string[] = [];
    for (const file of GATES) {
      const source = stripComments(read(file));
      for (const mod of LENS_MODULES) {
        if (source.includes(mod)) offenders.push(`${file} imports ${mod}`);
      }
    }
    expect(
      offenders,
      'An authorization gate imports the active-role lens. Even reading it "just ' +
        'for logging" puts a viewer-chosen value inside the decision — gate on ' +
        '`role` or a capability, and leave the lens to the surfaces that render.'
    ).toEqual([]);
  });

  it('is absent from every gate', () => {
    const offenders = GATES.filter((file) =>
      LENS_IDENTIFIER.test(stripComments(read(file)))
    );
    expect(
      offenders,
      'These files decide ACCESS. `activeRole` is a lens the viewer picks — ' +
        'gate on `role` (the JWT claim) or on a capability instead.'
    ).toEqual([]);
  });

  it('is absent from every API route but the one that sets it', () => {
    const routes = globSync(['app/api/**/route.ts'], { cwd: ROOT }).filter(
      (file) => file.split('\\').join('/') !== LENS_ROUTE
    );

    // Guards against a glob change silently emptying this test.
    expect(routes.length).toBeGreaterThan(80);

    const offenders = routes.filter((file) =>
      LENS_IDENTIFIER.test(stripComments(read(file)))
    );
    expect(
      offenders,
      'An API route is reading the active-role lens. Routes answer "may you ' +
        'do this", and the lens answers "what are you looking at" — a route ' +
        'branching on it lets a cookie decide access.'
    ).toEqual([]);
  });

  it('the exemption is not vacuous — the lens route really does write the cookie', () => {
    // If the route were ever renamed or deleted, the exclusion above would
    // quietly become a no-op filter and nobody would notice.
    const source = read(LENS_ROUTE);
    expect(source).toMatch(/ACTIVE_ROLE_COOKIE/);
    expect(source).toMatch(/cookies\.set/);
  });
});

describe('the lens is defined where it can be found', () => {
  it('lives in lib/auth/active-role.ts and lib/auth/view-context.ts only', () => {
    // Both halves are deliberately outside `lib/supabase/server.ts`:
    // `getSessionUser` stays JWT-pure (no network round-trip, ~84 call sites),
    // so the lens — which needs an assignments read — cannot live on
    // `SessionUser`. Asserted so a later phase does not quietly move it back.
    expect(read('lib/supabase/server.ts')).not.toMatch(LENS_IDENTIFIER);
    expect(stripComments(read('lib/auth/view-context.ts'))).toMatch(
      LENS_IDENTIFIER
    );
  });
});
