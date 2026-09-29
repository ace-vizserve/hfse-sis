import { describe, expect, it } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  decideSheetRemoval,
  entryHasEnteredData,
  loadSheetRemovability,
  sheetHasEnteredData,
  SHEET_REMOVAL_REASONS,
  type GradeEntryValues,
} from '@/lib/grading/sheet-removal';

// A seeded row nobody has touched: every value blank.
const blank = (over: Partial<GradeEntryValues> = {}): GradeEntryValues => ({
  ww_scores: [null, null],
  pt_scores: [null, null, null],
  qa_score: null,
  ww_ps: null,
  pt_ps: null,
  qa_ps: null,
  initial_grade: null,
  quarterly_grade: null,
  letter_grade: null,
  is_na: false,
  ww_excused: [],
  pt_excused: [],
  ...over,
});

describe('sheetHasEnteredData', () => {
  it('all-null rows → nothing entered (removable)', () => {
    expect(sheetHasEnteredData([blank(), blank(), blank()])).toBe(false);
  });

  it('no rows at all → nothing entered', () => {
    expect(sheetHasEnteredData([])).toBe(false);
  });

  it('empty arrays and missing columns → nothing entered', () => {
    expect(sheetHasEnteredData([{ ww_scores: [], pt_scores: [] }, {}])).toBe(
      false
    );
  });

  it('a single WW score of 0 → entered (blank ≠ zero, Hard Rule #3)', () => {
    expect(
      sheetHasEnteredData([blank(), blank({ ww_scores: [0, null] })])
    ).toBe(true);
  });

  it('a PT score → entered', () => {
    expect(sheetHasEnteredData([blank({ pt_scores: [null, 7, null] })])).toBe(
      true
    );
  });

  it('an exam score of 0 → entered', () => {
    expect(sheetHasEnteredData([blank({ qa_score: 0 })])).toBe(true);
  });

  it('a letter override → entered', () => {
    expect(sheetHasEnteredData([blank({ letter_grade: 'A' })])).toBe(true);
  });

  it('a whitespace-only letter is not a letter', () => {
    expect(entryHasEnteredData(blank({ letter_grade: '  ' }))).toBe(false);
  });

  it('is_na alone → NOT entered (seeded true for late enrollees)', () => {
    expect(sheetHasEnteredData([blank({ is_na: true })])).toBe(false);
  });

  it('an excused slot → entered', () => {
    expect(sheetHasEnteredData([blank({ ww_excused: [1] })])).toBe(true);
    expect(sheetHasEnteredData([blank({ pt_excused: [2] })])).toBe(true);
  });

  it('a derived figure alone → entered', () => {
    expect(sheetHasEnteredData([blank({ quarterly_grade: 75 })])).toBe(true);
    expect(sheetHasEnteredData([blank({ initial_grade: 0 })])).toBe(true);
    expect(sheetHasEnteredData([blank({ ww_ps: 0 })])).toBe(true);
  });
});

describe('decideSheetRemoval', () => {
  it('open, empty, no history → removable', () => {
    expect(
      decideSheetRemoval({
        isLocked: false,
        hasEnteredData: false,
        hasHistory: false,
      })
    ).toEqual({ removable: true, reason: null });
  });

  it('entered → refused with the plain-English reason', () => {
    const v = decideSheetRemoval({
      isLocked: false,
      hasEnteredData: true,
      hasHistory: false,
    });
    expect(v.removable).toBe(false);
    expect(v.reason).toBe(
      'This sheet has scores entered, so it can’t be removed.'
    );
  });

  it('locked wins over everything', () => {
    const v = decideSheetRemoval({
      isLocked: true,
      hasEnteredData: false,
      hasHistory: false,
    });
    expect(v.removable).toBe(false);
    expect(v.reason).toBe(SHEET_REMOVAL_REASONS.locked);
  });

  it('blank now but with history → refused', () => {
    const v = decideSheetRemoval({
      isLocked: false,
      hasEnteredData: false,
      hasHistory: true,
    });
    expect(v.removable).toBe(false);
    expect(v.reason).toBe(SHEET_REMOVAL_REASONS.history);
  });
});

// A minimal stand-in for the four reads `loadSheetRemovability` makes. Every
// chained filter is accepted; the table name alone decides the rows.
function fakeService(tables: Record<string, unknown[]>): SupabaseClient {
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'eq', 'limit']) b[m] = () => b;
    b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null });
    return b;
  };
  return {
    from: (table: string) => builder(tables[table] ?? []),
  } as unknown as SupabaseClient;
}

describe('loadSheetRemovability — the automatic N/A', () => {
  const lateEnrolleeRow = {
    id: 'e1',
    grading_sheet_id: 's1',
    ...blank({ is_na: true }),
  };

  it('is_na true with no audit history → removable', async () => {
    const out = await loadSheetRemovability(
      fakeService({
        grade_entries: [
          lateEnrolleeRow,
          { id: 'e2', grading_sheet_id: 's1', ...blank() },
        ],
      }),
      [{ id: 's1', is_locked: false }]
    );
    expect(out.get('s1')).toMatchObject({ removable: true, entryCount: 2 });
  });

  it('is_na true WITH a grade_audit_log row → not removable', async () => {
    const out = await loadSheetRemovability(
      fakeService({
        grade_entries: [lateEnrolleeRow],
        grade_audit_log: [{ grading_sheet_id: 's1' }],
      }),
      [{ id: 's1', is_locked: false }]
    );
    expect(out.get('s1')).toMatchObject({
      removable: false,
      reason: SHEET_REMOVAL_REASONS.history,
    });
  });

  it('is_na true WITH an audit_log row on the entry → not removable', async () => {
    const out = await loadSheetRemovability(
      fakeService({
        grade_entries: [lateEnrolleeRow],
        audit_log: [{ entity_id: 'e1' }],
      }),
      [{ id: 's1', is_locked: false }]
    );
    expect(out.get('s1')?.removable).toBe(false);
  });
});
