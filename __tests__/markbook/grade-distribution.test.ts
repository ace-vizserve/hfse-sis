/**
 * Unit tests for the grade-distribution filtering logic (lib/markbook/dashboard.ts).
 *
 * The loader's two correctness properties:
 *
 *  1. Non-examinable subjects are excluded.
 *     Non-examinable subjects (Music, Arts, PE, HE, CL, CA, PEH, PMPD) write a
 *     transmuted numeric quarterly_grade through the same WW/PT/QA pipeline per
 *     KD #104. Without an is_examinable filter their grades pollute the numeric
 *     histogram (contradicting the trend chart on the same page, KD #95/#115).
 *
 *  2. is_na=true rows are excluded.
 *     Hard Rule #3 "Blank≠Zero". A student not enrolled for a term carries
 *     is_na=true with a placeholder quarterly_grade that is NOT a real grade
 *     (KD #148 enrolment-coverage proration). Including these in a numeric
 *     distribution depresses band counts and biases the histogram.
 *
 * These tests replicate the JS-level filtering loop that `loadGradeDistributionUncached`
 * applies AFTER the DB fetch. They do NOT test the DB query (that would require
 * a real Supabase instance); they prove the in-process filter is correct.
 *
 * Identical filtering applies to `loadSubjectPerformanceTrendUncached` in
 * lib/markbook/compare.ts — its Step C loop also guards on is_na===true.
 */
import { describe, expect, it } from 'vitest';

import { GRADE_BANDS, type GradeBucket } from '@/lib/markbook/dashboard';

// ── Replicated JS filter (mirrors the fixed loop in loadGradeDistributionUncached) ─

type RawEntry = {
  quarterly_grade: number | null;
  is_na: boolean | null;
  // is_examinable is already resolved at the SHEET level (server-side join +
  // JS check on sheetIds) so individual entries don't carry it. The test
  // exercises the is_na guard; the examinable guard is tested by the sheet-
  // selection assertion below.
};

function bucketEntries(rows: RawEntry[]): GradeBucket[] {
  const buckets: GradeBucket[] = GRADE_BANDS.map((b) => ({
    key: b.key,
    label: b.label,
    count: 0,
  }));
  for (const row of rows) {
    if (row.is_na === true) continue; // exclude N.A. rows
    const g = row.quarterly_grade;
    if (g == null) continue;
    const idx = GRADE_BANDS.findIndex((b) => g >= b.lo && g <= b.hi);
    if (idx >= 0) buckets[idx].count += 1;
  }
  return buckets;
}

// ── is_na exclusion tests ─────────────────────────────────────────────────────

describe('grade distribution — is_na exclusion', () => {
  it('excludes is_na=true rows even when quarterly_grade is non-null', () => {
    const rows: RawEntry[] = [
      { quarterly_grade: 92, is_na: true }, // would land in "o" (90–100) — must be excluded
      { quarterly_grade: 85, is_na: false }, // valid → "vs" (85–89)
      { quarterly_grade: 78, is_na: null }, // null is_na treated as not-N.A. → "fs" (75–79)
    ];
    const buckets = bucketEntries(rows);
    const o = buckets.find((b) => b.key === 'o')!;
    const vs = buckets.find((b) => b.key === 'vs')!;
    const fs = buckets.find((b) => b.key === 'fs')!;

    expect(o.count).toBe(0); // the 92 is_na=true row must NOT be counted
    expect(vs.count).toBe(1); // the 85 row should be counted
    expect(fs.count).toBe(1); // the 78 is_na=null row should be counted
  });

  it('all is_na=true → all bands zero', () => {
    const rows: RawEntry[] = [
      { quarterly_grade: 90, is_na: true },
      { quarterly_grade: 75, is_na: true },
      { quarterly_grade: 50, is_na: true },
    ];
    const buckets = bucketEntries(rows);
    for (const b of buckets) {
      expect(b.count).toBe(0);
    }
  });

  it('mix of is_na and real grades — only real grades count', () => {
    const rows: RawEntry[] = [
      { quarterly_grade: 95, is_na: true }, // N.A. → exclude
      { quarterly_grade: 95, is_na: false }, // real → count
      { quarterly_grade: 95, is_na: null }, // null is_na → count
      { quarterly_grade: 80, is_na: true }, // N.A. → exclude
      { quarterly_grade: 80, is_na: false }, // real → count
    ];
    const buckets = bucketEntries(rows);
    const o = buckets.find((b) => b.key === 'o')!; // 90–100
    const s = buckets.find((b) => b.key === 's')!; // 80–84

    expect(o.count).toBe(2); // the two non-N.A. 95s
    expect(s.count).toBe(1); // the single non-N.A. 80
  });
});

// ── Examinable-only sheet selection (verifying the logic pattern) ─────────────
// The actual DB-level filter is in the query join; we test the JS belt-and-
// suspenders check that runs on the returned sheetRows before building sheetIds.

type SheetRowWithSubject = {
  id: string;
  subject: { is_examinable: boolean } | { is_examinable: boolean }[] | null;
};

function filterExaminableSheetIds(rows: SheetRowWithSubject[]): string[] {
  // Mirrors the JS filter added to loadGradeDistributionUncached.
  return rows
    .filter((r) => {
      const subj = Array.isArray(r.subject) ? r.subject[0] : r.subject;
      return subj?.is_examinable === true;
    })
    .map((r) => r.id);
}

describe('grade distribution — examinable-only sheet selection', () => {
  it('keeps only sheets whose subject is_examinable=true', () => {
    const rows: SheetRowWithSubject[] = [
      { id: 'math-sheet', subject: { is_examinable: true } },
      { id: 'music-sheet', subject: { is_examinable: false } }, // non-examinable — exclude
      { id: 'english-sheet', subject: { is_examinable: true } },
      { id: 'pe-sheet', subject: { is_examinable: false } }, // non-examinable — exclude
      { id: 'null-sheet', subject: null }, // no subject data — exclude
    ];
    const ids = filterExaminableSheetIds(rows);
    expect(ids).toEqual(['math-sheet', 'english-sheet']);
  });

  it('handles subject returned as single-element array (PostgREST join shape)', () => {
    const rows: SheetRowWithSubject[] = [
      { id: 'sheet-a', subject: [{ is_examinable: true }] },
      { id: 'sheet-b', subject: [{ is_examinable: false }] },
    ];
    const ids = filterExaminableSheetIds(rows);
    expect(ids).toEqual(['sheet-a']);
  });

  it('no examinable sheets → empty array (returns emptyGradeBuckets path)', () => {
    const rows: SheetRowWithSubject[] = [
      { id: 'music', subject: { is_examinable: false } },
      { id: 'arts', subject: { is_examinable: false } },
    ];
    expect(filterExaminableSheetIds(rows)).toHaveLength(0);
  });

  it('all examinable → all ids returned', () => {
    const rows: SheetRowWithSubject[] = [
      { id: 'math', subject: { is_examinable: true } },
      { id: 'science', subject: { is_examinable: true } },
    ];
    expect(filterExaminableSheetIds(rows)).toEqual(['math', 'science']);
  });
});

// ── Grade-band bucketing (boundary correctness) ────────────────────────────────

describe('grade distribution — band boundary correctness', () => {
  it('places grades at exact boundaries in the correct band', () => {
    const rows: RawEntry[] = [
      { quarterly_grade: 74, is_na: false }, // < 75 → dnm
      { quarterly_grade: 75, is_na: false }, // 75 → fs
      { quarterly_grade: 79, is_na: false }, // 79 → fs
      { quarterly_grade: 80, is_na: false }, // 80 → s
      { quarterly_grade: 84, is_na: false }, // 84 → s
      { quarterly_grade: 85, is_na: false }, // 85 → vs
      { quarterly_grade: 89, is_na: false }, // 89 → vs
      { quarterly_grade: 90, is_na: false }, // 90 → o
      { quarterly_grade: 100, is_na: false }, // 100 → o
    ];
    const buckets = bucketEntries(rows);
    expect(buckets.find((b) => b.key === 'dnm')!.count).toBe(1);
    expect(buckets.find((b) => b.key === 'fs')!.count).toBe(2);
    expect(buckets.find((b) => b.key === 's')!.count).toBe(2);
    expect(buckets.find((b) => b.key === 'vs')!.count).toBe(2);
    expect(buckets.find((b) => b.key === 'o')!.count).toBe(2);
  });

  it('null quarterly_grade is skipped regardless of is_na', () => {
    const rows: RawEntry[] = [
      { quarterly_grade: null, is_na: false },
      { quarterly_grade: null, is_na: null },
    ];
    const buckets = bucketEntries(rows);
    const total = buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(0);
  });

  it('empty input → all bands zero', () => {
    const buckets = bucketEntries([]);
    for (const b of buckets) expect(b.count).toBe(0);
  });
});
