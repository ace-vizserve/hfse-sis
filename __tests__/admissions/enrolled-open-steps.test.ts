import { describe, expect, it } from 'vitest';

import {
  ENROLLED_OPEN_STEPS_STATUS_SELECT,
  classifyEnrolledOpenSteps,
  compareEnrolledOpenSteps,
  type EnrolledOpenStepsRow,
} from '@/lib/admissions/enrolled-open-steps';
import {
  ENROLLED_PREREQ_STAGES,
  STAGE_COLUMN_MAP,
  STAGE_TERMINAL_STATUS,
} from '@/lib/schemas/sis';

// The Admissions queue of children enrolled with steps still open. Same
// "finished" rule as the Enrolled flip (`findOpenPrereqSteps`).

/** A status row with every prereq step at its terminal value. */
const ALL_DONE: Record<string, unknown> = Object.fromEntries(
  ENROLLED_PREREQ_STAGES.map((k) => [
    STAGE_COLUMN_MAP[k].statusCol,
    STAGE_TERMINAL_STATUS[k],
  ])
);

function classify(over: {
  applicationStatus?: string | null;
  category?: string | null;
  enroleeType?: string | null;
  statusRow?: Record<string, unknown>;
}) {
  return classifyEnrolledOpenSteps({
    applicationStatus: 'Enrolled',
    category: 'New',
    enroleeType: null,
    statusRow: ALL_DONE,
    ...over,
  });
}

describe('classifyEnrolledOpenSteps', () => {
  it('leaves out an Enrolled child with every step finished', () => {
    expect(classify({})).toBeNull();
  });

  it('lists the open steps in pipeline order, in plain words', () => {
    expect(
      classify({
        statusRow: { ...ALL_DONE, feeStatus: 'Pending', documentStatus: null },
      })
    ).toEqual(['Documents', 'Fees']);
  });

  it('leaves out Enrolled (Conditional) — a deliberate outcome, not a chase', () => {
    expect(
      classify({
        applicationStatus: 'Enrolled (Conditional)',
        statusRow: { ...ALL_DONE, feeStatus: 'Pending' },
      })
    ).toBeNull();
  });

  it('leaves out anyone not Enrolled', () => {
    for (const s of ['Submitted', 'Processing', 'Withdrawn', null]) {
      expect(
        classify({
          applicationStatus: s,
          statusRow: { ...ALL_DONE, feeStatus: null },
        })
      ).toBeNull();
    }
  });

  it('does not count Assessment against a Current child', () => {
    const row = { ...ALL_DONE, assessmentStatus: null };
    expect(classify({ category: 'Current', statusRow: row })).toBeNull();
    expect(
      classify({ category: 'VizSchool Current', statusRow: row })
    ).toBeNull();
    expect(classify({ category: 'New', statusRow: row })).toEqual([
      'Assessment',
    ]);
  });

  it('falls back to the status row enroleeType when category is blank', () => {
    const row = { ...ALL_DONE, assessmentStatus: null };
    expect(
      classify({ category: null, enroleeType: 'Current', statusRow: row })
    ).toBeNull();
    // Blank on both keeps Assessment — failing closed.
    expect(
      classify({ category: '', enroleeType: null, statusRow: row })
    ).toEqual(['Assessment']);
  });
});

describe('ENROLLED_OPEN_STEPS_STATUS_SELECT', () => {
  it('reads every prerequisite step status column', () => {
    const cols = ENROLLED_OPEN_STEPS_STATUS_SELECT.split(',').map((c) =>
      c.trim()
    );
    for (const k of ENROLLED_PREREQ_STAGES) {
      expect(cols).toContain(STAGE_COLUMN_MAP[k].statusCol);
    }
  });
});

describe('compareEnrolledOpenSteps', () => {
  const row = (over: Partial<EnrolledOpenStepsRow>): EnrolledOpenStepsRow => ({
    ayCode: 'AY2026',
    enroleeNumber: 'E',
    studentNumber: null,
    studentName: 'X',
    levelApplied: null,
    level: null,
    classLabel: null,
    openSteps: ['Fees'],
    enrolledOn: null,
    enrolledOnExact: false,
    enrolledBy: null,
    ...over,
  });

  it('puts most steps open first, then the longest enrolled, unknown dates last', () => {
    const rows = [
      row({ enroleeNumber: 'one-new', enrolledOn: '2026-09-20T00:00:00Z' }),
      row({ enroleeNumber: 'one-nodate' }),
      row({ enroleeNumber: 'one-old', enrolledOn: '2026-08-01T00:00:00Z' }),
      row({
        enroleeNumber: 'three',
        openSteps: ['Documents', 'Contract', 'Fees'],
        enrolledOn: '2026-09-27T00:00:00Z',
      }),
    ];
    expect(
      rows.sort(compareEnrolledOpenSteps).map((r) => r.enroleeNumber)
    ).toEqual(['three', 'one-old', 'one-new', 'one-nodate']);
  });
});
