/**
 * Pins the `exact:` rule in ROUTE_ACCESS, and the collapse of the one split it
 * was built for.
 *
 * WHY IT EXISTS. `isRouteAllowed` matches a prefix as "this path, or anything
 * beneath it", first match in declaration order. That cannot express "the file
 * but not the folder", and `/admissions/applications` (the funnel list) is a
 * prefix of `/admissions/applications/[enroleeNumber]` (one applicant's
 * record). Migration 106 gave the P-Files officer the pre-enrolment document
 * capabilities, so their validation queue listed applicants — and every name in
 * it linked to that record. They needed the record; they did not need the
 * funnel. Three rows, ordered exact-then-subtree, said exactly that (KD #173).
 *
 * ⚠ THAT ROLE WAS RETIRED 2026-09-10 and `admissions` — already admitted to the
 * whole funnel — absorbed it. The three rows collapsed to one, and with them
 * went the LAST `exact` row in the table. The mechanism is kept (the field, and
 * `isRouteAllowed`'s handling of it) because "the file, not the folder" is a
 * recurring need; these tests are kept for the same reason, retargeted from
 * "the officer's split works" to the two invariants that make any future
 * `exact` row safe. They are written to hold whether or not the table
 * currently contains one, so re-adding a row is guarded from its first commit.
 */
import { describe, expect, it } from 'vitest';

import {
  ROLES,
  ROUTE_ACCESS,
  isRouteAllowed,
  type Role,
} from '@/lib/auth/roles';

const LIST = '/admissions/applications';
const DETAIL = '/admissions/applications/E12345';
const CLOSED = '/admissions/applications/closed';

const FUNNEL_ROLES = [
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
];

describe('the applicant funnel is now one audience, list and file alike', () => {
  it.each(ROLES)('%s gets the same answer on all three paths', (role: Role) => {
    // The split existed to give ONE role a different answer on the detail path
    // than on the list. Nobody holds that shape any more, so a difference here
    // means a carve-out came back without a row to explain it.
    const expected = FUNNEL_ROLES.includes(role);
    expect(isRouteAllowed(LIST, role)).toBe(expected);
    expect(isRouteAllowed(DETAIL, role)).toBe(expected);
    expect(isRouteAllowed(CLOSED, role)).toBe(expected);
  });

  it('admits exactly the four funnel roles and nobody else', () => {
    expect(ROLES.filter((r) => isRouteAllowed(DETAIL, r)).sort()).toEqual(
      [...FUNNEL_ROLES].sort()
    );
  });
});

describe('the ordering any exact row depends on', () => {
  it('every exact row precedes a same-prefix subtree row', () => {
    ROUTE_ACCESS.forEach((rule, index) => {
      if (!rule.exact) return;
      const subtreeIndex = ROUTE_ACCESS.findIndex(
        (r, i) => i !== index && !r.exact && r.prefix === rule.prefix
      );
      // A same-prefix pair only makes sense as (exact, then subtree). If the
      // subtree row came first it would match the bare path too and the exact
      // row would be dead code.
      if (subtreeIndex !== -1) {
        expect(subtreeIndex).toBeGreaterThan(index);
      }
    });
  });

  it('an exact rule never matches below itself', () => {
    for (const rule of ROUTE_ACCESS.filter((r) => r.exact)) {
      const deeper = `${rule.prefix}/anything`;
      const matched = ROUTE_ACCESS.find((r) =>
        r.exact
          ? deeper === r.prefix
          : deeper === r.prefix || deeper.startsWith(r.prefix + '/')
      );
      expect(matched).not.toBe(rule);
    }
  });

  it('records how many exact rows the table carries', () => {
    // Zero today, and that is the honest state — this is the count, not an
    // assertion that it must stay zero. It exists so the two invariants above
    // are never silently vacuous: if this number moves, they started doing
    // real work and the diff should say why.
    expect(ROUTE_ACCESS.filter((r) => r.exact)).toHaveLength(0);
  });
});
