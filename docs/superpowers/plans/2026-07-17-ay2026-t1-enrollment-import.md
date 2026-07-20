# AY2026 T1 Enrollment Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a reviewable pair of SQL files (`ay2026-t1-enrollment-preview.sql` / `ay2026-t1-enrollment-apply.sql`) that, once run by hand, establish AY2026's T1 term, real section list, and student roster from HFSE's actual T1 attendance workbook.

**Architecture:** A chain of small pure TypeScript modules (SQL escaping → name matching → section-name derivation → workbook parsing → SQL/report builder) composed by a thin orchestrator script that does the only I/O (reads the `.xlsx` file, queries Supabase for the candidate pool, writes the two `.sql` files). Nothing writes to the database directly — the orchestrator's output is text files a human reviews and runs.

**Tech Stack:** TypeScript via `tsx`, `xlsx` (SheetJS) for parsing, `@supabase/supabase-js` (via the existing `createServiceClient()`), Vitest for unit tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-17-ay2026-t1-enrollment-import-design.md` — read it if anything below is ambiguous.
- T1 dates are fixed: `start_date = '2026-01-08'`, `end_date = '2026-03-13'` (AY2026, term_number=1).
- `section_students.enrollment_date` MUST be `NULL` for every inserted row — never today's date (would wrongly exclude Jan–Mar attendance from later rollups).
- Section names are clean (KD #144 style: "Patience", "Discipline 1") — never the file's "(G)"/"AM Global" annotations.
- Section tabs with zero students are skipped entirely — never created.
- The "YS" sheet is excluded from this import (level-catalog rework in progress concurrently) — flagged in the preview report, not silently dropped.
- Matching auto-accepts only `exact`/`strong`/unique-`fuzzy` tiers; everything else goes to a "needs review" list and is never written.
- Nothing in this plan touches `attendance_daily`, `grading_sheets`/`grade_entries`, or `evaluation_writeups` — those are later phases.
- All generated SQL must be idempotent (safe to regenerate + rerun) — use `ON CONFLICT DO NOTHING` / `NOT EXISTS` guards, matching the existing `scripts/backfill/ay2025-*-apply.sql` convention.
- Camel-case Postgres columns (`ay2026_enrolment_status."applicationStatus"` etc.) must be double-quoted in generated SQL.
- No task in this plan runs `apply.sql` against the database — that step is manual, by the user, after reviewing the preview report.

---

### Task 1: SQL string-escaping helpers

**Files:**

- Create: `lib/sis/backfill/enrollment/sql-escape.ts`
- Test: `__tests__/sis/backfill/enrollment/sql-escape.test.ts`

**Interfaces:**

- Produces: `sqlString(value: string): string`, `sqlStringOrNull(value: string | null | undefined): string` — used by Task 5's SQL builder.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/sis/backfill/enrollment/sql-escape.test.ts
import { describe, expect, it } from 'vitest';

import {
  sqlString,
  sqlStringOrNull,
} from '@/lib/sis/backfill/enrollment/sql-escape';

describe('sqlString', () => {
  it('quotes a plain string', () => {
    expect(sqlString('Patience')).toBe("'Patience'");
  });

  it('doubles embedded single quotes', () => {
    expect(sqlString("D'Angelo")).toBe("'D''Angelo'");
  });

  it('handles multiple embedded quotes', () => {
    expect(sqlString("O'Brien's")).toBe("'O''Brien''s'");
  });
});

describe('sqlStringOrNull', () => {
  it('quotes a non-empty string', () => {
    expect(sqlStringOrNull('Ms. Kristel')).toBe("'Ms. Kristel'");
  });

  it('emits NULL for null', () => {
    expect(sqlStringOrNull(null)).toBe('NULL');
  });

  it('emits NULL for undefined', () => {
    expect(sqlStringOrNull(undefined)).toBe('NULL');
  });

  it('emits NULL for an empty/whitespace string', () => {
    expect(sqlStringOrNull('')).toBe('NULL');
    expect(sqlStringOrNull('   ')).toBe('NULL');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/sis/backfill/enrollment/sql-escape.test.ts`
Expected: FAIL — cannot find module `@/lib/sis/backfill/enrollment/sql-escape`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/sis/backfill/enrollment/sql-escape.ts
// Escapes a string for safe inclusion inside a single-quoted Postgres SQL
// literal. Doubles embedded single quotes per the SQL standard. Used by the
// AY2026 enrollment-import SQL builder (build-import.ts) — never trusts a
// name/value straight into generated SQL text.
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Same as sqlString, but emits the unquoted literal NULL for
// null/undefined/whitespace-only input.
export function sqlStringOrNull(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === '')
    return 'NULL';
  return sqlString(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/sis/backfill/enrollment/sql-escape.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/enrollment/sql-escape.ts __tests__/sis/backfill/enrollment/sql-escape.test.ts
git commit -m "feat(backfill): add SQL-escaping helper for AY2026 enrollment import"
```

---

### Task 2: Name-matching pure logic

**Files:**

- Create: `lib/sis/backfill/enrollment/name-match.ts`
- Test: `__tests__/sis/backfill/enrollment/name-match.test.ts`

**Interfaces:**

- Produces:
  - `type MatchTier = 'exact' | 'strong' | 'fuzzy' | 'none'`
  - `interface SheetName { lastName: string; firstMiddle: string }`
  - `interface CandidateName { enroleeNumber: string; studentNumber: string | null; lastName: string; firstName: string; middleName: string | null }`
  - `interface MatchResult { tier: MatchTier; candidate: CandidateName | null; score: number }`
  - `parseSheetFullName(fullName: string): SheetName`
  - `matchName(sheetName: SheetName, candidates: CandidateName[]): MatchResult`
  - `similarityRatio(a: string, b: string): number` (0..1)
- Consumed by: Task 5 (`build-import.ts`) and Task 6 (orchestrator, which builds `CandidateName[]` from Supabase rows).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/sis/backfill/enrollment/name-match.test.ts
import { describe, expect, it } from 'vitest';

import {
  matchName,
  parseSheetFullName,
  similarityRatio,
  type CandidateName,
} from '@/lib/sis/backfill/enrollment/name-match';

describe('parseSheetFullName', () => {
  it('splits "LAST, First Middle." into last + firstMiddle', () => {
    expect(parseSheetFullName('BEDICO, Miguel Zion C.')).toEqual({
      lastName: 'BEDICO',
      firstMiddle: 'Miguel Zion C.',
    });
  });

  it('falls back to treating the whole string as last name when no comma', () => {
    expect(parseSheetFullName('NoComma')).toEqual({
      lastName: 'NoComma',
      firstMiddle: '',
    });
  });
});

describe('matchName', () => {
  const candidates: CandidateName[] = [
    {
      enroleeNumber: 'E260092',
      studentNumber: 'H220038',
      lastName: 'Bedico',
      firstName: 'Miguel Zion',
      middleName: 'Cabrera',
    },
    {
      enroleeNumber: 'E260093',
      studentNumber: 'H190240',
      lastName: 'Alvarez',
      firstName: 'Jaime',
      middleName: 'Dela Cruz',
    },
    {
      enroleeNumber: 'E260094',
      studentNumber: 'H190241',
      lastName: 'Alvarez',
      firstName: 'Jaime',
      middleName: 'Santos',
    },
  ];

  it('returns an exact match when last+first+middle all match', () => {
    const result = matchName(
      { lastName: 'BEDICO', firstMiddle: 'Miguel Zion Cabrera' },
      candidates
    );
    expect(result.tier).toBe('exact');
    expect(result.candidate?.enroleeNumber).toBe('E260092');
  });

  it('returns a strong match when middle name is abbreviated to an initial', () => {
    const result = matchName(
      { lastName: 'BEDICO', firstMiddle: 'Miguel Zion C.' },
      candidates
    );
    expect(result.tier).toBe('strong');
    expect(result.candidate?.enroleeNumber).toBe('E260092');
  });

  it('returns a strong match when middle name is omitted entirely', () => {
    const result = matchName(
      { lastName: 'BEDICO', firstMiddle: 'Miguel Zion' },
      candidates
    );
    expect(result.tier).toBe('strong');
    expect(result.candidate?.enroleeNumber).toBe('E260092');
  });

  it('returns none when two same-surname candidates are equally ambiguous', () => {
    const result = matchName(
      { lastName: 'ALVAREZ', firstMiddle: 'Jaime' },
      candidates
    );
    expect(result.tier).toBe('none');
    expect(result.candidate).toBeNull();
  });

  it('resolves an ambiguous surname when the middle name disambiguates', () => {
    const result = matchName(
      { lastName: 'ALVAREZ', firstMiddle: 'Jaime Santos' },
      candidates
    );
    // Full first+middle match against exactly one candidate ("Santos") —
    // this is actually an exact match, not merely a strong one; the other
    // candidate ("Dela Cruz") is ruled out at the "Santos" vs "Dela"
    // token position, not via ambiguity tolerance.
    expect(result.tier).toBe('exact');
    expect(result.candidate?.enroleeNumber).toBe('E260094');
  });

  it('returns none for a completely unrelated name', () => {
    const result = matchName(
      { lastName: 'ZZTOPP', firstMiddle: 'Nobody Here' },
      candidates
    );
    expect(result.tier).toBe('none');
  });

  it('returns a fuzzy match for a minor typo when it is uniquely close', () => {
    const result = matchName(
      { lastName: 'BEDIKO', firstMiddle: 'Miguel Zion Cabrera' },
      candidates
    );
    expect(result.tier).toBe('fuzzy');
    expect(result.candidate?.enroleeNumber).toBe('E260092');
  });
});

describe('similarityRatio', () => {
  it('is 1 for identical strings', () => {
    expect(similarityRatio('ABC', 'ABC')).toBe(1);
  });

  it('is 0 for completely different strings of equal length', () => {
    expect(similarityRatio('AAAA', 'ZZZZ')).toBe(0);
  });

  it('is between 0 and 1 for a near match', () => {
    const r = similarityRatio('BEDICO', 'BEDIKO');
    expect(r).toBeGreaterThan(0.7);
    expect(r).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/sis/backfill/enrollment/name-match.test.ts`
Expected: FAIL — cannot find module `@/lib/sis/backfill/enrollment/name-match`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/sis/backfill/enrollment/name-match.ts
// Pure name-matching logic for the AY2026 T1 enrollment import — and its
// planned T2/T3 reruns (per the design doc, this matcher gets reused when
// later terms are diffed against the roster this establishes). No I/O.

export type MatchTier = 'exact' | 'strong' | 'fuzzy' | 'none';

export interface SheetName {
  lastName: string;
  firstMiddle: string;
}

export interface CandidateName {
  enroleeNumber: string;
  studentNumber: string | null;
  lastName: string;
  firstName: string;
  middleName: string | null;
}

export interface MatchResult {
  tier: MatchTier;
  candidate: CandidateName | null;
  score: number;
}

function normalize(s: string): string {
  return s.toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
}

function tokenize(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean);
}

// Parses a workbook "Full Name" cell of the form "LASTNAME, First Middle."
// into { lastName, firstMiddle }. Cells without a comma fall back to
// treating the whole string as the last name.
export function parseSheetFullName(fullName: string): SheetName {
  const idx = fullName.indexOf(',');
  if (idx === -1) {
    return { lastName: fullName.trim(), firstMiddle: '' };
  }
  return {
    lastName: fullName.slice(0, idx).trim(),
    firstMiddle: fullName.slice(idx + 1).trim(),
  };
}

// True if `short` is a single-letter initial of `long` (e.g. "C" of "CABRERA").
function isInitialOf(short: string, long: string): boolean {
  return short.length === 1 && long.length > 0 && long[0] === short;
}

// Compares two token lists position-by-position. 'exact' if every token
// matches verbatim and the lists are the same length. 'strong' if the
// primary first-name token (position 0) matches EXACTLY — an initial-only
// match there is too weak a signal to auto-accept on its own — every other
// aligned position matches verbatim or by initial, and any leftover
// trailing tokens on either side are simply unexplained (typically a
// middle name present on one side and omitted on the other). Otherwise
// null.
//
// The "any leftover trailing tokens" tolerance is deliberately NOT capped
// at a fixed count: capping it (e.g. "at most 1 extra token") would let a
// 1-word-middle-name candidate auto-resolve while an otherwise-identical
// 2-word-middle-name candidate for the same first name got rejected purely
// by coincidence of word count, silently breaking a real ambiguous case
// (see the "equally ambiguous" test below) instead of flagging it. Callers
// (matchName) still catch true ambiguity by requiring exactly one 'strong'
// candidate among same-surname matches.
function compareTokens(a: string[], b: string[]): 'exact' | 'strong' | null {
  if (a.length === 0 && b.length === 0) return 'exact';
  if (a.length === 0 || b.length === 0) return null;
  if (a[0] !== b[0]) return null;
  const minLen = Math.min(a.length, b.length);
  for (let i = 1; i < minLen; i++) {
    if (a[i] !== b[i] && !isInitialOf(a[i], b[i]) && !isInitialOf(b[i], a[i])) {
      return null;
    }
  }
  if (a.length === b.length && a.join(' ') === b.join(' ')) return 'exact';
  return 'strong';
}

// Levenshtein-based similarity ratio in [0, 1]; 1 = identical (after
// normalization). Deliberately dependency-free — good enough for the
// narrow "is this a typo of the same name" fuzzy tier.
export function similarityRatio(a: string, b: string): number {
  const s1 = normalize(a);
  const s2 = normalize(b);
  if (s1 === s2) return 1;
  const m = s1.length;
  const n = s2.length;
  if (m === 0 || n === 0) return 0;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] =
        s1[i - 1] === s2[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  const distance = dp[n];
  return 1 - distance / Math.max(m, n);
}

const FUZZY_THRESHOLD = 0.9;

// Matches one workbook roster name against a pool of admissions candidates.
// Callers are responsible for pre-filtering the pool (e.g. excluding
// Cancelled/Withdrawn applications) before calling this.
export function matchName(
  sheetName: SheetName,
  candidates: CandidateName[]
): MatchResult {
  const sheetLastNorm = normalize(sheetName.lastName);
  const sheetTokens = tokenize(sheetName.firstMiddle);

  const sameLast = candidates.filter(
    (c) => normalize(c.lastName) === sheetLastNorm
  );

  const structured: { candidate: CandidateName; tier: 'exact' | 'strong' }[] =
    [];
  for (const c of sameLast) {
    const candTokens = tokenize(`${c.firstName} ${c.middleName ?? ''}`.trim());
    const cmp = compareTokens(sheetTokens, candTokens);
    if (cmp) structured.push({ candidate: c, tier: cmp });
  }
  const exact = structured.find((s) => s.tier === 'exact');
  if (exact) return { tier: 'exact', candidate: exact.candidate, score: 1 };

  const strong = structured.filter((s) => s.tier === 'strong');
  if (strong.length === 1) {
    return { tier: 'strong', candidate: strong[0].candidate, score: 1 };
  }
  if (strong.length > 1) {
    // Ambiguous — more than one same-surname candidate looks equally right.
    return { tier: 'none', candidate: null, score: 0 };
  }

  // Fuzzy pass — across the whole pool, in case of a last-name typo too.
  const sheetFull = `${sheetName.lastName} ${sheetName.firstMiddle}`;
  let best: { candidate: CandidateName; score: number } | null = null;
  let secondBestScore = 0;
  for (const c of candidates) {
    const candFull = `${c.lastName} ${c.firstName} ${c.middleName ?? ''}`;
    const score = similarityRatio(sheetFull, candFull);
    if (!best || score > best.score) {
      secondBestScore = best?.score ?? 0;
      best = { candidate: c, score };
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }
  if (
    best &&
    best.score >= FUZZY_THRESHOLD &&
    secondBestScore < FUZZY_THRESHOLD
  ) {
    return { tier: 'fuzzy', candidate: best.candidate, score: best.score };
  }
  return { tier: 'none', candidate: null, score: best?.score ?? 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/sis/backfill/enrollment/name-match.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/enrollment/name-match.ts __tests__/sis/backfill/enrollment/name-match.test.ts
git commit -m "feat(backfill): add tiered name-matching logic for AY2026 enrollment import"
```

---

### Task 3: Section-identity derivation

**Files:**

- Create: `lib/sis/backfill/enrollment/section-identity.ts`
- Test: `__tests__/sis/backfill/enrollment/section-identity.test.ts`

**Interfaces:**

- Produces: `type SectionIdentity = { kind: 'core'; levelCode: string; cleanName: string } | { kind: 'ys' } | { kind: 'unrecognized'; rawSheetName: string }`, `deriveSectionIdentity(sheetName: string): SectionIdentity`
- Consumed by: Task 5 (`build-import.ts`).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/sis/backfill/enrollment/section-identity.test.ts
import { describe, expect, it } from 'vitest';

import { deriveSectionIdentity } from '@/lib/sis/backfill/enrollment/section-identity';

describe('deriveSectionIdentity', () => {
  it('strips a trailing "(G)" annotation with no leading space', () => {
    expect(deriveSectionIdentity('P1 Patience(G)')).toEqual({
      kind: 'core',
      levelCode: 'P1',
      cleanName: 'Patience',
    });
  });

  it('strips a trailing "(AM Global)"-style annotation with a leading space', () => {
    expect(deriveSectionIdentity('P2 Honesty (G)')).toEqual({
      kind: 'core',
      levelCode: 'P2',
      cleanName: 'Honesty',
    });
  });

  it('leaves a plain section name untouched', () => {
    expect(deriveSectionIdentity('P1 Obedience')).toEqual({
      kind: 'core',
      levelCode: 'P1',
      cleanName: 'Obedience',
    });
  });

  it('handles multi-token clean names', () => {
    expect(deriveSectionIdentity('S1 Discipline 1 (G)')).toEqual({
      kind: 'core',
      levelCode: 'S1',
      cleanName: 'Discipline 1',
    });
    expect(deriveSectionIdentity('S1 Discipline 2')).toEqual({
      kind: 'core',
      levelCode: 'S1',
      cleanName: 'Discipline 2',
    });
  });

  it('handles secondary levels S1-S4', () => {
    expect(deriveSectionIdentity('S4 Excellence')).toEqual({
      kind: 'core',
      levelCode: 'S4',
      cleanName: 'Excellence',
    });
  });

  it('flags the YS sheet distinctly', () => {
    expect(deriveSectionIdentity('YS')).toEqual({ kind: 'ys' });
  });

  it('flags an unrecognized sheet name', () => {
    expect(deriveSectionIdentity('Reserved 1')).toEqual({
      kind: 'unrecognized',
      rawSheetName: 'Reserved 1',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/sis/backfill/enrollment/section-identity.test.ts`
Expected: FAIL — cannot find module `@/lib/sis/backfill/enrollment/section-identity`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/sis/backfill/enrollment/section-identity.ts
// Derives a clean (KD #144-style) level code + section name from a T1
// attendance workbook sheet tab name. "YS" is flagged distinctly rather
// than silently included or silently dropped — the level catalog for
// Youngstarters is being reworked concurrently (see the design doc), so
// this import excludes it and the caller surfaces that in the review
// report instead of guessing.

export type SectionIdentity =
  | { kind: 'core'; levelCode: string; cleanName: string }
  | { kind: 'ys' }
  | { kind: 'unrecognized'; rawSheetName: string };

const CORE_LEVEL_RE = /^(P[1-6]|S[1-4])\s+(.+)$/;

export function deriveSectionIdentity(sheetName: string): SectionIdentity {
  const trimmed = sheetName.trim();
  if (trimmed === 'YS') return { kind: 'ys' };

  // Drop a trailing parenthetical annotation like "(G)" or "(AM Global)",
  // with or without a leading space.
  const stripped = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const match = stripped.match(CORE_LEVEL_RE);
  if (match) {
    return { kind: 'core', levelCode: match[1], cleanName: match[2].trim() };
  }
  return { kind: 'unrecognized', rawSheetName: sheetName };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/sis/backfill/enrollment/section-identity.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/enrollment/section-identity.ts __tests__/sis/backfill/enrollment/section-identity.test.ts
git commit -m "feat(backfill): add section-identity derivation for AY2026 enrollment import"
```

---

### Task 4: Attendance workbook parser

**Files:**

- Create: `lib/sis/backfill/enrollment/attendance-workbook.ts`
- Test: `__tests__/sis/backfill/enrollment/attendance-workbook.test.ts`

**Interfaces:**

- Produces: `interface RosterStudent { indexNo: string; fullName: string }`, `interface ParsedSection { sheetName: string; classSectionLabel: string | null; formTeacher: string | null; students: RosterStudent[]; firstDate: string | null; lastDate: string | null }`, `parseSheet(ws: XLSX.WorkSheet, sheetName: string): ParsedSection`, `parseWorkbook(filePath: string): ParsedSection[]`
- Consumed by: Task 5 (`build-import.ts` takes `ParsedSection[]`) and Task 6 (orchestrator calls `parseWorkbook`).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/sis/backfill/enrollment/attendance-workbook.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseSheet } from '@/lib/sis/backfill/enrollment/attendance-workbook';

// Builds a minimal sheet matching the real HFSE masthead layout: 9 header
// rows (masthead), then a column-header row containing dated columns, then
// roster rows. Mirrors "P1 Patience(G)" from the real workbook, trimmed to
// 2 date columns instead of 47.
function buildFixtureRows(): string[][] {
  const rows: string[][] = [];
  rows[0] = ['', '', '', '', '', '', '', '', ''];
  rows[1] = [
    'Legend:',
    '',
    '',
    '',
    'Attendance for the month of',
    'January 2026',
    '',
    '',
    '',
  ];
  rows[2] = [
    '-',
    'No Class',
    '',
    '',
    'Class Section',
    'P1 Patience (AM Global)',
    '',
    '',
    '',
  ];
  rows[3] = ['P', 'Present', '', '', 'Form Teacher', 'Ms. Kristel', '', '', ''];
  rows[4] = ['A', 'Absent', '', '', 'Students - ', '', '', '', ''];
  rows[5] = ['EX', 'Excused', '', '', '', '', '', '', ''];
  rows[6] = ['L', 'Late', '', '', '', '', '', '', ''];
  rows[7] = ['', '', '', '', 'Homeroom ', '', '', '', ''];
  rows[8] = ['', '', '4 Vacation Leaves', '', '', '', '', '', ''];
  rows[9] = [
    'Index \nNo',
    'Bus No.',
    '5 days leave',
    'Classroom Officers',
    'Full Name',
    '8-Jan',
    '9-Jan',
    'Days present',
    'Attendance %',
  ];
  rows[10] = [
    '1',
    'HAPI HAUS',
    '',
    '',
    'ALVAREZ, Jaime III D.',
    'P',
    'P',
    '2',
    '100.00',
  ];
  rows[11] = [
    '2',
    '',
    '',
    '',
    'AMATE, Jaiden Matthew A.',
    'P',
    'P',
    '2',
    '100.00',
  ];
  rows[12] = ['', '', '', '', '', '', '', '', ''];
  return rows;
}

describe('parseSheet', () => {
  it('extracts masthead + roster from a well-formed section sheet', () => {
    const ws = XLSX.utils.aoa_to_sheet(buildFixtureRows());
    const result = parseSheet(ws, 'P1 Patience(G)');

    expect(result.sheetName).toBe('P1 Patience(G)');
    expect(result.classSectionLabel).toBe('P1 Patience (AM Global)');
    expect(result.formTeacher).toBe('Ms. Kristel');
    expect(result.firstDate).toBe('8-Jan');
    expect(result.lastDate).toBe('9-Jan');
    expect(result.students).toEqual([
      { indexNo: '1', fullName: 'ALVAREZ, Jaime III D.' },
      { indexNo: '2', fullName: 'AMATE, Jaiden Matthew A.' },
    ]);
  });

  it('returns an empty roster for a section with no students', () => {
    const rows = buildFixtureRows();
    rows[10] = ['1', '', '', '', '', '', '', '0', '#DIV/0!'];
    rows[11] = ['2', '', '', '', '', '', '', '0', '#DIV/0!'];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const result = parseSheet(ws, 'Reserved 1');

    expect(result.students).toEqual([]);
  });

  it('finds the Class Section / Form Teacher label even at a different column offset', () => {
    // YS-style masthead has one fewer leading column before the labels.
    const rows = buildFixtureRows();
    rows[2] = [
      '-',
      'No Class',
      '',
      'Class Section',
      'YS Faith - Little&Junior Stars',
      '',
      '',
      '',
      '',
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const result = parseSheet(ws, 'YS');

    expect(result.classSectionLabel).toBe('YS Faith - Little&Junior Stars');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/sis/backfill/enrollment/attendance-workbook.test.ts`
Expected: FAIL — cannot find module `@/lib/sis/backfill/enrollment/attendance-workbook`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/sis/backfill/enrollment/attendance-workbook.ts
// Parses HFSE's real T1 attendance workbook (per-section sheet tabs, a
// 9-row masthead, a dated-column roster) into structured data. Pure
// extraction only — no name matching, no section-name cleanup (see
// name-match.ts / section-identity.ts for those).
import * as XLSX from 'xlsx';

export interface RosterStudent {
  indexNo: string;
  fullName: string;
}

export interface ParsedSection {
  sheetName: string;
  classSectionLabel: string | null;
  formTeacher: string | null;
  students: RosterStudent[];
  firstDate: string | null;
  lastDate: string | null;
}

const DATE_COL_RE = /^\d{1,2}-[A-Za-z]{3}$/;

// Scans the masthead rows for a cell exactly matching `label`, and returns
// the very next cell in that row (the file always puts the value
// immediately after the label, though the label's own column position
// varies between YS and the Primary/Secondary sheets).
function findLabelValue(rows: string[][], label: string): string | null {
  for (const row of rows) {
    const idx = row.findIndex((c) => c.trim() === label);
    if (idx !== -1 && idx + 1 < row.length) {
      const value = row[idx + 1].trim();
      return value === '' ? null : value;
    }
  }
  return null;
}

export function parseSheet(
  ws: XLSX.WorkSheet,
  sheetName: string
): ParsedSection {
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: '',
  });

  const mastheadRows = rows.slice(0, 9);
  const classSectionLabel = findLabelValue(mastheadRows, 'Class Section');
  const formTeacher = findLabelValue(mastheadRows, 'Form Teacher');

  const headerRowIdx = rows.findIndex((r) =>
    r.some((c) => DATE_COL_RE.test(c.trim()))
  );
  if (headerRowIdx === -1) {
    return {
      sheetName,
      classSectionLabel,
      formTeacher,
      students: [],
      firstDate: null,
      lastDate: null,
    };
  }

  const header = rows[headerRowIdx];
  const dateColIndices = header.reduce<number[]>((acc, c, i) => {
    if (DATE_COL_RE.test(c.trim())) acc.push(i);
    return acc;
  }, []);
  // The roster's "Full Name" column always sits immediately before the
  // first dated column (Index No / Bus No / Leave [/ Classroom Officers] /
  // Full Name / dates...) — safer than matching the header text, which is
  // sometimes blank in real sheets even though the data column is present.
  const nameColIdx = Math.min(...dateColIndices) - 1;
  const indexColIdx = 0;

  const students: RosterStudent[] = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const fullName = (row[nameColIdx] ?? '').trim();
    if (!fullName) continue;
    students.push({
      indexNo: (row[indexColIdx] ?? '').trim(),
      fullName,
    });
  }

  return {
    sheetName,
    classSectionLabel,
    formTeacher,
    students,
    firstDate: header[dateColIndices[0]].trim(),
    lastDate: header[dateColIndices[dateColIndices.length - 1]].trim(),
  };
}

export function parseWorkbook(filePath: string): ParsedSection[] {
  const wb = XLSX.readFile(filePath);
  return wb.SheetNames.map((name) => parseSheet(wb.Sheets[name], name));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/sis/backfill/enrollment/attendance-workbook.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/enrollment/attendance-workbook.ts __tests__/sis/backfill/enrollment/attendance-workbook.test.ts
git commit -m "feat(backfill): add attendance-workbook parser for AY2026 enrollment import"
```

---

### Task 5: SQL / report builder

**Files:**

- Create: `lib/sis/backfill/enrollment/build-import.ts`
- Test: `__tests__/sis/backfill/enrollment/build-import.test.ts`

**Interfaces:**

- Consumes: `ParsedSection`/`RosterStudent` (Task 4), `CandidateName`/`MatchTier`/`matchName`/`parseSheetFullName` (Task 2), `deriveSectionIdentity` (Task 3), `sqlString`/`sqlStringOrNull` (Task 1).
- Produces: `interface BuildImportInput { sections: ParsedSection[]; candidates: CandidateName[]; ayCode: string; termNumber: number; termStart: string; termEnd: string }`, `interface BuildImportResult { preview: string; apply: string; stats: {...} }`, `buildEnrollmentImport(input: BuildImportInput): BuildImportResult`.
- Consumed by: Task 6 (orchestrator).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/sis/backfill/enrollment/build-import.test.ts
import { describe, expect, it } from 'vitest';

import { buildEnrollmentImport } from '@/lib/sis/backfill/enrollment/build-import';
import type { CandidateName } from '@/lib/sis/backfill/enrollment/name-match';
import type { ParsedSection } from '@/lib/sis/backfill/enrollment/attendance-workbook';

const CANDIDATES: CandidateName[] = [
  {
    enroleeNumber: 'E260092',
    studentNumber: 'H220038',
    lastName: 'Bedico',
    firstName: 'Miguel Zion',
    middleName: 'Cabrera',
  },
  {
    enroleeNumber: 'E260093',
    studentNumber: 'H190240',
    lastName: 'Alvarez',
    firstName: 'Jaime',
    middleName: 'Dela Cruz',
  },
  {
    enroleeNumber: 'E260099',
    studentNumber: null, // missing studentNumber on purpose
    lastName: 'Noname',
    firstName: 'Sample',
    middleName: null,
  },
];

const BASE_INPUT = {
  ayCode: 'AY2026',
  termNumber: 1,
  termStart: '2026-01-08',
  termEnd: '2026-03-13',
};

describe('buildEnrollmentImport', () => {
  it('creates a section and enrolls a confidently matched student', () => {
    const sections: ParsedSection[] = [
      {
        sheetName: 'P1 Patience(G)',
        classSectionLabel: 'P1 Patience (AM Global)',
        formTeacher: 'Ms. Kristel',
        students: [{ indexNo: '1', fullName: 'BEDICO, Miguel Zion C.' }],
        firstDate: '8-Jan',
        lastDate: '13-Mar',
      },
    ];
    const result = buildEnrollmentImport({
      ...BASE_INPUT,
      sections,
      candidates: CANDIDATES,
    });

    expect(result.stats.strong).toBe(1);
    expect(result.stats.sectionsCreated).toBe(1);
    expect(result.stats.needsReview).toBe(0);
    expect(result.apply).toContain("'P1', 'Patience'");
    expect(result.apply).toContain("'H220038'");
    expect(result.apply).toContain("date '2026-01-08'");
    expect(result.apply).toContain('enrollment_status');
    expect(result.apply).toContain(', null,'); // enrollment_date literal
  });

  it('skips a section tab with zero students', () => {
    const sections: ParsedSection[] = [
      {
        sheetName: 'Reserved 1',
        classSectionLabel: 'P1 Respect',
        formTeacher: null,
        students: [],
        firstDate: '8-Jan',
        lastDate: '13-Mar',
      },
    ];
    const result = buildEnrollmentImport({
      ...BASE_INPUT,
      sections,
      candidates: CANDIDATES,
    });

    expect(result.stats.sectionsCreated).toBe(0);
    expect(result.stats.skippedEmpty).toEqual(['Reserved 1']);
  });

  it('excludes the YS sheet and flags it in the report, not the apply file', () => {
    const sections: ParsedSection[] = [
      {
        sheetName: 'YS',
        classSectionLabel: 'YS Faith',
        formTeacher: null,
        students: [{ indexNo: '1', fullName: 'BEDICO, Miguel Zion C.' }],
        firstDate: '8-Jan',
        lastDate: '13-Mar',
      },
    ];
    const result = buildEnrollmentImport({
      ...BASE_INPUT,
      sections,
      candidates: CANDIDATES,
    });

    expect(result.stats.excludedYs).toEqual(['YS']);
    expect(result.stats.sectionsCreated).toBe(0);
    expect(result.apply).not.toContain('YS');
    expect(result.preview).toContain('YS');
  });

  it('flags an unmatched name in needs-review and never writes it', () => {
    const sections: ParsedSection[] = [
      {
        sheetName: 'P1 Obedience',
        classSectionLabel: 'P1 Obedience',
        formTeacher: 'Ms. Arlene',
        students: [{ indexNo: '1', fullName: 'NOBODY, Matches Here' }],
        firstDate: '8-Jan',
        lastDate: '13-Mar',
      },
    ];
    const result = buildEnrollmentImport({
      ...BASE_INPUT,
      sections,
      candidates: CANDIDATES,
    });

    // The section itself is still created — the design skips only
    // fully-empty tabs, not tabs with unmatched names.
    expect(result.stats.sectionsCreated).toBe(1);
    expect(result.stats.needsReview).toBe(1);
    expect(result.apply).not.toContain('NOBODY');
  });

  it('flags a matched candidate with no studentNumber in needs-review', () => {
    const sections: ParsedSection[] = [
      {
        sheetName: 'P1 Obedience',
        classSectionLabel: 'P1 Obedience',
        formTeacher: 'Ms. Arlene',
        students: [{ indexNo: '1', fullName: 'NONAME, Sample' }],
        firstDate: '8-Jan',
        lastDate: '13-Mar',
      },
    ];
    const result = buildEnrollmentImport({
      ...BASE_INPUT,
      sections,
      candidates: CANDIDATES,
    });

    expect(result.stats.needsReview).toBe(1);
    expect(result.apply).not.toContain('E260099');
  });

  it('flags both rows when two roster rows claim the same enrolee', () => {
    const sections: ParsedSection[] = [
      {
        sheetName: 'P1 Obedience',
        classSectionLabel: 'P1 Obedience',
        formTeacher: 'Ms. Arlene',
        students: [
          { indexNo: '1', fullName: 'BEDICO, Miguel Zion C.' },
          { indexNo: '2', fullName: 'BEDICO, Miguel Zion Cabrera' },
        ],
        firstDate: '8-Jan',
        lastDate: '13-Mar',
      },
    ];
    const result = buildEnrollmentImport({
      ...BASE_INPUT,
      sections,
      candidates: CANDIDATES,
    });

    expect(result.stats.needsReview).toBe(2);
    expect(result.apply).not.toContain('H220038');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/sis/backfill/enrollment/build-import.test.ts`
Expected: FAIL — cannot find module `@/lib/sis/backfill/enrollment/build-import`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/sis/backfill/enrollment/build-import.ts
// Composes the pure enrollment/name-match modules into the two SQL files
// described by the design doc: a read-only preview report and a
// transactional, idempotent apply script. No I/O — takes already-parsed
// sections and an already-fetched candidate pool.
import {
  matchName,
  parseSheetFullName,
  type CandidateName,
  type MatchTier,
} from './name-match';
import { deriveSectionIdentity } from './section-identity';
import { sqlString, sqlStringOrNull } from './sql-escape';
import type { ParsedSection } from './attendance-workbook';

export interface BuildImportInput {
  sections: ParsedSection[];
  candidates: CandidateName[];
  ayCode: string;
  termNumber: number;
  termStart: string;
  termEnd: string;
}

interface MatchedRow {
  levelCode: string;
  cleanName: string;
  indexNumber: number;
  candidate: CandidateName;
  tier: MatchTier;
}

interface NeedsReviewRow {
  levelCode: string;
  cleanName: string;
  sheetFullName: string;
  reason: string;
}

interface SectionMetaEntry {
  levelCode: string;
  cleanName: string;
  formTeacher: string | null;
}

export interface BuildImportResult {
  preview: string;
  apply: string;
  stats: {
    exact: number;
    strong: number;
    fuzzy: number;
    needsReview: number;
    sectionsCreated: number;
    excludedYs: string[];
    unrecognized: string[];
    skippedEmpty: string[];
  };
}

export function buildEnrollmentImport(
  input: BuildImportInput
): BuildImportResult {
  const matched: MatchedRow[] = [];
  const needsReview: NeedsReviewRow[] = [];
  const excludedYs: string[] = [];
  const unrecognized: string[] = [];
  const skippedEmpty: string[] = [];
  const sectionMeta = new Map<string, SectionMetaEntry>();

  for (const section of input.sections) {
    if (section.students.length === 0) {
      skippedEmpty.push(section.sheetName);
      continue;
    }
    const identity = deriveSectionIdentity(section.sheetName);
    if (identity.kind === 'ys') {
      excludedYs.push(section.sheetName);
      continue;
    }
    if (identity.kind === 'unrecognized') {
      unrecognized.push(section.sheetName);
      continue;
    }

    const key = `${identity.levelCode}::${identity.cleanName}`;
    if (!sectionMeta.has(key)) {
      sectionMeta.set(key, {
        levelCode: identity.levelCode,
        cleanName: identity.cleanName,
        formTeacher: section.formTeacher,
      });
    }

    for (const student of section.students) {
      const sheetName = parseSheetFullName(student.fullName);
      const result = matchName(sheetName, input.candidates);
      const indexNumber = Number.parseInt(student.indexNo, 10);

      if (result.tier === 'none' || !result.candidate) {
        needsReview.push({
          levelCode: identity.levelCode,
          cleanName: identity.cleanName,
          sheetFullName: student.fullName,
          reason: 'no confident match',
        });
        continue;
      }
      if (!Number.isFinite(indexNumber) || indexNumber <= 0) {
        needsReview.push({
          levelCode: identity.levelCode,
          cleanName: identity.cleanName,
          sheetFullName: student.fullName,
          reason: `unparseable index number "${student.indexNo}"`,
        });
        continue;
      }
      if (!result.candidate.studentNumber) {
        needsReview.push({
          levelCode: identity.levelCode,
          cleanName: identity.cleanName,
          sheetFullName: student.fullName,
          reason: `matched ${result.candidate.enroleeNumber} but it has no studentNumber`,
        });
        continue;
      }
      matched.push({
        levelCode: identity.levelCode,
        cleanName: identity.cleanName,
        indexNumber,
        candidate: result.candidate,
        tier: result.tier,
      });
    }
  }

  // Dup-claim detection: the same enroleeNumber matched from >1 roster row.
  const byEnrolee = new Map<string, MatchedRow[]>();
  for (const row of matched) {
    const list = byEnrolee.get(row.candidate.enroleeNumber) ?? [];
    list.push(row);
    byEnrolee.set(row.candidate.enroleeNumber, list);
  }
  const finalMatched: MatchedRow[] = [];
  for (const [enroleeNumber, rows] of byEnrolee) {
    if (rows.length > 1) {
      for (const row of rows) {
        needsReview.push({
          levelCode: row.levelCode,
          cleanName: row.cleanName,
          sheetFullName: `${row.candidate.lastName}, ${row.candidate.firstName}`,
          reason: `duplicate claim on enrolee ${enroleeNumber} (matched from ${rows.length} roster rows)`,
        });
      }
      continue;
    }
    finalMatched.push(rows[0]);
  }

  const stats: BuildImportResult['stats'] = {
    exact: finalMatched.filter((r) => r.tier === 'exact').length,
    strong: finalMatched.filter((r) => r.tier === 'strong').length,
    fuzzy: finalMatched.filter((r) => r.tier === 'fuzzy').length,
    needsReview: needsReview.length,
    sectionsCreated: sectionMeta.size,
    excludedYs,
    unrecognized,
    skippedEmpty,
  };

  return {
    preview: buildPreviewSql(
      input,
      finalMatched,
      needsReview,
      sectionMeta,
      stats
    ),
    apply: buildApplySql(input, finalMatched, sectionMeta),
    stats,
  };
}

function buildPreviewSql(
  input: BuildImportInput,
  matched: MatchedRow[],
  needsReview: NeedsReviewRow[],
  sectionMeta: Map<string, SectionMetaEntry>,
  stats: BuildImportResult['stats']
): string {
  const lines: string[] = [];
  lines.push(
    `-- AY2026 T${input.termNumber} enrollment import — PREVIEW (read-only)`
  );
  lines.push('--');
  lines.push(
    '-- Generated by gen-ay2026-t1-enrollment.ts from the T1 attendance workbook.'
  );
  lines.push(
    '-- Review this report BEFORE running the matching apply.sql file.'
  );
  lines.push('--');
  lines.push(`-- Sections to create: ${sectionMeta.size}`);
  for (const s of sectionMeta.values()) {
    lines.push(
      `--   ${s.levelCode} ${s.cleanName}${s.formTeacher ? ` (${s.formTeacher})` : ''}`
    );
  }
  lines.push('--');
  lines.push(
    `-- Matched students: ${matched.length} (exact=${stats.exact}, strong=${stats.strong}, fuzzy=${stats.fuzzy})`
  );
  lines.push('--');
  lines.push(
    `-- Skipped (empty section tabs): ${stats.skippedEmpty.join(', ') || '(none)'}`
  );
  lines.push(
    `-- Excluded (Youngstarters — level catalog reworked concurrently, resolve separately): ${
      stats.excludedYs.join(', ') || '(none)'
    }`
  );
  lines.push(
    `-- Unrecognized sheet names (needs manual attention): ${stats.unrecognized.join(', ') || '(none)'}`
  );
  lines.push('--');
  lines.push(
    `-- Needs review (${needsReview.length}) — NOT written by apply.sql:`
  );
  if (needsReview.length === 0) lines.push('--   (none)');
  for (const r of needsReview) {
    lines.push(
      `--   [${r.levelCode} ${r.cleanName}] "${r.sheetFullName}" — ${r.reason}`
    );
  }
  return lines.join('\n') + '\n';
}

function buildApplySql(
  input: BuildImportInput,
  matched: MatchedRow[],
  sectionMeta: Map<string, SectionMetaEntry>
): string {
  const statusTable = `ay${input.ayCode.slice(2)}_enrolment_status`;
  const lines: string[] = [];
  lines.push(
    `-- AY2026 T${input.termNumber} enrollment import — APPLY (transactional)`
  );
  lines.push('--');
  lines.push(
    `-- RUN ay2026-t${input.termNumber}-enrollment-preview.sql FIRST.`
  );
  lines.push(
    '-- Generated by gen-ay2026-t1-enrollment.ts — do not hand-edit; regenerate instead.'
  );
  lines.push('--');
  lines.push(
    '-- Run the WHOLE file in one go (one connection/session) — a tool that opens'
  );
  lines.push(
    '-- a new connection per query will silently roll back an uncommitted transaction.'
  );
  lines.push('');
  lines.push('begin;');
  lines.push('');
  lines.push('drop table if exists _ay26_sections;');
  lines.push(
    'create temp table _ay26_sections (level_code, clean_name, form_teacher) as'
  );
  lines.push('values');
  const sectionRows = [...sectionMeta.values()].map(
    (s) =>
      `  (${sqlString(s.levelCode)}, ${sqlString(s.cleanName)}, ${sqlStringOrNull(s.formTeacher)})`
  );
  lines.push(
    (sectionRows.length ? sectionRows.join(',\n') : "  ('', '', NULL)") + ';'
  );
  lines.push('');
  lines.push('drop table if exists _ay26_roster;');
  lines.push(
    'create temp table _ay26_roster (level_code, clean_name, student_number, last_name, first_name, middle_name, index_number, enrolee_number) as'
  );
  lines.push('values');
  const rosterRows = matched.map((r) => {
    const c = r.candidate;
    return `  (${sqlString(r.levelCode)}, ${sqlString(r.cleanName)}, ${sqlString(
      c.studentNumber as string
    )}, ${sqlString(c.lastName)}, ${sqlString(c.firstName)}, ${sqlStringOrNull(
      c.middleName
    )}, ${r.indexNumber}, ${sqlString(c.enroleeNumber)})`;
  });
  lines.push(
    (rosterRows.length
      ? rosterRows.join(',\n')
      : "  ('', '', '', '', '', NULL, 0, '')") + ';'
  );
  lines.push('');
  lines.push('-- 1) Term');
  lines.push(
    'insert into terms (academic_year_id, term_number, start_date, end_date)'
  );
  lines.push(
    `select ay.id, ${input.termNumber}, date ${sqlString(input.termStart)}, date ${sqlString(input.termEnd)}`
  );
  lines.push('from academic_years ay');
  lines.push(`where ay.ay_code = ${sqlString(input.ayCode)}`);
  lines.push('  and not exists (');
  lines.push(
    `    select 1 from terms t where t.academic_year_id = ay.id and t.term_number = ${input.termNumber}`
  );
  lines.push('  );');
  lines.push('');
  lines.push('-- 2) Sections');
  lines.push(
    'insert into sections (academic_year_id, level_id, name, form_class_adviser)'
  );
  lines.push('select ay.id, lv.id, s.clean_name, s.form_teacher');
  lines.push('from _ay26_sections s');
  lines.push(
    `join academic_years ay on ay.ay_code = ${sqlString(input.ayCode)}`
  );
  lines.push('join levels lv on lv.code = s.level_code');
  lines.push('on conflict (academic_year_id, level_id, name) do nothing;');
  lines.push('');
  lines.push('-- 3) students (upsert by student_number)');
  lines.push(
    'insert into students (student_number, last_name, first_name, middle_name)'
  );
  lines.push(
    'select distinct r.student_number, r.last_name, r.first_name, r.middle_name'
  );
  lines.push('from _ay26_roster r');
  lines.push('on conflict (student_number) do nothing;');
  lines.push('');
  lines.push(
    '-- 4) section_students (enrollment_date left NULL — on-time T1 enrollees)'
  );
  lines.push(
    'insert into section_students (section_id, student_id, index_number, enrollment_status, enrollment_date, enrolee_number)'
  );
  lines.push(
    "select sec.id, st.id, r.index_number, 'active', null, r.enrolee_number"
  );
  lines.push('from _ay26_roster r');
  lines.push(
    `join academic_years ay on ay.ay_code = ${sqlString(input.ayCode)}`
  );
  lines.push('join levels lv on lv.code = r.level_code');
  lines.push(
    'join sections sec on sec.academic_year_id = ay.id and sec.level_id = lv.id and sec.name = r.clean_name'
  );
  lines.push('join students st on st.student_number = r.student_number');
  lines.push('on conflict (section_id, student_id) do nothing;');
  lines.push('');
  lines.push('-- 5) status flip');
  lines.push(`update ${statusTable} st`);
  lines.push('set "applicationStatus" = \'Enrolled\',');
  lines.push('    "classSection" = r.clean_name,');
  lines.push('    "classLevel" = lv.label');
  lines.push('from _ay26_roster r');
  lines.push('join levels lv on lv.code = r.level_code');
  lines.push('where st."enroleeNumber" = r.enrolee_number;');
  lines.push('');
  lines.push('-- pre-commit sanity check');
  lines.push('select');
  lines.push(
    `  (select count(*) from terms t join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(
      input.ayCode
    )}) as term_count,`
  );
  lines.push(
    `  (select count(*) from sections sec join academic_years ay on ay.id=sec.academic_year_id where ay.ay_code=${sqlString(
      input.ayCode
    )}) as section_count,`
  );
  lines.push(
    `  (select count(*) from section_students ss join sections sec on sec.id=ss.section_id join academic_years ay on ay.id=sec.academic_year_id where ay.ay_code=${sqlString(
      input.ayCode
    )}) as roster_count;`
  );
  lines.push(
    `-- expect term_count >= 1, section_count = ${sectionMeta.size}, roster_count ~= ${matched.length}`
  );
  lines.push('');
  lines.push('commit;');
  lines.push('');
  lines.push('-- === post-commit verification ===');
  lines.push(
    `select "applicationStatus", count(*) from ${statusTable} group by 1 order by 2 desc;`
  );
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/sis/backfill/enrollment/build-import.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the full new test suite together**

Run: `npx vitest run __tests__/sis/backfill/enrollment/`
Expected: PASS (35 tests across the 4 files)

- [ ] **Step 6: Commit**

```bash
git add lib/sis/backfill/enrollment/build-import.ts __tests__/sis/backfill/enrollment/build-import.test.ts
git commit -m "feat(backfill): compose AY2026 enrollment import SQL/report builder"
```

---

### Task 6: Orchestrator script

**Files:**

- Create: `scripts/backfill/gen-ay2026-t1-enrollment.ts`

**Interfaces:**

- Consumes: `parseWorkbook` (Task 4), `buildEnrollmentImport`/`BuildImportInput` (Task 5), `CandidateName` (Task 2), `createServiceClient` (existing `lib/supabase/service.ts`).
- Produces: writes `scripts/backfill/ay2026-t1-enrollment-preview.sql` and `scripts/backfill/ay2026-t1-enrollment-apply.sql` to disk when run.

No automated test — this is I/O glue (reads a real file + queries the live Supabase project). It's exercised for real in Task 7. Type-check it instead.

- [ ] **Step 1: Write the orchestrator**

```typescript
// scripts/backfill/gen-ay2026-t1-enrollment.ts
// Generates ay2026-t1-enrollment-{preview,apply}.sql from HFSE's real T1
// attendance workbook. Emits SQL for review — does NOT write to the
// database itself. See:
// docs/superpowers/specs/2026-07-17-ay2026-t1-enrollment-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t1-enrollment.ts
import { writeFileSync } from 'node:fs';

import { createServiceClient } from '../../lib/supabase/service';
import { parseWorkbook } from '../../lib/sis/backfill/enrollment/attendance-workbook';
import { buildEnrollmentImport } from '../../lib/sis/backfill/enrollment/build-import';
import type { CandidateName } from '../../lib/sis/backfill/enrollment/name-match';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 1;
const TERM_START = '2026-01-08';
const TERM_END = '2026-03-13';
const WORKBOOK_PATH = 'AY2026/T1/T1 Attendance Jan-Mar (1).xlsx';
const NON_CANDIDATE_STATUSES = new Set(['Cancelled', 'Withdrawn']);

async function main() {
  const svc = createServiceClient();

  const sections = parseWorkbook(WORKBOOK_PATH);

  const { data: apps, error: appsErr } = await svc
    .from('ay2026_enrolment_applications')
    .select('enroleeNumber, studentNumber, lastName, firstName, middleName');
  if (appsErr) throw appsErr;

  const { data: statuses, error: statusErr } = await svc
    .from('ay2026_enrolment_status')
    .select('enroleeNumber, applicationStatus');
  if (statusErr) throw statusErr;

  const statusByEnrolee = new Map(
    (statuses ?? []).map((s: any) => [
      s.enroleeNumber as string,
      s.applicationStatus as string,
    ])
  );

  const candidates: CandidateName[] = (apps ?? [])
    .filter(
      (a: any) =>
        !NON_CANDIDATE_STATUSES.has(statusByEnrolee.get(a.enroleeNumber) ?? '')
    )
    .map((a: any) => ({
      enroleeNumber: a.enroleeNumber,
      studentNumber: a.studentNumber ?? null,
      lastName: a.lastName ?? '',
      firstName: a.firstName ?? '',
      middleName: a.middleName ?? null,
    }));

  const result = buildEnrollmentImport({
    sections,
    candidates,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
    termStart: TERM_START,
    termEnd: TERM_END,
  });

  writeFileSync(
    'scripts/backfill/ay2026-t1-enrollment-preview.sql',
    result.preview
  );
  writeFileSync(
    'scripts/backfill/ay2026-t1-enrollment-apply.sql',
    result.apply
  );

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log('Wrote scripts/backfill/ay2026-t1-enrollment-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t1-enrollment-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 2: Type-check the script**

Run: `npx tsc --noEmit scripts/backfill/gen-ay2026-t1-enrollment.ts`
Expected: no errors (project `tsconfig.json` path aliases and `xlsx`/`@supabase/supabase-js` types already resolve elsewhere in the repo, so this should be clean; if it reports unrelated pre-existing errors in other files, confirm this specific file has none)

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill/gen-ay2026-t1-enrollment.ts
git commit -m "feat(backfill): add AY2026 T1 enrollment import generator script"
```

---

### Task 7: Generate and hand off for review

**Files:** none created — this runs Task 6's script for real and inspects its output.

- [ ] **Step 1: Confirm the source file is present**

Run: `ls "AY2026/T1/T1 Attendance Jan-Mar (1).xlsx"`
Expected: the file is listed (no "No such file" error). If missing, stop and ask the user where it is before continuing.

- [ ] **Step 2: Run the generator**

Run: `npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t1-enrollment.ts`
Expected: prints a `Stats: {...}` JSON block, then confirms both files were written. No stack trace.

- [ ] **Step 3: Read the stats and sanity-check them**

Look at the printed `stats` object:

- `sectionsCreated` should be roughly 20-22 (24 real tabs, minus the empty "Reserved" ones, minus "YS").
- `exact` + `strong` + `fuzzy` should account for the large majority of total roster rows across all sections (a healthy import is >90% auto-matched given the file is HFSE's real, current roster).
- `needsReview` should be a short, reviewable list, not a large fraction of the roster.
- `excludedYs` should be exactly `['YS']`.
- `unrecognized` should be empty (every real sheet name should parse as either core, YS, or a genuinely empty "Reserved" tab that was already filtered by `skippedEmpty` before identity derivation ever ran).

If any of these look off (e.g. `needsReview` is large, or `unrecognized` is non-empty), do not proceed — investigate by reading `scripts/backfill/ay2026-t1-enrollment-preview.sql`'s "needs review" section, which lists the specific name and reason for every flagged row.

- [ ] **Step 4: Read the full preview report**

Run: `cat scripts/backfill/ay2026-t1-enrollment-preview.sql`

Read through the whole thing — the section list, match-tier counts, and every needs-review entry with its reason.

- [ ] **Step 5: Hand off to the user**

Do not run `ay2026-t1-enrollment-apply.sql`. Report back: the stats summary, a pointer to both generated files, and explicitly note that running `apply.sql` against the database is a manual step for the user to perform themselves (per the design doc — nothing in this plan executes it). If `needsReview` is non-trivial, flag the specific entries for the user's attention rather than silently proceeding.
