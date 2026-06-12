import { describe, expect, it } from 'vitest';

import { isAdmissionsStageFrozen } from '@/lib/schemas/sis';

// KD #147 — the admissions stage editor freezes once a student is FULLY
// 'Enrolled', EXCEPT supplies/orientation which stay editable until finalized.
// Shared by the stage PATCH route + the enrollment-tab UI, so this pure test is
// the single guarantee they agree.

describe('isAdmissionsStageFrozen', () => {
  it('never freezes when not fully Enrolled', () => {
    for (const app of [
      null,
      'Submitted',
      'Processing',
      'Enrolled (Conditional)', // conditional stays fully editable
      'Withdrawn',
    ]) {
      expect(isAdmissionsStageFrozen('application', app, app)).toBe(false);
      expect(isAdmissionsStageFrozen('supplies', 'Pending', app)).toBe(false);
      expect(isAdmissionsStageFrozen('orientation', 'Finished', app)).toBe(
        false
      );
    }
  });

  it('freezes the pre/at-enrolment stages once fully Enrolled', () => {
    for (const stage of [
      'application',
      'registration',
      'documents',
      'assessment',
      'contract',
      'fees',
      'class',
    ] as const) {
      expect(isAdmissionsStageFrozen(stage, 'Finished', 'Enrolled')).toBe(true);
    }
  });

  it('keeps supplies editable until finalized', () => {
    expect(isAdmissionsStageFrozen('supplies', 'Pending', 'Enrolled')).toBe(
      false
    );
    expect(isAdmissionsStageFrozen('supplies', null, 'Enrolled')).toBe(false);
    expect(isAdmissionsStageFrozen('supplies', 'Claimed', 'Enrolled')).toBe(
      true
    );
    expect(isAdmissionsStageFrozen('supplies', 'Cancelled', 'Enrolled')).toBe(
      true
    );
  });

  it('keeps orientation editable until finalized', () => {
    expect(isAdmissionsStageFrozen('orientation', 'Pending', 'Enrolled')).toBe(
      false
    );
    expect(isAdmissionsStageFrozen('orientation', 'Finished', 'Enrolled')).toBe(
      true
    );
    expect(
      isAdmissionsStageFrozen('orientation', 'Cancelled', 'Enrolled')
    ).toBe(true);
  });
});
