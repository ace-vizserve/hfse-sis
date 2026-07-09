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

    it('falls back to "set term dates first" when the fraction total is 0', () => {
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
      ).toBe('Set term dates first.');
    });

    it('reports no school days generated yet when done is 0 but terms exist', () => {
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
      ).toBe('No school days generated yet (4 terms).');
    });

    it('reports partial coverage', () => {
      expect(
        checklistSummary('calendar', {
          step: makeStep({
            id: 'calendar',
            status: 'partial',
            fraction: { done: 3, total: 4 },
          }),
          ay: makeAy(),
          terms: [],
        })
      ).toBe('School days cover 3 of 4 terms.');
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
      ).toBe('School days cover 4 of 4 terms.');
    });
  });

  describe('classes', () => {
    it('reports no classes created yet when both counts are 0', () => {
      expect(
        checklistSummary('classes', {
          step: makeStep({ id: 'classes', status: 'not_started' }),
          ay: makeAy({
            counts: {
              terms: 4,
              sections: 0,
              subject_configs: 0,
              section_students: 0,
            },
          }),
          terms: [],
        })
      ).toBe('No classes created yet.');
    });

    it('reports sections and subject weight counts, pluralized', () => {
      expect(
        checklistSummary('classes', {
          step: makeStep({ id: 'classes', status: 'done' }),
          ay: makeAy({
            counts: {
              terms: 4,
              sections: 12,
              subject_configs: 48,
              section_students: 0,
            },
          }),
          terms: [],
        })
      ).toBe('12 classes · 48 subject weights.');
    });

    it('singularizes for a single section', () => {
      expect(
        checklistSummary('classes', {
          step: makeStep({ id: 'classes', status: 'done' }),
          ay: makeAy({
            counts: {
              terms: 4,
              sections: 1,
              subject_configs: 1,
              section_students: 0,
            },
          }),
          terms: [],
        })
      ).toBe('1 class · 1 subject weight.');
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
