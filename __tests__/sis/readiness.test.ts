import { describe, it, expect } from 'vitest';
import {
  resolveAySetupStep,
  resolveCalendarStep,
  resolveClassesStep,
  resolveAdvisersStep,
  resolveGradingSheetsStep,
  resolveVirtueThemesStep,
  resolveLetterheadStep,
  resolveAppWindowStep,
  buildReadiness,
  nextIncompleteStepId,
} from '@/lib/sis/readiness';

describe('resolveAySetupStep', () => {
  it('not_started when no terms exist, no fraction key', () => {
    const s = resolveAySetupStep({ datedTermCount: 0, totalTermCount: 0 });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toBeUndefined();
  });
  it('not_started when terms exist but none dated', () => {
    const s = resolveAySetupStep({ datedTermCount: 0, totalTermCount: 4 });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toEqual({ done: 0, total: 4 });
  });
  it('partial when some but not all terms are dated', () => {
    const s = resolveAySetupStep({ datedTermCount: 1, totalTermCount: 4 });
    expect(s.status).toBe('partial');
    expect(s.fraction).toEqual({ done: 1, total: 4 });
  });
  it('done with all terms dated, required, correct id', () => {
    const s = resolveAySetupStep({ datedTermCount: 4, totalTermCount: 4 });
    expect(s.status).toBe('done');
    expect(s.fraction).toEqual({ done: 4, total: 4 });
    expect(s.required).toBe(true);
    expect(s.id).toBe('ay-setup');
  });
});

describe('resolveCalendarStep', () => {
  it('not_started when no terms exist, no fraction key', () => {
    const s = resolveCalendarStep({ totalTerms: 0, coveredTerms: 0 });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toBeUndefined();
  });
  it('not_started when terms exist but none covered', () => {
    const s = resolveCalendarStep({ totalTerms: 4, coveredTerms: 0 });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toEqual({ done: 0, total: 4 });
  });
  it('partial when some terms covered', () => {
    const s = resolveCalendarStep({ totalTerms: 4, coveredTerms: 2 });
    expect(s.status).toBe('partial');
    expect(s.fraction).toEqual({ done: 2, total: 4 });
  });
  it('done when all terms covered', () => {
    expect(resolveCalendarStep({ totalTerms: 4, coveredTerms: 4 }).status).toBe(
      'done'
    );
  });
});

describe('resolveClassesStep', () => {
  it('not_started when no sections', () => {
    expect(
      resolveClassesStep({ sectionCount: 0, subjectConfigCount: 10 }).status
    ).toBe('not_started');
  });
  it('not_started when sections but no subject configs', () => {
    expect(
      resolveClassesStep({ sectionCount: 18, subjectConfigCount: 0 }).status
    ).toBe('not_started');
  });
  it('done when both present', () => {
    expect(
      resolveClassesStep({ sectionCount: 18, subjectConfigCount: 82 }).status
    ).toBe('done');
  });
});

describe('resolveAdvisersStep', () => {
  it('not_started when no sections, no fraction key', () => {
    const s = resolveAdvisersStep({ sectionCount: 0, advisedSectionCount: 0 });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toBeUndefined();
  });
  it('not_started when sections exist but none advised', () => {
    const s = resolveAdvisersStep({ sectionCount: 18, advisedSectionCount: 0 });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toEqual({ done: 0, total: 18 });
  });
  it('partial when some advised', () => {
    const s = resolveAdvisersStep({
      sectionCount: 18,
      advisedSectionCount: 12,
    });
    expect(s.status).toBe('partial');
    expect(s.fraction).toEqual({ done: 12, total: 18 });
  });
  it('done when all advised', () => {
    expect(
      resolveAdvisersStep({ sectionCount: 18, advisedSectionCount: 18 }).status
    ).toBe('done');
  });
});

describe('resolveGradingSheetsStep', () => {
  it('not_started with zero sections, fraction is always present (0/0)', () => {
    const s = resolveGradingSheetsStep({
      totalSections: 0,
      sectionsWithSheets: 0,
    });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toEqual({ done: 0, total: 0 });
  });
  it('not_started when no sheets yet', () => {
    const s = resolveGradingSheetsStep({
      totalSections: 18,
      sectionsWithSheets: 0,
    });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toEqual({ done: 0, total: 18 });
  });
  it('partial when some sheets', () => {
    expect(
      resolveGradingSheetsStep({ totalSections: 18, sectionsWithSheets: 5 })
        .status
    ).toBe('partial');
  });
  it('done when all sections covered', () => {
    expect(
      resolveGradingSheetsStep({ totalSections: 18, sectionsWithSheets: 18 })
        .status
    ).toBe('done');
  });
});

describe('resolveVirtueThemesStep', () => {
  it('not_started when no terms require a theme, no fraction key', () => {
    const s = resolveVirtueThemesStep({
      termsRequiringTheme: 0,
      termsWithTheme: 0,
    });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toBeUndefined();
  });
  it('not_started when none set', () => {
    const s = resolveVirtueThemesStep({
      termsRequiringTheme: 3,
      termsWithTheme: 0,
    });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toEqual({ done: 0, total: 3 });
  });
  it('partial when some set', () => {
    const s = resolveVirtueThemesStep({
      termsRequiringTheme: 3,
      termsWithTheme: 1,
    });
    expect(s.status).toBe('partial');
    expect(s.fraction).toEqual({ done: 1, total: 3 });
  });
  it('done when all set', () => {
    expect(
      resolveVirtueThemesStep({ termsRequiringTheme: 3, termsWithTheme: 3 })
        .status
    ).toBe('done');
  });
});

describe('resolveLetterheadStep', () => {
  it('not_started when neither field set', () => {
    expect(
      resolveLetterheadStep({ hasOrgName: false, hasAddress: false }).status
    ).toBe('not_started');
  });
  it('partial when only org name set', () => {
    expect(
      resolveLetterheadStep({ hasOrgName: true, hasAddress: false }).status
    ).toBe('partial');
  });
  it('done when both set', () => {
    expect(
      resolveLetterheadStep({ hasOrgName: true, hasAddress: true }).status
    ).toBe('done');
  });
});

describe('resolveAppWindowStep', () => {
  it('done and optional when accepting', () => {
    const s = resolveAppWindowStep({ accepting: true });
    expect(s.required).toBe(false);
    expect(s.status).toBe('done');
  });
  it('not_started and still optional when closed', () => {
    const s = resolveAppWindowStep({ accepting: false });
    expect(s.required).toBe(false);
    expect(s.status).toBe('not_started');
  });
});

describe('buildReadiness', () => {
  it('counts only required steps; optional app-window excluded from total', () => {
    const steps = [
      resolveAySetupStep({ datedTermCount: 4, totalTermCount: 4 }), // done, required
      resolveCalendarStep({ totalTerms: 4, coveredTerms: 4 }), // done, required
      resolveClassesStep({ sectionCount: 18, subjectConfigCount: 82 }), // done, required
      resolveAdvisersStep({ sectionCount: 18, advisedSectionCount: 12 }), // partial, required
      resolveGradingSheetsStep({ totalSections: 18, sectionsWithSheets: 0 }), // not_started, required
      resolveVirtueThemesStep({ termsRequiringTheme: 3, termsWithTheme: 3 }), // done, required
      resolveLetterheadStep({ hasOrgName: true, hasAddress: true }), // done, required
      resolveAppWindowStep({ accepting: true }), // done, but optional — excluded from total
    ];
    const r = buildReadiness('AY2027', steps);
    expect(r.total).toBe(7); // 7 required
    expect(r.complete).toBe(5); // 5 required done
    expect(r.steps).toHaveLength(8);
    expect(r.ayCode).toBe('AY2027');
  });
  it('all-not-started → complete=0, total=7', () => {
    const steps = [
      resolveAySetupStep({ datedTermCount: 0, totalTermCount: 0 }),
      resolveCalendarStep({ totalTerms: 0, coveredTerms: 0 }),
      resolveClassesStep({ sectionCount: 0, subjectConfigCount: 0 }),
      resolveAdvisersStep({ sectionCount: 0, advisedSectionCount: 0 }),
      resolveGradingSheetsStep({ totalSections: 0, sectionsWithSheets: 0 }),
      resolveVirtueThemesStep({ termsRequiringTheme: 0, termsWithTheme: 0 }),
      resolveLetterheadStep({ hasOrgName: false, hasAddress: false }),
      resolveAppWindowStep({ accepting: false }),
    ];
    const r = buildReadiness('AY2027', steps);
    expect(r.complete).toBe(0);
    expect(r.total).toBe(7);
  });
});

describe('nextIncompleteStepId', () => {
  it('returns the first required step that is not done', () => {
    const steps = [
      resolveAySetupStep({ datedTermCount: 4, totalTermCount: 4 }), // done
      resolveCalendarStep({ totalTerms: 4, coveredTerms: 1 }), // partial (incomplete)
    ];
    expect(nextIncompleteStepId(steps)).toBe('calendar');
  });
  it('falls back to steps[0].id when all required steps are done', () => {
    const steps = [
      resolveAySetupStep({ datedTermCount: 4, totalTermCount: 4 }), // done, required
      resolveAppWindowStep({ accepting: false }), // not done, but optional — skipped
    ];
    expect(nextIncompleteStepId(steps)).toBe('ay-setup');
  });
});
