/**
 * A note on any mark — migration 180 (Miss Koh, 2026-09-28).
 *
 * Before 180 only an Excused mark could carry a note. Now Present, Late and
 * Absent can too; NC ("no class", a calendar fact) and a cleared day still
 * cannot. The zod rule and the ledger writer must say the same thing as
 * `attendance_daily_note_requires_mark_chk`, or a teacher gets a 500 with a
 * constraint name instead of a sentence.
 */

import { describe, expect, it } from 'vitest';

import {
  DailyEntrySchema,
  notePlaceholderFor,
  statusTakesNote,
} from '@/lib/schemas/attendance';

const base = {
  sectionStudentId: '11111111-1111-4111-8111-111111111111',
  termId: '33333333-3333-4333-8333-333333333333',
  date: '2099-02-10',
};

describe('statusTakesNote', () => {
  it.each(['P', 'L', 'A', 'EX'] as const)('%s takes a note', (s) => {
    expect(statusTakesNote(s)).toBe(true);
  });

  it('NC and a cleared day do not', () => {
    expect(statusTakesNote('NC')).toBe(false);
    expect(statusTakesNote(null)).toBe(false);
    expect(statusTakesNote(undefined)).toBe(false);
  });
});

describe('DailyEntrySchema — the note', () => {
  it.each(['P', 'L', 'A', 'EX'] as const)('accepts a note on %s', (status) => {
    const parsed = DailyEntrySchema.safeParse({
      ...base,
      status,
      ...(status === 'EX' ? { exReason: 'mc' } : {}),
      exNote: 'arrived 08:40, bus delayed',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a note on NC', () => {
    const parsed = DailyEntrySchema.safeParse({
      ...base,
      status: 'NC',
      exNote: 'anything',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('notePlaceholderFor', () => {
  it('gives each mark its own example', () => {
    const all = (['P', 'L', 'A', 'EX'] as const).map(notePlaceholderFor);
    expect(new Set(all).size).toBe(4);
    for (const p of all) expect(p).toMatch(/^Add a note \(optional\)/);
  });
});
