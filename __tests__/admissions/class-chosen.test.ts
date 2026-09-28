import { describe, it, expect } from 'vitest';

import {
  PREREQ_STATUS_COLUMNS,
  compareClassChosenRows,
  describeEnrolmentReadiness,
  formatOutstanding,
  isClassChosenAwaitingEnrolment,
  type ClassChosenRow,
} from '@/lib/admissions/class-chosen';

const ALL_DONE = {
  registrationStatus: 'Finished',
  documentStatus: 'Finished',
  assessmentStatus: 'Finished',
  contractStatus: 'Signed',
  feeStatus: 'Paid',
};

describe('describeEnrolmentReadiness', () => {
  it('reads the five prerequisite status columns', () => {
    expect(PREREQ_STATUS_COLUMNS).toEqual([
      'registrationStatus',
      'documentStatus',
      'assessmentStatus',
      'contractStatus',
      'feeStatus',
    ]);
  });

  it('is ready when every prerequisite is at its done status', () => {
    const r = describeEnrolmentReadiness(ALL_DONE);
    expect(r).toEqual({ ready: true, outstanding: [] });
    expect(formatOutstanding(r)).toBe('Ready to enrol');
  });

  it('names the unfinished stages in stage order, in plain words', () => {
    const r = describeEnrolmentReadiness({
      ...ALL_DONE,
      feeStatus: 'Unpaid',
      documentStatus: 'Pending',
    });
    expect(r.ready).toBe(false);
    expect(r.outstanding).toEqual(['Documents', 'Fees']);
    expect(formatOutstanding(r)).toBe('Documents, Fees');
  });

  it('counts a blank status as not done', () => {
    const r = describeEnrolmentReadiness({ ...ALL_DONE, contractStatus: null });
    expect(r.outstanding).toEqual(['Contract']);
  });

  it('lists everything for a fresh application', () => {
    expect(describeEnrolmentReadiness({}).outstanding).toEqual([
      'Registration',
      'Documents',
      'Assessment',
      'Contract',
      'Fees',
    ]);
  });

  it('matches the Enrolled gate exactly — a near-miss value is not done', () => {
    // The gate compares the stored value as-is; "paid" would be refused by
    // the save, so it must not read as ready here either.
    const r = describeEnrolmentReadiness({ ...ALL_DONE, feeStatus: 'paid' });
    expect(r.outstanding).toEqual(['Fees']);
  });
});

describe('isClassChosenAwaitingEnrolment', () => {
  it('keeps an open application with a class chosen', () => {
    for (const s of ['Submitted', 'Ongoing Verification', 'Processing']) {
      expect(
        isClassChosenAwaitingEnrolment({
          classSection: 'Courage',
          applicationStatus: s,
        })
      ).toBe(true);
    }
  });

  it('drops a row with no class, or a blank one', () => {
    expect(
      isClassChosenAwaitingEnrolment({
        classSection: null,
        applicationStatus: 'Submitted',
      })
    ).toBe(false);
    expect(
      isClassChosenAwaitingEnrolment({
        classSection: '   ',
        applicationStatus: 'Submitted',
      })
    ).toBe(false);
  });

  it('drops enrolled applications — they join the class list', () => {
    for (const s of ['Enrolled', 'Enrolled (Conditional)', ' Enrolled ']) {
      expect(
        isClassChosenAwaitingEnrolment({
          classSection: 'Courage',
          applicationStatus: s,
        })
      ).toBe(false);
    }
  });

  it('drops cancelled and withdrawn applications', () => {
    for (const s of ['Cancelled', 'Withdrawn']) {
      expect(
        isClassChosenAwaitingEnrolment({
          classSection: 'Courage',
          applicationStatus: s,
        })
      ).toBe(false);
    }
  });
});

function row(overrides: Partial<ClassChosenRow>): ClassChosenRow {
  return {
    ayCode: 'AY2026',
    enroleeNumber: 'E1',
    studentNumber: null,
    fullName: 'Name',
    levelApplied: 'Primary 3',
    classLevel: 'Primary 3',
    classSection: 'Courage',
    applicationStatus: 'Submitted',
    ready: false,
    outstanding: ['Fees'],
    classChosenAt: null,
    classChosenBy: null,
    ...overrides,
  };
}

describe('compareClassChosenRows', () => {
  it('puts ready rows first, then the oldest class choice, undated last', () => {
    const rows = [
      row({ fullName: 'D undated', classChosenAt: null }),
      row({ fullName: 'C newer', classChosenAt: '2026-09-20T00:00:00Z' }),
      row({
        fullName: 'E ready newer',
        ready: true,
        outstanding: [],
        classChosenAt: '2026-09-25T00:00:00Z',
      }),
      row({ fullName: 'B older', classChosenAt: '2026-09-01T00:00:00Z' }),
      row({
        fullName: 'A ready older',
        ready: true,
        outstanding: [],
        classChosenAt: '2026-09-02T00:00:00Z',
      }),
    ];
    expect(rows.sort(compareClassChosenRows).map((r) => r.fullName)).toEqual([
      'A ready older',
      'E ready newer',
      'B older',
      'C newer',
      'D undated',
    ]);
  });

  it('breaks ties on the name', () => {
    const rows = [row({ fullName: 'Zed' }), row({ fullName: 'Amy' })];
    expect(rows.sort(compareClassChosenRows).map((r) => r.fullName)).toEqual([
      'Amy',
      'Zed',
    ]);
  });
});
