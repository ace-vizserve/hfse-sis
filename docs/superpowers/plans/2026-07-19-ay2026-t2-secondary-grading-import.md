# AY2026 T2 Secondary Grading Sheets Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a reviewable `preview.sql` / `apply.sql` pair that imports HFSE's real AY2026 T2 Secondary grading data (Regular track: ~7 subjects × up to 4 sections from `GRADES/`; Global track: 8 subjects × 2 sections from `Lower Secondary Global Grading Sheets/`) into `grading_sheets` / `grade_entries`, without ever writing to the database directly from this codebase.

**Architecture:** Extracts the proven T2 masthead-parsing helpers Phase 6a built (and fixed twice — the printed-grade-column bug, then the tab-name-first identity bug) out of `grading-workbook-t2.ts` into a new shared module, `t2-masthead.ts`, per the explicit recommendation in Phase 6a's own final review. That module gains one real enhancement this phase needs: a truncation-aware identity rule, since some `GRADES/`-folder Secondary tab names are cut off by Excel's 31-character sheet-name limit — the opposite failure direction from Phase 6a's original bug (there, row 2 was wrong; here, the tab name is incomplete). Two new parser files consume the shared module — one for `GRADES/`'s Secondary tabs (Regular track), one for `Lower Secondary Global Grading Sheets/` (Global track, reusing Phase 3's `"DO NOT USE"` tab exclusion). A new composer mirrors Phase 6a's corrections-only shape exactly (accepted, deliberate duplication — the composer has no shared-extraction recommendation the way the parser did). One orchestrator wires it together.

**Tech Stack:** TypeScript, `xlsx` (SheetJS) for parsing, `tsx` for running the orchestrator, Vitest for unit tests, Supabase service client for read-only DB lookups.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-19-ay2026-t2-secondary-grading-import-design.md` — read it before starting; every task below implements a piece of it.
- **CCA is explicitly out of scope** (its workbook is activity-rostered, not section-rostered — doesn't fit this project's per-section `grading_sheets` model). Never read `CCA (Sec) Grading AY2026 T2.xlsx`.
- **Regular track (`GRADES/` folder) scope**: Literature (all 4 sections: Discipline 2, Integrity 2, Consistency, Excellence), History (Discipline 2 + Integrity 2 only — the real file has no S3/S4 tabs), SS & Geo (Consistency + Excellence only — the real file has no S1/S2 tabs), Contemporary Arts (all 4), PE (Sec) (all 4, subject code `PEH`), plus the Secondary tabs already present in the Math/English/Science `GRADES/` files Phase 6a already reads for Primary. **Filipino's `GRADES/` file is never read for Secondary** — its `S1`–`S4` tabs are structurally incomplete (a `WRITTEN WORKS` block only, no Performance Tasks / Exam / printed-grade columns at all) and would throw if the column-layout finder were run against them; this is consistent with Filipino not being a taught Secondary subject, not a bug to work around. Mandarin's and STAR/MAPEH's `GRADES/` files have no Secondary tabs at all and are also not read for this phase.
- **Global track (`Lower Secondary Global Grading Sheets/` folder) scope**: the same 8 subjects as T1's Phase 3 (`ARTD`, `COMP`, `ENG`, `GP`, `HUM`, `MATH`, `PEH`, `SCI`), explicit file list — never a directory glob — excluding `Copy of English/Science/Mathematics...` (confirmed corrupted duplicates again for T2 — the `Copy of Mathematics...` file's `#REF!` this time sits in the already-ignored spurious trailing column rather than the NAME column like T1's, but it is excluded anyway on the standing policy that a file already flagged as a known duplicate is never read, regardless of exactly where its corruption happens to land) and skipping any tab whose name starts with `"DO NOT USE"` (Phase 3's exact exclusion check, reused).
- **Every T2 sheet (both tracks) has a second, spurious `"Quarterly"/"Term 1"` column pair after the real printed-grade columns.** The printed-grade cross-check must read only the FIRST `"Initial"`/`"Quarterly"` label match scanning forward from the Exam column — never the last (Phase 6a's fix, reused via the shared module, never re-derived).
- **Identity resolution**: tab name wins whenever it parses (Phase 6a's rule) — UNLESS the tab-derived section name is a genuine case-insensitive prefix of the row-2-derived section name (both must agree on level; the tab-derived text must be strictly shorter) — that specific pattern signals Excel's 31-character tab-name truncation, and row 2's fuller text is used instead. Every disagreement (whichever direction) is logged, but under two DISTINCT headings in preview.sql: "identity corrections" (tab name won) vs. "tab name truncated" (row 2 won because the tab name was cut off).
- **`grading-workbook-t2.ts`'s (Phase 6a) exact existing public interface and behavior are preserved.** Its own full test suite (`__tests__/sis/backfill/grading/grading-workbook-t2.test.ts`) must pass completely unchanged after the extraction — this is the refactor task's own acceptance criterion. The one additive change allowed is a new `truncationNotes: string[]` field on `ParseGradingWorkbookT2Result` (empty for every existing Phase 6a fixture, since none trigger truncation) — no existing test asserts the whole result object via `toEqual`, so this is safe.
- **`subject_configs` writes are expected to be zero** — every relevant subject (`ENG`, `MATH`, `SCI`, `CA`, `LIT`, `HIST`, `SS`, `PEH`) is already `weights_confirmed=true` with a value matching the real T2 header data, verified via a direct DB query before writing any code. The composer still accepts a `subjectConfigWeights: SubjectConfigWeight[]` input (same shape as Phase 6a's) and correctly handles an empty array — this is a verified expectation encoded as an empty list, not skipped logic.
- **No `subject_level_offerings` or `section_subjects` writes** — both are already populated (Regular track by this session's earlier ad-hoc backfill; Global track by Phase 3's T1 import, which is not term-scoped).
- Roster resolution is via `(levelCode, sectionName, indexNumber)` lookup against live `section_students` — unresolved rows go to needs-review, never guessed. Grade computation via importing `lib/compute/quarterly.ts::computeQuarterly` directly (Hard Rule #1/#2, never re-implemented).
- `grading_sheets` are locked on import (`is_locked=true, locked_at=now(), locked_by='backfill-import'`).
- Single, un-chunked `apply.sql` — this phase's volume is comparable to Phase 6a's, well under the threshold that forced Phase 2's chunking.
- No code in this plan ever writes to the database. The orchestrator only reads (for roster/subject_configs lookups) and writes local `.sql` files.
- Output files (`scripts/backfill/ay2026-t2-secondary-grading-{preview,apply}.sql`) contain real student names and scores (PII) — must be gitignored.

---

### Task 1: Extract shared T2 masthead module (pure refactor of Phase 6a's parser)

**Files:**

- Create: `lib/sis/backfill/grading/t2-masthead.ts`
- Modify: `lib/sis/backfill/grading/grading-workbook-t2.ts` (Phase 6a, already shipped — refactored to consume the new shared module; its own test suite is the acceptance gate, not a new test file for this task)
- Test: no new test file for this task — Step 2 below runs Phase 6a's EXISTING test file as the acceptance check.

**Interfaces:**

- Produces (consumed by Tasks 2 and 3):

  ```ts
  // Row layout constants (same masthead shape across every T2 file, both tracks)
  export const ROW_LEVEL_SECTION = 2;
  export const ROW_TEACHER = 3;
  export const ROW_LABELS = 5;
  export const ROW_SUBCOLS = 7;
  export const ROW_MAXSCORES = 8;
  export const ROW_STUDENTS_START = 9;

  export function cell(row: unknown[] | undefined, i: number): string;
  export function numOrNull(v: string): number | null;

  export interface ColumnLayout {
    wwCols: number[];
    ptCols: number[];
    wwTotalCol: number;
    ptTotalCol: number;
    examCol: number;
  }
  export function findColumnLayout(subcolRow: unknown[]): ColumnLayout;
  export function weightAt(maxRow: unknown[], totalCol: number): number;
  export function findPrintedGradeColsT2(
    labelRow: unknown[],
    fromCol: number
  ): { initialCol: number | null; quarterlyCol: number | null };

  export type IdentityT2 =
    | { kind: 'primary'; levelCode: string; sectionName: string }
    | { kind: 'secondary'; levelCode: string; sectionName: string }
    | { kind: 'unrecognized' };

  export function titleCase(raw: string): string;
  export function parseTeacherName(raw: string): string | null;

  export function resolveIdentity(
    sheetName: string,
    row2Raw: string
  ): {
    identity: IdentityT2;
    correctionNote: string | null;
    truncationNote: string | null;
  };
  ```

- [ ] **Step 1: Create the shared module**

Create `lib/sis/backfill/grading/t2-masthead.ts`:

```ts
// lib/sis/backfill/grading/t2-masthead.ts
// Shared masthead-parsing helpers for every T2 grading-sheet source
// (Primary GRADES/ tabs — grading-workbook-t2.ts; Secondary Regular-track
// GRADES/ tabs — grading-workbook-secondary-t2.ts; Global-track Lower
// Secondary Global Grading Sheets/ — grading-workbook-global-t2.ts).
// Extracted from grading-workbook-t2.ts (Phase 6a) per the explicit
// recommendation in that phase's final whole-branch review: a third
// parser needing the same tab-name-first identity resolution and fixed
// printed-grade-column finder should share one copy, not duplicate a
// third time.
//
// Two real, hand-verified bugs are fixed here (both stay fixed for every
// consumer of this module):
//   1. Every T2 sheet has a SECOND, unreliable "Quarterly"/"Term 1" column
//      pair after the real printed-grade columns. The naive approach
//      (take the LAST "Initial"/"Quarterly" label match scanning
//      forward) silently grabs the wrong one. findPrintedGradeColsT2
//      takes the FIRST match of each label only.
//   2. Row 2's free-text identity label is sometimes simply wrong (a
//      copy-paste artifact from cloning a template tab in Excel), and
//      because roster resolution keys on (levelCode, sectionName,
//      indexNumber), a wrong label doesn't fail loud — it can silently
//      resolve against a DIFFERENT real section's roster. Tab names are
//      structurally reliable (Excel forbids duplicate tab names), so
//      resolveIdentity prefers the tab name whenever it parses.
//
// One further enhancement, added for Phase 6b: some GRADES/-folder
// Secondary tab names are truncated by Excel's 31-character sheet-name
// limit (e.g. "Social Studies&Geography - S3 C", really "...S3
// Consistency") — the OPPOSITE failure direction from bug #2 above (there
// row 2 was wrong; here the tab name is incomplete). resolveIdentity
// detects this specific pattern (tab-derived section is a genuine prefix
// of row 2's fuller text, both agreeing on level) and prefers row 2 in
// that one case, logging it as a distinct "truncation" note rather than a
// "correction" note — it isn't really a disagreement, the tab name just
// didn't have room to say the whole thing.

export const ROW_LEVEL_SECTION = 2;
export const ROW_TEACHER = 3;
export const ROW_LABELS = 5;
export const ROW_SUBCOLS = 7;
export const ROW_MAXSCORES = 8;
export const ROW_STUDENTS_START = 9;

export function cell(row: unknown[] | undefined, i: number): string {
  if (!row) return '';
  const v = row[i];
  return v == null ? '' : String(v).trim();
}

export function numOrNull(v: string): number | null {
  if (v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export interface ColumnLayout {
  wwCols: number[];
  ptCols: number[];
  wwTotalCol: number;
  ptTotalCol: number;
  examCol: number;
}

export function findColumnLayout(subcolRow: unknown[]): ColumnLayout {
  const wwCols: number[] = [];
  const ptCols: number[] = [];
  const totalCols: number[] = [];
  let examCol = -1;
  for (let i = 2; i < subcolRow.length; i++) {
    const label = cell(subcolRow as unknown[], i);
    if (/^W\d+$/i.test(label)) wwCols.push(i);
    else if (/^PT\d+$/i.test(label)) ptCols.push(i);
    else if (/^Total$/i.test(label)) totalCols.push(i);
    else if (/^Exam$/i.test(label)) examCol = i;
  }
  const [wwTotalCol, ptTotalCol] = totalCols;
  if (wwTotalCol == null || ptTotalCol == null || examCol === -1) {
    throw new Error(
      't2-masthead: could not locate WW/PT Total columns or the Exam column in row 8 sub-labels'
    );
  }
  return { wwCols, ptCols, wwTotalCol, ptTotalCol, examCol };
}

export function weightAt(maxRow: unknown[], totalCol: number): number {
  const wsCell = cell(maxRow, totalCol + 2);
  const pct = Number(wsCell.replace('%', ''));
  if (Number.isNaN(pct)) {
    throw new Error(
      `t2-masthead: expected a WS% cell at column ${totalCol + 2}, got "${wsCell}"`
    );
  }
  return pct / 100;
}

// Takes the FIRST match of each label, not the last, and stops scanning
// once both are found. This is what keeps the spurious second
// "Quarterly"/"Term 1" pair out of every T2 import.
export function findPrintedGradeColsT2(
  labelRow: unknown[],
  fromCol: number
): { initialCol: number | null; quarterlyCol: number | null } {
  let initialCol: number | null = null;
  let quarterlyCol: number | null = null;
  for (let i = fromCol; i < labelRow.length; i++) {
    if (initialCol !== null && quarterlyCol !== null) break;
    const label = cell(labelRow, i);
    if (initialCol === null && /Initial/i.test(label)) {
      initialCol = i;
      continue;
    }
    if (quarterlyCol === null && /Quarterly/i.test(label)) {
      quarterlyCol = i;
    }
  }
  return { initialCol, quarterlyCol };
}

export type IdentityT2 =
  | { kind: 'primary'; levelCode: string; sectionName: string }
  | { kind: 'secondary'; levelCode: string; sectionName: string }
  | { kind: 'unrecognized' };

export function titleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Row 2's shape: "Primary N NAME - SUBJECT" or "Secondary N NAME - SUBJECT".
const ROW2_IDENTITY_RE = /^(Primary|Secondary)\s+(\d+)\s+(.+?)\s+-\s+.+$/i;

function parseRow2Identity(raw: string): IdentityT2 {
  const m = ROW2_IDENTITY_RE.exec(raw.trim());
  if (!m) return { kind: 'unrecognized' };
  const [, levelWord, levelNum, sectionRaw] = m;
  const isPrimary = levelWord.toLowerCase() === 'primary';
  return {
    kind: isPrimary ? 'primary' : 'secondary',
    levelCode: `${isPrimary ? 'P' : 'S'}${levelNum}`,
    sectionName: titleCase(sectionRaw),
  };
}

// Tab name's shape: "<Subject> - P<N> <Name>", "<Subject> - S<N> <Name>", or
// "<Subject> - Sec <N> <Name>" (the S/Sec spelling varies by file — both
// observed in real data, "Sec" tried first so it isn't shadowed by the
// single-letter "S" alternative).
const TAB_NAME_IDENTITY_RE = /^.+?\s*-\s*(Sec|P|S)\.?\s*(\d+)\s+(.+)$/i;

function parseTabNameIdentity(sheetName: string): IdentityT2 {
  const m = TAB_NAME_IDENTITY_RE.exec(sheetName.trim());
  if (!m) return { kind: 'unrecognized' };
  const [, prefix, levelNum, sectionRaw] = m;
  const isPrimary = prefix.toLowerCase().startsWith('p');
  return {
    kind: isPrimary ? 'primary' : 'secondary',
    levelCode: `${isPrimary ? 'P' : 'S'}${levelNum}`,
    sectionName: titleCase(sectionRaw),
  };
}

function identityLabel(identity: IdentityT2): string {
  return identity.kind === 'unrecognized'
    ? '(unrecognized)'
    : `${identity.levelCode} ${identity.sectionName}`;
}

// True when `shortSection` is a genuine, strictly-shorter prefix of
// `longSection` (case-insensitive) — the signature of Excel's 31-character
// sheet-name truncation, not a real disagreement.
function isTruncationOf(shortSection: string, longSection: string): boolean {
  const s = shortSection.toLowerCase();
  const l = longSection.toLowerCase();
  return s.length < l.length && l.startsWith(s);
}

// Tab name wins whenever it parses — Excel forbids two tabs sharing a
// name, so a mistyped tab name would be immediately visible to whoever
// built the workbook, unlike a free-text label cell that's easy to
// fat-finger via copy-paste without visual feedback. Row 2 is the
// fallback ONLY when the tab name doesn't parse (the real case for
// never-renamed "Reserved N" tabs).
//
// EXCEPTION: when both parse, agree on level, but the tab-derived section
// is a genuine prefix of row 2's fuller section text, the tab name is
// treated as TRUNCATED (Excel's 31-char sheet-name limit) rather than
// simply wrong — row 2 wins in that one case, logged as a distinct
// "truncation" note, not a "correction" note (it isn't really a
// disagreement, the tab name just didn't have room to say the whole
// thing).
export function resolveIdentity(
  sheetName: string,
  row2Raw: string
): {
  identity: IdentityT2;
  correctionNote: string | null;
  truncationNote: string | null;
} {
  const tabIdentity = parseTabNameIdentity(sheetName);
  if (tabIdentity.kind === 'unrecognized') {
    return {
      identity: parseRow2Identity(row2Raw),
      correctionNote: null,
      truncationNote: null,
    };
  }

  const row2Identity = parseRow2Identity(row2Raw);
  if (row2Identity.kind === 'unrecognized') {
    return {
      identity: tabIdentity,
      correctionNote: null,
      truncationNote: null,
    };
  }

  const agrees =
    row2Identity.kind === tabIdentity.kind &&
    row2Identity.levelCode === tabIdentity.levelCode &&
    row2Identity.sectionName === tabIdentity.sectionName;
  if (agrees) {
    return {
      identity: tabIdentity,
      correctionNote: null,
      truncationNote: null,
    };
  }

  if (
    row2Identity.kind === tabIdentity.kind &&
    row2Identity.levelCode === tabIdentity.levelCode &&
    isTruncationOf(tabIdentity.sectionName, row2Identity.sectionName)
  ) {
    return {
      identity: row2Identity,
      correctionNote: null,
      truncationNote: `"${sheetName}": tab name appears truncated (Excel's sheet-name limit) — "${tabIdentity.sectionName}" vs row 2's fuller "${row2Identity.sectionName}" — using row 2`,
    };
  }

  return {
    identity: tabIdentity,
    correctionNote: `"${sheetName}": tab name says ${identityLabel(tabIdentity)}, row 2 says ${identityLabel(row2Identity)} — using tab name`,
    truncationNote: null,
  };
}

export function parseTeacherName(raw: string): string | null {
  const m = /Teacher:\s*(.*)/i.exec(raw);
  if (!m) return null;
  const name = m[1].trim();
  return name === '' ? null : name;
}
```

- [ ] **Step 2: Write the failing tests for the new truncation-detection behavior**

Create `__tests__/sis/backfill/grading/t2-masthead.test.ts`:

```ts
// __tests__/sis/backfill/grading/t2-masthead.test.ts
import { describe, expect, it } from 'vitest';

import { resolveIdentity } from '@/lib/sis/backfill/grading/t2-masthead';

describe('resolveIdentity', () => {
  it('uses the tab name when it agrees with row 2 (no note of any kind)', () => {
    const result = resolveIdentity(
      'Math - P1 Patience',
      'Primary 1 PATIENCE - MATH'
    );
    expect(result.identity).toEqual({
      kind: 'primary',
      levelCode: 'P1',
      sectionName: 'Patience',
    });
    expect(result.correctionNote).toBeNull();
    expect(result.truncationNote).toBeNull();
  });

  it('falls back to row 2 when the tab name does not parse at all (Reserved-tab case)', () => {
    const result = resolveIdentity('Reserved 1', 'Primary 1 RESPECT - MATH');
    expect(result.identity).toEqual({
      kind: 'primary',
      levelCode: 'P1',
      sectionName: 'Respect',
    });
    expect(result.correctionNote).toBeNull();
    expect(result.truncationNote).toBeNull();
  });

  it('prefers the tab name over a wrong row-2 label, logging a correction note (Phase 6a real case)', () => {
    const result = resolveIdentity(
      'English - P5 Perseverance',
      'Primary 5 COMMITMENT - ENGLISH'
    );
    expect(result.identity).toEqual({
      kind: 'primary',
      levelCode: 'P5',
      sectionName: 'Perseverance',
    });
    expect(result.correctionNote).toContain('English - P5 Perseverance');
    expect(result.correctionNote).toContain('P5 Perseverance');
    expect(result.correctionNote).toContain('P5 Commitment');
    expect(result.truncationNote).toBeNull();
  });

  it('prefers row 2 over a TRUNCATED tab name, logging a distinct truncation note — the real SS & Geo case', () => {
    // Real tab name: "Social Studies&Geography - S3 C" (31 chars, Excel's
    // limit) — really "...S3 Consistency", cut off.
    const result = resolveIdentity(
      'Social Studies&Geography - S3 C',
      'Secondary 3 CONSISTENCY - SOCIAL STUDIES & GEOGRAPHY'
    );
    expect(result.identity).toEqual({
      kind: 'secondary',
      levelCode: 'S3',
      sectionName: 'Consistency',
    });
    expect(result.correctionNote).toBeNull();
    expect(result.truncationNote).toContain('Social Studies&Geography - S3 C');
    expect(result.truncationNote).toContain('Consistency');
  });

  it('prefers row 2 over a truncated tab name — the real Contemporary Arts case', () => {
    // Real tab name: "Contemporary Arts - Sec 1 Disci" (31 chars) — really
    // "...Sec 1 Discipline 2".
    const result = resolveIdentity(
      'Contemporary Arts - Sec 1 Disci',
      'Secondary 1 DISCIPLINE 2 - CONTEMPORARY ARTS'
    );
    expect(result.identity).toEqual({
      kind: 'secondary',
      levelCode: 'S1',
      sectionName: 'Discipline 2',
    });
    expect(result.truncationNote).toContain('Discipline 2');
    expect(result.correctionNote).toBeNull();
  });

  it('does NOT misclassify a genuine disagreement (not a prefix relationship) as truncation', () => {
    // "Perseverance" is not a prefix of "Commitment" nor vice versa — this
    // must take the normal tab-wins correction path, not the truncation
    // path, even though both are "disagreements."
    const result = resolveIdentity(
      'English - P5 Perseverance',
      'Primary 5 COMMITMENT - ENGLISH'
    );
    expect(result.truncationNote).toBeNull();
    expect(result.correctionNote).not.toBeNull();
  });

  it('does NOT treat "tab name longer than row 2" as truncation (History real case — row 2 missing a trailing "2")', () => {
    // Real bug: tab says "Sec 2 Integrity 2" (correct), row 2 says
    // "INTEGRITY" (missing the "2") — row 2 is the SHORTER/wrong one here,
    // the opposite direction from truncation. Tab name must still win via
    // the normal correction path.
    const result = resolveIdentity(
      'History - Sec 2 Integrity 2',
      'Secondary 2 INTEGRITY - HISTORY'
    );
    expect(result.identity).toEqual({
      kind: 'secondary',
      levelCode: 'S2',
      sectionName: 'Integrity 2',
    });
    expect(result.truncationNote).toBeNull();
    expect(result.correctionNote).toContain('Integrity 2');
  });
});
```

- [ ] **Step 3: Run the new tests to verify they pass** (the module already exists from Step 1 — this validates the enhancement)

Run: `npx vitest run __tests__/sis/backfill/grading/t2-masthead.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 4: Refactor `grading-workbook-t2.ts` to consume the shared module**

Replace the entire content of `lib/sis/backfill/grading/grading-workbook-t2.ts`:

```ts
// lib/sis/backfill/grading/grading-workbook-t2.ts
// Parses HFSE's real T2 "GRADES" folder subject workbooks (Primary + a
// Secondary Regular-track tab riding along in the same file) into one
// ParsedSubjectSheet per real PRIMARY section tab. Secondary tabs are
// recognized and skipped — grading-workbook-secondary-t2.ts (Phase 6b)
// processes them.
//
// Masthead-parsing internals (column layout, the fixed printed-grade
// finder, tab-name-first identity resolution) live in the shared
// ./t2-masthead module — extracted from this file per Phase 6a's own
// final review recommendation, once a third T2 parser needed the same
// logic. This refactor changes no behavior: this file's own test suite
// (__tests__/sis/backfill/grading/grading-workbook-t2.test.ts) passes
// completely unchanged.
import * as XLSX from 'xlsx';

import type { GradingStudentRow, ParsedSubjectSheet } from './grading-workbook';
import {
  ROW_LEVEL_SECTION,
  ROW_TEACHER,
  ROW_LABELS,
  ROW_SUBCOLS,
  ROW_MAXSCORES,
  ROW_STUDENTS_START,
  cell,
  numOrNull,
  findColumnLayout,
  weightAt,
  findPrintedGradeColsT2,
  resolveIdentity,
  parseTeacherName,
  type IdentityT2,
} from './t2-masthead';

export interface ParseGradingWorkbookT2Result {
  sheets: ParsedSubjectSheet[];
  skippedSecondary: string[];
  skippedUnrecognized: string[];
  identityCorrections: string[];
  truncationNotes: string[];
}

function parseOneSheetT2(
  rows: unknown[][],
  subjectCode: string,
  sheetName: string
): {
  sheet: ParsedSubjectSheet | null;
  identity: IdentityT2;
  correctionNote: string | null;
  truncationNote: string | null;
} {
  const { identity, correctionNote, truncationNote } = resolveIdentity(
    sheetName,
    cell(rows[ROW_LEVEL_SECTION], 0)
  );
  if (identity.kind !== 'primary')
    return { sheet: null, identity, correctionNote, truncationNote };

  const teacherName = parseTeacherName(cell(rows[ROW_TEACHER], 0));
  const layout = findColumnLayout(rows[ROW_SUBCOLS]);
  const maxRow = rows[ROW_MAXSCORES];

  const wwWeight = weightAt(maxRow, layout.wwTotalCol);
  const ptWeight = weightAt(maxRow, layout.ptTotalCol);
  const qaWeight = weightAt(maxRow, layout.examCol);

  const realWwCols = layout.wwCols.filter((c) => cell(maxRow, c) !== '');
  const realPtCols = layout.ptCols.filter((c) => cell(maxRow, c) !== '');
  const wwTotals = realWwCols.map((c) => Number(cell(maxRow, c)));
  const ptTotals = realPtCols.map((c) => Number(cell(maxRow, c)));
  const qaTotalRaw = cell(maxRow, layout.examCol);
  const qaTotal = qaTotalRaw === '' ? null : Number(qaTotalRaw);

  const { initialCol, quarterlyCol } = findPrintedGradeColsT2(
    rows[ROW_LABELS],
    layout.examCol + 1
  );

  const students: GradingStudentRow[] = [];
  for (let i = ROW_STUDENTS_START; i < rows.length; i++) {
    const row = rows[i];
    const indexNo = cell(row, 0);
    const fullName = cell(row, 1);
    if (!/^\d+$/.test(indexNo) || fullName === '') continue;

    students.push({
      indexNo,
      fullName,
      wwScores: realWwCols.map((c) => numOrNull(cell(row, c))),
      ptScores: realPtCols.map((c) => numOrNull(cell(row, c))),
      examScore: numOrNull(cell(row, layout.examCol)),
      printedInitialGrade:
        initialCol == null ? null : numOrNull(cell(row, initialCol)),
      printedQuarterlyGrade:
        quarterlyCol == null ? null : numOrNull(cell(row, quarterlyCol)),
    });
  }

  return {
    sheet: {
      subjectCode,
      levelCode: identity.levelCode,
      sectionName: identity.sectionName,
      teacherName,
      wwWeight,
      ptWeight,
      qaWeight,
      wwTotals,
      ptTotals,
      qaTotal,
      students,
    },
    identity,
    correctionNote,
    truncationNote,
  };
}

export function parseGradingWorkbookT2(
  filePath: string,
  subjectCode: string
): ParseGradingWorkbookT2Result {
  const wb = XLSX.readFile(filePath);
  const sheets: ParsedSubjectSheet[] = [];
  const skippedSecondary: string[] = [];
  const skippedUnrecognized: string[] = [];
  const identityCorrections: string[] = [];
  const truncationNotes: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    const { sheet, identity, correctionNote, truncationNote } = parseOneSheetT2(
      rows,
      subjectCode,
      sheetName
    );
    if (correctionNote) identityCorrections.push(correctionNote);
    if (truncationNote) truncationNotes.push(truncationNote);
    if (identity.kind === 'primary' && sheet) {
      sheets.push(sheet);
    } else if (identity.kind === 'secondary') {
      skippedSecondary.push(sheetName);
    } else {
      skippedUnrecognized.push(sheetName);
    }
  }

  return {
    sheets,
    skippedSecondary,
    skippedUnrecognized,
    identityCorrections,
    truncationNotes,
  };
}
```

- [ ] **Step 5: Run Phase 6a's existing test suite to confirm the refactor changed nothing**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook-t2.test.ts`
Expected: PASS (8 tests — every one of Phase 6a's existing tests, completely unchanged)

- [ ] **Step 6: Run the full backfill suite to confirm zero regression anywhere else**

Run: `npx vitest run __tests__/sis/backfill/`
Expected: PASS — all tests across all phases green.

- [ ] **Step 7: Commit**

```bash
git add lib/sis/backfill/grading/t2-masthead.ts lib/sis/backfill/grading/grading-workbook-t2.ts __tests__/sis/backfill/grading/t2-masthead.test.ts
git commit -m "refactor(backfill): extract shared T2 masthead helpers, add truncation-aware identity"
```

---

### Task 2: Secondary Regular-track parser (`GRADES/` folder)

**Files:**

- Create: `lib/sis/backfill/grading/grading-workbook-secondary-t2.ts`
- Test: `__tests__/sis/backfill/grading/grading-workbook-secondary-t2.test.ts`

**Interfaces:**

- Consumes (from Task 1): everything from `@/lib/sis/backfill/grading/t2-masthead` (row constants, `cell`, `numOrNull`, `findColumnLayout`, `weightAt`, `findPrintedGradeColsT2`, `resolveIdentity`, `parseTeacherName`, `IdentityT2`).
- Consumes: `GradingStudentRow`, `ParsedSubjectSheet` types from `@/lib/sis/backfill/grading/grading-workbook` (Phase 3, unmodified).
- Produces (consumed by Task 5's orchestrator):

  ```ts
  export interface ParseGradingWorkbookSecondaryT2Result {
    sheets: ParsedSubjectSheet[];
    skippedPrimary: string[];
    skippedUnrecognized: string[];
    identityCorrections: string[];
    truncationNotes: string[];
  }

  export function parseGradingWorkbookSecondaryT2(
    filePath: string,
    subjectCode: string
  ): ParseGradingWorkbookSecondaryT2Result;
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/grading/grading-workbook-secondary-t2.test.ts`:

```ts
// __tests__/sis/backfill/grading/grading-workbook-secondary-t2.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGradingWorkbookSecondaryT2 } from '@/lib/sis/backfill/grading/grading-workbook-secondary-t2';

function writeWorkbook(
  path: string,
  sheets: Record<string, (string | number)[][]>
) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, path);
}

// Real row shape from Literature's "Literature - Sec 1 Discipline 2" tab.
const LIT_SEC1_ROWS: (string | number)[][] = [
  ['Term 2 - 2026'],
  [],
  ['Secondary 1 DISCIPLINE 2 - LITERATURE'],
  ['Teacher: Ms. Carl'],
  [],
  [
    'Index No.',
    'NAME',
    'WRITTEN WORKS (30%)',
    '',
    '',
    '',
    '',
    '',
    'PERFORMANCE TASKS (50%)',
    '',
    '',
    '',
    '',
    '',
    'QUARTERLY ',
    '',
    '',
    'Initial',
    'Quarterly',
  ],
  [],
  [
    '',
    '',
    'W1',
    '',
    '',
    'Total',
    'PS',
    'WS',
    'PT1',
    'PT2',
    'PT3',
    'Total',
    'PS',
    'WS',
    'Exam',
    'PS',
    'WS',
  ],
  [
    '',
    '',
    30,
    '',
    '',
    30,
    '100%',
    '30%',
    30,
    20,
    25,
    75,
    '100%',
    '50%',
    65,
    '100%',
    '20%',
  ],
  [
    1,
    'BAGANG, Miguel C.',
    26,
    '',
    '',
    26,
    '86.67',
    '26.00',
    28,
    19,
    25,
    72,
    '96.00',
    '48.00',
    59,
    '90.77',
    '18.15',
    92.15,
    95,
  ],
];

// Real row shape from Math's "Math - P1 Patience" tab — used here to prove
// a Primary tab riding along in the same file is skipped, never processed.
const MATH_P1_ROWS: (string | number)[][] = [
  ['Term 2 - 2026'],
  [],
  ['Primary 1 PATIENCE - MATH'],
  ['Teacher: Mr. Wai Chung'],
  [],
  [
    'Index No.',
    'NAME',
    'WRITTEN WORKS (40%)',
    '',
    '',
    '',
    '',
    '',
    'PERFORMANCE TASKS (40%)',
    '',
    '',
    '',
    '',
    '',
    'QUARTERLY ',
    '',
    '',
    'Initial',
    'Quarterly',
  ],
  [],
  [
    '',
    '',
    'W1',
    'W2',
    'W3',
    'Total',
    'PS',
    'WS',
    'PT1',
    'PT2',
    'PT3',
    'Total',
    'PS',
    'WS',
    'Exam',
    'PS',
    'WS',
  ],
  [
    '',
    '',
    10,
    10,
    '',
    20,
    '100%',
    '40%',
    10,
    10,
    10,
    30,
    '100%',
    '40%',
    30,
    '100%',
    '20%',
  ],
  [
    1,
    'ALVAREZ, Jaime III D.',
    10,
    10,
    '',
    20,
    '100.00',
    '40.00',
    9,
    6,
    10,
    25,
    '83.33',
    '33.33',
    22,
    '73.33',
    '14.67',
    88.0,
    92,
  ],
];

describe('parseGradingWorkbookSecondaryT2', () => {
  it('parses a real Secondary tab correctly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-sec-t2-'));
    const path = join(dir, 'lit.xlsx');
    writeWorkbook(path, { 'Literature - Sec 1 Discipline 2': LIT_SEC1_ROWS });

    const result = parseGradingWorkbookSecondaryT2(path, 'LIT');

    expect(result.sheets).toHaveLength(1);
    const sheet = result.sheets[0];
    expect(sheet.subjectCode).toBe('LIT');
    expect(sheet.levelCode).toBe('S1');
    expect(sheet.sectionName).toBe('Discipline 2');
    expect(sheet.teacherName).toBe('Ms. Carl');
    expect(sheet.wwWeight).toBeCloseTo(0.3);
    expect(sheet.ptWeight).toBeCloseTo(0.5);
    expect(sheet.qaWeight).toBeCloseTo(0.2);
    const bagang = sheet.students[0];
    expect(bagang.printedInitialGrade).toBeCloseTo(92.15);
    expect(bagang.printedQuarterlyGrade).toBe(95);
  });

  it('recognizes a Primary tab riding along in the same file and skips it, never processing it as Secondary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-sec-t2-'));
    const path = join(dir, 'math.xlsx');
    writeWorkbook(path, { 'Math - P1 Patience': MATH_P1_ROWS });

    const result = parseGradingWorkbookSecondaryT2(path, 'MATH');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedPrimary).toEqual(['Math - P1 Patience']);
    expect(result.skippedUnrecognized).toEqual([]);
  });

  it('reports a blank/Reserved tab as unrecognized, not an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-sec-t2-'));
    const path = join(dir, 'reserved.xlsx');
    writeWorkbook(path, { 'Reserved 1': [[''], [''], ['']] });

    const result = parseGradingWorkbookSecondaryT2(path, 'LIT');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedUnrecognized).toEqual(['Reserved 1']);
    expect(result.skippedPrimary).toEqual([]);
  });

  it('resolves a truncated SS & Geo tab name via row 2, recording a truncation note (real case)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-sec-t2-'));
    const path = join(dir, 'ssgeo.xlsx');
    const rows = LIT_SEC1_ROWS.map((r) => [...r]);
    rows[2] = ['Secondary 3 CONSISTENCY - SOCIAL STUDIES & GEOGRAPHY'];
    writeWorkbook(path, {
      'Social Studies&Geography - S3 C': rows,
    });

    const result = parseGradingWorkbookSecondaryT2(path, 'SS');

    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].levelCode).toBe('S3');
    expect(result.sheets[0].sectionName).toBe('Consistency');
    expect(result.truncationNotes).toHaveLength(1);
    expect(result.identityCorrections).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook-secondary-t2.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/grading/grading-workbook-secondary-t2'`

- [ ] **Step 3: Implement the parser**

Create `lib/sis/backfill/grading/grading-workbook-secondary-t2.ts`:

```ts
// lib/sis/backfill/grading/grading-workbook-secondary-t2.ts
// Parses HFSE's real T2 "GRADES" folder subject workbooks into one
// ParsedSubjectSheet per real SECONDARY (Regular-track) section tab —
// the mirror image of grading-workbook-t2.ts (Phase 6a), which processes
// the Primary tabs in these same files. Both consume the shared
// ./t2-masthead module.
import * as XLSX from 'xlsx';

import type { GradingStudentRow, ParsedSubjectSheet } from './grading-workbook';
import {
  ROW_LEVEL_SECTION,
  ROW_TEACHER,
  ROW_LABELS,
  ROW_SUBCOLS,
  ROW_MAXSCORES,
  ROW_STUDENTS_START,
  cell,
  numOrNull,
  findColumnLayout,
  weightAt,
  findPrintedGradeColsT2,
  resolveIdentity,
  parseTeacherName,
  type IdentityT2,
} from './t2-masthead';

export interface ParseGradingWorkbookSecondaryT2Result {
  sheets: ParsedSubjectSheet[];
  skippedPrimary: string[];
  skippedUnrecognized: string[];
  identityCorrections: string[];
  truncationNotes: string[];
}

function parseOneSheetSecondaryT2(
  rows: unknown[][],
  subjectCode: string,
  sheetName: string
): {
  sheet: ParsedSubjectSheet | null;
  identity: IdentityT2;
  correctionNote: string | null;
  truncationNote: string | null;
} {
  const { identity, correctionNote, truncationNote } = resolveIdentity(
    sheetName,
    cell(rows[ROW_LEVEL_SECTION], 0)
  );
  if (identity.kind !== 'secondary')
    return { sheet: null, identity, correctionNote, truncationNote };

  const teacherName = parseTeacherName(cell(rows[ROW_TEACHER], 0));
  const layout = findColumnLayout(rows[ROW_SUBCOLS]);
  const maxRow = rows[ROW_MAXSCORES];

  const wwWeight = weightAt(maxRow, layout.wwTotalCol);
  const ptWeight = weightAt(maxRow, layout.ptTotalCol);
  const qaWeight = weightAt(maxRow, layout.examCol);

  const realWwCols = layout.wwCols.filter((c) => cell(maxRow, c) !== '');
  const realPtCols = layout.ptCols.filter((c) => cell(maxRow, c) !== '');
  const wwTotals = realWwCols.map((c) => Number(cell(maxRow, c)));
  const ptTotals = realPtCols.map((c) => Number(cell(maxRow, c)));
  const qaTotalRaw = cell(maxRow, layout.examCol);
  const qaTotal = qaTotalRaw === '' ? null : Number(qaTotalRaw);

  const { initialCol, quarterlyCol } = findPrintedGradeColsT2(
    rows[ROW_LABELS],
    layout.examCol + 1
  );

  const students: GradingStudentRow[] = [];
  for (let i = ROW_STUDENTS_START; i < rows.length; i++) {
    const row = rows[i];
    const indexNo = cell(row, 0);
    const fullName = cell(row, 1);
    if (!/^\d+$/.test(indexNo) || fullName === '') continue;

    students.push({
      indexNo,
      fullName,
      wwScores: realWwCols.map((c) => numOrNull(cell(row, c))),
      ptScores: realPtCols.map((c) => numOrNull(cell(row, c))),
      examScore: numOrNull(cell(row, layout.examCol)),
      printedInitialGrade:
        initialCol == null ? null : numOrNull(cell(row, initialCol)),
      printedQuarterlyGrade:
        quarterlyCol == null ? null : numOrNull(cell(row, quarterlyCol)),
    });
  }

  return {
    sheet: {
      subjectCode,
      levelCode: identity.levelCode,
      sectionName: identity.sectionName,
      teacherName,
      wwWeight,
      ptWeight,
      qaWeight,
      wwTotals,
      ptTotals,
      qaTotal,
      students,
    },
    identity,
    correctionNote,
    truncationNote,
  };
}

export function parseGradingWorkbookSecondaryT2(
  filePath: string,
  subjectCode: string
): ParseGradingWorkbookSecondaryT2Result {
  const wb = XLSX.readFile(filePath);
  const sheets: ParsedSubjectSheet[] = [];
  const skippedPrimary: string[] = [];
  const skippedUnrecognized: string[] = [];
  const identityCorrections: string[] = [];
  const truncationNotes: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    const { sheet, identity, correctionNote, truncationNote } =
      parseOneSheetSecondaryT2(rows, subjectCode, sheetName);
    if (correctionNote) identityCorrections.push(correctionNote);
    if (truncationNote) truncationNotes.push(truncationNote);
    if (identity.kind === 'secondary' && sheet) {
      sheets.push(sheet);
    } else if (identity.kind === 'primary') {
      skippedPrimary.push(sheetName);
    } else {
      skippedUnrecognized.push(sheetName);
    }
  }

  return {
    sheets,
    skippedPrimary,
    skippedUnrecognized,
    identityCorrections,
    truncationNotes,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook-secondary-t2.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/grading/grading-workbook-secondary-t2.ts __tests__/sis/backfill/grading/grading-workbook-secondary-t2.test.ts
git commit -m "feat(backfill): parse AY2026 T2 Secondary Regular-track grading workbooks"
```

---

### Task 3: Global-track parser (`Lower Secondary Global Grading Sheets/` folder)

**Files:**

- Create: `lib/sis/backfill/grading/grading-workbook-global-t2.ts`
- Test: `__tests__/sis/backfill/grading/grading-workbook-global-t2.test.ts`

**Interfaces:**

- Consumes (from Task 1): the same `t2-masthead` exports as Task 2.
- Produces (consumed by Task 5's orchestrator):

  ```ts
  export interface ParseGradingWorkbookGlobalT2Result {
    sheets: ParsedSubjectSheet[];
    skippedDoNotUse: string[];
    skippedUnrecognized: string[];
    identityCorrections: string[];
    truncationNotes: string[];
  }

  export function parseGradingWorkbookGlobalT2(
    filePath: string,
    subjectCode: string
  ): ParseGradingWorkbookGlobalT2Result;
  ```

**Difference from Task 2's parser:** every tab in these files is already Secondary (there are no Primary tabs mixed in — confirmed via direct inspection of the real T2 files), so this parser doesn't branch on `identity.kind`, it just requires `'secondary'` and treats anything else as unrecognized. It ALSO must skip any sheet name starting with `"DO NOT USE"` — the same exclusion Phase 3's `grading-workbook.ts` (`sheetName.startsWith('DO NOT USE')`) already established, confirmed present again in every real T2 Global-track file (`"DO NOT USE Literature - Sec 4 E"`).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/grading/grading-workbook-global-t2.test.ts`:

```ts
// __tests__/sis/backfill/grading/grading-workbook-global-t2.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGradingWorkbookGlobalT2 } from '@/lib/sis/backfill/grading/grading-workbook-global-t2';

function writeWorkbook(
  path: string,
  sheets: Record<string, (string | number)[][]>
) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, path);
}

// Real row shape from Mathematics Global Class's "Math - Sec 1 Discipline 1"
// tab, transcribed verbatim — including the spurious second
// "Quarterly"/"Term 1" pair at cols 23/24 that must never be read.
const MATH_GLOBAL_SEC1_ROWS: (string | number)[][] = [
  ['Term 2 - 2026'],
  ['GLOBAL CLASS'],
  ['Secondary 1 DISCIPLINE 1 - MATHEMATICS'],
  ['Teacher: Ms.J'],
  [],
  [
    'Index No.',
    'NAME',
    'WRITTEN WORKS (40%)',
    '',
    '',
    '',
    '',
    '',
    'PERFORMANCE TASKS (40%)',
    '',
    '',
    '',
    '',
    '',
    'QUARTERLY ',
    '',
    '',
    'Initial',
    'Quarterly',
    '',
    '',
    'Quarterly',
    'Term 1',
  ],
  [
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'ASSESSMENT (20%)',
    '',
    '',
    'Grade',
    'Grade',
    '',
    '',
    'Grade',
    'Grade',
  ],
  [
    '',
    '',
    'W1',
    'W2',
    'W3',
    'Total',
    'PS',
    'WS',
    'PT1',
    'PT2',
    'PT3',
    'Total',
    'PS',
    'WS',
    'Exam',
    'PS',
    'WS',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    '',
    '',
    20,
    20,
    '',
    40,
    '100%',
    '40%',
    30,
    30,
    25,
    85,
    '100%',
    '40%',
    70,
    '100%',
    '20%',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    1,
    'BANTA, Stephanie Louise S.',
    10,
    12,
    '',
    22,
    '55.00',
    '22.00',
    26,
    20,
    23,
    69,
    '81.18',
    '32.47',
    48,
    '68.57',
    '13.71',
    68.18,
    80,
    '',
    '',
    80,
    89,
  ],
];

describe('parseGradingWorkbookGlobalT2', () => {
  it('parses a real Global-track Secondary tab, reading only the FIRST Initial/Quarterly pair', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-global-t2-'));
    const path = join(dir, 'math.xlsx');
    writeWorkbook(path, {
      'Math - Sec 1 Discipline 1': MATH_GLOBAL_SEC1_ROWS,
    });

    const result = parseGradingWorkbookGlobalT2(path, 'MATH');

    expect(result.sheets).toHaveLength(1);
    const sheet = result.sheets[0];
    expect(sheet.levelCode).toBe('S1');
    expect(sheet.sectionName).toBe('Discipline 1');
    expect(sheet.wwWeight).toBeCloseTo(0.4);
    const banta = sheet.students[0];
    expect(banta.printedInitialGrade).toBeCloseTo(68.18);
    expect(banta.printedQuarterlyGrade).toBe(80); // NEVER the spurious 89
  });

  it('skips any tab whose name starts with "DO NOT USE"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-global-t2-'));
    const path = join(dir, 'math2.xlsx');
    writeWorkbook(path, {
      'DO NOT USE Literature - Sec 4 E': [['Term 2 - 2026'], ['irrelevant']],
      'Math - Sec 1 Discipline 1': MATH_GLOBAL_SEC1_ROWS,
    });

    const result = parseGradingWorkbookGlobalT2(path, 'MATH');
    expect(result.sheets).toHaveLength(1);
    expect(result.skippedDoNotUse).toEqual(['DO NOT USE Literature - Sec 4 E']);
  });

  it('reports a non-DO-NOT-USE unrecognized tab separately from skippedDoNotUse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-global-t2-'));
    const path = join(dir, 'blank.xlsx');
    writeWorkbook(path, { Sheet2: [[''], [''], ['']] });

    const result = parseGradingWorkbookGlobalT2(path, 'MANDARIN');
    expect(result.sheets).toHaveLength(0);
    expect(result.skippedUnrecognized).toEqual(['Sheet2']);
    expect(result.skippedDoNotUse).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook-global-t2.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/backfill/grading/grading-workbook-global-t2'`

- [ ] **Step 3: Implement the parser**

Create `lib/sis/backfill/grading/grading-workbook-global-t2.ts`:

```ts
// lib/sis/backfill/grading/grading-workbook-global-t2.ts
// Parses HFSE's real T2 "Lower Secondary Global Grading Sheets" workbooks
// (Global-track Secondary — Discipline 1, Integrity 1 only; every tab in
// these files is already Secondary, no Primary tabs mixed in) into one
// ParsedSubjectSheet per real section tab. Reuses Phase 3's exact
// "DO NOT USE" tab exclusion and the shared ./t2-masthead module (the same
// printed-grade-column fix and tab-name-first identity resolution every
// other T2 parser uses — these T2 Global-track files carry the identical
// spurious second Quarterly/Term-1 column pair Phase 6a found elsewhere).
import * as XLSX from 'xlsx';

import type { GradingStudentRow, ParsedSubjectSheet } from './grading-workbook';
import {
  ROW_LEVEL_SECTION,
  ROW_TEACHER,
  ROW_LABELS,
  ROW_SUBCOLS,
  ROW_MAXSCORES,
  ROW_STUDENTS_START,
  cell,
  numOrNull,
  findColumnLayout,
  weightAt,
  findPrintedGradeColsT2,
  resolveIdentity,
  parseTeacherName,
  type IdentityT2,
} from './t2-masthead';

export interface ParseGradingWorkbookGlobalT2Result {
  sheets: ParsedSubjectSheet[];
  skippedDoNotUse: string[];
  skippedUnrecognized: string[];
  identityCorrections: string[];
  truncationNotes: string[];
}

function parseOneSheetGlobalT2(
  rows: unknown[][],
  subjectCode: string,
  sheetName: string
): {
  sheet: ParsedSubjectSheet | null;
  identity: IdentityT2;
  correctionNote: string | null;
  truncationNote: string | null;
} {
  const { identity, correctionNote, truncationNote } = resolveIdentity(
    sheetName,
    cell(rows[ROW_LEVEL_SECTION], 0)
  );
  if (identity.kind !== 'secondary')
    return { sheet: null, identity, correctionNote, truncationNote };

  const teacherName = parseTeacherName(cell(rows[ROW_TEACHER], 0));
  const layout = findColumnLayout(rows[ROW_SUBCOLS]);
  const maxRow = rows[ROW_MAXSCORES];

  const wwWeight = weightAt(maxRow, layout.wwTotalCol);
  const ptWeight = weightAt(maxRow, layout.ptTotalCol);
  const qaWeight = weightAt(maxRow, layout.examCol);

  const realWwCols = layout.wwCols.filter((c) => cell(maxRow, c) !== '');
  const realPtCols = layout.ptCols.filter((c) => cell(maxRow, c) !== '');
  const wwTotals = realWwCols.map((c) => Number(cell(maxRow, c)));
  const ptTotals = realPtCols.map((c) => Number(cell(maxRow, c)));
  const qaTotalRaw = cell(maxRow, layout.examCol);
  const qaTotal = qaTotalRaw === '' ? null : Number(qaTotalRaw);

  const { initialCol, quarterlyCol } = findPrintedGradeColsT2(
    rows[ROW_LABELS],
    layout.examCol + 1
  );

  const students: GradingStudentRow[] = [];
  for (let i = ROW_STUDENTS_START; i < rows.length; i++) {
    const row = rows[i];
    const indexNo = cell(row, 0);
    const fullName = cell(row, 1);
    if (!/^\d+$/.test(indexNo) || fullName === '') continue;

    students.push({
      indexNo,
      fullName,
      wwScores: realWwCols.map((c) => numOrNull(cell(row, c))),
      ptScores: realPtCols.map((c) => numOrNull(cell(row, c))),
      examScore: numOrNull(cell(row, layout.examCol)),
      printedInitialGrade:
        initialCol == null ? null : numOrNull(cell(row, initialCol)),
      printedQuarterlyGrade:
        quarterlyCol == null ? null : numOrNull(cell(row, quarterlyCol)),
    });
  }

  return {
    sheet: {
      subjectCode,
      levelCode: identity.levelCode,
      sectionName: identity.sectionName,
      teacherName,
      wwWeight,
      ptWeight,
      qaWeight,
      wwTotals,
      ptTotals,
      qaTotal,
      students,
    },
    identity,
    correctionNote,
    truncationNote,
  };
}

export function parseGradingWorkbookGlobalT2(
  filePath: string,
  subjectCode: string
): ParseGradingWorkbookGlobalT2Result {
  const wb = XLSX.readFile(filePath);
  const sheets: ParsedSubjectSheet[] = [];
  const skippedDoNotUse: string[] = [];
  const skippedUnrecognized: string[] = [];
  const identityCorrections: string[] = [];
  const truncationNotes: string[] = [];

  for (const sheetName of wb.SheetNames) {
    if (sheetName.startsWith('DO NOT USE')) {
      skippedDoNotUse.push(sheetName);
      continue;
    }
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    const { sheet, identity, correctionNote, truncationNote } =
      parseOneSheetGlobalT2(rows, subjectCode, sheetName);
    if (correctionNote) identityCorrections.push(correctionNote);
    if (truncationNote) truncationNotes.push(truncationNote);
    if (identity.kind === 'secondary' && sheet) {
      sheets.push(sheet);
    } else {
      skippedUnrecognized.push(sheetName);
    }
  }

  return {
    sheets,
    skippedDoNotUse,
    skippedUnrecognized,
    identityCorrections,
    truncationNotes,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/grading/grading-workbook-global-t2.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/grading/grading-workbook-global-t2.ts __tests__/sis/backfill/grading/grading-workbook-global-t2.test.ts
git commit -m "feat(backfill): parse AY2026 T2 Global-track Secondary grading workbooks"
```

---

### Task 4: Secondary import composer

**Files:**

- Create: `lib/sis/backfill/grading/build-secondary-grading-import.ts`
- Test: `__tests__/sis/backfill/grading/build-secondary-grading-import.test.ts`

**Interfaces:**

- Consumes: `GradingStudentRow`, `ParsedSubjectSheet` types from `@/lib/sis/backfill/grading/grading-workbook`; `computeQuarterly` from `@/lib/compute/quarterly`; `sqlString` from `@/lib/sis/backfill/enrollment/sql-escape`.
- Produces (consumed by Task 5's orchestrator) — deliberately the same shape as Phase 6a's `build-primary-grading-import.ts` (accepted duplication — this file has no shared-extraction recommendation the way the parsers did; only cosmetic title strings differ):

  ```ts
  export interface RosterLookupEntry {
    levelCode: string;
    sectionName: string;
    indexNumber: number;
    sectionStudentId: string;
  }

  export interface SubjectConfigWeight {
    subjectCode: string;
    wwWeight: number;
    ptWeight: number;
    qaWeight: number;
  }

  export interface BuildSecondaryGradingImportInput {
    sheets: ParsedSubjectSheet[];
    rosterLookup: RosterLookupEntry[];
    subjectConfigWeights: SubjectConfigWeight[];
    ayCode: string;
    termNumber: number;
  }

  export interface BuildSecondaryGradingImportResult {
    preview: string;
    apply: string;
    stats: {
      subjectConfigsWritten: number;
      gradingSheetsWritten: number;
      gradeEntriesWritten: number;
      needsReview: number;
      quarterlyMismatches: number;
    };
  }

  export function buildSecondaryGradingImport(
    input: BuildSecondaryGradingImportInput
  ): BuildSecondaryGradingImportResult;
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sis/backfill/grading/build-secondary-grading-import.test.ts`:

```ts
// __tests__/sis/backfill/grading/build-secondary-grading-import.test.ts
import { describe, expect, it } from 'vitest';

import { buildSecondaryGradingImport } from '@/lib/sis/backfill/grading/build-secondary-grading-import';
import type {
  GradingStudentRow,
  ParsedSubjectSheet,
} from '@/lib/sis/backfill/grading/grading-workbook';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '@/lib/sis/backfill/grading/build-secondary-grading-import';

const BASE_INPUT = { ayCode: 'AY2026', termNumber: 2 };

const ROSTER: RosterLookupEntry[] = [
  {
    levelCode: 'S1',
    sectionName: 'Discipline 2',
    indexNumber: 1,
    sectionStudentId: 'ss-bagang-uuid',
  },
];

function student(overrides: Partial<GradingStudentRow>): GradingStudentRow {
  return {
    indexNo: '1',
    fullName: 'BAGANG, Miguel C.',
    wwScores: [26],
    ptScores: [28, 19, 25],
    examScore: 59,
    printedInitialGrade: 92.15,
    printedQuarterlyGrade: 95,
    ...overrides,
  };
}

function litSheet(
  overrides: Partial<ParsedSubjectSheet> = {}
): ParsedSubjectSheet {
  return {
    subjectCode: 'LIT',
    levelCode: 'S1',
    sectionName: 'Discipline 2',
    teacherName: 'Ms. Carl',
    wwWeight: 0.3,
    ptWeight: 0.5,
    qaWeight: 0.2,
    wwTotals: [30],
    ptTotals: [30, 20, 25],
    qaTotal: 65,
    students: [student({})],
    ...overrides,
  };
}

describe('buildSecondaryGradingImport', () => {
  it('resolves roster, computes grades via the real formula, and writes grading_sheets/grade_entries', () => {
    const result = buildSecondaryGradingImport({
      ...BASE_INPUT,
      sheets: [litSheet()],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(result.stats.gradingSheetsWritten).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(1);
    expect(result.stats.needsReview).toBe(0);
    expect(result.stats.quarterlyMismatches).toBe(0);
    expect(result.apply).toContain("'LIT'");
    expect(result.apply).toContain("'S1'");
    expect(result.apply).toContain("'ss-bagang-uuid'");
    expect(result.apply).toContain("'backfill-import'");
  });

  it('accepts an empty subjectConfigWeights list and writes zero subject_configs rows (the expected Phase 6b case)', () => {
    const result = buildSecondaryGradingImport({
      ...BASE_INPUT,
      sheets: [litSheet()],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(result.stats.subjectConfigsWritten).toBe(0);
    expect(result.preview).toContain('subject_configs corrections (0)');
  });

  it('flags an unresolved (level, section, index) as needs-review and excludes it from apply.sql', () => {
    const sheet = litSheet({
      students: [student({ indexNo: '99', fullName: 'NOBODY, Unresolved' })],
    });
    const result = buildSecondaryGradingImport({
      ...BASE_INPUT,
      sheets: [sheet],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(result.stats.needsReview).toBe(1);
    expect(result.apply).not.toContain('NOBODY');
    expect(result.preview).toContain('NOBODY');
  });

  it('flags a quarterly-grade mismatch but still writes the raw scores', () => {
    const sheet = litSheet({
      students: [student({ printedQuarterlyGrade: 999 })],
    });
    const result = buildSecondaryGradingImport({
      ...BASE_INPUT,
      sheets: [sheet],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(result.stats.quarterlyMismatches).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(1);
    expect(result.apply).toContain("'ss-bagang-uuid'");
  });

  it('produces a single un-chunked apply.sql string at this volume', () => {
    const result = buildSecondaryGradingImport({
      ...BASE_INPUT,
      sheets: [litSheet()],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(typeof result.apply).toBe('string');
    expect(result.apply).toContain('begin;');
    expect(result.apply).toContain('commit;');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sis/backfill/grading/build-secondary-grading-import.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the composer**

Create `lib/sis/backfill/grading/build-secondary-grading-import.ts`:

```ts
// lib/sis/backfill/grading/build-secondary-grading-import.ts
// Composes parsed T2 Secondary grading data (grading-workbook-secondary-t2.ts
// + grading-workbook-global-t2.ts — the orchestrator merges both tracks'
// sheets before calling this) into the two SQL artifacts described by the
// design doc: a read-only preview report and a transactional, idempotent
// apply script. No I/O. Deliberately mirrors Phase 6a's
// build-primary-grading-import.ts exactly (accepted duplication — only
// title strings differ; the logic has no shared-extraction
// recommendation the way the parsers did).
import { computeQuarterly } from '@/lib/compute/quarterly';
import { sqlString } from '../enrollment/sql-escape';
import type { GradingStudentRow, ParsedSubjectSheet } from './grading-workbook';

export interface RosterLookupEntry {
  levelCode: string;
  sectionName: string;
  indexNumber: number;
  sectionStudentId: string;
}

export interface SubjectConfigWeight {
  subjectCode: string;
  wwWeight: number;
  ptWeight: number;
  qaWeight: number;
}

export interface BuildSecondaryGradingImportInput {
  sheets: ParsedSubjectSheet[];
  rosterLookup: RosterLookupEntry[];
  subjectConfigWeights: SubjectConfigWeight[];
  ayCode: string;
  termNumber: number;
}

interface ResolvedEntry {
  sectionStudentId: string;
  subjectCode: string;
  levelCode: string;
  wwScores: (number | null)[];
  ptScores: (number | null)[];
  examScore: number | null;
  computed: ReturnType<typeof computeQuarterly>;
}

interface NeedsReviewRow {
  subjectCode: string;
  levelCode: string;
  sectionName: string;
  indexNo: string;
  fullName: string;
  reason: string;
}

interface MismatchRow {
  subjectCode: string;
  sectionName: string;
  indexNo: string;
  fullName: string;
  kind: 'quarterly' | 'initial';
  printed: number;
  computed: number;
}

export interface BuildSecondaryGradingImportResult {
  preview: string;
  apply: string;
  stats: {
    subjectConfigsWritten: number;
    gradingSheetsWritten: number;
    gradeEntriesWritten: number;
    needsReview: number;
    quarterlyMismatches: number;
  };
}

function toFixed6(n: number | null): string {
  return n == null ? 'null' : n.toFixed(6);
}

export function buildSecondaryGradingImport(
  input: BuildSecondaryGradingImportInput
): BuildSecondaryGradingImportResult {
  const { sheets, rosterLookup, subjectConfigWeights, ayCode, termNumber } =
    input;

  const rosterMap = new Map<string, string>();
  for (const r of rosterLookup) {
    rosterMap.set(
      `${r.levelCode}::${r.sectionName}::${r.indexNumber}`,
      r.sectionStudentId
    );
  }

  const resolved: ResolvedEntry[] = [];
  const needsReview: NeedsReviewRow[] = [];
  const mismatches: MismatchRow[] = [];

  for (const sheet of sheets) {
    for (const student of sheet.students) {
      const key = `${sheet.levelCode}::${sheet.sectionName}::${Number.parseInt(student.indexNo, 10)}`;
      const sectionStudentId = rosterMap.get(key);
      if (!sectionStudentId) {
        needsReview.push({
          subjectCode: sheet.subjectCode,
          levelCode: sheet.levelCode,
          sectionName: sheet.sectionName,
          indexNo: student.indexNo,
          fullName: student.fullName,
          reason: `no matching section_students row for index ${student.indexNo}`,
        });
        continue;
      }

      const computed = computeQuarterly({
        ww_scores: student.wwScores,
        ww_totals: sheet.wwTotals,
        pt_scores: student.ptScores,
        pt_totals: sheet.ptTotals,
        qa_score: student.examScore,
        qa_total: sheet.qaTotal,
        ww_weight: sheet.wwWeight,
        pt_weight: sheet.ptWeight,
        qa_weight: sheet.qaWeight,
      });

      checkMismatch(sheet, student, computed, mismatches);

      resolved.push({
        sectionStudentId,
        subjectCode: sheet.subjectCode,
        levelCode: sheet.levelCode,
        wwScores: student.wwScores,
        ptScores: student.ptScores,
        examScore: student.examScore,
        computed,
      });
    }
  }

  const stats: BuildSecondaryGradingImportResult['stats'] = {
    subjectConfigsWritten: subjectConfigWeights.length,
    gradingSheetsWritten: sheets.length,
    gradeEntriesWritten: resolved.length,
    needsReview: needsReview.length,
    quarterlyMismatches: mismatches.length,
  };

  return {
    preview: buildPreviewSql(
      sheets,
      subjectConfigWeights,
      needsReview,
      mismatches,
      stats
    ),
    apply: buildApplySql(
      ayCode,
      termNumber,
      sheets,
      resolved,
      subjectConfigWeights
    ),
    stats,
  };
}

function checkMismatch(
  sheet: ParsedSubjectSheet,
  student: GradingStudentRow,
  computed: ReturnType<typeof computeQuarterly>,
  mismatches: MismatchRow[]
) {
  if (student.printedQuarterlyGrade != null) {
    if (computed.quarterly_grade !== student.printedQuarterlyGrade) {
      mismatches.push({
        subjectCode: sheet.subjectCode,
        sectionName: sheet.sectionName,
        indexNo: student.indexNo,
        fullName: student.fullName,
        kind: 'quarterly',
        printed: student.printedQuarterlyGrade,
        computed: computed.quarterly_grade ?? NaN,
      });
    }
    return;
  }
  if (student.printedInitialGrade != null && computed.initial_grade != null) {
    if (Math.abs(computed.initial_grade - student.printedInitialGrade) > 0.01) {
      mismatches.push({
        subjectCode: sheet.subjectCode,
        sectionName: sheet.sectionName,
        indexNo: student.indexNo,
        fullName: student.fullName,
        kind: 'initial',
        printed: student.printedInitialGrade,
        computed: computed.initial_grade,
      });
    }
  }
}

function buildPreviewSql(
  sheets: ParsedSubjectSheet[],
  subjectConfigWeights: SubjectConfigWeight[],
  needsReview: NeedsReviewRow[],
  mismatches: MismatchRow[],
  stats: BuildSecondaryGradingImportResult['stats']
): string {
  const lines: string[] = [];
  lines.push(
    '-- AY2026 T2 Secondary grading sheets import — PREVIEW (read-only)'
  );
  lines.push('--');
  lines.push(
    '-- Generated by gen-ay2026-t2-secondary-grading.ts from the Regular-track'
  );
  lines.push(
    '-- "GRADES" subject workbooks and the Global-track "Lower Secondary'
  );
  lines.push('-- Global Grading Sheets" workbooks.');
  lines.push(
    '-- Review this report BEFORE running the matching apply.sql file.'
  );
  lines.push('--');
  lines.push(
    "-- Per-subject weights & slots (read from each sheet's own header):"
  );
  for (const s of sheets) {
    lines.push(
      `--   ${s.subjectCode} ${s.levelCode} ${s.sectionName}: ww=${s.wwWeight} pt=${s.ptWeight} qa=${s.qaWeight} | wwTotals=[${s.wwTotals}] ptTotals=[${s.ptTotals}] qaTotal=${s.qaTotal}`
    );
  }
  lines.push('--');
  lines.push(
    `-- subject_configs corrections (${subjectConfigWeights.length}):`
  );
  if (subjectConfigWeights.length === 0) lines.push('--   (none)');
  for (const w of subjectConfigWeights) {
    lines.push(
      `--   ${w.subjectCode}: ww=${w.wwWeight} pt=${w.ptWeight} qa=${w.qaWeight}, weights_confirmed -> true`
    );
  }
  lines.push('--');
  lines.push(
    `-- gradingSheets=${stats.gradingSheetsWritten} gradeEntries=${stats.gradeEntriesWritten}`
  );
  lines.push('--');
  lines.push(
    `-- Needs review (${needsReview.length}) — NOT written by apply.sql:`
  );
  if (needsReview.length === 0) lines.push('--   (none)');
  for (const r of needsReview) {
    lines.push(
      `--   [${r.subjectCode} ${r.levelCode} ${r.sectionName}] index ${r.indexNo} "${r.fullName}" — ${r.reason}`
    );
  }
  lines.push('--');
  lines.push(
    `-- Quarterly/Initial grade mismatches (${mismatches.length}) — raw scores ARE still written, this is informational:`
  );
  if (mismatches.length === 0) lines.push('--   (none)');
  for (const m of mismatches) {
    lines.push(
      `--   [${m.subjectCode} ${m.sectionName}] index ${m.indexNo} "${m.fullName}" — ${m.kind}: printed=${m.printed} computed=${m.computed}`
    );
  }
  return lines.join('\n') + '\n';
}

function buildApplySql(
  ayCode: string,
  termNumber: number,
  sheets: ParsedSubjectSheet[],
  resolved: ResolvedEntry[],
  subjectConfigWeights: SubjectConfigWeight[]
): string {
  const lines: string[] = [];
  lines.push(
    '-- AY2026 T2 Secondary grading sheets import — APPLY (transactional)'
  );
  lines.push('--');
  lines.push('-- RUN ay2026-t2-secondary-grading-preview.sql FIRST.');
  lines.push(
    '-- Generated by gen-ay2026-t2-secondary-grading.ts — do not hand-edit; regenerate instead.'
  );
  lines.push('--');
  lines.push(
    '-- subject_configs writes below are EXACTLY the hand-verified corrections'
  );
  lines.push(
    '-- from the design doc — never derived from the sheets themselves. No'
  );
  lines.push(
    '-- subject_level_offerings or section_subjects writes (already populated).'
  );
  lines.push('--');
  lines.push('-- Run the WHOLE file in one go (one connection/session).');
  lines.push('');
  lines.push('begin;');
  lines.push('');

  if (subjectConfigWeights.length > 0) {
    lines.push('drop table if exists _ay26sgrd_subject_configs;');
    lines.push(
      'create temp table _ay26sgrd_subject_configs (subject_code, ww_weight, pt_weight, qa_weight) as'
    );
    lines.push('values');
    const configRows = subjectConfigWeights.map(
      (w) =>
        `  (${sqlString(w.subjectCode)}, ${w.wwWeight}, ${w.ptWeight}, ${w.qaWeight})`
    );
    lines.push(configRows.join(',\n') + ';');
    lines.push('');
    lines.push(
      'insert into subject_configs (academic_year_id, subject_id, ww_weight, pt_weight, qa_weight, weights_confirmed)'
    );
    lines.push(
      'select ay.id, sub.id, c.ww_weight, c.pt_weight, c.qa_weight, true'
    );
    lines.push('from _ay26sgrd_subject_configs c');
    lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
    lines.push('join subjects sub on sub.code = c.subject_code');
    lines.push('on conflict (academic_year_id, subject_id) do update set');
    lines.push('  ww_weight = excluded.ww_weight,');
    lines.push('  pt_weight = excluded.pt_weight,');
    lines.push('  qa_weight = excluded.qa_weight,');
    lines.push('  weights_confirmed = excluded.weights_confirmed;');
    lines.push('');
  }

  lines.push('drop table if exists _ay26sgrd_sheets;');
  lines.push(
    'create temp table _ay26sgrd_sheets (subject_code, level_code, section_name, teacher_name, ww_totals, pt_totals, qa_total) as'
  );
  lines.push('values');
  const sheetRows = sheets.map(
    (s) =>
      `  (${sqlString(s.subjectCode)}, ${sqlString(s.levelCode)}, ${sqlString(s.sectionName)}, ${s.teacherName == null ? 'NULL' : sqlString(s.teacherName)}, ARRAY[${s.wwTotals.join(',')}]::numeric[], ARRAY[${s.ptTotals.join(',')}]::numeric[], ${s.qaTotal ?? 'null'})`
  );
  lines.push(sheetRows.join(',\n') + ';');
  lines.push('');
  lines.push(
    'insert into grading_sheets (term_id, section_id, subject_id, subject_config_id, teacher_name, ww_totals, pt_totals, qa_total, is_locked, locked_at, locked_by)'
  );
  lines.push(
    "select t.id, sec.id, sub.id, sc.id, s.teacher_name, s.ww_totals, s.pt_totals, s.qa_total, true, now(), 'backfill-import'"
  );
  lines.push('from _ay26sgrd_sheets s');
  lines.push(`join academic_years ay on ay.ay_code = ${sqlString(ayCode)}`);
  lines.push(
    `join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber}`
  );
  lines.push('join subjects sub on sub.code = s.subject_code');
  lines.push(
    'join sections sec on sec.academic_year_id = ay.id and sec.name = s.section_name'
  );
  lines.push(
    'join subject_configs sc on sc.academic_year_id = ay.id and sc.subject_id = sub.id'
  );
  lines.push('on conflict (term_id, section_id, subject_id) do nothing;');
  lines.push('');

  lines.push('drop table if exists _ay26sgrd_entries;');
  lines.push(
    'create temp table _ay26sgrd_entries (section_student_id, subject_code, ww_scores, pt_scores, qa_score, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade) as'
  );
  lines.push('values');
  const entryRows = resolved.map((e) => {
    const wwArr = `ARRAY[${e.wwScores.map((v) => (v == null ? 'null' : v)).join(',')}]::numeric[]`;
    const ptArr = `ARRAY[${e.ptScores.map((v) => (v == null ? 'null' : v)).join(',')}]::numeric[]`;
    return `  (${sqlString(e.sectionStudentId)}, ${sqlString(e.subjectCode)}, ${wwArr}, ${ptArr}, ${e.examScore ?? 'null'}, ${toFixed6(e.computed.ww_ps)}, ${toFixed6(e.computed.pt_ps)}, ${toFixed6(e.computed.qa_ps)}, ${toFixed6(e.computed.initial_grade)}, ${e.computed.quarterly_grade ?? 'null'})`;
  });
  lines.push(
    (entryRows.length
      ? entryRows.join(',\n')
      : "  ('00000000-0000-0000-0000-000000000000', '__NONE__', ARRAY[]::numeric[], ARRAY[]::numeric[], null, null, null, null, null, null)") +
      ';'
  );
  lines.push('');
  lines.push(
    'insert into grade_entries (grading_sheet_id, section_student_id, ww_scores, pt_scores, qa_score, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade)'
  );
  lines.push(
    'select gs.id, e.section_student_id::uuid, e.ww_scores, e.pt_scores, e.qa_score, e.ww_ps, e.pt_ps, e.qa_ps, e.initial_grade, e.quarterly_grade'
  );
  lines.push('from _ay26sgrd_entries e');
  lines.push('join section_students ss on ss.id = e.section_student_id::uuid');
  lines.push('join sections sec on sec.id = ss.section_id');
  lines.push(
    `join academic_years ay on ay.id = sec.academic_year_id and ay.ay_code = ${sqlString(ayCode)}`
  );
  lines.push(
    `join terms t on t.academic_year_id = ay.id and t.term_number = ${termNumber}`
  );
  lines.push('join subjects sub on sub.code = e.subject_code');
  lines.push(
    'join grading_sheets gs on gs.term_id = t.id and gs.section_id = sec.id and gs.subject_id = sub.id'
  );
  lines.push("where e.subject_code <> '__NONE__'");
  lines.push('on conflict (grading_sheet_id, section_student_id) do nothing;');
  lines.push('');
  lines.push('commit;');
  lines.push('');
  lines.push('-- === post-commit verification ===');
  lines.push(
    `select count(*) as grading_sheets_rows from grading_sheets gs join terms t on t.id=gs.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber};`
  );
  lines.push(
    `select count(*) as grade_entries_rows from grade_entries ge join grading_sheets gs on gs.id=ge.grading_sheet_id join terms t on t.id=gs.term_id join academic_years ay on ay.id=t.academic_year_id where ay.ay_code=${sqlString(ayCode)} and t.term_number=${termNumber};`
  );
  lines.push(
    `select code, ww_weight, pt_weight, qa_weight, weights_confirmed from subject_configs sc join academic_years ay on ay.id=sc.academic_year_id join subjects sub on sub.id=sc.subject_id where ay.ay_code=${sqlString(ayCode)} and sub.code in (${subjectConfigWeights.map((w) => sqlString(w.subjectCode)).join(', ') || "'__NONE__'"});`
  );
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/backfill/grading/build-secondary-grading-import.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/grading/build-secondary-grading-import.ts __tests__/sis/backfill/grading/build-secondary-grading-import.test.ts
git commit -m "feat(backfill): compose AY2026 T2 Secondary grading import SQL"
```

---

### Task 5: Orchestrator script + gitignore

**Files:**

- Create: `scripts/backfill/gen-ay2026-t2-secondary-grading.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `parseGradingWorkbookSecondaryT2` (Task 2), `parseGradingWorkbookGlobalT2` (Task 3), `buildSecondaryGradingImport` + `RosterLookupEntry` + `SubjectConfigWeight` (Task 4), `createServiceClient` from `@/lib/supabase/service` (existing).
- Produces: nothing consumed by later tasks. Writes `scripts/backfill/ay2026-t2-secondary-grading-preview.sql` and `scripts/backfill/ay2026-t2-secondary-grading-apply.sql`.

- [ ] **Step 1: Implement the orchestrator**

Create `scripts/backfill/gen-ay2026-t2-secondary-grading.ts`:

```ts
// scripts/backfill/gen-ay2026-t2-secondary-grading.ts
// Generates ay2026-t2-secondary-grading-{preview,apply}.sql from HFSE's
// real T2 Secondary grading workbooks — Regular track ("GRADES/" folder)
// and Global track ("Lower Secondary Global Grading Sheets/" folder).
// Emits SQL for review — does NOT write to the database itself. See:
// docs/superpowers/specs/2026-07-19-ay2026-t2-secondary-grading-import-design.md
//
// Run: npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-secondary-grading.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServiceClient } from '../../lib/supabase/service';
import { parseGradingWorkbookSecondaryT2 } from '../../lib/sis/backfill/grading/grading-workbook-secondary-t2';
import { parseGradingWorkbookGlobalT2 } from '../../lib/sis/backfill/grading/grading-workbook-global-t2';
import { buildSecondaryGradingImport } from '../../lib/sis/backfill/grading/build-secondary-grading-import';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '../../lib/sis/backfill/grading/build-secondary-grading-import';
import type { ParsedSubjectSheet } from '../../lib/sis/backfill/grading/grading-workbook';

const AY_CODE = 'AY2026';
const TERM_NUMBER = 2;

// --- Regular track: "GRADES/" folder ---
// Never Filipino (its S1-S4 tabs are structurally incomplete — see design
// doc §2 Locked Decision #1), never Mandarin or STAR/MAPEH (no Secondary
// tabs exist in either file at all), never CCA (activity-rostered, not
// section-rostered — see design doc §1 point 3, out of scope this phase).
const REGULAR_DIR = 'AY2026/T2/Term 2 Grades/GRADES';
const REGULAR_SUBJECT_FILES: { file: string; subjectCode: string }[] = [
  { file: 'Math Grading AY2026 T2.xlsx', subjectCode: 'MATH' },
  { file: 'English Grading AY2026 T2.xlsx', subjectCode: 'ENG' },
  { file: 'Science Grading AY2026 T2.xlsx', subjectCode: 'SCI' },
  { file: 'Literature Grading AY2026 T2.xlsx', subjectCode: 'LIT' },
  { file: 'History Grading AY2026 T2.xlsx', subjectCode: 'HIST' }, // S1/S2 only, per the real file
  { file: 'SS & Geo Grading AY2026 T2.xlsx', subjectCode: 'SS' }, // S3/S4 only, per the real file
  { file: 'Contemporary Arts Grading AY2026 T2.xlsx', subjectCode: 'CA' },
  { file: 'PE (Sec) Grading AY2026 T2.xlsx', subjectCode: 'PEH' },
];

// --- Global track: "Lower Secondary Global Grading Sheets/" folder ---
// Explicit file list — never a directory glob. "Copy of English/Science/
// Mathematics..." are corrupted duplicates (same standing exclusion
// policy as every prior phase) and must never be read.
const GLOBAL_DIR =
  'AY2026/T2/Term 2 Grades/Lower Secondary Global Grading Sheets';
const GLOBAL_SUBJECT_FILES: { file: string; subjectCode: string }[] = [
  {
    file: 'Art and Design Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'ARTD',
  },
  {
    file: 'Computing Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'COMP',
  },
  {
    file: 'English Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'ENG',
  },
  {
    file: 'Global Perspectives Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'GP',
  },
  {
    file: 'Humanities Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'HUM',
  },
  {
    file: 'Mathematics Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'MATH',
  },
  {
    file: 'PE and Health Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'PEH',
  },
  {
    file: 'Science Grading Sheet Global Class AY2026 T2.xlsx',
    subjectCode: 'SCI',
  },
];

// Hand-verified during design (docs/superpowers/specs/2026-07-19-ay2026-t2-secondary-grading-import-design.md
// §2 Locked Decision #5): every relevant subject is already correct and
// already weights_confirmed=true. Empty on purpose — NOT derived at
// generation time, and NOT simply omitted from the composer call (the
// composer must correctly handle this empty-but-real input, per Task 4).
const SUBJECT_CONFIG_WEIGHTS: SubjectConfigWeight[] = [];

function buildNotesSection(
  heading: string,
  docPointer: string,
  notes: string[]
): string {
  const lines: string[] = [];
  lines.push('--');
  lines.push(`-- ${heading} (${notes.length}):`);
  lines.push(`-- (${docPointer})`);
  if (notes.length === 0) lines.push('--   (none)');
  for (const n of notes) lines.push(`--   ${n}`);
  return lines.join('\n') + '\n';
}

async function main() {
  const svc = createServiceClient();

  let sheets: ParsedSubjectSheet[] = [];
  let allIdentityCorrections: string[] = [];
  let allTruncationNotes: string[] = [];

  // 1. Regular track.
  for (const { file, subjectCode } of REGULAR_SUBJECT_FILES) {
    const result = parseGradingWorkbookSecondaryT2(
      join(REGULAR_DIR, file),
      subjectCode
    );
    sheets = sheets.concat(result.sheets);
    allIdentityCorrections = allIdentityCorrections.concat(
      result.identityCorrections
    );
    allTruncationNotes = allTruncationNotes.concat(result.truncationNotes);
    console.log(
      `[Regular] ${file}: ${result.sheets.length} Secondary sheet(s), skipped ${result.skippedPrimary.length} Primary + ${result.skippedUnrecognized.length} unrecognized, ${result.identityCorrections.length} correction(s), ${result.truncationNotes.length} truncation(s)`
    );
  }

  // 2. Global track.
  for (const { file, subjectCode } of GLOBAL_SUBJECT_FILES) {
    const result = parseGradingWorkbookGlobalT2(
      join(GLOBAL_DIR, file),
      subjectCode
    );
    sheets = sheets.concat(result.sheets);
    allIdentityCorrections = allIdentityCorrections.concat(
      result.identityCorrections
    );
    allTruncationNotes = allTruncationNotes.concat(result.truncationNotes);
    console.log(
      `[Global] ${file}: ${result.sheets.length} Secondary sheet(s), skipped ${result.skippedDoNotUse.length} DO-NOT-USE + ${result.skippedUnrecognized.length} unrecognized, ${result.identityCorrections.length} correction(s), ${result.truncationNotes.length} truncation(s)`
    );
  }

  // 3. Build the roster lookup for AY2026's Secondary sections.
  const { data: ay, error: ayErr } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  if (ayErr) throw ayErr;

  const { data: rows, error: rowsErr } = await svc
    .from('section_students')
    .select(
      'id, index_number, sections!inner(name, academic_year_id, levels!inner(code, level_type))'
    )
    .eq('sections.academic_year_id', (ay as any).id)
    .eq('sections.levels.level_type', 'secondary');
  if (rowsErr) throw rowsErr;

  const rosterLookup: RosterLookupEntry[] = (rows ?? []).map((r: any) => ({
    levelCode: r.sections.levels.code,
    sectionName: r.sections.name,
    indexNumber: r.index_number,
    sectionStudentId: r.id,
  }));

  // 4. Compose.
  const result = buildSecondaryGradingImport({
    sheets,
    rosterLookup,
    subjectConfigWeights: SUBJECT_CONFIG_WEIGHTS,
    ayCode: AY_CODE,
    termNumber: TERM_NUMBER,
  });

  const finalPreview =
    result.preview +
    '\n' +
    buildNotesSection(
      'Identity corrections — tab name overrode a conflicting row 2 label',
      'see design doc §1 point 2 for why row 2 alone is not trustworthy',
      allIdentityCorrections
    ) +
    '\n' +
    buildNotesSection(
      "Tab name truncated — row 2's fuller label used instead",
      'see design doc §1 point 2 for the Excel 31-char sheet-name limit case',
      allTruncationNotes
    );

  writeFileSync(
    'scripts/backfill/ay2026-t2-secondary-grading-preview.sql',
    finalPreview
  );
  writeFileSync(
    'scripts/backfill/ay2026-t2-secondary-grading-apply.sql',
    result.apply
  );

  console.log('Stats:', JSON.stringify(result.stats, null, 2));
  console.log(
    `Identity corrections: ${allIdentityCorrections.length}, truncation notes: ${allTruncationNotes.length}`
  );
  console.log('Wrote scripts/backfill/ay2026-t2-secondary-grading-preview.sql');
  console.log('Wrote scripts/backfill/ay2026-t2-secondary-grading-apply.sql');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 2: Add the gitignore entry**

Modify `.gitignore` — add after the existing `scripts/backfill/ay2026-t2-primary-grading-*.sql` line:

```

# AY2026 T2 Secondary grading import output (real student PII — names,
# scores). Generated by gen-ay2026-t2-secondary-grading.ts; review
# locally, never commit.
scripts/backfill/ay2026-t2-secondary-grading-*.sql
```

- [ ] **Step 3: Run the full backfill test suite to confirm no regression**

Run: `npx vitest run __tests__/sis/backfill/`
Expected: PASS — every prior phase's test plus the new tests from Tasks 1–4 (7 + 4 + 3 + 5 = 19 new), all green.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill/gen-ay2026-t2-secondary-grading.ts .gitignore
git commit -m "feat(backfill): add AY2026 T2 Secondary grading import orchestrator"
```

- [ ] **Step 5: Run the generator for real and read the stats**

Run: `npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t2-secondary-grading.ts`
Expected: prints a per-file line for all 16 files (8 Regular + 8 Global), then a `Stats:` block with `subjectConfigsWritten: 0` (matching the design's verified expectation — if this is ever non-zero, stop and investigate before running apply.sql, per the design doc's validation plan), `gradingSheetsWritten` and `gradeEntriesWritten` at a scale comparable to Phase 6a's Primary run, `needsReview` and `quarterlyMismatches` near 0. Read `scripts/backfill/ay2026-t2-secondary-grading-preview.sql` in full and hand-verify: (1) the truncation-notes section shows the expected SS & Geo / Contemporary Arts cases resolving to their full correct section names; (2) the identity-corrections section's entries look like genuine tab-name-wins cases, not a regex misfire; (3) no subject reports a real `subject_configs` correction (if one appears, it means a real weight discrepancy this design didn't anticipate, and must be investigated before proceeding).

---

## Self-review notes (fixed inline before handoff)

- **Spec coverage:** design doc §2 Locked Decisions 1–10 are each implemented — scope (Task 5's `REGULAR_SUBJECT_FILES`/`GLOBAL_SUBJECT_FILES`, CCA/Filipino/Mandarin/STAR exclusion documented inline), CCA out of scope (never referenced anywhere in this plan), shared module extraction with Phase 6a's behavior preserved (Task 1, whose own acceptance test IS Phase 6a's existing suite), the truncation-aware identity rule (Task 1, tested against both real truncation cases and both real "not a truncation" cases to prove the heuristic doesn't over-fire), zero-corrections `subject_configs` handling that still correctly accepts and processes an empty list (Task 4, explicitly tested), no `subject_level_offerings`/`section_subjects` writes (absent from Task 4's SQL, same as Phase 6a), locked/single-file/idempotent SQL (Task 4, same shape as Phase 6a). §3's architecture diagram and §4's SQL write plan map 1:1 onto Tasks 1–5. §5's validation plan is Task 5 Step 5. §6's testing section is satisfied by Task 1's Phase-6a-regression gate plus each new file's dedicated tests.
- **Placeholder scan:** none found — every step has complete, runnable code.
- **Type consistency:** `IdentityT2`, `resolveIdentity`'s three-field return shape (`identity`/`correctionNote`/`truncationNote`), and every row-layout constant are defined once in Task 1's `t2-masthead.ts` and imported identically (never redefined) by Tasks 2 and 3's parsers and by the refactored Phase 6a file. `ParsedSubjectSheet`/`GradingStudentRow` field names are imported as types from Phase 3's `grading-workbook.ts` (never redefined) and used identically across every parser and the composer. `RosterLookupEntry`/`SubjectConfigWeight` field names in Task 4 match Phase 6a's shape exactly (`subjectCode`/`wwWeight`/`ptWeight`/`qaWeight`/`levelCode`/`sectionName`/`indexNumber`/`sectionStudentId`) — verified consistent across the test file, the implementation, and Task 5's orchestrator usage.
