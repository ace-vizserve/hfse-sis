import { describe, it, expect } from 'vitest';
import {
  resolveAySetupStep,
  resolveCalendarStep,
  resolveSectionsStep,
  resolveSubjectWeightsStep,
  resolveAdvisersStep,
  resolveSectionSubjectsStep,
  resolveGradingSheetsStep,
  resolveVirtueThemesStep,
  resolveLetterheadStep,
  resolveAppWindowStep,
  buildReadiness,
  nextIncompleteStepId,
  describeYearBandStatus,
  READINESS_SEGMENT_CLASS,
  type AyReadiness,
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

describe('resolveSectionsStep', () => {
  it('not_started when no relevant grade levels are in use, no fraction key', () => {
    const s = resolveSectionsStep({
      relevantLevelCount: 0,
      levelsWithSectionCount: 0,
    });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toBeUndefined();
  });
  it('done when every relevant level has at least one section', () => {
    const s = resolveSectionsStep({
      relevantLevelCount: 5,
      levelsWithSectionCount: 5,
    });
    expect(s.status).toBe('done');
    expect(s.fraction).toEqual({ done: 5, total: 5 });
  });
  it('partial when some relevant levels have a section', () => {
    const s = resolveSectionsStep({
      relevantLevelCount: 5,
      levelsWithSectionCount: 2,
    });
    expect(s.status).toBe('partial');
    expect(s.fraction).toEqual({ done: 2, total: 5 });
  });
  it('partial (never not_started) when no relevant level has a section yet', () => {
    const s = resolveSectionsStep({
      relevantLevelCount: 5,
      levelsWithSectionCount: 0,
    });
    expect(s.status).toBe('partial');
    expect(s.fraction).toEqual({ done: 0, total: 5 });
  });
});

describe('resolveSectionSubjectsStep', () => {
  it('not_started when no sections, no fraction key omitted (fraction always present)', () => {
    const s = resolveSectionSubjectsStep({
      totalSections: 0,
      sectionsWithSubjects: 0,
    });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toEqual({ done: 0, total: 0 });
  });
  it('not_started when sections exist but none have subjects assigned', () => {
    const s = resolveSectionSubjectsStep({
      totalSections: 18,
      sectionsWithSubjects: 0,
    });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toEqual({ done: 0, total: 18 });
  });
  it('partial when some sections have subjects assigned', () => {
    const s = resolveSectionSubjectsStep({
      totalSections: 18,
      sectionsWithSubjects: 5,
    });
    expect(s.status).toBe('partial');
  });
  it('done when every section has at least one subject assigned', () => {
    expect(
      resolveSectionSubjectsStep({
        totalSections: 18,
        sectionsWithSubjects: 18,
      }).status
    ).toBe('done');
  });
});

describe('resolveSubjectWeightsStep', () => {
  it('not_started when no levels are in use', () => {
    expect(
      resolveSubjectWeightsStep({
        levelsInUse: 0,
        levelsFullyConfigured: 0,
        missingCount: 0,
      }).status
    ).toBe('not_started');
  });
  it('not_started when levels are in use but none have subject configs (decoupled from sections — no sectionCount input anymore)', () => {
    expect(
      resolveSubjectWeightsStep({
        levelsInUse: 3,
        levelsFullyConfigured: 0,
        missingCount: 24,
      }).status
    ).toBe('not_started');
  });
  it('done when every in-use level has at least one subject configured', () => {
    expect(
      resolveSubjectWeightsStep({
        levelsInUse: 3,
        levelsFullyConfigured: 3,
        missingCount: 0,
      }).status
    ).toBe('done');
  });
  it('partial when some but not all levels have no subjects configured — the bug this fix closes (previously read as done)', () => {
    const step = resolveSubjectWeightsStep({
      levelsInUse: 3,
      levelsFullyConfigured: 2,
      missingCount: 4,
    });
    expect(step.status).toBe('partial');
    expect(step.fraction).toEqual({ done: 2, total: 3 });
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
  it('not_started with zero expected sheets, fraction is always present (0/0)', () => {
    const s = resolveGradingSheetsStep({
      totalExpectedSheets: 0,
      totalActualSheets: 0,
    });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toEqual({ done: 0, total: 0 });
  });
  it('not_started when sheets are expected but none exist yet', () => {
    const s = resolveGradingSheetsStep({
      totalExpectedSheets: 18,
      totalActualSheets: 0,
    });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toEqual({ done: 0, total: 18 });
  });
  it('partial when some but not all expected sheets exist', () => {
    expect(
      resolveGradingSheetsStep({
        totalExpectedSheets: 18,
        totalActualSheets: 5,
      }).status
    ).toBe('partial');
  });
  it('done when every expected sheet exists', () => {
    expect(
      resolveGradingSheetsStep({
        totalExpectedSheets: 18,
        totalActualSheets: 18,
      }).status
    ).toBe('done');
  });
  // The bug this fix closes: a section needing 3 subjects x 4 terms = 12
  // sheets used to read "done" the moment ANY one sheet existed for that
  // section (sectionsWithSheets === totalSections). Now the check is
  // against the real per-(section, subject, term) expected count.
  it('partial (not done) when a section has 3 subjects x 4 terms = 12 expected sheets but only 5 exist', () => {
    const s = resolveGradingSheetsStep({
      totalExpectedSheets: 12,
      totalActualSheets: 5,
    });
    expect(s.status).toBe('partial');
    expect(s.fraction).toEqual({ done: 5, total: 12 });
  });
  // Section-subjects step not done yet (no subjects attached anywhere) ->
  // zero expected sheets. Must read not_started, never divide-by-zero and
  // never a false "done".
  it('not_started (never divide-by-zero, never falsely done) when no section has any subject attached yet', () => {
    const s = resolveGradingSheetsStep({
      totalExpectedSheets: 0,
      totalActualSheets: 0,
    });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toEqual({ done: 0, total: 0 });
    expect(Number.isFinite(s.fraction!.done)).toBe(true);
    expect(Number.isFinite(s.fraction!.total)).toBe(true);
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
      resolveSubjectWeightsStep({
        levelsInUse: 3,
        levelsFullyConfigured: 3,
        missingCount: 0,
      }), // done, required
      resolveAdvisersStep({ sectionCount: 18, advisedSectionCount: 12 }), // partial, required
      resolveGradingSheetsStep({
        totalExpectedSheets: 18,
        totalActualSheets: 0,
      }), // not_started, required
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
      resolveSubjectWeightsStep({
        levelsInUse: 0,
        levelsFullyConfigured: 0,
        missingCount: 0,
      }),
      resolveAdvisersStep({ sectionCount: 0, advisedSectionCount: 0 }),
      resolveGradingSheetsStep({
        totalExpectedSheets: 0,
        totalActualSheets: 0,
      }),
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

describe('READINESS_SEGMENT_CLASS', () => {
  it('maps each status to a distinct solid-tint class', () => {
    expect(READINESS_SEGMENT_CLASS.done).toBe('bg-brand-mint');
    expect(READINESS_SEGMENT_CLASS.partial).toBe('bg-brand-amber');
    expect(READINESS_SEGMENT_CLASS.not_started).toBe('bg-muted');
  });
});

describe('describeYearBandStatus', () => {
  function readinessWith(
    steps: ReturnType<typeof resolveAySetupStep>[]
  ): AyReadiness {
    return buildReadiness('AY2027', steps);
  }

  it('no academic year (total 0)', () => {
    const r = readinessWith([resolveAppWindowStep({ accepting: false })]); // only optional → total 0
    const s = describeYearBandStatus(r);
    expect(s.headline).toBe('No academic year set up yet.');
  });

  it('all required done', () => {
    const r = readinessWith([
      resolveAySetupStep({ datedTermCount: 4, totalTermCount: 4 }),
    ]);
    const s = describeYearBandStatus(r);
    expect(s.headline).toBe('Year setup is done.');
  });

  it('nothing done yet names the first incomplete step', () => {
    const r = readinessWith([
      resolveAySetupStep({ datedTermCount: 0, totalTermCount: 4 }),
      resolveCalendarStep({ totalTerms: 4, coveredTerms: 0 }),
    ]);
    const s = describeYearBandStatus(r);
    expect(s.headline).toBe("Year setup hasn't started yet.");
    expect(s.detail).toContain('Academic year & term dates');
  });

  it('one item left reads "almost done" and names it', () => {
    const r = readinessWith([
      resolveAySetupStep({ datedTermCount: 4, totalTermCount: 4 }), // done
      resolveLetterheadStep({ hasOrgName: false, hasAddress: false }), // not done
    ]);
    const s = describeYearBandStatus(r);
    expect(s.headline).toBe('Year setup is almost done.');
    expect(s.detail).toContain('Report-card letterhead');
  });

  it('partway through names the next incomplete step and a percent', () => {
    const r = readinessWith([
      resolveAySetupStep({ datedTermCount: 4, totalTermCount: 4 }), // done
      resolveCalendarStep({ totalTerms: 4, coveredTerms: 0 }), // not done, next up
      resolveSubjectWeightsStep({
        levelsInUse: 0,
        levelsFullyConfigured: 0,
        missingCount: 0,
      }), // not done
      resolveAdvisersStep({ sectionCount: 0, advisedSectionCount: 0 }), // not done
    ]);
    const s = describeYearBandStatus(r);
    expect(s.headline).toBe('Year setup is 25% done.');
    expect(s.detail).toContain('School calendar');
  });
});
