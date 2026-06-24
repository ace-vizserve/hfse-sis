# AY2025 Grades Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill AY2025's issued grades from the masterfile into production so T1–T4 report cards + the Academic Summary render complete, without importing the WW/PT/QA grading workbooks.

**Architecture:** Pure parsing/mapping libs under `lib/sis/backfill/grades/` (workbook → grade cells; column→DB-subject map; letter→representative numeric; name→canonical-enrolee), driven by a one-off `scripts/backfill/ay2025-grades.ts` runner with `dry-run` (read + report, no writes) and `apply` (write `subject_configs` → `grading_sheets` → `grade_entries`) modes. The masterfile is the sole source; a blank cell = "not taken". Annual/Overall/awards derive and cross-check against the masterfile.

**Tech Stack:** TypeScript run via `npx tsx --env-file=.env.local`; `xlsx` (SheetJS) for workbook parsing; `@supabase/supabase-js` service client (`lib/supabase/service.ts`); Vitest for the pure libs; `lib/compute/letter-grade.ts` (`numericToLetter`), `lib/compute/annual.ts` (`computeAnnualGrade`/`computeGeneralAverage`), `lib/compute/awards.ts` for verification.

## Global Constraints

- **Masterfile-only.** No grading-workbook (component) import. Spec: `docs/superpowers/specs/2026-06-24-ay2025-grades-backfill-design.md`.
- **`grade_entries.quarterly_grade` is `smallint`** — store integers only.
- **`subject_configs` CHECK:** `ww_weight + pt_weight + qa_weight = 1.00` — placeholder weights must sum to 1 (use `0.30 / 0.50 / 0.20`).
- **Natural keys (idempotent upserts):** `subject_configs (academic_year_id, subject_id, level_id)`; `grading_sheets (term_id, section_id, subject_id)`; `grade_entries (grading_sheet_id, section_student_id)`.
- **Non-examinable letters** render via `numericToLetter` (A≥90 / B≥85 / C≥80 / IP<80) from a stored numeric — store a band-representative integer; the numeric is never displayed.
- **Held-52 DIFF_SN dups skip** (not in roster). **Sheets `is_locked=true`.** **AY = `AY2025`.**
- **No writes until the `dry-run` report is reviewed.** All unmapped columns / unmatched students / award mismatches are listed, never silently dropped.

---

### Task 1: Subject-column → DB-subject map

**Files:**

- Create: `lib/sis/backfill/grades/subject-map.ts`
- Test: `__tests__/sis/backfill/grades/subject-map.test.ts`

**Interfaces:**

- Produces: `type SubjectMapEntry = { code: string; examinable: boolean }` and `mapSubjectColumn(label: string): SubjectMapEntry | null`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/sis/backfill/grades/subject-map.test.ts
import { describe, it, expect } from 'vitest';
import { mapSubjectColumn } from '@/lib/sis/backfill/grades/subject-map';

describe('mapSubjectColumn', () => {
  it('maps examinable columns to codes', () => {
    expect(mapSubjectColumn('ENGLISH')).toEqual({
      code: 'ENG',
      examinable: true,
    });
    expect(mapSubjectColumn('Social Studies')).toEqual({
      code: 'SS',
      examinable: true,
    });
    expect(mapSubjectColumn('MATHEMATICS')).toEqual({
      code: 'MATH',
      examinable: true,
    });
    expect(mapSubjectColumn('HUMANITIES')).toEqual({
      code: 'HUM',
      examinable: true,
    });
  });
  it('maps non-examinable columns', () => {
    expect(mapSubjectColumn('MUSIC EDUCATION')).toEqual({
      code: 'MUSIC',
      examinable: false,
    });
    expect(mapSubjectColumn('PHYSICAL EDUCATION AND HEALTH')).toEqual({
      code: 'PEH',
      examinable: false,
    });
    expect(mapSubjectColumn('CONTEMPORARY ART')).toEqual({
      code: 'CA',
      examinable: false,
    });
  });
  it('is case/space insensitive and flags unmapped', () => {
    expect(mapSubjectColumn('  english ')).toEqual({
      code: 'ENG',
      examinable: true,
    });
    expect(mapSubjectColumn('OVERALL ACADEMIC AWARD')).toBeNull();
    expect(mapSubjectColumn('ATTENDANCE')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run __tests__/sis/backfill/grades/subject-map.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/sis/backfill/grades/subject-map.ts
export type SubjectMapEntry = { code: string; examinable: boolean };

// Masterfile subject-column label (UPPERCASE) → DB subjects.code. Clean 1:1.
const MAP: Record<string, SubjectMapEntry> = {
  ENGLISH: { code: 'ENG', examinable: true },
  MATH: { code: 'MATH', examinable: true },
  MATHEMATICS: { code: 'MATH', examinable: true },
  'MOTHER TONGUE': { code: 'MT', examinable: true },
  SCIENCE: { code: 'SCI', examinable: true },
  'SOCIAL STUDIES': { code: 'SS', examinable: true },
  HISTORY: { code: 'HIST', examinable: true },
  LITERATURE: { code: 'LIT', examinable: true },
  HUMANITIES: { code: 'HUM', examinable: true },
  ECONOMICS: { code: 'ECON', examinable: true },
  'MUSIC EDUCATION': { code: 'MUSIC', examinable: false },
  'ARTS EDUCATION': { code: 'ARTS', examinable: false },
  'PHYSICAL EDUCATION': { code: 'PE', examinable: false },
  'HEALTH EDUCATION': { code: 'HE', examinable: false },
  'CONTEMPORARY ART': { code: 'CA', examinable: false },
  'PHYSICAL EDUCATION AND HEALTH': { code: 'PEH', examinable: false },
};

export function mapSubjectColumn(label: string): SubjectMapEntry | null {
  return MAP[label.trim().toUpperCase()] ?? null;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run __tests__/sis/backfill/grades/subject-map.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/grades/subject-map.ts __tests__/sis/backfill/grades/subject-map.test.ts
git commit -m "feat(ay2025-grades): masterfile subject-column → DB subject map"
```

---

### Task 2: Letter → band-representative numeric

**Files:**

- Create: `lib/sis/backfill/grades/representative-numeric.ts`
- Test: `__tests__/sis/backfill/grades/representative-numeric.test.ts`

**Interfaces:**

- Consumes: `numericToLetter` from `lib/compute/letter-grade.ts`.
- Produces: `letterToRepresentative(letter: string): number | null` — returns an integer that `numericToLetter` maps back to the same letter.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/sis/backfill/grades/representative-numeric.test.ts
import { describe, it, expect } from 'vitest';
import { letterToRepresentative } from '@/lib/sis/backfill/grades/representative-numeric';
import { numericToLetter } from '@/lib/compute/letter-grade';

describe('letterToRepresentative', () => {
  it('round-trips every derived letter through numericToLetter', () => {
    for (const L of ['A', 'B', 'C', 'IP'] as const) {
      const n = letterToRepresentative(L);
      expect(n).not.toBeNull();
      expect(Number.isInteger(n)).toBe(true);
      expect(numericToLetter(n as number)).toBe(L);
    }
  });
  it('is case-insensitive and returns null for unknown', () => {
    expect(letterToRepresentative('a')).toBe(letterToRepresentative('A'));
    expect(letterToRepresentative('Z')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run __tests__/sis/backfill/grades/representative-numeric.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// lib/sis/backfill/grades/representative-numeric.ts
// A non-exam masterfile cell is a letter; the report card derives the letter
// from a numeric (numericToLetter: A>=90, B>=85, C>=80, IP<80). Store a mid-band
// integer so the derived letter matches. The numeric itself is never displayed.
const BAND: Record<string, number> = { A: 95, B: 87, C: 82, IP: 70 };

export function letterToRepresentative(letter: string): number | null {
  return BAND[letter.trim().toUpperCase()] ?? null;
}
```

- [ ] **Step 4: Run it, verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/grades/representative-numeric.ts __tests__/sis/backfill/grades/representative-numeric.test.ts
git commit -m "feat(ay2025-grades): letter → band-representative numeric (round-trips numericToLetter)"
```

---

### Task 3: Masterfile grade parser

**Files:**

- Create: `lib/sis/backfill/grades/masterfile-grades.ts`
- Test: `__tests__/sis/backfill/grades/masterfile-grades.test.ts`

**Interfaces:**

- Consumes: `mapSubjectColumn` (Task 1); `xlsx`.
- Produces:

  ```ts
  export type GradeCell = {
    name: string;
    level: string;
    sectionClass: string;
    status: string;
    subjectCode: string;
    examinable: boolean;
    term: 1 | 2 | 3 | 4;
    kind: 'numeric' | 'letter' | 'na';
    numeric: number | null; // examinable quarterly (integer) or null
    letter: string | null; // non-exam letter (A/B/C/IP) or null
    overall: number | null; // examinable Overall (for cross-check) or null
    award: string | null; // examinable Award text or null
  };
  export function parseMasterfileGrades(filePath: string): GradeCell[];
  ```

  Contract: one `GradeCell` per (student × mapped-subject-column × term) **where the term cell is non-empty**. Examinable blocks are 6 columns (`Term 1..Term 4`, `Overall`, `Remarks`); non-exam blocks are 4 (`Term 1..Term 4`). The subject-header row is the row containing `ENGLISH` at/after column 6; data rows are those whose column 0 is a number and column 1 (name) non-empty (mirrors the FCA parser). `N.A.`/`NA` cells → `kind:'na'`.

- [ ] **Step 1: Write the failing test** (real fixtures — the AY2025 workbooks already in the repo root, gitignored)

```ts
// __tests__/sis/backfill/grades/masterfile-grades.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseMasterfileGrades } from '@/lib/sis/backfill/grades/masterfile-grades';

const PRIMARY = 'AY2025 Final Report Book_Primary.xlsx';
const d = existsSync(PRIMARY) ? describe : describe.skip; // fixture is local/gitignored

d('parseMasterfileGrades (primary)', () => {
  const cells = parseMasterfileGrades(PRIMARY);
  it('emits examinable + non-exam cells with the right kinds', () => {
    const david = cells.filter((c) => c.name.startsWith('ASPIRAS, David'));
    const engT1 = david.find((c) => c.subjectCode === 'ENG' && c.term === 1);
    expect(engT1).toMatchObject({
      examinable: true,
      kind: 'numeric',
      numeric: 93,
    });
    expect(engT1!.overall).toBe(93.8);
    const musicT1 = david.find(
      (c) => c.subjectCode === 'MUSIC' && c.term === 1
    );
    expect(musicT1).toMatchObject({
      examinable: false,
      kind: 'letter',
      letter: 'A',
    });
  });
  it('covers all four terms and never emits a blank cell', () => {
    const davidEng = cells.filter(
      (c) => c.name.startsWith('ASPIRAS, David') && c.subjectCode === 'ENG'
    );
    expect(davidEng.map((c) => c.term).sort()).toEqual([1, 2, 3, 4]);
    expect(
      cells.every(
        (c) => c.kind === 'na' || c.numeric !== null || c.letter !== null
      )
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL (module not found). (If the fixture is absent the suite skips — acceptable; CI runs the unit logic on Tasks 1–2/4.)

- [ ] **Step 3: Implement**

```ts
// lib/sis/backfill/grades/masterfile-grades.ts
import * as XLSX from 'xlsx';
import { mapSubjectColumn } from './subject-map';

export type GradeCell = {
  name: string;
  level: string;
  sectionClass: string;
  status: string;
  subjectCode: string;
  examinable: boolean;
  term: 1 | 2 | 3 | 4;
  kind: 'numeric' | 'letter' | 'na';
  numeric: number | null;
  letter: string | null;
  overall: number | null;
  award: string | null;
};

const LETTERS = new Set(['A', 'B', 'C', 'IP']);

export function parseMasterfileGrades(filePath: string): GradeCell[] {
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(
    wb.Sheets['Masterfile'],
    {
      header: 1,
      blankrows: false,
      defval: '',
    }
  );
  // subject-header row = the one with ENGLISH at/after col 6
  const hr = rows.findIndex((r) =>
    r.some((c, i) => i >= 6 && /ENGLISH/i.test(String(c ?? '')))
  );
  if (hr < 0) return [];
  const header = rows[hr];

  // Build column blocks: each non-empty header cell at col>=6 starts a subject.
  // examinable block width = 6 (T1-T4, Overall, Remarks); non-exam = 4 (T1-T4).
  type Block = {
    code: string;
    examinable: boolean;
    t: [number, number, number, number];
    overall: number | null;
  };
  const blocks: Block[] = [];
  for (let c = 6; c < header.length; c++) {
    const label = String(header[c] ?? '').trim();
    if (!label) continue;
    const m = mapSubjectColumn(label);
    if (!m) continue; // OVERALL ACADEMIC AWARD / ATTENDANCE / TEACHER'S COMMENTS skipped
    blocks.push({
      code: m.code,
      examinable: m.examinable,
      t: [c, c + 1, c + 2, c + 3],
      overall: m.examinable ? c + 4 : null,
    });
  }

  const out: GradeCell[] = [];
  for (const r of rows) {
    if (typeof r[0] !== 'number' || !r[1]) continue; // data rows only
    const name = String(r[1]).trim();
    const level = String(r[2] ?? '').trim();
    const sectionClass = String(r[3] ?? '').trim();
    const status = String(r[5] ?? '').trim();
    for (const b of blocks) {
      const overall =
        b.overall != null && typeof r[b.overall] === 'number'
          ? (r[b.overall] as number)
          : null;
      const award =
        b.overall != null
          ? String(r[b.overall + 1] ?? '').trim() || null
          : null;
      b.t.forEach((col, i) => {
        const raw = r[col];
        const sraw = String(raw ?? '').trim();
        if (sraw === '') return; // blank = not taken
        const term = (i + 1) as 1 | 2 | 3 | 4;
        if (/^n\.?a\.?$/i.test(sraw)) {
          out.push({
            name,
            level,
            sectionClass,
            status,
            subjectCode: b.code,
            examinable: b.examinable,
            term,
            kind: 'na',
            numeric: null,
            letter: null,
            overall,
            award,
          });
        } else if (b.examinable && typeof raw === 'number') {
          out.push({
            name,
            level,
            sectionClass,
            status,
            subjectCode: b.code,
            examinable: true,
            term,
            kind: 'numeric',
            numeric: Math.round(raw),
            letter: null,
            overall,
            award,
          });
        } else if (!b.examinable && LETTERS.has(sraw.toUpperCase())) {
          out.push({
            name,
            level,
            sectionClass,
            status,
            subjectCode: b.code,
            examinable: false,
            term,
            kind: 'letter',
            numeric: null,
            letter: sraw.toUpperCase(),
            overall: null,
            award: null,
          });
        }
        // anything else (stray text) is skipped; surfaced via dry-run counts vs roster
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run __tests__/sis/backfill/grades/masterfile-grades.test.ts` → PASS (or SKIP if fixture absent).

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/grades/masterfile-grades.ts __tests__/sis/backfill/grades/masterfile-grades.test.ts
git commit -m "feat(ay2025-grades): masterfile grade-cell parser (per student×subject×term)"
```

---

### Task 4: Name → canonical-enrolee matcher (reconciliation)

**Files:**

- Create: `lib/sis/backfill/grades/reconcile-match.ts`
- Test: `__tests__/sis/backfill/grades/reconcile-match.test.ts`

**Interfaces:**

- Produces: `buildNameToEnrolee(csvText: string): Map<string, { enrolee: string; dup: string }>` — keyed by the exact `Student Name (sheet)`, value `{ canonical enrolee, dup flag }`. (Quote-aware CSV parse, ported from the FCA pass.)

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/sis/backfill/grades/reconcile-match.test.ts
import { describe, it, expect } from 'vitest';
import { buildNameToEnrolee } from '@/lib/sis/backfill/grades/reconcile-match';

const CSV = [
  'Band,Index,Level,Class (section),Student Name (sheet),Sheet Status,Target Status,Match Method,Confidence,# Apps,Dup Flag,Enrolee No(s),Student No(s),Canonical Enrolee',
  'Primary,1,Primary One,Patience - Global,"ASPIRAS, David Ray M.",Active,Enrolled,structured,high,1,NONE,E250689,H250689,E250689',
  'Primary,2,Primary One,Patience - Global,"DOMINGO, Gio Lucas P.",Active,Enrolled,structured,high,1,DIFF_SN,E250695,H250695,E250695',
].join('\n');

describe('buildNameToEnrolee', () => {
  it('maps the sheet name to the canonical enrolee + dup flag', () => {
    const m = buildNameToEnrolee(CSV);
    expect(m.get('ASPIRAS, David Ray M.')).toEqual({
      enrolee: 'E250689',
      dup: 'NONE',
    });
    expect(m.get('DOMINGO, Gio Lucas P.')).toEqual({
      enrolee: 'E250695',
      dup: 'DIFF_SN',
    });
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement**

```ts
// lib/sis/backfill/grades/reconcile-match.ts
// Quote-aware CSV parse (handles the quoted "LAST, First" name field).
function parseCSV(txt: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) {
      if (ch === '"') {
        if (txt[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\r') {
      /* skip */
    } else if (ch === '\n') {
      row.push(cur);
      out.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    out.push(row);
  }
  return out;
}

export function buildNameToEnrolee(
  csvText: string
): Map<string, { enrolee: string; dup: string }> {
  const rows = parseCSV(csvText);
  const H = rows[0];
  const iName = H.indexOf('Student Name (sheet)');
  const iCanon = H.indexOf('Canonical Enrolee');
  const iDup = H.indexOf('Dup Flag');
  const m = new Map<string, { enrolee: string; dup: string }>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[iName]) continue;
    m.set(r[iName].trim(), {
      enrolee: (r[iCanon] ?? '').trim(),
      dup: (r[iDup] ?? '').trim(),
    });
  }
  return m;
}
```

- [ ] **Step 4: Run it, verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sis/backfill/grades/reconcile-match.ts __tests__/sis/backfill/grades/reconcile-match.test.ts
git commit -m "feat(ay2025-grades): reconciliation name → canonical-enrolee matcher"
```

---

### Task 5: Importer runner — `dry-run` (read + report, zero writes)

**Files:**

- Create: `scripts/backfill/ay2025-grades.ts`
- (No unit test — this is the integration entrypoint; verified by running it.)

**Interfaces:**

- Consumes: `parseMasterfileGrades`, `mapSubjectColumn`, `letterToRepresentative`, `buildNameToEnrolee`; `createServiceClient` (`lib/supabase/service.ts`); `computeAnnualGrade`, `computeGeneralAverage` (`lib/compute/annual.ts`).
- Produces: a runner with `--mode=dry-run|apply`. Dry-run resolves the live AY2025 sections/terms/subjects/section_students, plans every write, runs the verification, and prints a report. Writes nothing.

- [ ] **Step 1: Implement the dry-run path**

```ts
// scripts/backfill/ay2025-grades.ts
import { createServiceClient } from '@/lib/supabase/service';
import { readFileSync } from 'node:fs';
import {
  parseMasterfileGrades,
  type GradeCell,
} from '@/lib/sis/backfill/grades/masterfile-grades';
import { letterToRepresentative } from '@/lib/sis/backfill/grades/representative-numeric';
import { buildNameToEnrolee } from '@/lib/sis/backfill/grades/reconcile-match';
import {
  computeAnnualGrade,
  computeGeneralAverage,
} from '@/lib/compute/annual';

const AY = 'AY2025';
const FILES = [
  'AY2025 Final Report Book_Primary.xlsx',
  'AY2025 Final Report Book_Secondary.xlsx',
];
const RECON = 'AY2025 Reconciliation.csv';
const mode = (process.argv
  .find((a) => a.startsWith('--mode='))
  ?.split('=')[1] ?? 'dry-run') as 'dry-run' | 'apply';

type Resolved = {
  cell: GradeCell;
  enrolee: string;
  sectionStudentId: string;
  sectionId: string;
  subjectId: string;
  termId: string;
  storedNumeric: number | null; // smallint to store, or null when is_na
  isNa: boolean;
};

async function main() {
  const svc = createServiceClient();

  // 1) live reference data for AY2025
  const { data: ay } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY)
    .single();
  const ayId = ay!.id;
  const { data: terms } = await svc
    .from('terms')
    .select('id, term_number')
    .eq('academic_year_id', ayId);
  const termByNum = new Map(
    (terms ?? []).map((t) => [t.term_number as number, t.id as string])
  );
  const { data: subjects } = await svc
    .from('subjects')
    .select('id, code, is_examinable');
  const subjectByCode = new Map(
    (subjects ?? []).map((s) => [s.code as string, s])
  );
  // sections + roster (enrolee_number → {sectionStudentId, sectionId})
  const { data: ss } = await svc
    .from('section_students')
    .select(
      'id, enrolee_number, sections!inner(id, name, academic_year_id, levels!inner(code))'
    )
    .eq('sections.academic_year_id', ayId)
    .neq('enrollment_status', 'withdrawn'); // primary active row; transfers handled below if needed
  const rosterByEnrolee = new Map<
    string,
    { sectionStudentId: string; sectionId: string }
  >();
  for (const r of ss ?? []) {
    if (!r.enrolee_number) continue;
    const sec = Array.isArray(r.sections) ? r.sections[0] : r.sections;
    rosterByEnrolee.set(r.enrolee_number as string, {
      sectionStudentId: r.id as string,
      sectionId: sec.id as string,
    });
  }

  // 2) parse masterfiles + reconciliation
  const nameToEnrolee = buildNameToEnrolee(readFileSync(RECON, 'utf8'));
  const cells: GradeCell[] = FILES.flatMap((f) => parseMasterfileGrades(f));

  // 3) resolve each cell to ids + the value to store
  const resolved: Resolved[] = [];
  const unmatchedNames = new Set<string>();
  const unmappedSubjects = new Set<string>();
  const unresolvedRoster = new Set<string>();
  for (const cell of cells) {
    const rec = nameToEnrolee.get(cell.name);
    if (!rec || !rec.enrolee) {
      unmatchedNames.add(cell.name);
      continue;
    }
    const roster = rosterByEnrolee.get(rec.enrolee);
    if (!roster) {
      unresolvedRoster.add(rec.enrolee);
      continue;
    } // held-52 / unsynced
    const subject = subjectByCode.get(cell.subjectCode);
    if (!subject) {
      unmappedSubjects.add(cell.subjectCode);
      continue;
    }
    const termId = termByNum.get(cell.term);
    if (!termId) continue;
    let storedNumeric: number | null = null;
    let isNa = false;
    if (cell.kind === 'na') isNa = true;
    else if (cell.kind === 'numeric') storedNumeric = cell.numeric;
    else if (cell.kind === 'letter') {
      storedNumeric = letterToRepresentative(cell.letter!);
      if (storedNumeric == null) {
        unmappedSubjects.add(`${cell.subjectCode}:badletter:${cell.letter}`);
        continue;
      }
    }
    resolved.push({
      cell,
      enrolee: rec.enrolee,
      sectionStudentId: roster.sectionStudentId,
      sectionId: roster.sectionId,
      subjectId: subject.id,
      termId,
      storedNumeric,
      isNa,
    });
  }

  // 4) verification: derive Overall (annual) per (enrolee, subject) from the 4 stored terms, compare to masterfile Overall
  const byKey = new Map<string, { cells: GradeCell[]; examinable: boolean }>();
  for (const r of resolved) {
    const k = `${r.enrolee} ${r.cell.subjectCode}`;
    if (!byKey.has(k))
      byKey.set(k, { cells: [], examinable: r.cell.examinable });
    byKey.get(k)!.cells.push(r.cell);
  }
  const awardMismatches: string[] = [];
  for (const [k, g] of byKey) {
    if (!g.examinable) continue;
    const masterfileOverall =
      g.cells.find((c) => c.overall != null)?.overall ?? null;
    const terms4 = [1, 2, 3, 4].map(
      (t) => g.cells.find((c) => c.term === t)?.numeric ?? null
    );
    const derived = computeAnnualGrade(terms4 as (number | null)[]); // 2dp per lib/compute/annual.ts
    if (
      masterfileOverall != null &&
      derived != null &&
      Math.abs(derived - masterfileOverall) > 0.05
    ) {
      awardMismatches.push(
        `${k.replace(' ', '/')}: derived ${derived} vs masterfile ${masterfileOverall}`
      );
    }
  }

  // 5) report
  const sheets = new Set(
    resolved.map((r) => `${r.sectionId} ${r.subjectId} ${r.termId}`)
  );
  console.log(
    `[ay2025-grades:${mode}] cells parsed=${cells.length} resolved=${resolved.length}`
  );
  console.log(
    `  grading_sheets to ensure=${sheets.size}  grade_entries=${resolved.length}`
  );
  console.log(
    `  unmatched names=${unmatchedNames.size}  unresolved roster (held/unsynced)=${unresolvedRoster.size}  unmapped subjects=${[...unmappedSubjects].join(',') || 'none'}`
  );
  console.log(`  Overall cross-check mismatches=${awardMismatches.length}`);
  awardMismatches.slice(0, 40).forEach((m) => console.log('    ! ' + m));

  if (mode === 'dry-run') {
    console.log('DRY RUN — no writes.');
    return;
  }
  await apply(svc, ayId, resolved, subjectByCode);
}

// apply() defined in Task 6.
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the dry-run** (read-only)

Run: `npx tsx --env-file=.env.local scripts/backfill/ay2025-grades.ts --mode=dry-run`
Expected: a report with `resolved` ≈ (roster students × their subjects × 4 terms), `unresolved roster` ≈ the held-52, `unmapped subjects=none`, and `Overall cross-check mismatches` small (investigate any). **No writes.**

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill/ay2025-grades.ts
git commit -m "feat(ay2025-grades): dry-run importer (resolve, plan, verify, report)"
```

---

### Task 6: Importer runner — `apply` (write configs → sheets → entries)

**Files:**

- Modify: `scripts/backfill/ay2025-grades.ts` (add `apply()`)

**Interfaces:**

- Consumes: the `Resolved[]` + the live reference maps from Task 5.
- Produces: `async function apply(svc, ayId, resolved, subjectByCode)` — idempotent writes in dependency order.

- [ ] **Step 1: Implement `apply()`**

```ts
// append to scripts/backfill/ay2025-grades.ts
import type { SupabaseClient } from '@supabase/supabase-js';

async function apply(
  svc: SupabaseClient,
  ayId: string,
  resolved: Resolved[],
  subjectByCode: Map<
    string,
    { id: string; code: string; is_examinable: boolean }
  >
) {
  // A) subject_configs per (subject, level) — placeholder weights summing to 1.00.
  //    Resolve level_id per section once.
  const sectionLevel = new Map<string, string>(); // sectionId -> levelId
  const { data: secs } = await svc
    .from('sections')
    .select('id, level_id')
    .eq('academic_year_id', ayId);
  for (const s of secs ?? [])
    sectionLevel.set(s.id as string, s.level_id as string);

  const configKey = (subjectId: string, levelId: string) =>
    `${subjectId} ${levelId}`;
  const neededConfigs = new Map<
    string,
    { subjectId: string; levelId: string }
  >();
  for (const r of resolved) {
    const levelId = sectionLevel.get(r.sectionId)!;
    neededConfigs.set(configKey(r.subjectId, levelId), {
      subjectId: r.subjectId,
      levelId,
    });
  }
  for (const { subjectId, levelId } of neededConfigs.values()) {
    await svc
      .from('subject_configs')
      .upsert(
        {
          academic_year_id: ayId,
          subject_id: subjectId,
          level_id: levelId,
          ww_weight: 0.3,
          pt_weight: 0.5,
          qa_weight: 0.2,
        },
        {
          onConflict: 'academic_year_id,subject_id,level_id',
          ignoreDuplicates: true,
        }
      );
  }
  const { data: cfgs } = await svc
    .from('subject_configs')
    .select('id, subject_id, level_id')
    .eq('academic_year_id', ayId);
  const configId = new Map(
    (cfgs ?? []).map((c) => [
      configKey(c.subject_id as string, c.level_id as string),
      c.id as string,
    ])
  );

  // B) grading_sheets per (term, section, subject), is_locked=true, empty slots.
  const sheetKey = (termId: string, sectionId: string, subjectId: string) =>
    `${termId} ${sectionId} ${subjectId}`;
  const neededSheets = new Map<string, Resolved>();
  for (const r of resolved)
    neededSheets.set(sheetKey(r.termId, r.sectionId, r.subjectId), r);
  for (const r of neededSheets.values()) {
    const levelId = sectionLevel.get(r.sectionId)!;
    await svc.from('grading_sheets').upsert(
      {
        term_id: r.termId,
        section_id: r.sectionId,
        subject_id: r.subjectId,
        subject_config_id: configId.get(configKey(r.subjectId, levelId))!,
        ww_totals: [],
        pt_totals: [],
        qa_total: null,
        is_locked: true,
        locked_by: 'ay2025.backfill',
        locked_at: new Date('2025-11-14T12:00:00+08:00').toISOString(),
      },
      { onConflict: 'term_id,section_id,subject_id', ignoreDuplicates: true }
    );
  }
  const { data: sheets } = await svc
    .from('grading_sheets')
    .select(
      'id, term_id, section_id, subject_id, sections!inner(academic_year_id)'
    )
    .eq('sections.academic_year_id', ayId);
  const sheetId = new Map(
    (sheets ?? []).map((s) => [
      sheetKey(
        s.term_id as string,
        s.section_id as string,
        s.subject_id as string
      ),
      s.id as string,
    ])
  );

  // C) grade_entries per (grading_sheet, section_student). quarterly_grade smallint; is_na; empty component arrays.
  const entryRows = resolved.map((r) => ({
    grading_sheet_id: sheetId.get(
      sheetKey(r.termId, r.sectionId, r.subjectId)
    )!,
    section_student_id: r.sectionStudentId,
    ww_scores: [],
    pt_scores: [],
    qa_score: null,
    quarterly_grade: r.isNa ? null : r.storedNumeric,
    is_na: r.isNa,
  }));
  // chunked upsert (PostgREST payload limits)
  for (let i = 0; i < entryRows.length; i += 500) {
    const chunk = entryRows.slice(i, i + 500);
    const { error } = await svc
      .from('grade_entries')
      .upsert(chunk, { onConflict: 'grading_sheet_id,section_student_id' });
    if (error) throw new Error(`grade_entries chunk ${i}: ${error.message}`);
  }
  console.log(
    `[apply] subject_configs=${neededConfigs.size} grading_sheets=${neededSheets.size} grade_entries=${entryRows.length}`
  );
}
```

- [ ] **Step 2: Re-run dry-run, confirm the plan is unchanged** — `npx tsx --env-file=.env.local scripts/backfill/ay2025-grades.ts --mode=dry-run` (sanity).

- [ ] **Step 3: Apply** (writes to prod)

Run: `npx tsx --env-file=.env.local scripts/backfill/ay2025-grades.ts --mode=apply`
Expected: `[apply] subject_configs=N grading_sheets=M grade_entries=K`.

- [ ] **Step 4: Verify in the DB**

```sql
SELECT t.term_number, count(*)
FROM grade_entries ge
JOIN grading_sheets gs ON gs.id = ge.grading_sheet_id
JOIN sections s ON s.id = gs.section_id
JOIN academic_years a ON a.id = s.academic_year_id
JOIN terms t ON t.id = gs.term_id
WHERE a.ay_code = 'AY2025'
GROUP BY t.term_number ORDER BY 1;
```

Expected: four rows (T1–T4) with counts matching the apply log. Spot-check one student's report card renders the issued grades.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill/ay2025-grades.ts
git commit -m "feat(ay2025-grades): apply mode — configs → sheets → entries (idempotent)"
```

---

## Self-Review

- **Spec coverage:** masterfile-only (Tasks 3,5) · subject map incl. unmapped flagging (1) · examinable numeric + non-exam representative + N.A. (2,3,5) · non-empty-cell-only (3) · student match + held-52 skip (4,5) · scaffolding configs/sheets/entries with the real schema + natural keys (6) · annual/Overall cross-check (5) · dry-run→apply, no writes until reviewed (5,6) · sheets locked (6). ✓
- **Placeholder scan:** none — every step has runnable code/commands.
- **Type consistency:** `GradeCell` (Task 3) consumed in Task 5; `Resolved` defined Task 5, consumed Task 6; map/representative/match signatures match their call sites. ✓
- **Open items resolved:** schema/NOT-NULL/natural-keys (header + Tasks 5/6); representative-numeric chosen (2); column offsets (3, header-detected); match key = name→reconciliation (4); T4 non-exam uses derived annual via the four representative numerics — no `annual_letter_grade` written (consistent with the masterfile showing per-term letters, not "Passed"). ✓

## Notes for execution

- **Transfers:** the dry-run roster query takes the non-withdrawn `section_students` row per enrolee; if a student has none (pure-withdrawn) their grades fall to "unresolved roster" — review that list (expected ≈ held-52 only). If withdrawn students need cards, widen the query to include their withdrawn row.
- **`.env.local` must point at the same prod project** the SQL was run against (one shared project, KD #1). The dry-run is read-only — run it first and confirm the counts before `apply`.
- **Non-exam representative numeric** is a deliberate, never-displayed stand-in (Decision 4). If real non-exam numerics are ever wanted, layer the ~4 non-exam workbooks later — out of scope here.
