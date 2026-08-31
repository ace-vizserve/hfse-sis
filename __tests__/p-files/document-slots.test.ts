/**
 * The document-slot catalogue, and the three rules that keep it honest.
 *
 * There are TWO slot lists in this codebase and nothing but this file keeps
 * them in step: `lib/p-files/document-config.ts` (P-Files — expiry, grouping,
 * applicability) and `lib/sis/queries.ts` (admissions — the actual column
 * names). The admissions Documents-stage gate reads the second while every
 * P-Files surface reads the first, so a key present in one and missing from
 * the other is a silent disagreement about what a student is required to have.
 */
import { describe, it, expect } from 'vitest';

import {
  DOCUMENT_SLOTS,
  GROUP_LABELS,
  isChaseableGroup,
  isSlotApplicable,
  type DocumentGroup,
} from '@/lib/p-files/document-config';
import {
  DOCUMENT_SLOTS as SIS_DOCUMENT_SLOTS,
  OPTIONAL_DOCUMENT_SLOT_KEYS,
} from '@/lib/sis/queries';

/** The eight added alongside migration 135. */
const SCHOOL_FORM_KEYS = [
  'lastSchoolRecommendation',
  'assessmentResult',
  'signedContract',
  'newStudentChecksheet',
  'pfilesChecklist',
  'preCounsellingAck',
  'conditionalEnrolment',
  'lateEnrolmentForm',
] as const;

describe('the two slot lists agree', () => {
  it('holds exactly the same keys on both sides', () => {
    const pfiles = DOCUMENT_SLOTS.map((s) => s.key).sort();
    const sis = SIS_DOCUMENT_SLOTS.map((s) => s.key).sort();
    expect(pfiles).toEqual(sis);
  });

  it('names the columns after the key on the admissions side', () => {
    for (const slot of SIS_DOCUMENT_SLOTS) {
      expect(slot.urlCol, slot.key).toBe(slot.key);
      expect(slot.statusCol, slot.key).toBe(`${slot.key}Status`);
    }
  });

  it('gives every group a label', () => {
    for (const slot of DOCUMENT_SLOTS) {
      expect(GROUP_LABELS[slot.group], slot.key).toBeTruthy();
    }
  });
});

describe('the school forms', () => {
  it('are all present, in the school group, and never expire', () => {
    for (const key of SCHOOL_FORM_KEYS) {
      const slot = DOCUMENT_SLOTS.find((s) => s.key === key);
      expect(slot, key).toBeDefined();
      expect(slot!.group, key).toBe('school');
      // No {key}Expiry column exists for these — migration 135 created none,
      // so anything reading an expiry off them would read a missing column.
      expect(slot!.expires, key).toBe(false);
      expect(slot!.meta, key).toBeNull();
    }
  });

  // THE ONE THAT MATTERS. The Action Queue, the "N documents need attention"
  // headline and the reminder mail are all a worklist of things to ask a
  // FAMILY for. The parent portal offers none of these eight — the P-Files
  // officer uploads them — so a missing one has nobody to chase. When they
  // were briefly filed under 'student', every student's page grew six
  // permanent rows each offering to "Remind parent" about a form no parent
  // could ever produce.
  it('are never chaseable', () => {
    for (const key of SCHOOL_FORM_KEYS) {
      const slot = DOCUMENT_SLOTS.find((s) => s.key === key)!;
      expect(isChaseableGroup(slot.group), key).toBe(false);
    }
  });

  it('leaves the three family-facing groups chaseable', () => {
    for (const group of [
      'student',
      'student-expiring',
      'parent',
    ] as DocumentGroup[]) {
      expect(isChaseableGroup(group), group).toBe(true);
    }
  });

  // Nobody has agreed with the school that these must be on file before a
  // student can enrol. If they were required, the Documents stage could not be
  // flipped to Verified for a single student in the system, because every one
  // of these columns starts empty.
  it('never blocks the Documents stage', () => {
    for (const key of SCHOOL_FORM_KEYS) {
      expect(OPTIONAL_DOCUMENT_SLOT_KEYS as readonly string[], key).toContain(
        key
      );
    }
  });
});

describe('isSlotApplicable', () => {
  const filled = {
    conditional: { kind: 'filled', column: 'fatherEmail' },
  } as const;
  const equals = {
    conditional: {
      kind: 'equals',
      column: 'applicationStatus',
      value: 'Enrolled (Conditional)',
    },
  } as const;
  const late = { conditional: { kind: 'lateEnrollee' } } as const;

  it('treats a slot with no condition as always applicable', () => {
    expect(isSlotApplicable({ conditional: null }, { app: null })).toBe(true);
    expect(isSlotApplicable({ conditional: null }, { app: {} })).toBe(true);
  });

  it('reads `filled` exactly as the old behaviour did', () => {
    expect(isSlotApplicable(filled, { app: { fatherEmail: 'a@b.c' } })).toBe(
      true
    );
    expect(isSlotApplicable(filled, { app: { fatherEmail: '' } })).toBe(false);
    expect(isSlotApplicable(filled, { app: { fatherEmail: '   ' } })).toBe(
      false
    );
    expect(isSlotApplicable(filled, { app: { fatherEmail: null } })).toBe(
      false
    );
    expect(isSlotApplicable(filled, { app: {} })).toBe(false);
  });

  it('matches `equals` on the exact value only', () => {
    expect(
      isSlotApplicable(equals, {
        app: { applicationStatus: 'Enrolled (Conditional)' },
      })
    ).toBe(true);
    // Plain 'Enrolled' is a DIFFERENT outcome and must not pull the
    // Conditional Enrolment form onto an ordinary student's file.
    expect(
      isSlotApplicable(equals, { app: { applicationStatus: 'Enrolled' } })
    ).toBe(false);
    expect(isSlotApplicable(equals, { app: {} })).toBe(false);
  });

  // "Cannot tell" must hide, never require. A slot that is hidden is merely
  // invisible; a slot falsely required makes every ordinary student read as
  // permanently incomplete on every completeness figure in the app.
  it('treats an unknown late-enrollee status as not applicable', () => {
    expect(isSlotApplicable(late, { app: {} })).toBe(false);
    expect(isSlotApplicable(late, { app: {}, isLateEnrollee: false })).toBe(
      false
    );
    expect(isSlotApplicable(late, { app: {}, isLateEnrollee: true })).toBe(
      true
    );
  });

  it('never throws on a missing or malformed facts bag', () => {
    for (const slot of DOCUMENT_SLOTS) {
      expect(() => isSlotApplicable(slot, { app: undefined })).not.toThrow();
      expect(() => isSlotApplicable(slot, { app: null })).not.toThrow();
    }
  });
});
