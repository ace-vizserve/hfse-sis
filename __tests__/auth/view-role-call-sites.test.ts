/**
 * THE CALL-SITE RULE, made executable.
 *
 *        role authorises.  activeRole renders.
 *
 * `resolveClassroomScope` and `loadClassroomAccess` take the role as a
 * PARAMETER and are called from both pages and API routes. Which role each
 * caller passes is the entire security boundary of the role-switcher feature:
 *
 *   • a page or layout passes `activeRole` — it decides what to SHOW;
 *   • an API route passes the real JWT `role` — it decides what to ALLOW.
 *
 * `__tests__/auth/active-role-never-authorises.test.ts` bans an API route from
 * naming the lens at all. It cannot see the mistake this file exists to catch,
 * which is the same mistake made one level down: a route that keeps its hands
 * clean and lets a HELPER read the lens on its behalf. `app/api/classroom/**`
 * fetches with the SERVICE client, so RLS is not behind these calls — the
 * argument at the call site is the whole gate.
 *
 * It also catches the opposite, and that half is not about security at all: a
 * page that keeps passing the real `role` is a page where the Teacher view and
 * the Admin view render identically, which is the defect Phase 3a was written
 * to remove. Both directions are asserted so neither can regress quietly.
 *
 * Comments are stripped before scanning, the same way the sibling guards do it:
 * prose about the rule is welcome, code breaking it is not.
 *
 * ⚠ WHAT THIS GUARD CANNOT SEE, stated so nobody reads it as exhaustive.
 * Discovery is glob-limited to `app/**` + `{page,layout}.tsx` and
 * `app/api/**\/route.ts`. A page that delegated its gate into a colocated
 * server component (`app/(classroom)/classroom/[sectionId]/_gate.tsx`, say) or
 * into a `lib/` helper would be INVISIBLE here — the classification would
 * simply not include it, and both suites would stay green. Same bounded shape
 * as `__tests__/auth/module-inpage-link-reachability.test.ts`, and the same
 * remedy: widen the glob deliberately when the pattern appears, rather than
 * assuming it already covers everything under `app/`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { globSync } from 'tinyglobby';

// The one-pass scanner, shared with the authorization guard. It replaced a
// two-regex helper that silently deleted the `loadClassroomAccess(` call this
// file exists to classify — the whole story, and its own unit tests, live in
// `__tests__/_utils/strip-comments.ts` and its test file.
import {
  assertScannableFiles,
  stripComments,
} from '@/__tests__/_utils/strip-comments';

const ROOT = process.cwd();

/** The two helpers whose first argument is the decision. */
const SCOPE_HELPERS = ['loadClassroomAccess', 'resolveClassroomScope'] as const;

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function posix(file: string): string {
  return file.split('\\').join('/');
}

type CallSite = { file: string; helper: string; firstArg: string };

/**
 * Every `helper(<firstArg>, …)` in a file, where the first argument is a plain
 * identifier or one member access — which is every call site in the repo today
 * (`activeRole`, `viewer.activeRole`, `role`, `auth.role`).
 *
 * ⚠ AND THAT PATTERN CAN MISS. A call written `loadClassroomAccess(cond ? a : b, …)`
 * or `resolveClassroomScope(roleFor(x), …)` matches nothing and would be
 * silently DROPPED rather than reported — a call site could be rewritten into
 * an unmatched form and this guard would stay green while covering one site
 * fewer. `countBareCalls` below closes that: it counts occurrences of the bare
 * `helper(` and the suites assert the two counts agree, so an unparsed call
 * fails the test instead of vanishing from it.
 */
function callSitesIn(file: string): CallSite[] {
  const source = stripComments(read(file));
  const sites: CallSite[] = [];
  for (const helper of SCOPE_HELPERS) {
    const re = new RegExp(`\\b${helper}\\(\\s*([A-Za-z_$][\\w$.]*)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      sites.push({ file: posix(file), helper, firstArg: m[1] });
    }
  }
  return sites;
}

/**
 * How many times either helper is CALLED in a file, however the argument is
 * written. The import statement cannot match — `from '...'` has no `(` after
 * the name — and comments are stripped first, so this counts real calls.
 */
function countBareCalls(file: string): number {
  const source = stripComments(read(file));
  let n = 0;
  for (const helper of SCOPE_HELPERS) {
    n += source.match(new RegExp(`\\b${helper}\\(`, 'g'))?.length ?? 0;
  }
  return n;
}

/**
 * Both suites below assert `parsed === bare` for their own glob. Split out so
 * the failure message can say which side is short, since "12 vs 14" on its own
 * does not tell you whether a call was added or a parse was lost.
 */
function expectEveryCallWasParsed(files: string[], label: string) {
  const parsed = files.flatMap(callSitesIn).length;
  const bare = files.reduce((n, f) => n + countBareCalls(f), 0);
  expect(
    parsed,
    `${label}: ${bare} call(s) to a scope helper, but only ${parsed} had a ` +
      'first argument this guard could read. A call whose first argument is a ' +
      'ternary, a function call or a template is invisible to the ' +
      'classification below — rewrite it as a plain identifier, or teach ' +
      '`callSitesIn` the new shape.'
  ).toBe(bare);
}

/** Anything naming the lens, however it is reached. */
const NAMES_THE_LENS = /activeRole/;

const PAGE_FILES = globSync(['app/**/page.tsx', 'app/**/layout.tsx'], {
  cwd: ROOT,
});
const ROUTE_FILES = globSync(['app/api/**/route.ts'], { cwd: ROOT });

describe('pages render through the lens', () => {
  const sites = PAGE_FILES.flatMap(callSitesIn);

  it('finds the call sites at all — the guard is not vacuous', () => {
    // A refactor that renames either helper, or moves every classroom page,
    // would otherwise turn this whole file into a green no-op.
    //
    // The floor is the TRUE count, not a loose lower bound. It was `>= 12`
    // against 14 real sites, which left room for two to be rewritten into a
    // form `callSitesIn` cannot read while this still passed. Raising it means
    // DELETING a lensed page fails here — which is the point: that is a
    // decision, and it should be made deliberately by editing this number.
    expect(sites.length).toBe(14);
    expect(new Set(sites.map((s) => s.helper))).toEqual(new Set(SCOPE_HELPERS));
  });

  it('every call was parsed — none silently dropped', () => {
    expectEveryCallWasParsed(PAGE_FILES, 'pages and layouts');
  });

  it('every page and layout passes activeRole, not the account role', () => {
    const offenders = sites
      .filter((s) => !NAMES_THE_LENS.test(s.firstArg))
      .map((s) => `${s.file}: ${s.helper}(${s.firstArg}, …)`);
    expect(
      offenders,
      'A page is resolving classroom scope from the account role. It will ' +
        'render identically in both views, which is the whole defect the ' +
        'role switcher exists to fix — pass `activeRole` from getViewContext().'
    ).toEqual([]);
  });
});

describe('API routes authorise on the real role', () => {
  const sites = ROUTE_FILES.flatMap(callSitesIn);

  it('finds the route call sites — the guard is not vacuous', () => {
    // Five today, all under app/api/classroom/**. A FLOOR here, unlike the
    // page side: adding a sixth route that gates on the real role is exactly
    // what should happen, and it should not fail a test. The parse-coverage
    // check below is what stops a new route hiding from the classification.
    expect(sites.length).toBeGreaterThanOrEqual(5);
  });

  it('every call was parsed — none silently dropped', () => {
    expectEveryCallWasParsed(ROUTE_FILES, 'API routes');
  });

  it('no route passes the lens, directly or through a property', () => {
    const offenders = sites
      .filter((s) => NAMES_THE_LENS.test(s.firstArg))
      .map((s) => `${s.file}: ${s.helper}(${s.firstArg}, …)`);
    expect(
      offenders,
      'An API route is resolving access from the active-role lens. These ' +
        'routes read with the SERVICE client, so RLS is not behind them — a ' +
        'cookie would be deciding access. Pass the JWT `role`.'
    ).toEqual([]);
  });
});

describe('the scanner can actually read what it is given', () => {
  // The stripper's own behaviour is pinned in
  // `__tests__/_utils/strip-comments.test.ts`, next to the shared util. What
  // belongs HERE is the question that is specific to this guard's inputs: did
  // the scanner survive every file in THIS scan set, or did one of them leave
  // it stuck mid-string / mid-comment and quietly delete the rest?
  //
  // Over-stripping is silent and always passes, so this is the only assertion
  // in the file that can tell "no offenders" apart from "no text left".
  it('every scanned file parses to completion', () => {
    assertScannableFiles(
      [...PAGE_FILES, ...ROUTE_FILES].map((f) => ({
        path: posix(f),
        source: read(f),
      }))
    );
  });
});

describe('the helpers stay callable from both sides', () => {
  it('neither reads the lens itself', () => {
    // The failure the two suites above cannot see: if either helper started
    // calling `getViewContext()` internally, every route would keep passing a
    // real role and still be answered from the cookie.
    for (const file of ['lib/classroom/scope.ts', 'lib/classroom/queries.ts']) {
      const source = stripComments(read(file));
      expect(source, `${file} must not import the lens`).not.toMatch(
        /@\/lib\/auth\/(view-context|active-role)/
      );
      expect(source, `${file} must not name the lens`).not.toMatch(
        NAMES_THE_LENS
      );
    }
  });
});
