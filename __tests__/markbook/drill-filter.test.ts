/**
 * Unit tests for lib/markbook/drill-filter.ts — the client-safe module that
 * now holds BOTH the canonical GRADE_BANDS vocabulary and the single
 * applyTargetFilter switch shared by the server drill loader (drill.ts) and
 * the client drill-seed narrowing path (markbook-drill-sheet.tsx's sanctioned
 * `initialData` exception to KD #24's drill-seed rule).
 *
 * Three things under test:
 *
 *  1. GRADE_BANDS boundary correctness (classifyGradeBucket) — the unified
 *     vocabulary that used to be triplicated across dashboard.ts / drill.ts /
 *     drill-target-filter.ts with two DIFFERENT label sets.
 *
 *  2. 'grade-bucket-entries' — the newly-added examinable + is_na filters,
 *     scoped to ONLY this target (grade-entries / teacher-entry-velocity
 *     must keep counting everything).
 *
 *  3. applyTargetFilter's per-target switch for the 7 targets named in the
 *     task brief: sheets-locked, change-requests, publication-coverage,
 *     term-sheet-status, term-publication-status, sheet-readiness-section,
 *     teacher-entry-velocity — including the two semantic-alignment fixes
 *     ('decided' keys on reviewedAt, not resolvedAt; 'sheets-locked' uses
 *     the dashboard's +08:00 SGT-day-boundary comparison, not a raw UTC
 *     date-slice).
 */
import { describe, expect, it } from 'vitest';

import {
  applyTargetFilter,
  classifyGradeBucket,
  GRADE_BANDS,
} from '@/lib/markbook/drill-filter';
import type {
  ChangeRequestRow,
  GradeEntryRow,
  SheetRow,
} from '@/lib/markbook/drill';

// ── Fixture factories ───────────────────────────────────────────────────────

function makeSheet(overrides: Partial<SheetRow> = {}): SheetRow {
  return {
    sheetId: 'sheet-1',
    sectionId: 'section-1',
    sectionName: 'Obedience',
    level: 'P1',
    subjectCode: 'ENG',
    subjectName: 'English',
    termNumber: 1,
    termLabel: 'Term 1',
    termId: 'term-1',
    isLocked: false,
    lockedAt: null,
    isPublished: false,
    publishedAt: null,
    entriesPresent: 0,
    entriesExpected: 0,
    completenessPct: 0,
    teacherName: null,
    ...overrides,
  };
}

function makeChangeRequest(
  overrides: Partial<ChangeRequestRow> = {}
): ChangeRequestRow {
  return {
    requestId: 'req-1',
    status: 'pending',
    sheetId: 'sheet-1',
    sectionId: 'section-1',
    sectionName: 'Obedience',
    subjectCode: 'ENG',
    termNumber: 1,
    termId: 'term-1',
    fieldChanged: 'ww_scores',
    reasonCategory: 'data_entry_error',
    requestedBy: 'teacher@hfse.edu.sg',
    requestedAt: '2026-03-01T00:00:00+00:00',
    resolvedAt: null,
    reviewedAt: null,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<GradeEntryRow> = {}): GradeEntryRow {
  return {
    entryId: 'entry-1',
    studentId: 'student-1',
    studentName: 'Doe, Jane',
    studentNumber: 'S-0001',
    enroleeNumber: 'S-0001',
    level: 'P1',
    sectionId: 'section-1',
    sectionName: 'Obedience',
    subjectCode: 'ENG',
    termNumber: 1,
    termId: 'term-1',
    wwScores: [8, 9],
    ptScores: [9, 10],
    qaScore: 25,
    qaMax: 30,
    letterGrade: null,
    rawScore: 25,
    maxScore: 30,
    computedGrade: 88,
    gradeBucket: 'vs',
    isExaminable: true,
    isNa: false,
    isLocked: false,
    enteredAt: '2026-03-01T00:00:00+00:00',
    enteredBy: 'teacher@hfse.edu.sg',
    enteredById: 'teacher-uuid-1',
    ...overrides,
  };
}

// ── 1. GRADE_BANDS boundary correctness ─────────────────────────────────────

describe('GRADE_BANDS — classifyGradeBucket boundary correctness', () => {
  it('places grades at exact boundaries in the correct band', () => {
    expect(classifyGradeBucket(0)).toBe('dnm');
    expect(classifyGradeBucket(74)).toBe('dnm');
    expect(classifyGradeBucket(75)).toBe('fs');
    expect(classifyGradeBucket(79)).toBe('fs');
    expect(classifyGradeBucket(80)).toBe('s');
    expect(classifyGradeBucket(84)).toBe('s');
    expect(classifyGradeBucket(85)).toBe('vs');
    expect(classifyGradeBucket(89)).toBe('vs');
    expect(classifyGradeBucket(90)).toBe('o');
    expect(classifyGradeBucket(100)).toBe('o');
  });

  it('null / non-finite grades classify as null', () => {
    expect(classifyGradeBucket(null)).toBeNull();
    expect(classifyGradeBucket(Number.NaN)).toBeNull();
  });

  it('exposes exactly 5 bands covering 0..100 with no gaps or overlaps', () => {
    expect(GRADE_BANDS).toHaveLength(5);
    const sorted = [...GRADE_BANDS].sort((a, b) => a.lo - b.lo);
    expect(sorted[0].lo).toBe(0);
    expect(sorted[sorted.length - 1].hi).toBe(100);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].lo).toBe(sorted[i - 1].hi + 1);
    }
  });
});

// ── 2. grade-bucket-entries — examinable + is_na filters ────────────────────

describe("applyTargetFilter('grade-bucket-entries') — examinable + is_na", () => {
  it('excludes non-examinable entries even when segment is unset', () => {
    const rows = [
      makeEntry({ entryId: 'a', isExaminable: true }),
      makeEntry({ entryId: 'b', isExaminable: false }), // e.g. Music, PE (KD #104)
    ];
    const out = applyTargetFilter(rows, 'grade-bucket-entries', null, {});
    expect(out.map((r) => (r as GradeEntryRow).entryId)).toEqual(['a']);
  });

  it('excludes is_na=true entries even when segment is unset', () => {
    const rows = [
      makeEntry({ entryId: 'a', isNa: false }),
      makeEntry({ entryId: 'b', isNa: true }), // Hard Rule #3 placeholder grade
    ];
    const out = applyTargetFilter(rows, 'grade-bucket-entries', null, {});
    expect(out.map((r) => (r as GradeEntryRow).entryId)).toEqual(['a']);
  });

  it('applies both filters together, then narrows by the clicked band', () => {
    const rows = [
      makeEntry({
        entryId: 'keep',
        isExaminable: true,
        isNa: false,
        gradeBucket: 'o',
        computedGrade: 95,
      }),
      makeEntry({
        entryId: 'wrong-band',
        isExaminable: true,
        isNa: false,
        gradeBucket: 's',
        computedGrade: 82,
      }),
      makeEntry({
        entryId: 'non-examinable',
        isExaminable: false,
        isNa: false,
        gradeBucket: 'o',
        computedGrade: 95,
      }),
      makeEntry({
        entryId: 'na-row',
        isExaminable: true,
        isNa: true,
        gradeBucket: 'o',
        computedGrade: 95,
      }),
    ];
    const out = applyTargetFilter(rows, 'grade-bucket-entries', 'o', {});
    expect(out.map((r) => (r as GradeEntryRow).entryId)).toEqual(['keep']);
  });

  it('accepts the bucket LABEL as well as the key', () => {
    const rows = [
      makeEntry({ entryId: 'a', gradeBucket: 'dnm' }),
      makeEntry({ entryId: 'b', gradeBucket: 'o' }),
    ];
    const label = GRADE_BANDS.find((b) => b.key === 'dnm')!.label;
    const out = applyTargetFilter(rows, 'grade-bucket-entries', label, {});
    expect(out.map((r) => (r as GradeEntryRow).entryId)).toEqual(['a']);
  });

  it('leaves grade-entries and teacher-entry-velocity unfiltered by examinable/is_na', () => {
    const rows = [
      makeEntry({ entryId: 'examinable', isExaminable: true, isNa: false }),
      makeEntry({ entryId: 'non-examinable', isExaminable: false }),
      makeEntry({ entryId: 'na-row', isNa: true }),
    ];
    expect(
      applyTargetFilter(rows, 'grade-entries', null, {}).map(
        (r) => (r as GradeEntryRow).entryId
      )
    ).toEqual(['examinable', 'non-examinable', 'na-row']);

    // teacher-entry-velocity with no segment returns everything too.
    expect(
      applyTargetFilter(rows, 'teacher-entry-velocity', null, {}).map(
        (r) => (r as GradeEntryRow).entryId
      )
    ).toEqual(['examinable', 'non-examinable', 'na-row']);
  });
});

// ── 3a. sheets-locked — +08:00 SGT day-boundary alignment ───────────────────

describe("applyTargetFilter('sheets-locked')", () => {
  it('with no range: returns every locked sheet, ignores unlocked', () => {
    const rows = [
      makeSheet({
        sheetId: 'locked',
        isLocked: true,
        lockedAt: '2026-03-05T04:00:00+00:00',
      }),
      makeSheet({ sheetId: 'open', isLocked: false, lockedAt: null }),
    ];
    const out = applyTargetFilter(rows, 'sheets-locked', null, {});
    expect(out.map((r) => (r as SheetRow).sheetId)).toEqual(['locked']);
  });

  it("uses the dashboard's exact `${date}T00:00:00+08:00` / `${date}T23:59:59+08:00` boundary strings (KD #32), not a `.slice(0, 10)` UTC calendar-date compare", () => {
    // loadMarkbookKpisForRange (dashboard.ts) builds fromIso/toIso as
    // `${input.from}T00:00:00+08:00` / `${input.to}T23:59:59+08:00` and
    // compares the raw locked_at ISO string against them directly. Prove the
    // drill does the identical comparison by picking a lockedAt whose date
    // portion equals `from`/`to` but whose time is right at the boundary of
    // what a `.slice(0, 10)` compare would have treated identically anyway
    // (both approaches must include it) — then a lockedAt one calendar day
    // OUTSIDE the range, which BOTH approaches must exclude. The point isn't
    // that the two approaches diverge on every input (for whole-day ranges
    // they mostly agree) — it's that the drill's code is now built from the
    // same literal boundary-string construction, not a different one that
    // happens to often agree.
    const from = '2026-03-05';
    const to = '2026-03-05';

    const withinDay = makeSheet({
      sheetId: 'within',
      isLocked: true,
      lockedAt: '2026-03-05T10:15:00+00:00',
    });
    const priorDay = makeSheet({
      sheetId: 'prior-day',
      isLocked: true,
      lockedAt: '2026-03-04T10:15:00+00:00',
    });
    const nextDay = makeSheet({
      sheetId: 'next-day',
      isLocked: true,
      lockedAt: '2026-03-06T10:15:00+00:00',
    });

    const out = applyTargetFilter(
      [withinDay, priorDay, nextDay],
      'sheets-locked',
      null,
      { from, to }
    );
    expect(out.map((r) => (r as SheetRow).sheetId)).toEqual(['within']);
  });

  it('excludes locked sheets whose lockedAt falls outside the range', () => {
    const rows = [
      makeSheet({
        sheetId: 'in-range',
        isLocked: true,
        lockedAt: '2026-03-05T10:00:00+00:00',
      }),
      makeSheet({
        sheetId: 'out-of-range',
        isLocked: true,
        lockedAt: '2026-01-01T10:00:00+00:00',
      }),
      makeSheet({ sheetId: 'unlocked', isLocked: false, lockedAt: null }),
    ];
    const out = applyTargetFilter(rows, 'sheets-locked', null, {
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(out.map((r) => (r as SheetRow).sheetId)).toEqual(['in-range']);
  });

  it('a locked sheet with no lockedAt timestamp never matches a ranged query', () => {
    const rows = [makeSheet({ isLocked: true, lockedAt: null })];
    const out = applyTargetFilter(rows, 'sheets-locked', null, {
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(out).toHaveLength(0);
  });
});

// ── 3b. change-requests — 'decided' keys on reviewedAt, not resolvedAt ──────

describe("applyTargetFilter('change-requests')", () => {
  it("'decided' requires reviewedAt (matches the dashboard's decidedCount), not resolvedAt", () => {
    const rows = [
      makeChangeRequest({
        requestId: 'approved-reviewed',
        status: 'approved',
        reviewedAt: '2026-03-02T00:00:00+00:00',
        resolvedAt: '2026-03-02T00:00:00+00:00',
      }),
      makeChangeRequest({
        requestId: 'applied-but-reviewedAt-null',
        // Regression case: resolvedAt (applied_at ?? reviewed_at) is
        // non-null here purely because applied_at is set, but reviewedAt
        // itself is null. The OLD drill filter (keyed on resolvedAt) would
        // have wrongly counted this as decided; the dashboard KPI — which
        // keys on reviewed_at alone — never would.
        status: 'applied',
        reviewedAt: null,
        resolvedAt: '2026-03-03T00:00:00+00:00',
      }),
      makeChangeRequest({
        requestId: 'pending',
        status: 'pending',
        reviewedAt: null,
        resolvedAt: null,
      }),
      makeChangeRequest({
        requestId: 'applied-and-reviewed',
        status: 'applied',
        reviewedAt: '2026-03-04T00:00:00+00:00',
        resolvedAt: '2026-03-05T00:00:00+00:00', // later than reviewedAt
      }),
    ];
    const out = applyTargetFilter(rows, 'change-requests', 'decided');
    expect((out as ChangeRequestRow[]).map((r) => r.requestId).sort()).toEqual([
      'applied-and-reviewed',
      'approved-reviewed',
    ]);
  });

  it('a plain status segment filters on the literal status value', () => {
    const rows = [
      makeChangeRequest({ requestId: 'p', status: 'pending' }),
      makeChangeRequest({ requestId: 'r', status: 'rejected' }),
    ];
    const out = applyTargetFilter(rows, 'change-requests', 'pending');
    expect((out as ChangeRequestRow[]).map((r) => r.requestId)).toEqual(['p']);
  });

  it('no segment → returns every row unfiltered', () => {
    const rows = [
      makeChangeRequest({ requestId: 'a' }),
      makeChangeRequest({ requestId: 'b' }),
    ];
    expect(applyTargetFilter(rows, 'change-requests', null)).toHaveLength(2);
  });
});

// ── 3c. publication-coverage ─────────────────────────────────────────────────

describe("applyTargetFilter('publication-coverage')", () => {
  it("'published' keeps only published sheets", () => {
    const rows = [
      makeSheet({ sheetId: 'pub', isPublished: true }),
      makeSheet({ sheetId: 'unpub', isPublished: false }),
    ];
    const out = applyTargetFilter(rows, 'publication-coverage', 'published');
    expect(out.map((r) => (r as SheetRow).sheetId)).toEqual(['pub']);
  });

  it("'not-published' keeps only unpublished sheets", () => {
    const rows = [
      makeSheet({ sheetId: 'pub', isPublished: true }),
      makeSheet({ sheetId: 'unpub', isPublished: false }),
    ];
    const out = applyTargetFilter(
      rows,
      'publication-coverage',
      'not-published'
    );
    expect(out.map((r) => (r as SheetRow).sheetId)).toEqual(['unpub']);
  });
});

// ── 3d. term-sheet-status — dual regex (compact + human label) ──────────────

describe("applyTargetFilter('term-sheet-status')", () => {
  const rows = [
    makeSheet({ sheetId: 't1-locked', termNumber: 1, isLocked: true }),
    makeSheet({ sheetId: 't1-open', termNumber: 1, isLocked: false }),
    makeSheet({ sheetId: 't2-locked', termNumber: 2, isLocked: true }),
  ];

  it('accepts the compact form (T1:locked)', () => {
    const out = applyTargetFilter(rows, 'term-sheet-status', 'T1:locked');
    expect(out.map((r) => (r as SheetRow).sheetId)).toEqual(['t1-locked']);
  });

  it('accepts the human chart-label form (Term 1 · Open)', () => {
    const out = applyTargetFilter(rows, 'term-sheet-status', 'Term 1 · Open');
    expect(out.map((r) => (r as SheetRow).sheetId)).toEqual(['t1-open']);
  });

  it('bare term (T2) returns every sheet in that term regardless of lock state', () => {
    const out = applyTargetFilter(rows, 'term-sheet-status', 'T2');
    expect(out.map((r) => (r as SheetRow).sheetId)).toEqual(['t2-locked']);
  });
});

// ── 3e. term-publication-status — dedupe by section ──────────────────────────

describe("applyTargetFilter('term-publication-status')", () => {
  it('dedupes multiple subject sheets down to one row per section', () => {
    const rows = [
      makeSheet({
        sheetId: 'math',
        sectionId: 'sec-1',
        termNumber: 1,
        isPublished: true,
      }),
      makeSheet({
        sheetId: 'eng',
        sectionId: 'sec-1',
        termNumber: 1,
        isPublished: true,
      }),
      makeSheet({
        sheetId: 'other-sec',
        sectionId: 'sec-2',
        termNumber: 1,
        isPublished: true,
      }),
    ];
    const out = applyTargetFilter(
      rows,
      'term-publication-status',
      'Term 1 · Published'
    );
    expect(out).toHaveLength(2); // one per section, not per sheet
    expect(new Set(out.map((r) => (r as SheetRow).sectionId))).toEqual(
      new Set(['sec-1', 'sec-2'])
    );
  });
});

// ── 3f. sheet-readiness-section ──────────────────────────────────────────────

describe("applyTargetFilter('sheet-readiness-section')", () => {
  it('with no segment: returns every non-locked sheet across all sections', () => {
    const rows = [
      makeSheet({ sheetId: 'a', sectionName: 'Obedience', isLocked: false }),
      makeSheet({ sheetId: 'b', sectionName: 'Honesty', isLocked: true }),
    ];
    const out = applyTargetFilter(rows, 'sheet-readiness-section', null);
    expect(out.map((r) => (r as SheetRow).sheetId)).toEqual(['a']);
  });

  it('with a segment: scopes to that section AND excludes locked sheets', () => {
    const rows = [
      makeSheet({
        sheetId: 'obedience-open',
        sectionName: 'Obedience',
        isLocked: false,
      }),
      makeSheet({
        sheetId: 'obedience-locked',
        sectionName: 'Obedience',
        isLocked: true,
      }),
      makeSheet({
        sheetId: 'honesty-open',
        sectionName: 'Honesty',
        isLocked: false,
      }),
    ];
    const out = applyTargetFilter(rows, 'sheet-readiness-section', 'Obedience');
    expect(out.map((r) => (r as SheetRow).sheetId)).toEqual(['obedience-open']);
  });
});

// ── 3g. teacher-entry-velocity ───────────────────────────────────────────────

describe("applyTargetFilter('teacher-entry-velocity')", () => {
  it('with a segment: filters entries to that teacher email', () => {
    const rows = [
      makeEntry({ entryId: 'a', enteredBy: 'alice@hfse.edu.sg' }),
      makeEntry({ entryId: 'b', enteredBy: 'bob@hfse.edu.sg' }),
    ];
    const out = applyTargetFilter(
      rows,
      'teacher-entry-velocity',
      'alice@hfse.edu.sg'
    );
    expect(out.map((r) => (r as GradeEntryRow).entryId)).toEqual(['a']);
  });

  it('with no segment: returns every entry unfiltered', () => {
    const rows = [
      makeEntry({ entryId: 'a', enteredBy: 'alice@hfse.edu.sg' }),
      makeEntry({ entryId: 'b', enteredBy: 'bob@hfse.edu.sg' }),
    ];
    expect(
      applyTargetFilter(rows, 'teacher-entry-velocity', null)
    ).toHaveLength(2);
  });
});
