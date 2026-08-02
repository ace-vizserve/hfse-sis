/**
 * The two rules that make a subject-config save safe mid-year.
 *
 * HFSE agrees a Scheme of Work before each academic year and one config save
 * broadcasts it to every section — that is the intended workflow and must stay
 * frictionless. Changes during the year are "rare but not impossible"
 * (Chandana, 2026-07-31), and that is the case where the broadcast destroys
 * things: entered marks, and deliberately-set per-section exam totals.
 *
 * Both rules are written so that the start-of-year case is a NO-OP. Empty,
 * uncustomised sheets pass straight through.
 */

import { describe, it, expect } from 'vitest';
import { resolveQaTotal } from '@/lib/grading/sync-config-sheets';

describe('Rule 2 — resolveQaTotal: adopt the SOW, keep the override', () => {
  it('a sheet on the old subject default adopts the new one', () => {
    // The SOW broadcast. Nothing was customised, so the section follows.
    expect(resolveQaTotal(50, 50, 65)).toBe(65);
  });

  it('a sheet set deliberately for its section is left alone', () => {
    // Koh's 140-mark paper while the subject default is 50. An unrelated
    // config save must not revert it.
    expect(resolveQaTotal(140, 50, 65)).toBeNull();
  });

  it('a brand-new sheet with no total adopts the default', () => {
    expect(resolveQaTotal(null, 50, 65)).toBe(65);
  });

  it('writes nothing when the sheet already holds the new value', () => {
    // Idempotence — a resync must not churn updated_at across every sheet.
    expect(resolveQaTotal(65, 50, 65)).toBeNull();
  });

  it('leaves everything alone when the config has no qa_max', () => {
    expect(resolveQaTotal(140, 50, null)).toBeNull();
  });

  it('adopts when the previous default is unknown and the value differs', () => {
    // No prior to compare against: fall back to the old broadcast behaviour
    // rather than silently freezing every sheet.
    expect(resolveQaTotal(50, null, 65)).toBe(65);
  });

  it('tolerates numeric-vs-string from PostgREST', () => {
    // qa_total is `numeric`; the driver can hand back a string.
    expect(resolveQaTotal('50' as unknown as number, 50, 65)).toBe(65);
    expect(resolveQaTotal('140' as unknown as number, 50, 65)).toBeNull();
  });
});

describe('Rule 1 — findTruncationBlockers', () => {
  // The pure decision is "is there a non-null score at an index >= the new
  // max". These exercise that logic through a stub rather than a live DB.
  const service = (entries: Array<Record<string, unknown>>) =>
    ({
      from(table: string) {
        if (table === 'grading_sheets') {
          return {
            select: () => ({
              eq: () => ({
                eq: () =>
                  Promise.resolve({ data: [{ id: 'sheet-1' }], error: null }),
              }),
            }),
          };
        }
        if (table === 'grade_entries') {
          return {
            select: () => ({
              in: () => Promise.resolve({ data: entries, error: null }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    }) as never;

  it('allows a reduction when the dropped slots are empty', async () => {
    // The start-of-year case, and also a mid-year tidy-up of unused slots.
    const { findTruncationBlockers } =
      await import('@/lib/grading/sync-config-sheets');
    const blockers = await findTruncationBlockers(
      service([
        {
          grading_sheet_id: 'sheet-1',
          ww_scores: [10, 8, null, null, null],
          pt_scores: [5, 5, 5],
        },
      ]),
      'cfg-1',
      2,
      3
    );
    expect(blockers).toEqual([]);
  });

  it('blocks when a dropped slot holds a real mark', async () => {
    const { findTruncationBlockers } =
      await import('@/lib/grading/sync-config-sheets');
    const blockers = await findTruncationBlockers(
      service([
        {
          grading_sheet_id: 'sheet-1',
          ww_scores: [10, 8, 7, null, 9],
          pt_scores: [5, 5, 5],
        },
      ]),
      'cfg-1',
      2,
      3
    );
    expect(blockers).toHaveLength(1);
    expect(blockers[0].component).toBe('ww');
    // 1-based, the way a teacher names them: Written Work 3 and 5.
    expect(blockers[0].slotNumbers).toEqual([3, 5]);
  });

  it('treats a zero as a real mark, not an empty slot', async () => {
    // Hard Rule #3 — 0 means "took it and scored nothing", which is data.
    const { findTruncationBlockers } =
      await import('@/lib/grading/sync-config-sheets');
    const blockers = await findTruncationBlockers(
      service([
        { grading_sheet_id: 'sheet-1', ww_scores: [10, 8, 0], pt_scores: [] },
      ]),
      'cfg-1',
      2,
      3
    );
    expect(blockers).toHaveLength(1);
    expect(blockers[0].slotNumbers).toEqual([3]);
  });

  it('counts every affected student, not just the first', async () => {
    const { findTruncationBlockers } =
      await import('@/lib/grading/sync-config-sheets');
    const blockers = await findTruncationBlockers(
      service([
        { grading_sheet_id: 'sheet-1', ww_scores: [1, 1, 5], pt_scores: [] },
        { grading_sheet_id: 'sheet-1', ww_scores: [1, 1, 6], pt_scores: [] },
      ]),
      'cfg-1',
      2,
      3
    );
    expect(blockers[0].studentsAffected).toBe(2);
  });

  it('reports performance-task slots separately from written work', async () => {
    const { findTruncationBlockers } =
      await import('@/lib/grading/sync-config-sheets');
    const blockers = await findTruncationBlockers(
      service([
        {
          grading_sheet_id: 'sheet-1',
          ww_scores: [1, 1, 9],
          pt_scores: [1, 1, 1, 7],
        },
      ]),
      'cfg-1',
      2,
      3
    );
    expect(blockers.map((b) => b.component).sort()).toEqual(['pt', 'ww']);
  });
});
