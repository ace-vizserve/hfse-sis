/**
 * Pins the `exact:` rule in ROUTE_ACCESS and the one split it exists for.
 *
 * WHY IT EXISTS. `isRouteAllowed` matches a prefix as "this path, or anything
 * beneath it", first match in declaration order. That cannot express "the file
 * but not the folder", and `/admissions/applications` (the funnel list) is a
 * prefix of `/admissions/applications/[enroleeNumber]` (one applicant's
 * record). Migration 106 gave the P-Files officer the pre-enrolment document
 * capabilities, so their validation queue lists applicants — and every name in
 * it links to that record. They need the record; they do not need the funnel.
 *
 * The whole split rests on ORDER: the `exact` row must sit above the subtree
 * row. Swap them and the officer is locked out again, silently. That is the
 * property these tests are really guarding. See KD #173.
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

/** Every role except the officer — their answers must not have moved at all. */
const UNAFFECTED: Role[] = ROLES.filter((r) => r !== 'p_file_officer');

describe('the P-Files officer reaches the applicant file, not the funnel', () => {
  it('may open one applicant record', () => {
    expect(isRouteAllowed(DETAIL, 'p_file_officer')).toBe(true);
  });

  it('may NOT open the applications list', () => {
    expect(isRouteAllowed(LIST, 'p_file_officer')).toBe(false);
  });

  it('may NOT open the closed-applications archive', () => {
    expect(isRouteAllowed(CLOSED, 'p_file_officer')).toBe(false);
  });

  it('gains nothing else in Admissions', () => {
    for (const path of [
      '/admissions',
      '/admissions/insights',
      '/admissions/document-validation',
      '/admissions/feedback',
      '/admissions/cohorts/stp',
      '/admissions/audit-log',
      '/admissions/upcoming/applications',
    ]) {
      expect(isRouteAllowed(path, 'p_file_officer')).toBe(false);
    }
  });
});

describe('no other role moved', () => {
  it.each(UNAFFECTED)('%s is unchanged on all three paths', (role) => {
    // All four non-officer roles were, and remain, allowed on every one of
    // these; the split was carved for the officer alone.
    const expected = [
      'admissions',
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ].includes(role);
    expect(isRouteAllowed(LIST, role)).toBe(expected);
    expect(isRouteAllowed(DETAIL, role)).toBe(expected);
    expect(isRouteAllowed(CLOSED, role)).toBe(expected);
  });
});

describe('the ordering the split depends on', () => {
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
    const exactRules = ROUTE_ACCESS.filter((r) => r.exact);
    expect(exactRules.length).toBeGreaterThan(0);
    for (const rule of exactRules) {
      const deeper = `${rule.prefix}/anything`;
      const matched = ROUTE_ACCESS.find((r) =>
        r.exact
          ? deeper === r.prefix
          : deeper === r.prefix || deeper.startsWith(r.prefix + '/')
      );
      expect(matched).not.toBe(rule);
    }
  });
});
