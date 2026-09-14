/**
 * Every module page that renders or reads anything states who may see it.
 *
 * Three layers gate a route: the middleware (`lib/supabase/proxy.ts` — session
 * plus `isRouteAllowed(pathname, role)`), the module layout's group-level role
 * union, and the page itself. The first two are real and neither is going away,
 * but a page that names no roles is protected only by layers it never mentions,
 * and any change to either layer silently changes what reaches it.
 *
 * An audit on 2026-09-14 found 24 of 102 module pages with no guard of their
 * own. Seven of them rendered or read data — including `/markbook/grading`,
 * which READ the viewer's role to decide which buttons to draw and then never
 * turned anyone away. Drawing fewer controls is not a gate.
 *
 * The other seventeen are pure redirect stubs: they render nothing, read
 * nothing, and forward to a destination that guards itself. Guarding those buys
 * nothing, so they are listed below rather than given a token check — but the
 * list is explicit, so adding a page to it is a decision.
 *
 * `scripts/audit-unguarded-pages.perf.ts` prints the ROUTE_ACCESS row governing
 * every page, which is where a new guard's role list should come from.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const GROUPS = [
  'app/(sis)',
  'app/(markbook)',
  'app/(attendance)',
  'app/(records)',
  'app/(admissions)',
  'app/(evaluation)',
  'app/(p-files)',
  'app/(classroom)',
];

/**
 * Pages that forward and nothing else. Each renders no JSX and reads no data,
 * so there is nothing to protect — the destination does its own checking.
 *
 * ⚠ A page belongs here only while it stays a pure redirect. The moment it
 * renders something or queries anything, it needs a guard and must come off
 * this list.
 */
const REDIRECT_ONLY = new Set([
  'app/(admissions)/admissions/compare/page.tsx',
  'app/(attendance)/attendance/calendar/page.tsx',
  'app/(attendance)/attendance/compare/page.tsx',
  'app/(evaluation)/evaluation/compare/page.tsx',
  'app/(markbook)/markbook/compare/page.tsx',
  'app/(markbook)/markbook/grading/advisory/[id]/comments/page.tsx',
  'app/(markbook)/markbook/masterfile/page.tsx',
  'app/(markbook)/markbook/sections/[id]/attendance/page.tsx',
  'app/(markbook)/markbook/sections/[id]/comments/page.tsx',
  'app/(markbook)/markbook/sections/[id]/page.tsx',
  'app/(p-files)/p-files/compare/page.tsx',
  'app/(records)/records/academic-summary/attendance/page.tsx',
  'app/(records)/records/academic-summary/awards/page.tsx',
  'app/(records)/records/academic-summary/comments/page.tsx',
  'app/(records)/records/compare/page.tsx',
  'app/(records)/records/discount-codes/page.tsx',
  'app/(sis)/sis/admin/users/page.tsx',
]);

/** Anything that refuses a viewer. Reading the role is NOT one of these. */
const GUARD = /requirePageRoles|getSessionUser|requireRole|requireCapability/;

function modulePages(): string[] {
  return execSync(
    'find ' + GROUPS.map((g) => '"' + g + '"').join(' ') + ' -name page.tsx',
    { encoding: 'utf8' }
  )
    .split('\n')
    .map((s) => s.trim().split('\\').join('/'))
    .filter(Boolean);
}

describe('page guard coverage', () => {
  const pages = modulePages();

  it('finds the module pages at all (sanity check on the glob)', () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  it('gives every non-redirect module page a guard of its own', () => {
    const unguarded = pages.filter(
      (f) => !REDIRECT_ONLY.has(f) && !GUARD.test(readFileSync(f, 'utf8'))
    );
    expect(
      unguarded,
      'These pages render or read data but name no roles, so they are protected ' +
        'only by the middleware and the module layout. Add ' +
        '`await requirePageRoles([...])` with the roles from this path\u2019s ' +
        'ROUTE_ACCESS row \u2014 `npx tsx scripts/audit-unguarded-pages.perf.ts` ' +
        'prints it:\n  ' +
        unguarded.join('\n  ')
    ).toEqual([]);
  });

  it('keeps the redirect-only list honest — every entry still exists', () => {
    // A stale entry would silently exempt a path that has since been rewritten
    // into a real page, or deleted and recreated elsewhere.
    const present = new Set(pages);
    const missing = [...REDIRECT_ONLY].filter((f) => !present.has(f));
    expect(
      missing,
      'Listed as redirect-only but no longer present — remove from the list:\n  ' +
        missing.join('\n  ')
    ).toEqual([]);
  });

  it('keeps the redirect-only list honest — every entry still only redirects', () => {
    // The exemption is "renders nothing, reads nothing". If one of these grows
    // a JSX return, the exemption stops being true and the page needs a guard.
    const nowRenders = [...REDIRECT_ONLY].filter((f) => {
      const src = readFileSync(f, 'utf8');
      const code = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      return /return\s*\(/.test(code);
    });
    expect(
      nowRenders,
      'Exempted as redirect-only but these now render something — they need a ' +
        'guard, and must come off REDIRECT_ONLY:\n  ' +
        nowRenders.join('\n  ')
    ).toEqual([]);
  });
});
