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
      expect(inChaseLensScope('admissions', status)).toBe(true);
    });

    it.each(CHASE_ENROLLED_STATUSES)('excludes %s', (status) => {
      expect(inChaseLensScope('admissions', status)).toBe(false);
    });

    it('excludes terminal statuses', () => {
      expect(inChaseLensScope('admissions', 'Cancelled')).toBe(false);
      expect(inChaseLensScope('admissions', 'Withdrawn')).toBe(false);
    });
  });

  describe('p-files lens — enrolled students', () => {
    it.each(CHASE_ENROLLED_STATUSES)('admits %s', (status) => {
      expect(inChaseLensScope('p-files', status)).toBe(true);
    });

    it.each(ADMISSIONS_FUNNEL_STATUSES)('excludes %s', (status) => {
      expect(inChaseLensScope('p-files', status)).toBe(false);
    });

    it('excludes terminal statuses', () => {
      expect(inChaseLensScope('p-files', 'Cancelled')).toBe(false);
      expect(inChaseLensScope('p-files', 'Withdrawn')).toBe(false);
    });

    // The point of the change. Class assignment is step 11 and trails
    // enrolment, so gating document chasing on it left enrolled students
    // unwatched for however long placement took.
    it('admits an enrolled student who has no class yet', () => {
      expect(inChaseLensScope('p-files', 'Enrolled')).toBe(true);
      expect(inChaseLensScope('p-files', 'Enrolled (Conditional)')).toBe(true);
    });
  });

  describe('shared behaviour', () => {
    it('admits everyone when no lens is given — back-compat for lens-less callers', () => {
      expect(inChaseLensScope(undefined, 'Cancelled')).toBe(true);
      expect(inChaseLensScope(undefined, null)).toBe(true);
    });

    it('tolerates a null or padded status string', () => {
      expect(inChaseLensScope('p-files', null)).toBe(false);
      expect(inChaseLensScope('p-files', '  Enrolled  ')).toBe(true);
      expect(inChaseLensScope('admissions', '  Submitted  ')).toBe(true);
    });

    it('never puts the same student in both lenses', () => {
      const all = [
        ...ADMISSIONS_FUNNEL_STATUSES,
        ...CHASE_ENROLLED_STATUSES,
        'Cancelled',
        'Withdrawn',
      ];
      for (const status of all) {
        const both =
          inChaseLensScope('admissions', status) &&
          inChaseLensScope('p-files', status);
        expect(both, `${status} appeared in both lenses`).toBe(false);
      }
    });
  });
});
