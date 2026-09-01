import { describe, expect, it } from 'vitest';

import { DailyEntrySchema } from '@/lib/schemas/attendance';
import {
  ProfileUpdateSchema,
  STAGE_COLUMN_MAP,
  findStageCompletionBlockers,
  validateTerminalReason,
} from '@/lib/schemas/sis';

/**
 * The profile schema is a full object — the route narrows it to the fields the
 * form actually changed before parsing. Mirror that here so a test about one
 * field does not have to invent values for forty others.
 */
function parseProfileField<K extends keyof typeof ProfileUpdateSchema.shape>(
  field: K,
  value: unknown
) {
  return ProfileUpdateSchema.pick({ [field]: true } as never).parse({
    [field]: value,
  }) as Record<K, string | null>;
}
import { resolveEffectiveStageValues } from '@/lib/sis/stage-completion';

// The WRITE path, which is where the `<p></p>` problem starts.
//
// Every reader we fixed is defensive; these are the normalisers and gates that
// decide what reaches the column in the first place. While they measured the
// raw string, an editor that had been clicked into and left alone stored seven
// characters of markup that every downstream reader — and every reader we did
// NOT fix — treats as something a person wrote.

/** What an untouched formatting editor persists. */
const UNTOUCHED = '<p></p>';

describe('attendance ex_note is emptied on the words', () => {
  const base = {
    sectionStudentId: '11111111-1111-4111-8111-111111111111',
    termId: '22222222-2222-4222-8222-222222222222',
    date: '2026-09-01',
    status: 'EX' as const,
    exReason: 'mc' as const,
  };

  it('nulls a note box that was opened and never typed in', () => {
    const parsed = DailyEntrySchema.parse({ ...base, exNote: UNTOUCHED });
    expect(parsed.exNote).toBeNull();
  });

  it('still nulls a plain empty string', () => {
    expect(DailyEntrySchema.parse({ ...base, exNote: '' }).exNote).toBeNull();
  });

  it('keeps a note a teacher actually wrote, markup and all', () => {
    const parsed = DailyEntrySchema.parse({
      ...base,
      exNote: '<p>Seen by the <strong>school nurse</strong>.</p>',
    });
    expect(parsed.exNote).toBe(
      '<p>Seen by the <strong>school nurse</strong>.</p>'
    );
  });
});

describe('the three prose profile fields are emptied on the words', () => {
  // homeAddress / additionalLearningNeeds / otherLearningNeeds are the only
  // `kind: 'textarea'` fields in the edit-profile sheet, and that renders a
  // RichTextEditor. They were declared with the PLAIN `optionalText`, which
  // stores `<p></p>` and counts markup towards `.max()`.
  it.each([
    'homeAddress',
    'additionalLearningNeeds',
    'otherLearningNeeds',
  ] as const)('nulls an untouched editor for %s', (field) => {
    expect(parseProfileField(field, UNTOUCHED)[field]).toBeNull();
  });

  it('keeps real prose', () => {
    expect(
      parseProfileField(
        'additionalLearningNeeds',
        '<p>Needs a quiet room for assessments.</p>'
      ).additionalLearningNeeds
    ).toBe('<p>Needs a quiet room for assessments.</p>');
  });

  it('measures the cap on the writing, not on the tags', () => {
    // 1990 characters of prose against a 2000 cap. Wrapped in markup the raw
    // string is well over 2000, so the old `.max()` would have refused a
    // note that is comfortably inside the limit a person can see.
    const prose = 'a'.repeat(1990);
    expect(() =>
      parseProfileField(
        'additionalLearningNeeds',
        `<p><strong><em>${prose}</em></strong></p>`
      )
    ).not.toThrow();
  });

  it('leaves the plain fields measuring the plain string', () => {
    // A regression guard for the helper split: `previousSchool` is NOT prose
    // and must keep the raw-string behaviour.
    expect(parseProfileField('previousSchool', '   ').previousSchool).toBeNull();
  });
});

describe('the "Other needs an explanation" gate cannot be beaten by markup', () => {
  it('refuses an untouched notes box', () => {
    const result = validateTerminalReason('other', UNTOUCHED);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('notes_required');
  });

  it('still refuses a blank string', () => {
    expect(validateTerminalReason('other', '').ok).toBe(false);
  });

  it('accepts a real explanation', () => {
    expect(
      validateTerminalReason('other', '<p>Family moved to Johor.</p>').ok
    ).toBe(true);
  });
});

describe('the stage completion gate and its merge agree about blank', () => {
  const applicationCols = STAGE_COLUMN_MAP.application;

  it('treats an untouched prose extra as not filled in', () => {
    const merged = resolveEffectiveStageValues(
      applicationCols,
      {},
      'Cancelled',
      { terminalNotes: UNTOUCHED }
    );
    expect(merged.extras.terminalNotes).toBeNull();
  });

  it('reads an untouched prose extra off the STORED row as blank too', () => {
    // The other half of the merge — a row that already holds `<p></p>` from
    // before the write path was fixed must not read as filled in either.
    const notesCol = applicationCols.extras.find(
      (e) => e.fieldKey === 'terminalNotes'
    );
    expect(notesCol).toBeDefined();
    const merged = resolveEffectiveStageValues(
      applicationCols,
      { [notesCol!.columnName]: UNTOUCHED },
      undefined,
      undefined
    );
    expect(merged.extras.terminalNotes).toBeNull();
  });

  it('keeps a prose extra a person wrote', () => {
    const merged = resolveEffectiveStageValues(
      applicationCols,
      {},
      'Cancelled',
      { terminalNotes: '<p>Chose another school.</p>' }
    );
    expect(merged.extras.terminalNotes).toBe('<p>Chose another school.</p>');
  });

  it('does not count an untouched editor as a filled required field', () => {
    // findStageCompletionBlockers is the general gate: whatever
    // STAGE_STATUS_REQUIRED_FIELDS names, an untouched editor must never
    // satisfy it.
    const blockers = findStageCompletionBlockers('registration', 'Finished', {
      invoice: UNTOUCHED,
      paymentDate: UNTOUCHED,
    });
    expect(blockers.map((b) => b.fieldKey).sort()).toEqual([
      'invoice',
      'paymentDate',
    ]);
  });

  it('still accepts genuinely filled required fields', () => {
    const blockers = findStageCompletionBlockers('registration', 'Finished', {
      invoice: 'INV-2026-0042',
      paymentDate: '2026-09-01',
    });
    expect(blockers).toEqual([]);
  });
});
