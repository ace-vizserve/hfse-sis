import { describe, expect, it } from 'vitest';

import { DailyEntrySchema, EX_NOTE_MAX_LENGTH } from '@/lib/schemas/attendance';
import {
  ChangeRequestActionSchema,
  ChangeRequestFormSchema,
} from '@/lib/schemas/change-request';
import { ClassroomNoteSchema, MAX_NOTE_LENGTH } from '@/lib/schemas/classroom';
import {
  DISCIPLINE_NATURE_MAX,
  DisciplineRecordSchema,
} from '@/lib/schemas/discipline';
import { EvaluationWriteupUpsertSchema } from '@/lib/schemas/evaluation';
import { PromiseSchema } from '@/lib/schemas/p-files';

// THE LIMITS ARE ABOUT WHAT A PERSON TYPED.
//
// Every one of these boxes is a formatting editor now, so the column holds
// HTML. The caps were written about writing — "keep the note under 300
// characters" is a sentence about words. Counting the stored string instead
// would refuse a note that is plainly short on screen, and the person would
// have no way to see the difference: the tags are invisible to them.
//
// Each test below pairs a value that is WITHIN the limit as prose but OVER it
// as a string. Under the old `.max()` every one of them was rejected.

// Real v4 shapes. Zod 4's `.uuid()` checks the version and variant nibbles, so
// a row of zeroes is rejected and every case here would fail for a reason that
// has nothing to do with formatted text.
const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';
const UUID3 = '33333333-3333-4333-8333-333333333333';
const UUID4 = '44444444-4444-4444-8444-444444444444';

/**
 * `n` characters of prose, wrapped one character per `<strong>` so the string
 * is many times longer than the writing. This is not a contrived shape — it is
 * what a teacher bolding individual words produces.
 */
function heavilyMarkedUp(n: number): string {
  return `<p>${'<strong>a</strong>'.repeat(n)}</p>`;
}

describe('evaluation write-up cap', () => {
  it('accepts 10,000 characters of prose however much markup carries it', () => {
    const html = heavilyMarkedUp(10_000);
    // Sanity: the stored string really is far over the limit.
    expect(html.length).toBeGreaterThan(10_000);

    const r = EvaluationWriteupUpsertSchema.safeParse({
      termId: UUID,
      sectionId: UUID2,
      studentId: UUID3,
      writeup: html,
    });
    expect(r.success).toBe(true);
  });

  it('still refuses more than 10,000 characters of prose', () => {
    const r = EvaluationWriteupUpsertSchema.safeParse({
      termId: UUID,
      sectionId: UUID2,
      studentId: UUID3,
      writeup: `<p>${'a'.repeat(10_001)}</p>`,
    });
    expect(r.success).toBe(false);
  });

  it('leaves a cleared draft (null) alone', () => {
    const r = EvaluationWriteupUpsertSchema.safeParse({
      termId: UUID,
      sectionId: UUID2,
      studentId: UUID3,
      writeup: null,
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.writeup).toBe(null);
  });
});

describe('short-note caps', () => {
  it('the attendance note counts words, not tags', () => {
    const html = heavilyMarkedUp(EX_NOTE_MAX_LENGTH);
    expect(html.length).toBeGreaterThan(EX_NOTE_MAX_LENGTH);

    const r = DailyEntrySchema.safeParse({
      sectionStudentId: UUID,
      termId: UUID2,
      date: '2026-09-01',
      status: 'EX',
      exNote: html,
    });
    expect(r.success).toBe(true);
  });

  it('the attendance note still refuses a genuinely long note', () => {
    const r = DailyEntrySchema.safeParse({
      sectionStudentId: UUID,
      termId: UUID2,
      date: '2026-09-01',
      status: 'EX',
      exNote: `<p>${'a'.repeat(EX_NOTE_MAX_LENGTH + 1)}</p>`,
    });
    expect(r.success).toBe(false);
  });

  it("the attendance note's empty-to-null transform is unchanged", () => {
    const r = DailyEntrySchema.safeParse({
      sectionStudentId: UUID,
      termId: UUID2,
      date: '2026-09-01',
      status: 'EX',
      exNote: '   ',
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.exNote).toBe(null);
  });

  it('the class note counts words, not tags', () => {
    const html = heavilyMarkedUp(MAX_NOTE_LENGTH);
    expect(html.length).toBeGreaterThan(MAX_NOTE_LENGTH);
    expect(ClassroomNoteSchema.safeParse({ content: html }).success).toBe(true);
  });

  it('the P-Files note counts words, not tags', () => {
    const html = heavilyMarkedUp(500);
    expect(html.length).toBeGreaterThan(500);

    const r = PromiseSchema.safeParse({
      slotKey: 'birthCert',
      promisedUntil: '2026-09-30',
      note: html,
    });
    expect(r.success).toBe(true);
  });

  it('the P-Files note still refuses a genuinely long note', () => {
    const r = PromiseSchema.safeParse({
      slotKey: 'birthCert',
      promisedUntil: '2026-09-30',
      note: `<p>${'a'.repeat(501)}</p>`,
    });
    expect(r.success).toBe(false);
  });
});

describe('discipline record', () => {
  const base = {
    record_type: 'incident' as const,
    occurred_on: '2020-01-01',
    nature: 'Pushing in the canteen queue',
  };

  it("the one-line 'what kind of thing' box counts words, not tags", () => {
    const html = heavilyMarkedUp(DISCIPLINE_NATURE_MAX);
    expect(html.length).toBeGreaterThan(DISCIPLINE_NATURE_MAX);
    expect(
      DisciplineRecordSchema.safeParse({ ...base, nature: html }).success
    ).toBe(true);
  });

  it('a required box left empty in the editor is still empty', () => {
    // `<p></p>` is seven characters and no words. The field is required.
    const r = DisciplineRecordSchema.safeParse({ ...base, nature: '<p></p>' });
    expect(r.success).toBe(false);
  });

  it('keeps its default for details, so the form and route types still differ', () => {
    const r = DisciplineRecordSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.success && r.data.details).toBe('');
  });
});

describe('change request', () => {
  const base = {
    grading_sheet_id: UUID,
    grade_entry_id: UUID2,
    field_changed: 'qa_score' as const,
    slot_index: null,
    current_value: '20',
    proposed_value: '22',
    reason_category: 'data_entry_error' as const,
    primary_approver_id: UUID3,
    secondary_approver_id: UUID4,
  };

  it('a bolded 20-character explanation clears the floor', () => {
    const r = ChangeRequestFormSchema.safeParse({
      ...base,
      justification: '<p><strong>Mis-keyed from the paper script.</strong></p>',
    });
    expect(r.success).toBe(true);
  });

  it('a bolded ONE-WORD explanation does not clear the floor', () => {
    // The 20-character floor exists to stop "typo" being filed as a reason.
    // Measured as a string, `<p><strong>typo</strong></p>` is 28 characters
    // and would sail through.
    const r = ChangeRequestFormSchema.safeParse({
      ...base,
      justification: '<p><strong>typo</strong></p>',
    });
    expect(r.success).toBe(false);
  });

  it('an empty editor is not an explanation', () => {
    const r = ChangeRequestFormSchema.safeParse({
      ...base,
      justification: '<p></p>',
    });
    expect(r.success).toBe(false);
  });

  it('a rejection needs a decision note with words in it', () => {
    expect(
      ChangeRequestActionSchema.safeParse({
        action: 'reject',
        decision_note: '<p></p>',
      }).success
    ).toBe(false);

    expect(
      ChangeRequestActionSchema.safeParse({
        action: 'reject',
        decision_note: '<p>The paper script says 20.</p>',
      }).success
    ).toBe(true);
  });
});
