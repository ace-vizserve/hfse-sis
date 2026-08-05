import { describe, expect, it } from 'vitest';

import {
  ADMISSIONS_FUNNEL_STATUSES,
  CHASE_ENROLLED_STATUSES,
  inChaseLensScope,
} from '@/lib/sis/chase-lens';

// This predicate is what makes KD #124 (count == drill) structural rather than
// aspirational: `document-chase-queue.ts` counts with it and `drill.ts` lists
// with it. If the two ever disagree the card opens a drill that contradicts the
// number on its face, so the behaviour is pinned here.

describe('inChaseLensScope', () => {
  describe('admissions lens — the pre-enrolment funnel', () => {
    it.each(ADMISSIONS_FUNNEL_STATUSES)('admits %s', (status) => {
      expect(inChaseLensScope('admissions', status, null)).toBe(true);
    });

    it.each(CHASE_ENROLLED_STATUSES)('excludes %s', (status) => {
      expect(inChaseLensScope('admissions', status, 'P1-Diligence')).toBe(
        false
      );
    });

    it('excludes terminal statuses', () => {
      expect(inChaseLensScope('admissions', 'Cancelled', null)).toBe(false);
      expect(inChaseLensScope('admissions', 'Withdrawn', null)).toBe(false);
    });

    it('ignores the class section entirely', () => {
      expect(inChaseLensScope('admissions', 'Submitted', null)).toBe(true);
      expect(inChaseLensScope('admissions', 'Submitted', 'P1-Diligence')).toBe(
        true
      );
    });
  });

  describe('p-files lens — enrolled students', () => {
    it.each(CHASE_ENROLLED_STATUSES)('admits %s with a class', (status) => {
      expect(inChaseLensScope('p-files', status, 'P1-Diligence')).toBe(true);
    });

    it.each(ADMISSIONS_FUNNEL_STATUSES)('excludes %s', (status) => {
      expect(inChaseLensScope('p-files', status, 'P1-Diligence')).toBe(false);
    });

    it('excludes a student with no class section', () => {
      expect(inChaseLensScope('p-files', 'Enrolled', null)).toBe(false);
    });

    // PostgREST's `.not('classSection','is',null)` passes '' through, so the
    // predicate has to catch blank strings itself or the count over-reports.
    it('treats a blank or whitespace class section as no class', () => {
      expect(inChaseLensScope('p-files', 'Enrolled', '')).toBe(false);
      expect(inChaseLensScope('p-files', 'Enrolled', '   ')).toBe(false);
    });
  });

  describe('shared behaviour', () => {
    it('admits everyone when no lens is given — back-compat for lens-less callers', () => {
      expect(inChaseLensScope(undefined, 'Cancelled', null)).toBe(true);
      expect(inChaseLensScope(undefined, null, null)).toBe(true);
    });

    it('tolerates a null or padded status string', () => {
      expect(inChaseLensScope('p-files', null, 'P1-Diligence')).toBe(false);
      expect(inChaseLensScope('p-files', '  Enrolled  ', 'P1-Diligence')).toBe(
        true
      );
      expect(inChaseLensScope('admissions', '  Submitted  ', null)).toBe(true);
    });
  });
});
