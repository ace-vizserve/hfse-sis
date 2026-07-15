import { describe, expect, it } from 'vitest';

import { checklistSummary } from '@/lib/sis/year-setup';
import type { AcademicYearListItem, TermRow } from '@/lib/sis/ay-setup/queries';
import type { ReadinessStep } from '@/lib/sis/readiness';

function makeStep(overrides: Partial<ReadinessStep> = {}): ReadinessStep {
  return {
    id: 'ay-setup',
    step: 1,
    label: 'Term dates',
    description: '',
    href: '/sis/ay-setup',
    status: 'not_started',
    required: true,
    ...overrides,
  };
}

function makeAy(
  overrides: Partial<AcademicYearListItem> = {}
): AcademicYearListItem {
  return {
    id: 'ay-id',
    ay_code: 'AY2026',
    label: 'Academic Year 2026',
    is_current: true,
    accepting_applications: false,
    created_at: '2026-01-01',
    counts: { terms: 4, sections: 0, subject_configs: 0, section_students: 0 },
    has_children: false,
    ...overrides,
  };
}

function makeTerm(overrides: Partial<TermRow> = {}): TermRow {
  return {
    id: 't1',
    academic_year_id: 'ay-id',
    term_number: 1,
    label: 'Term 1',
    start_date: null,
    end_date: null,
    is_current: false,
    virtue_theme: null,
    grading_lock_date: null,
    ...overrides,
  };
}

describe('checklistSummary', () => {
  describe('ay-setup (term dates)', () => {
    it('reports no terms configured when there are none', () => {
      expect(
        checklistSummary('ay-setup', {
          step: makeStep(),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('No terms configured for this year yet.');
    });

    it('reports no term dates yet when terms exist but none are dated', () => {
      const terms = [
        makeTerm({ term_number: 1 }),
        makeTerm({ term_number: 2, id: 't2' }),
      ];
      expect(
        checklistSummary('ay-setup', { step: makeStep(), ay: makeAy(), terms })
      ).toBe('No term dates yet.');
    });

    it('reports the dated fraction and T1 window when T1 is dated (en-SG, no year)', () => {
      const terms = [
        makeTerm({
          id: 't1',
          term_number: 1,
          start_date: '2026-01-06',
          end_date: '2026-03-21',
        }),
        makeTerm({ id: 't2', term_number: 2 }),
      ];
      expect(
        checklistSummary('ay-setup', {
          step: makeStep({ status: 'partial' }),
          ay: makeAy(),
          terms,
        })
      ).toBe('1 of 2 terms dated · T1 6 Jan – 21 Mar');
    });

    it('omits the T1 window when T1 itself is not dated', () => {
      const terms = [
        makeTerm({ id: 't1', term_number: 1 }),
        makeTerm({
          id: 't2',
          term_number: 2,
          start_date: '2026-04-01',
          end_date: '2026-06-01',
        }),
      ];
      expect(
        checklistSummary('ay-setup', {
          step: makeStep({ status: 'partial' }),
          ay: makeAy(),
          terms,
        })
      ).toBe('1 of 2 terms dated.');
    });

    it('singularizes for a single dated term', () => {
      const terms = [
        makeTerm({
          id: 't1',
          term_number: 1,
          start_date: '2026-01-06',
          end_date: '2026-03-21',
        }),
      ];
      expect(
        checklistSummary('ay-setup', {
          step: makeStep({ status: 'done' }),
          ay: makeAy(),
          terms,
        })
      ).toBe('1 of 1 term dated · T1 6 Jan – 21 Mar');
    });
  });

  describe('calendar', () => {
    it('falls back to "set term dates first" when there is no fraction', () => {
      expect(
        checklistSummary('calendar', {
          step: makeStep({
            id: 'calendar',
            status: 'not_started',
            fraction: undefined,
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('Set term dates first.');
    });

    // NOTE: `resolveCalendarStep` (lib/sis/readiness.ts) never actually
    // produces a `fraction` object when `totalTerms === 0` — it returns
    // `fraction: undefined` in that case, same as the "no fraction" branch
    // above. So `{ done: 0, total: 0 }` is a synthetic/unreachable-in-prod
    // state; it's still exercised here for defensive coverage, with its
    // expectation updated to match the Phase 2 branch (which has no special
    // `total === 0` guard — it falls through to the done===total case).
    it('reports full coverage (0/0) for the unreachable-in-prod all-zero fraction', () => {
      expect(
        checklistSummary('calendar', {
          step: makeStep({
            id: 'calendar',
            status: 'not_started',
            fraction: { done: 0, total: 0 },
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('School days cover all 0 terms.');
    });

    it('names the blocking consequence when done is 0 but terms exist', () => {
      expect(
        checklistSummary('calendar', {
          step: makeStep({
            id: 'calendar',
            status: 'not_started',
            fraction: { done: 0, total: 4 },
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe(
        "4 terms still have unmarked dates — attendance entry will be blocked there until they're set."
      );
    });

    it('partial state names the blocking consequence, not just a fraction (Phase 2 consequence-first copy)', () => {
      const summary = checklistSummary('calendar', {
        step: makeStep({
          id: 'calendar',
          status: 'partial',
          fraction: { done: 3, total: 4 },
        }),
        ay: makeAy(),
        terms: [],
      });
      expect(summary).toBe(
        "1 term still has unmarked dates — attendance entry will be blocked there until they're set."
      );
      expect(summary).toContain('will be blocked');
    });

    it('reports full coverage', () => {
      expect(
        checklistSummary('calendar', {
          step: makeStep({
            id: 'calendar',
            status: 'done',
            fraction: { done: 4, total: 4 },
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('School days cover all 4 terms.');
    });
  });

  describe('sections', () => {
    // NEW (Task 5, migration-080 follow-up) — split out of the old combined
    // 'classes' step. Pattern-matches the 'advisers' case's shape.
    it('falls back to plain-English when there is no fraction', () => {
      expect(
        checklistSummary('sections', {
          step: makeStep({
            id: 'sections',
            status: 'not_started',
            fraction: undefined,
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('No grade levels in use yet.');
    });

    it('reports no grade levels in use yet when the fraction total is 0', () => {
      expect(
        checklistSummary('sections', {
          step: makeStep({
            id: 'sections',
            status: 'not_started',
            fraction: { done: 0, total: 0 },
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('No grade levels in use yet.');
    });

    it('reports the sections fraction', () => {
      expect(
        checklistSummary('sections', {
          step: makeStep({
            id: 'sections',
            status: 'partial',
            fraction: { done: 2, total: 5 },
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('2 of 5 grade levels have at least one class section.');
    });

    it('singularizes for a single grade level', () => {
      expect(
        checklistSummary('sections', {
          step: makeStep({
            id: 'sections',
            status: 'done',
            fraction: { done: 1, total: 1 },
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('1 of 1 grade level have at least one class section.');
    });
  });

  describe('subject-weights', () => {
    // NOTE: this branch was rewired from raw `ay.counts` (a meaningless
    // total — "12 classes · 48 subject weights" said nothing about
    // completeness) to `step.fraction`, which `lib/sis/readiness.ts`'s
    // `resolveSubjectWeightsStep` (renamed from `resolveClassesStep`, Task 5
    // — decoupled from section existence) now computes as levels-fully-
    // configured vs levels-in-use (comparing each in-use level's
    // subject_level_offerings against template_subject_level_offerings,
    // i.e. Structure Defaults). The two tests below that used to assert on
    // the old `ay.counts`-derived copy were deliberately rewritten to
    // assert on the new fraction-derived, consequence-first copy — not
    // silently left to bit-rot.
    it('reports no classes created yet when there is no fraction', () => {
      expect(
        checklistSummary('subject-weights', {
          step: makeStep({
            id: 'subject-weights',
            status: 'not_started',
            fraction: undefined,
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('No classes created yet.');
    });

    it('reports no classes created yet when the fraction total is 0', () => {
      expect(
        checklistSummary('subject-weights', {
          step: makeStep({
            id: 'subject-weights',
            status: 'not_started',
            fraction: { done: 0, total: 0 },
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('No classes created yet.');
    });

    it('reports full completion when every level is configured', () => {
      expect(
        checklistSummary('subject-weights', {
          step: makeStep({
            id: 'subject-weights',
            status: 'done',
            fraction: { done: 3, total: 3 },
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe("Every level's subjects are configured (3/3).");
    });

    it('partial state names what disappears from the report card (Phase 2 consequence-first copy)', () => {
      const summary = checklistSummary('subject-weights', {
        step: makeStep({
          id: 'subject-weights',
          status: 'partial',
          fraction: { done: 2, total: 3 },
        }),
        ay: makeAy(),
        terms: [],
      });
      expect(summary).toBe(
        "1 level is missing subjects from Structure Defaults — those subjects won't appear on report cards."
      );
      expect(summary).toContain("won't appear on report cards");
    });

    it('pluralizes the gap for multiple missing levels', () => {
      expect(
        checklistSummary('subject-weights', {
          step: makeStep({
            id: 'subject-weights',
            status: 'partial',
            fraction: { done: 1, total: 3 },
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe(
        "2 levels are missing subjects from Structure Defaults — those subjects won't appear on report cards."
      );
    });
  });

  describe('advisers', () => {
    it('falls back to plain-English when there is no fraction', () => {
      expect(
        checklistSummary('advisers', {
          step: makeStep({
            id: 'advisers',
            status: 'not_started',
            fraction: undefined,
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('No classes to assign advisers to yet.');
    });

    it('reports the advised fraction', () => {
      expect(
        checklistSummary('advisers', {
          step: makeStep({
            id: 'advisers',
            status: 'partial',
            fraction: { done: 2, total: 5 },
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('2 of 5 classes have a form adviser.');
    });
  });

  describe('grading-sheets', () => {
    it('falls back to plain-English when there is no fraction', () => {
      expect(
        checklistSummary('grading-sheets', {
          step: makeStep({
            id: 'grading-sheets',
            status: 'not_started',
            fraction: undefined,
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('No classes yet.');
    });

    it('reports the sheets fraction', () => {
      expect(
        checklistSummary('grading-sheets', {
          step: makeStep({
            id: 'grading-sheets',
            status: 'partial',
            fraction: { done: 1, total: 3 },
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('1 of 3 classes have grading sheets.');
    });
  });

  describe('virtue-themes', () => {
    it('falls back to plain-English when there is no fraction', () => {
      expect(
        checklistSummary('virtue-themes', {
          step: makeStep({
            id: 'virtue-themes',
            status: 'not_started',
            fraction: undefined,
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('No Terms 1–3 yet.');
    });

    it('reports the theme fraction', () => {
      expect(
        checklistSummary('virtue-themes', {
          step: makeStep({
            id: 'virtue-themes',
            status: 'partial',
            fraction: { done: 1, total: 3 },
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('1 of 3 terms have a virtue theme set.');
    });
  });

  describe('letterhead', () => {
    it('reports done', () => {
      expect(
        checklistSummary('letterhead', {
          step: makeStep({ id: 'letterhead', status: 'done' }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('Organization name and address are set.');
    });

    it('reports partial', () => {
      expect(
        checklistSummary('letterhead', {
          step: makeStep({ id: 'letterhead', status: 'partial' }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('Partly set — organization name or address is missing.');
    });

    it('reports not started', () => {
      expect(
        checklistSummary('letterhead', {
          step: makeStep({ id: 'letterhead', status: 'not_started' }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('No letterhead configured yet.');
    });
  });

  describe('app-window', () => {
    it('reports live for the current AY when accepting', () => {
      expect(
        checklistSummary('app-window', {
          step: makeStep({ id: 'app-window', status: 'done', required: false }),
          ay: makeAy({ accepting_applications: true, is_current: true }),
          terms: [],
        })
      ).toBe('Live — parents can apply for this year.');
    });

    it('reports early-bird open for a non-current AY when accepting', () => {
      expect(
        checklistSummary('app-window', {
          step: makeStep({ id: 'app-window', status: 'done', required: false }),
          ay: makeAy({ accepting_applications: true, is_current: false }),
          terms: [],
        })
      ).toBe('Open for early-bird applications.');
    });

    it('reports closed when not accepting', () => {
      expect(
        checklistSummary('app-window', {
          step: makeStep({
            id: 'app-window',
            status: 'not_started',
            required: false,
          }),
          ay: makeAy({ accepting_applications: false }),
          terms: [],
        })
      ).toBe('Closed — parents cannot apply yet.');
    });
  });
});
