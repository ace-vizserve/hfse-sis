# Academic Summary — hub + quick-view child routes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/records/academic-summary` into a hub (the existing dashboard) with three deep-linkable quick-view child routes — Awards, Attendance, Comments — and demote the raw masterfile grid to an export-only "Generate Masterfile" artifact (.xlsx + .csv).

**Architecture:** Every page (hub + 3 children) reads ONE `loadMasterfile(...)` payload and derives its rows from shared, unit-tested pure functions that reuse the predicates already exported from `lib/markbook/masterfile-dashboard.ts` — so a child page's list can never drift from the hub's aggregate (count==drill, KD #124). Child pages are RSC that reuse a shared server scope-resolver + the existing `MasterfileToolbar` for AY/Level/Class scoping, with a new breadcrumb. No new API routes for the views (client-side derivation over the in-browser payload, KD #128); the only API change is a `?format=csv` branch on the existing export route.

**Tech Stack:** Next.js 16 (App Router, async `searchParams`), TypeScript, Tailwind v4 design tokens (`app/globals.css` only — Hard Rule #7), shadcn/ui, `@tanstack/react-table` via the unified `<DataTable>` shell (KD #84), `vitest`.

**Spec:** `docs/superpowers/specs/2026-06-07-academic-summary-quick-views-design.md`

---

## File structure

**Create:**
- `components/ui/breadcrumb.tsx` — shadcn breadcrumb primitive (installed).
- `lib/markbook/academic-summary-scope.ts` — shared server scope-resolver (AY / levels / payload) extracted from the hub page; used by hub + 3 children.
- `lib/markbook/academic-summary-views.ts` — pure derivation: `buildAwardsRows`, `buildAttendanceRows`, `buildCommentRows` + their row types + tier helpers.
- `app/(records)/records/academic-summary/awards/page.tsx`
- `app/(records)/records/academic-summary/attendance/page.tsx`
- `app/(records)/records/academic-summary/comments/page.tsx`
- `components/markbook/academic-summary/quick-view-header.tsx` — shared breadcrumb + heading + back-context for the 3 child pages.
- `components/markbook/academic-summary/awards-view.tsx` — client table + filters + export.
- `components/markbook/academic-summary/attendance-view.tsx`
- `components/markbook/academic-summary/comments-view.tsx`
- `__tests__/markbook/academic-summary-views.test.ts`

**Modify:**
- `lib/markbook/masterfile.ts` — add `lateEnrolleeTermNumber` to the row + resolve it; add `submitted` to `commentsByTerm` entries.
- `lib/markbook/masterfile-dashboard.ts` — add an `overview` aggregate (total/active/withdrawn/lateByTerm) to `computeMasterfileDashboard`.
- `components/markbook/masterfile-dashboard.tsx` — reorganize into Overview cards / Academic Performance / Quick Links / Actions, add Late-Enrollees card, retain watchlists.
- `components/markbook/masterfile-view.tsx` — remove Dashboard|Table toggle + grid; replace Export-to-Excel button with a "Generate Masterfile" dropdown (.xlsx / .csv).
- `app/(records)/records/academic-summary/page.tsx` — use the shared scope-resolver; update header copy (drop "Switch to Table").
- `app/api/markbook/masterfile/export/route.ts` — add `?format=csv`.
- `lib/auth/roles.ts` — `RECORDS_NAV`: convert the Academic-Summary section to a labelled group with Overview + Awards + Attendance + Comments.

**Delete:**
- `components/markbook/masterfile-grid.tsx` — no longer rendered on screen (export is server-side via `masterfile-export.ts`).

**No change needed:** `ROUTE_ACCESS` — the existing `{ prefix: '/records/academic-summary', allowed: [...] }` entry (roles.ts ~L702, longer-prefix-wins) already covers all child routes.

---

## Task 1: Install the breadcrumb primitive

**Files:**
- Create: `components/ui/breadcrumb.tsx`

- [ ] **Step 1: Install via shadcn MCP** (per project rule — install primitives, don't substitute)

Use the shadcn MCP tools: `mcp__shadcn__get_add_command_for_items` for item `@shadcn/breadcrumb`, then run the returned add command. Expected result: `components/ui/breadcrumb.tsx` created exporting `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator`.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no errors referencing breadcrumb).

- [ ] **Step 3: Commit**

```bash
git add components/ui/breadcrumb.tsx
git commit -m "feat(ui): add shadcn breadcrumb primitive"
```

---

## Task 2: Extend the masterfile loader (late-enrollee term + comment submitted flag)

**Files:**
- Modify: `lib/markbook/masterfile.ts`
- Test: `__tests__/markbook/masterfile-late-term.test.ts` (new, pure helper test)

The loader needs two additions both consumed by the new pages: the resolved late-enrollee joining term, and the FCA write-up `submitted` flag (for Submitted/Draft/Missing).

- [ ] **Step 1: Write a failing test for the pure term resolver**

Create `__tests__/markbook/masterfile-late-term.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveLateEnrolleeTerm } from '@/lib/markbook/masterfile';

const TERMS = [
  { termNumber: 1, startDate: '2026-01-06', endDate: '2026-03-13' },
  { termNumber: 2, startDate: '2026-03-30', endDate: '2026-05-29' },
  { termNumber: 3, startDate: '2026-06-29', endDate: '2026-09-04' },
  { termNumber: 4, startDate: '2026-09-21', endDate: '2026-11-20' },
];

describe('resolveLateEnrolleeTerm', () => {
  it('prefers the explicit override', () => {
    expect(resolveLateEnrolleeTerm(2, '2026-06-29', TERMS)).toBe(2);
  });
  it('derives from enrollment_date when no override (date inside T2)', () => {
    expect(resolveLateEnrolleeTerm(null, '2026-04-15', TERMS)).toBe(2);
  });
  it('derives the next term when date sits in a break', () => {
    // between T2 end and T3 start -> joins T3
    expect(resolveLateEnrolleeTerm(null, '2026-06-10', TERMS)).toBe(3);
  });
  it('returns null when no override and no date', () => {
    expect(resolveLateEnrolleeTerm(null, null, TERMS)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run __tests__/markbook/masterfile-late-term.test.ts`
Expected: FAIL — `resolveLateEnrolleeTerm` is not exported.

- [ ] **Step 3: Add the resolver + row field + loader wiring**

In `lib/markbook/masterfile.ts`:

(a) Export the pure resolver (date-only SGT comparison, KD #32 — string compare of `yyyy-MM-dd` is correct for ISO dates):

```ts
// Resolve a late enrollee's joining term: explicit override wins; else the
// term whose window contains enrollment_date; else the earliest term that
// starts after it (joined during a break -> next term); else null. KD #111/#68.
export function resolveLateEnrolleeTerm(
  override: number | null,
  enrollmentDate: string | null,
  terms: { termNumber: number; startDate: string | null; endDate: string | null }[]
): number | null {
  if (override != null) return override;
  if (!enrollmentDate) return null;
  const d = enrollmentDate.slice(0, 10);
  const sorted = terms
    .filter((t) => t.startDate && t.endDate)
    .slice()
    .sort((a, b) => a.termNumber - b.termNumber);
  for (const t of sorted) {
    if (d >= (t.startDate as string).slice(0, 10) && d <= (t.endDate as string).slice(0, 10)) {
      return t.termNumber;
    }
  }
  for (const t of sorted) {
    if (d < (t.startDate as string).slice(0, 10)) return t.termNumber;
  }
  return null;
}
```

(b) Add to `MasterfileStudentRow` (after `enrollmentStatus`):

```ts
  // Resolved joining term for late enrollees (override -> date-derived -> null).
  // null for active/withdrawn or when unresolvable. KD #111/#68.
  lateEnrolleeTermNumber: number | null;
```

(c) Change the `commentsByTerm` field type on `MasterfileStudentRow` from `{ termNumber: number; text: string }[]` to `{ termNumber: number; text: string; submitted: boolean }[]` (additive — existing consumers reading `termNumber`/`text` are unaffected).

(d) Extend the `section_students` select (currently `'id, section_id, enrollment_status, created_at, student:students(...)'`, ~L298) to add `late_enrollee_term_number, enrollment_date`; carry both onto each enrolment object built at ~L350 (e.g. `lateTermOverride: e.late_enrollee_term_number ?? null`, `enrollmentDate: e.enrollment_date ?? null`).

(e) Extend the write-up select (~L480) from `'student_id, term_id, writeup'` to `'student_id, term_id, writeup, submitted'`; change `commentsByStudent` value type to `Map<string, { text: string; submitted: boolean }>` and store `{ text, submitted: !!w.submitted }` (still skip empty `text`).

(f) When building each student row: set `lateEnrolleeTermNumber` from the `primary` enrolment —
```ts
lateEnrolleeTermNumber:
  primary.enrollmentStatus === 'late_enrollee'
    ? resolveLateEnrolleeTerm(primary.lateTermOverride, primary.enrollmentDate,
        terms.map((t) => ({ termNumber: t.term_number, startDate: t.start_date, endDate: t.end_date })))
    : null,
```
and build `commentsByTerm` entries as `{ termNumber, text, submitted }` from the extended map.

> Note: confirm the `terms` rows in scope carry `start_date`/`end_date` — the `.select('id, term_number, label')` at ~L201 does NOT. Widen it to `'id, term_number, label, start_date, end_date'`.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run __tests__/markbook/masterfile-late-term.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck the whole package (catches commentsByTerm consumers)**

Run: `npx tsc --noEmit`
Expected: PASS. If `masterfile-export.ts` or `masterfile-dashboard.ts` break on `commentsByTerm`, they only read `termNumber`/`text` — additive field shouldn't break them; fix any strict-typing fallout inline.

- [ ] **Step 6: Commit**

```bash
git add lib/markbook/masterfile.ts __tests__/markbook/masterfile-late-term.test.ts
git commit -m "feat(masterfile): resolve late-enrollee term + carry comment submitted flag"
```

---

## Task 3: Shared server scope-resolver

**Files:**
- Create: `lib/markbook/academic-summary-scope.ts`
- Modify: `app/(records)/records/academic-summary/page.tsx`

Extract the ~80 lines of AY/level/payload resolution from the hub page so all four pages share one implementation.

- [ ] **Step 1: Create the resolver**

`lib/markbook/academic-summary-scope.ts`:

```ts
import 'server-only';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { loadMasterfile, type MasterfilePayload } from '@/lib/markbook/masterfile';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export type AcademicSummaryScope = {
  ayCode: string;
  ayCodes: string[];
  levels: { id: string; label: string }[];
  selectedLevelId: string | null;
  selectedSectionId: string | null;
  payload: MasterfilePayload | null;
  /** true when no level has sections this AY (caller renders empty state). */
  empty: boolean;
};

export async function resolveAcademicSummaryScope(sp: {
  ay?: string;
  level?: string;
  class?: string;
}): Promise<AcademicSummaryScope> {
  const supabase = await createClient();
  const service = createServiceClient();
  const currentAyCode = await requireCurrentAyCode(service);

  let ayCode = currentAyCode;
  if (sp.ay && /^AY\d{4}$/.test(sp.ay)) {
    const { data } = await supabase
      .from('academic_years').select('ay_code').eq('ay_code', sp.ay).maybeSingle();
    if (data) ayCode = (data as { ay_code: string }).ay_code;
  }

  const { data: allAysRaw } = await supabase
    .from('academic_years').select('ay_code').order('ay_code', { ascending: false });
  const ayCodes = ((allAysRaw ?? []) as { ay_code: string }[]).map((a) => a.ay_code);

  const { data: ayRow } = await supabase
    .from('academic_years').select('id').eq('ay_code', ayCode).maybeSingle();
  if (!ayRow) return { ayCode, ayCodes, levels: [], selectedLevelId: null, selectedSectionId: null, payload: null, empty: true };
  const ayId = (ayRow as { id: string }).id;

  const { data: sectionLevelRows } = await supabase
    .from('sections').select('level:levels(id, code, label, level_type)').eq('academic_year_id', ayId);
  type LvlLite = { id: string; code: string; label: string; level_type: string };
  const levelMap = new Map<string, LvlLite>();
  for (const row of (sectionLevelRows ?? []) as { level: LvlLite | LvlLite[] | null }[]) {
    const lvl = Array.isArray(row.level) ? row.level[0] : row.level;
    if (lvl) levelMap.set(lvl.id, lvl);
  }
  const levelsFull = Array.from(levelMap.values()).sort((a, b) =>
    a.level_type !== b.level_type ? (a.level_type === 'primary' ? -1 : 1) : a.code.localeCompare(b.code)
  );
  const levels = levelsFull.map((l) => ({ id: l.id, label: l.label }));

  const selectedLevelId =
    sp.level && levelsFull.some((l) => l.id === sp.level) ? sp.level : (levelsFull[0]?.id ?? null);
  if (!selectedLevelId) return { ayCode, ayCodes, levels, selectedLevelId: null, selectedSectionId: null, payload: null, empty: true };

  const payload = await loadMasterfile({
    ayCode, levelId: selectedLevelId, sectionIds: sp.class ? [sp.class] : undefined,
  });
  const selectedSectionId =
    sp.class && payload?.sections.some((s) => s.id === sp.class) ? sp.class : null;

  return { ayCode, ayCodes, levels, selectedLevelId, selectedSectionId, payload: payload ?? null, empty: false };
}
```

- [ ] **Step 2: Refactor the hub page to use it**

In `app/(records)/records/academic-summary/page.tsx`, replace the inline AY/levels/payload block (lines ~44–164) with a call to `resolveAcademicSummaryScope(sp)`, keeping the same role gate, `PageShell`, header, `MasterfileToolbar`, `MasterfileView`, and threshold footer. Handle `scope.empty` / `!scope.payload` with the existing empty-state markup. Keep behavior identical for this task (dashboard reorg is Task 8/9).

- [ ] **Step 3: Typecheck + build the route**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual check**

Run: `npx next build` (or dev) and load `/records/academic-summary?ay=AY9999` — page renders unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/markbook/academic-summary-scope.ts "app/(records)/records/academic-summary/page.tsx"
git commit -m "refactor(academic-summary): shared server scope-resolver"
```

---

## Task 4: Overview aggregate on the dashboard compute

**Files:**
- Modify: `lib/markbook/masterfile-dashboard.ts`
- Test: `__tests__/markbook/masterfile-overview.test.ts`

The hub's Overview cards need total/active/withdrawn/late counts that ignore the client Status filter (they ARE the status breakdown).

- [ ] **Step 1: Write the failing test**

`__tests__/markbook/masterfile-overview.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeMasterfileOverview } from '@/lib/markbook/masterfile-dashboard';
import type { MasterfileStudentRow } from '@/lib/markbook/masterfile';

function row(p: Partial<MasterfileStudentRow>): MasterfileStudentRow {
  return {
    studentId: 'x', studentNumber: 'S', fullName: 'N', sectionId: 'sec',
    sectionName: 'Grit', formClassAdviser: null, enrollmentStatus: 'active',
    lateEnrolleeTermNumber: null, subjectRows: [], generalAverage: null,
    overallAward: null, attendanceByTerm: [], attendanceTotal: { present: 0, late: 0, schoolDays: 0 },
    commentsByTerm: [], ...p,
  };
}

describe('computeMasterfileOverview', () => {
  it('counts by status and breaks late down by term, ignoring nothing', () => {
    const rows = [
      row({ enrollmentStatus: 'active' }),
      row({ enrollmentStatus: 'withdrawn' }),
      row({ enrollmentStatus: 'late_enrollee', lateEnrolleeTermNumber: 2 }),
      row({ enrollmentStatus: 'late_enrollee', lateEnrolleeTermNumber: 2 }),
      row({ enrollmentStatus: 'late_enrollee', lateEnrolleeTermNumber: 3 }),
      row({ enrollmentStatus: 'late_enrollee', lateEnrolleeTermNumber: null }),
    ];
    const o = computeMasterfileOverview(rows);
    expect(o.total).toBe(6);
    expect(o.active).toBe(1);
    expect(o.withdrawn).toBe(1);
    expect(o.lateEnrollee).toBe(3);
    expect(o.lateByTerm).toEqual([
      { termNumber: 2, count: 2 },
      { termNumber: 3, count: 1 },
    ]);
    expect(o.lateUnresolved).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `npx vitest run __tests__/markbook/masterfile-overview.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Add to `lib/markbook/masterfile-dashboard.ts`:

```ts
export type MasterfileOverview = {
  total: number;
  active: number;
  withdrawn: number;
  lateEnrollee: number;
  lateUnresolved: number; // late but no term resolved
  lateByTerm: { termNumber: number; count: number }[]; // ascending, term resolved only
};

export function computeMasterfileOverview(
  rows: MasterfileStudentRow[]
): MasterfileOverview {
  let active = 0, withdrawn = 0, lateEnrollee = 0, lateUnresolved = 0;
  const byTerm = new Map<number, number>();
  for (const r of rows) {
    if (r.enrollmentStatus === 'active') active++;
    else if (r.enrollmentStatus === 'withdrawn') withdrawn++;
    else if (r.enrollmentStatus === 'late_enrollee') {
      lateEnrollee++;
      if (r.lateEnrolleeTermNumber == null) lateUnresolved++;
      else byTerm.set(r.lateEnrolleeTermNumber, (byTerm.get(r.lateEnrolleeTermNumber) ?? 0) + 1);
    }
  }
  return {
    total: rows.length, active, withdrawn, lateEnrollee, lateUnresolved,
    lateByTerm: [...byTerm.entries()].sort((a, b) => a[0] - b[0]).map(([termNumber, count]) => ({ termNumber, count })),
  };
}
```

Then add `overview: computeMasterfileOverview(payload.rows)` to the object returned by `computeMasterfileDashboard` (using the full `payload.rows`, NOT status-filtered), and add `overview: MasterfileOverview;` to the `MasterfileDashboard` type.

- [ ] **Step 4: Run tests**

Run: `npx vitest run __tests__/markbook/masterfile-overview.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/markbook/masterfile-dashboard.ts __tests__/markbook/masterfile-overview.test.ts
git commit -m "feat(masterfile): overview status aggregate with late-by-term"
```

---

## Task 5: Pure view-derivation library

**Files:**
- Create: `lib/markbook/academic-summary-views.ts`
- Test: `__tests__/markbook/academic-summary-views.test.ts`

Derives the row sets for Awards/Attendance/Comments from the payload. Reuses `awardTierForRow` (overall) and a new subject-label→tier helper. Awards-by-subject and per-term performance both supported.

- [ ] **Step 1: Write failing tests**

`__tests__/markbook/academic-summary-views.test.ts` — cover: awards full-year overall (tier from `overallAward`), awards full-year subject (tier from subject award label), awards per-term overall (mean of examinable quarterly cells, no tier), awards per-term subject (that cell's quarterly), tier filter, attendance total vs per-term (absent derived, rate), comments Submitted/Draft/Missing per term. Build a small fixture `MasterfilePayload` with 2 subjects (1 examinable, 1 not), 4 terms, 3 students (active w/ full data, late enrollee T2 partial, withdrawn). Assert:

```ts
// representative assertions
expect(buildAwardsRows(payload, { subjectId: 'overall', termNumber: null }).map(r => r.tier))
  .toContain('gold');
expect(buildAwardsRows(payload, { subjectId: 'overall', termNumber: 2 })[0].tier).toBeNull(); // per-term: no official tier
expect(buildAwardsRows(payload, { subjectId: 'overall', termNumber: null, tier: 'gold' }).every(r => r.tier === 'gold')).toBe(true);
expect(buildAttendanceRows(payload, { termNumber: null })[0].absent).toBe(/* schoolDays - present - late */ 0);
const c = buildCommentRows(payload, { termNumber: 1 });
expect(c.find(r => r.studentNumber === 'SUBMITTED-STU')!.commentStatus).toBe('Submitted');
expect(c.find(r => r.studentNumber === 'DRAFT-STU')!.commentStatus).toBe('Draft');
expect(c.find(r => r.studentNumber === 'NONE-STU')!.commentStatus).toBe('Missing');
```

- [ ] **Step 2: Run to confirm fail**

Run: `npx vitest run __tests__/markbook/academic-summary-views.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the library**

`lib/markbook/academic-summary-views.ts`:

```ts
import {
  awardTierForRow,
  type AwardTier,
} from '@/lib/markbook/masterfile-dashboard';
import type {
  MasterfilePayload,
  MasterfileStudentRow,
} from '@/lib/markbook/masterfile';
import type { SubjectAwardLabel } from '@/lib/compute/awards';

export type EnrollmentStatusLabel = 'Active' | 'Late enrollee' | 'Withdrawn';

function statusLabel(r: MasterfileStudentRow): EnrollmentStatusLabel {
  if (r.enrollmentStatus === 'withdrawn') return 'Withdrawn';
  if (r.enrollmentStatus === 'late_enrollee') return 'Late enrollee';
  return 'Active';
}

export function subjectLabelToTier(label: SubjectAwardLabel): AwardTier | null {
  switch (label) {
    case 'Gold': return 'gold';
    case 'Silver': return 'silver';
    case 'Bronze': return 'bronze';
    case 'Not eligible for Subject Award': return 'notEligible';
    default: return null; // null label = blank cell (withdrawn/no data)
  }
}

// ---------- Awards ----------
export type AwardsRow = {
  studentNumber: string | null;
  studentName: string;
  sectionName: string;
  status: EnrollmentStatusLabel;
  lateTermNumber: number | null;
  score: number | null;
  tier: AwardTier | null; // null in per-term (provisional) mode
};

export type AwardsOptions = {
  subjectId: 'overall' | string;
  termNumber: number | null; // null = full year (official award)
  tier?: AwardTier | 'all';
};

export function buildAwardsRows(
  payload: MasterfilePayload,
  opts: AwardsOptions
): AwardsRow[] {
  const subjectIndex =
    opts.subjectId === 'overall'
      ? -1
      : payload.subjects.findIndex((s) => s.id === opts.subjectId);
  const termIndex =
    opts.termNumber == null
      ? -1
      : payload.terms.findIndex((t) => t.termNumber === opts.termNumber);

  const rows: AwardsRow[] = payload.rows.map((r) => {
    let score: number | null = null;
    let tier: AwardTier | null = null;

    if (opts.termNumber == null) {
      // Full year — official award.
      if (opts.subjectId === 'overall') {
        score = r.generalAverage;
        tier = awardTierForRow(r);
      } else if (subjectIndex >= 0) {
        const sr = r.subjectRows[subjectIndex];
        score = sr?.overall ?? null;
        tier = sr ? subjectLabelToTier(sr.award) : null;
      }
    } else if (termIndex >= 0) {
      // Per-term performance — provisional, no tier.
      if (opts.subjectId === 'overall') {
        const vals = r.subjectRows
          .map((sr, i) => (payload.subjects[i]?.isExaminable ? sr.cells[termIndex]?.quarterly ?? null : null))
          .filter((v): v is number => v != null);
        score = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
      } else if (subjectIndex >= 0) {
        score = r.subjectRows[subjectIndex]?.cells[termIndex]?.quarterly ?? null;
      }
    }

    return {
      studentNumber: r.studentNumber, studentName: r.fullName, sectionName: r.sectionName,
      status: statusLabel(r), lateTermNumber: r.lateEnrolleeTermNumber, score, tier,
    };
  });

  const filtered =
    opts.termNumber == null && opts.tier && opts.tier !== 'all'
      ? rows.filter((r) => r.tier === opts.tier)
      : rows;

  // Best-first; nulls last.
  return filtered.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
}

// ---------- Attendance ----------
export type AttendanceRow = {
  studentNumber: string | null;
  studentName: string;
  sectionName: string;
  status: EnrollmentStatusLabel;
  lateTermNumber: number | null;
  present: number;
  late: number;
  absent: number;
  schoolDays: number;
  rate: number | null;
};

export function buildAttendanceRows(
  payload: MasterfilePayload,
  opts: { termNumber: number | null }
): AttendanceRow[] {
  const termId =
    opts.termNumber == null ? null : payload.terms.find((t) => t.termNumber === opts.termNumber)?.id ?? null;
  return payload.rows
    .map((r) => {
      let present = 0, late = 0, schoolDays = 0;
      if (termId == null) {
        present = r.attendanceTotal.present; late = r.attendanceTotal.late; schoolDays = r.attendanceTotal.schoolDays;
      } else {
        const cell = r.attendanceByTerm.find((c) => c.termId === termId);
        present = cell?.present ?? 0; late = cell?.late ?? 0; schoolDays = cell?.schoolDays ?? 0;
      }
      const absent = Math.max(0, schoolDays - present - late);
      const rate = schoolDays > 0 ? Math.round((present / schoolDays) * 1000) / 10 : null;
      return {
        studentNumber: r.studentNumber, studentName: r.fullName, sectionName: r.sectionName,
        status: statusLabel(r), lateTermNumber: r.lateEnrolleeTermNumber, present, late, absent, schoolDays, rate,
      };
    })
    .sort((a, b) => (b.rate ?? -Infinity) - (a.rate ?? -Infinity));
}

// ---------- Comments ----------
export type CommentStatus = 'Submitted' | 'Draft' | 'Missing';
export type CommentRow = {
  studentNumber: string | null;
  studentName: string;
  sectionName: string;
  status: EnrollmentStatusLabel;
  lateTermNumber: number | null;
  termNumber: number;
  adviser: string | null;
  commentStatus: CommentStatus;
  text: string | null;
};

// T1–T3 only (KD #49). termNumber null = all comment terms (student × term rows).
export function buildCommentRows(
  payload: MasterfilePayload,
  opts: { termNumber: number | null; status?: CommentStatus | 'all' }
): CommentRow[] {
  const commentTerms = payload.terms
    .filter((t) => t.termNumber >= 1 && t.termNumber <= 3)
    .filter((t) => opts.termNumber == null || t.termNumber === opts.termNumber)
    .map((t) => t.termNumber);

  const out: CommentRow[] = [];
  for (const r of payload.rows) {
    for (const tn of commentTerms) {
      const cell = r.commentsByTerm.find((c) => c.termNumber === tn);
      const text = cell?.text ?? null;
      let commentStatus: CommentStatus;
      if (!text) commentStatus = 'Missing';
      else if (cell?.submitted) commentStatus = 'Submitted';
      else commentStatus = 'Draft';
      out.push({
        studentNumber: r.studentNumber, studentName: r.fullName, sectionName: r.sectionName,
        status: statusLabel(r), lateTermNumber: r.lateEnrolleeTermNumber, termNumber: tn,
        adviser: r.formClassAdviser, commentStatus, text,
      });
    }
  }
  const filtered = opts.status && opts.status !== 'all' ? out.filter((r) => r.commentStatus === opts.status) : out;
  return filtered.sort((a, b) => a.sectionName.localeCompare(b.sectionName) || a.studentName.localeCompare(b.studentName) || a.termNumber - b.termNumber);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run __tests__/markbook/academic-summary-views.test.ts`
Expected: PASS (all derivation tests green).

- [ ] **Step 5: Commit**

```bash
git add lib/markbook/academic-summary-views.ts __tests__/markbook/academic-summary-views.test.ts
git commit -m "feat(academic-summary): pure awards/attendance/comments derivations"
```

---

## Task 6: Shared quick-view header (breadcrumb + heading)

**Files:**
- Create: `components/markbook/academic-summary/quick-view-header.tsx`

> **UI task** — before writing JSX: invoke the `ui-ux-pro-max@ui-ux-pro-max-skill` skill and re-read `docs/context/09-design-system.md` §8/§9. Tokens only (Hard Rule #7).

- [ ] **Step 1: Implement the header**

A client/server-agnostic presentational component:

```tsx
import Link from 'next/link';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

export function QuickViewHeader({
  title, subtitle, ayQuery,
}: { title: string; subtitle: string; ayQuery: string }) {
  return (
    <header className="space-y-3">
      <Breadcrumb>
        <BreadcrumbList className="font-mono text-[11px] uppercase tracking-[0.14em]">
          <BreadcrumbItem><BreadcrumbLink asChild><Link href="/records">Records</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink asChild><Link href={`/records/academic-summary${ayQuery}`}>Academic Summary</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{title}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="font-serif text-[32px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[38px]">{title}</h1>
      <p className="max-w-3xl text-[15px] leading-relaxed text-muted-foreground">{subtitle}</p>
    </header>
  );
}
```

`ayQuery` is `''` or `?ay=AY9999` so the breadcrumb back-link preserves the AY.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/markbook/academic-summary/quick-view-header.tsx
git commit -m "feat(academic-summary): shared breadcrumb header for quick views"
```

---

## Task 7: Awards quick-view page + component

**Files:**
- Create: `app/(records)/records/academic-summary/awards/page.tsx`
- Create: `components/markbook/academic-summary/awards-view.tsx`

> **UI task** — invoke `ui-ux-pro-max` + re-read design-system §8/§9 before JSX. Use the unified `<DataTable>` shell (KD #84) + `<StatusBadge>` + `<IdentifierLink>`.

- [ ] **Step 1: The page (RSC)**

```tsx
import { redirect } from 'next/navigation';
import { PageShell } from '@/components/ui/page-shell';
import { MasterfileToolbar } from '@/components/markbook/masterfile-toolbar';
import { QuickViewHeader } from '@/components/markbook/academic-summary/quick-view-header';
import { AwardsView } from '@/components/markbook/academic-summary/awards-view';
import { resolveAcademicSummaryScope } from '@/lib/markbook/academic-summary-scope';
import { getSessionUser } from '@/lib/supabase/server';

export default async function AwardsPage({ searchParams }: {
  searchParams: Promise<{ ay?: string; level?: string; class?: string }>;
}) {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  if (!['registrar', 'school_admin', 'superadmin'].includes(session.role ?? '')) redirect('/');

  const sp = await searchParams;
  const scope = await resolveAcademicSummaryScope(sp);
  const ayQuery = sp.ay ? `?ay=${encodeURIComponent(sp.ay)}` : '';

  return (
    <PageShell>
      <QuickViewHeader
        title="Awards"
        subtitle="Subject awards and the Overall Academic Award. Pick a subject (or Overall) and a term — full-year shows the official award tier; a single term shows provisional performance."
        ayQuery={ayQuery}
      />
      {scope.empty || !scope.payload ? (
        <EmptyAwards />
      ) : (
        <>
          <MasterfileToolbar
            ayCodes={scope.ayCodes} selectedAyCode={scope.ayCode}
            levels={scope.levels} selectedLevelId={scope.selectedLevelId}
            sections={scope.payload.sections} selectedSectionId={scope.selectedSectionId}
          />
          <AwardsView payload={scope.payload} />
        </>
      )}
    </PageShell>
  );
}

function EmptyAwards() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
      No levels with sections configured for this academic year.
    </div>
  );
}
```

- [ ] **Step 2: The view component**

`components/markbook/academic-summary/awards-view.tsx` (`'use client'`). Behavior:
- Local state: `subjectId` (`'overall'` default), `termNumber` (`null` = Full year default), `tier` (`'all'`).
- Controls: three `Select`s styled like `MasterfileView`'s `FilterSelect` — **Subject** (first item `Overall Academic Award`, then `payload.subjects.map`), **Term** (`Full year` + `Term 1..4` from `payload.terms`), **Tier** (`All / Gold / Silver / Bronze / Not eligible`) — *hide the Tier select when `termNumber != null`*.
- When `termNumber != null`, render a quiet note line: `Provisional — awards finalize once Term 4 grades are complete.` (`text-muted-foreground font-mono text-[10px] uppercase`).
- Rows: `buildAwardsRows(payload, { subjectId, termNumber, tier })`.
- Render via the unified `<DataTable>` (KD #84). Columns:
  - Student — `<IdentifierLink href={`/records/students/${studentNumber}`}>{studentName}</IdentifierLink>` (KD #81; plain text if `studentNumber` null).
  - Class — `sectionName`.
  - Status — `<StatusBadge>` for Active/Late enrollee/Withdrawn; append `· T{lateTermNumber}` (amber) when `status === 'Late enrollee' && lateTermNumber`.
  - Score — `score == null ? '—' : score.toFixed(termNumber == null && subjectId === 'overall' ? 1 : termNumber == null ? 2 : 0)` (GA 1dp / subject overall 2dp / per-term quarterly integer).
  - Award — full-year only: a tier badge (Gold amber / Silver `ink-4` / Bronze `brand-bronze` / Not eligible muted, matching the dashboard donut colors). In per-term mode, render `—` or hide the column.
- Export: a `Button` "Export CSV" using the shared CSV helper in `components/ui/data-table` (KD #84) over the current rows; an "Export Excel" + "Print" `Button` group. Excel reuses the Generate-Masterfile export href scoped to the current AY/level/class (the full workbook — note in a tooltip it's the full masterfile); Print = `window.print()`.

> Provide complete column defs + the three selects in the implementation; mirror the `FilterSelect`/`ToggleButton` styling from `masterfile-view.tsx` and the column/StatusBadge patterns from existing drill sheets (`components/markbook/drills/*`).

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npx next build`
Expected: PASS.

- [ ] **Step 4: Manual check**

Load `/records/academic-summary/awards?ay=AY9999` — Overall full-year shows tier badges; switch Subject→English shows English overalls; switch Term→2 hides Tier + shows provisional note + integer quarterly; Tier filter narrows full-year list; CSV downloads.

- [ ] **Step 5: Commit**

```bash
git add "app/(records)/records/academic-summary/awards" components/markbook/academic-summary/awards-view.tsx
git commit -m "feat(academic-summary): Awards quick view"
```

---

## Task 8: Attendance quick-view page + component

**Files:**
- Create: `app/(records)/records/academic-summary/attendance/page.tsx`
- Create: `components/markbook/academic-summary/attendance-view.tsx`

> **UI task** — invoke `ui-ux-pro-max` + design-system first.

- [ ] **Step 1: The page (RSC)** — identical skeleton to Task 7's page, with `title="Attendance"`, `subtitle="Per-term and full-year attendance for the level or a class — present, late and absent days with attendance rate."`, rendering `<AttendanceView payload={scope.payload} />`.

- [ ] **Step 2: The view component** (`'use client'`):
- State: `termNumber` (`null` = full year default).
- Controls: a **Term** `Select` (`Full year` + Term 1..4).
- Rows: `buildAttendanceRows(payload, { termNumber })`.
- `<DataTable>` columns: Student (IdentifierLink → `/attendance/students/${studentNumber}`, KD #81), Class, Status (+late term suffix), Present, Late, Absent, **Rate** (`rate == null ? '—' : rate.toFixed(1) + '%'` — tint mint ≥95 / amber 85–94 / destructive <85 via §9.3), School days. Sortable by Rate (default) + name.
- Export: "Export CSV" (shared helper) + "Export Excel" (the masterfile workbook, scoped).
- Footnote: `Excused (EX) days are tracked in the Attendance module.` (sets the EX-deferred expectation).

- [ ] **Step 3: Typecheck + build** — `npx tsc --noEmit && npx next build` → PASS.

- [ ] **Step 4: Manual check** — `/records/academic-summary/attendance?ay=AY9999`: full-year rates render; switching Term re-scopes; CSV downloads.

- [ ] **Step 5: Commit**

```bash
git add "app/(records)/records/academic-summary/attendance" components/markbook/academic-summary/attendance-view.tsx
git commit -m "feat(academic-summary): Attendance quick view"
```

---

## Task 9: Comments quick-view page + component

**Files:**
- Create: `app/(records)/records/academic-summary/comments/page.tsx`
- Create: `components/markbook/academic-summary/comments-view.tsx`

> **UI task** — invoke `ui-ux-pro-max` + design-system first.

- [ ] **Step 1: The page (RSC)** — same skeleton; `title="Comments"`, `subtitle="Form Class Adviser write-up completion (Terms 1–3). Read-only here — edits stay in Evaluation."`, renders `<CommentsView payload={scope.payload} />`.

- [ ] **Step 2: The view component** (`'use client'`):
- State: `termNumber` (default = `null` all comment terms), `status` (`'all'` default).
- Controls: **Term** `Select` (`All terms` + Term 1/2/3 — T4 excluded), **Status** `Select` (`All / Submitted / Draft / Missing`).
- Rows: `buildCommentRows(payload, { termNumber, status })`.
- `<DataTable>` columns: Student (IdentifierLink → `/records/students/${studentNumber}`), Class, Term (`T{termNumber}`), Status (badge: Submitted→mint/success, Draft→amber/warning, Missing→destructive via `<StatusBadge>`), Adviser (`adviser ?? '—'`), Comment — truncated to ~2 lines with an inline **expand/collapse** toggle (`useState` per row, or a small `<details>`), plus a per-row link `Open in Evaluation` → `/evaluation/sections/${payload... section}?...` (resolve the section by name→id from `payload.sections`; if unresolved, link to `/evaluation/sections`).
- Header action: "Open Evaluation Module" `Button` → `/evaluation`. "Export CSV" (shared helper; include the full comment text column).
- Read-only — no edit affordances.

> The Evaluation deep-link target: `/evaluation/sections/[id]` is the roster editor. Map `sectionName`→`id` via `payload.sections`. Confirm the route exists; if the section id isn't resolvable, fall back to `/evaluation/sections`.

- [ ] **Step 3: Typecheck + build** — `npx tsc --noEmit && npx next build` → PASS.

- [ ] **Step 4: Manual check** — `/records/academic-summary/comments?ay=AY9999`: Submitted/Draft/Missing render; Status filter works; comment expands inline; Open-in-Evaluation navigates; CSV downloads.

- [ ] **Step 5: Commit**

```bash
git add "app/(records)/records/academic-summary/comments" components/markbook/academic-summary/comments-view.tsx
git commit -m "feat(academic-summary): Comments quick view (read-only)"
```

---

## Task 10: CSV format on the export route ("Generate Masterfile")

**Files:**
- Modify: `app/api/markbook/masterfile/export/route.ts`

- [ ] **Step 1: Add a `?format=csv` branch**

After the existing auth + AY/level/class resolution + `loadMasterfile`, branch on `searchParams.get('format')`. Default (`xlsx` or unset) keeps the current workbook path. For `csv`, flatten the payload to a CSV string (UTF-8 BOM `﻿` prefix, matching the drill CSV convention in KD #56) with one row per student: identity columns + per examinable subject (T1–T4, Overall, Award) + per non-exam subject (T1–T4, Final) + General Average + Overall Award + per-term attendance (present/late/school-days) + the T1–T3 comments. Reuse the column ordering already implemented in `lib/markbook/masterfile-export.ts` (factor a shared `flattenMasterfileRows(payload)` helper there if it eases reuse; otherwise inline). Respond with `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="masterfile-<level>-<ay>.csv"`.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npx next build` → PASS.

- [ ] **Step 3: Manual check**

`GET /api/markbook/masterfile/export?ay=AY9999&level=<id>&format=csv` downloads a CSV; `&format=xlsx` (and no format) still downloads the identical workbook as before.

- [ ] **Step 4: Commit**

```bash
git add "app/api/markbook/masterfile/export/route.ts" lib/markbook/masterfile-export.ts
git commit -m "feat(masterfile): CSV format on export route (Generate Masterfile)"
```

---

## Task 11: Hub — simplify MasterfileView (remove toggle/grid, Generate Masterfile dropdown)

**Files:**
- Modify: `components/markbook/masterfile-view.tsx`
- Modify: `app/(records)/records/academic-summary/page.tsx`
- Delete: `components/markbook/masterfile-grid.tsx`

> **UI task** — invoke `ui-ux-pro-max` + design-system first.

- [ ] **Step 1: Strip the toggle + grid from `masterfile-view.tsx`**

Remove `ViewMode` state, the Dashboard|Table `ToggleButton`s, the `MasterfileGrid` import + render, and `initialView`. Always render `<MasterfileDashboard payload filters />`. Keep the Term/Subject/Status `FilterSelect`s (they still drive the dashboard).

- [ ] **Step 2: Replace Export-to-Excel with a Generate Masterfile dropdown**

Swap the single export `Button` for a `DropdownMenu` (label "Generate Masterfile", `FileSpreadsheet` icon) with two items: **Excel (.xlsx)** → `exportHref` (current) and **CSV (.csv)** → `exportHref + '&format=csv'`. Both `<a>` downloads.

- [ ] **Step 3: Update the page**

In `page.tsx`, drop the `initialView`/`?view=` prop, and edit the hero paragraph to remove "Switch to Table for the full grid" — replace with copy pointing at the quick views + Generate Masterfile (e.g. "Use the quick views for awards, attendance and comments, or Generate Masterfile for the full spreadsheet.").

- [ ] **Step 4: Delete the grid component**

```bash
git rm components/markbook/masterfile-grid.tsx
```
Run `npx tsc --noEmit` to confirm nothing else imports it. (If `masterfile-export.ts` imported a type from the grid, move that type; the export builds from the payload, not the grid component.)

- [ ] **Step 5: Build + manual**

Run: `npx next build` → PASS. Load `/records/academic-summary` — no Table toggle; Generate Masterfile dropdown offers Excel + CSV; dashboard filters still work.

- [ ] **Step 6: Commit**

```bash
git add components/markbook/masterfile-view.tsx "app/(records)/records/academic-summary/page.tsx"
git commit -m "feat(academic-summary): masterfile export-only; remove on-screen grid"
```

---

## Task 12: Hub dashboard reorganization (Overview / Performance / Quick Links / Actions + Late Enrollees)

**Files:**
- Modify: `components/markbook/masterfile-dashboard.tsx`

> **UI task** — invoke `ui-ux-pro-max` + re-read design-system §8/§9 before JSX. This is a re-layout of an existing component — preserve every existing drill (`setTarget`) and the `MasterfileDrillSheet`.

- [ ] **Step 1: Add the Overview section**

Above the current "At a glance", add an **Overview** section (`ActHeader` eyebrow "Overview") with a card grid: **Total Students · Active · Withdrawn · Late Enrollees · Missing FCA Comments · Incomplete Grades**.
- Total/Active/Withdrawn/Late read from `d.overview` (Task 4). The **Late Enrollees** card shows the count plus a per-term breakdown line built from `d.overview.lateByTerm` (e.g. `T2: 2 · T3: 1`, with `+N unresolved` when `lateUnresolved > 0`) in a `font-mono text-[10px] uppercase` subtext.
- Missing FCA Comments + Incomplete Grades reuse the existing `missing-comments` / `incomplete-results` drill triggers (move those two `ReadinessCard`/`GradableCard` here, or render parallel cards that call the same `setTarget`). Keep "Grades recorded / Sheets locked / Comments in / Attendance logged" as the existing "At a glance" readiness strip (retitle if desired).

- [ ] **Step 2: Keep Academic Performance**

Retitle the "How they're doing" section to **Academic Performance**; it keeps Award distribution (Performance Bands), GA spread (Grade Average Distribution), Subject performance. (No Class Rankings.)

- [ ] **Step 3: Add a Quick Links section**

A new section **Quick Links** with three navigation cards → `/records/academic-summary/awards`, `/.../attendance`, `/.../comments` (each preserving the current `?ay`/`?level`/`?class` via props threaded from the page, or read from the payload: `?ay=${payload.ayCode}&level=${payload.level.id}` + class if `payload.selectedSectionIds?.[0]`). Use the gradient-tile card recipe (design-system §8) with an icon (Award / CalendarCheck2 / MessageSquareText), title, and one-line description.

- [ ] **Step 4: Retain the watchlists**

Keep "Still coming in" (`NeedsDataCard`) + "Standing out" (`NeedsAttentionCard`) as a final section after Academic Performance (or after Quick Links), unchanged.

- [ ] **Step 5: Thread the scope query for Quick Links**

The dashboard needs the AY/level/class query string for the links. Add a `scopeQuery: string` prop to `MasterfileDashboard` (built on the page as `?ay=...&level=...[&class=...]`) and pass through `MasterfileView`. Update both call sites.

- [ ] **Step 6: Typecheck + build + manual**

Run: `npx tsc --noEmit && npx next build` → PASS. Load `/records/academic-summary` — Overview cards show counts (Late Enrollees shows per-term), Quick Links navigate to the three child routes with AY/level preserved, drills still open, watchlists present.

- [ ] **Step 7: Commit**

```bash
git add components/markbook/masterfile-dashboard.tsx components/markbook/masterfile-view.tsx "app/(records)/records/academic-summary/page.tsx"
git commit -m "feat(academic-summary): hub overview + quick links + late-enrollee-by-term"
```

---

## Task 13: Sidebar sub-items

**Files:**
- Modify: `lib/auth/roles.ts`

- [ ] **Step 1: Convert the Academic-Summary nav section to a labelled group**

In `RECORDS_NAV` (~L164–175), replace the single-item section with a labelled section:

```ts
  // Academic Summary hub + quick views (KD #95/#127). Labelled group so the
  // three quick views read as sub-items under the hub.
  {
    label: 'Academic Summary',
    items: [
      { href: '/records/academic-summary', label: 'Overview', requiresRoles: ['registrar', 'school_admin', 'superadmin'] },
      { href: '/records/academic-summary/awards', label: 'Awards', requiresRoles: ['registrar', 'school_admin', 'superadmin'] },
      { href: '/records/academic-summary/attendance', label: 'Attendance', requiresRoles: ['registrar', 'school_admin', 'superadmin'] },
      { href: '/records/academic-summary/comments', label: 'Comments', requiresRoles: ['registrar', 'school_admin', 'superadmin'] },
    ],
  },
```

Active-state: all four use exact-match (none are in `PREFIX_MATCH_HREFS`), so the hub "Overview" lights up only on the hub and each child lights up only on its own route — no special handling needed.

- [ ] **Step 2: Typecheck + build + manual**

Run: `npx tsc --noEmit && npx next build` → PASS. In the Records sidebar, an "Academic Summary" group shows Overview / Awards / Attendance / Comments; clicking each navigates and highlights the correct item.

- [ ] **Step 3: Commit**

```bash
git add lib/auth/roles.ts
git commit -m "feat(records): Academic Summary sidebar sub-items"
```

---

## Task 14: Final verification

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit` → Expected: clean.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run` → Expected: all pass (incl. the 3 new suites + existing masterfile-drill parity tests).

- [ ] **Step 3: Production build**

Run: `npx next build` → Expected: clean compile.

- [ ] **Step 4: count==drill spot-check**

With the test AY (AY9999) seeded, verify for a level with late enrollees:
- Hub "Late Enrollees" card count == sum of its per-term breakdown (+ unresolved).
- Awards full-year Overall: number of Gold rows == the hub Award donut's Gold legend count (same scope/filters).
- Comments Missing count (Status=Missing) is consistent with the hub "Missing FCA Comments" card for the same term scope.

- [ ] **Step 5: Code review**

Dispatch `feature-dev:code-reviewer` over the branch diff. Address findings.

- [ ] **Step 6: Final commit (if review fixes)**

```bash
git add -A   # NOTE: never stage HFSE reference *.xlsx — they are gitignored; verify `git status` shows only source files
git commit -m "fix(academic-summary): address code-review findings"
```

---

## Self-review notes (author)

- **Spec coverage:** Hub reorg (T11/T12) · Awards w/ Subject + Term modes (T5/T7) · Attendance (T5/T8) · Comments Submitted/Draft/Missing (T2/T5/T9) · Masterfile export-only +CSV (T10/T11) · late-enrollee term (T2, shown T7/T8/T9/T12) · sidebar sub-items (T13) · breadcrumbs (T1/T6) · dropped Promotion/Rankings (never added). All covered.
- **Engine reuse:** all derivations import predicates from `masterfile-dashboard.ts`; no duplicate award/GA logic. count==drill preserved.
- **No new ROUTE_ACCESS:** existing `/records/academic-summary` prefix covers children — verified longer-prefix-wins.
- **Type consistency:** `AwardTier` reused from `masterfile-dashboard.ts`; `SubjectAwardLabel` from `lib/compute/awards.ts`; `commentsByTerm` change is additive; `resolveLateEnrolleeTerm`/`computeMasterfileOverview`/`buildAwardsRows`/`buildAttendanceRows`/`buildCommentRows` names consistent across tasks.
- **Open risk flagged in-task:** widen the `terms` select to include `start_date,end_date` (Task 2 note); confirm Evaluation `/evaluation/sections/[id]` deep-link + section-id resolution (Task 9 note).
