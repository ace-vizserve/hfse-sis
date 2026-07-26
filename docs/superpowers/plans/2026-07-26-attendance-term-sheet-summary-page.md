# Attendance Term Sheet Summary Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the attendance module a dedicated, per-section-per-term page that replicates the real attendance workbook's wide layout (Term Total block + one column-group per month), and revert the "Attendance summary" dialog back to a simple search-first "Look up student" surface that links out to the new page.

**Architecture:** A new Server Component page at `/attendance/[sectionId]/summary` reuses the exact same data loaders the Term sheet page already uses (`getDedupedSchoolCalendarForTerm`, `getDailyForSection`) and a revived version of the pre-Task-7 client-side "Show summary" computation — now a pure, server-callable function in `lib/attendance/sheet-summary.ts`. A new bespoke (non-`DataTable`) component renders the wide, sticky-column, grouped-header table. The dialog (`StudentLookupSheet`) drops the roster-table default view it gained a few days ago and goes back to a flat searchable list, gaining one new link to the page.

**Tech Stack:** Next.js 16 App Router (Server Component page, no client JS needed for the table itself), Tailwind semantic tokens, Vitest + Testing Library.

## Global Constraints

- `(P + L + EX) / (P + L + EX + A)` (marked-days-only denominator), 1dp — the one formula, unchanged, sourced from `summarizeMarks`/`summarizeByMonth` (`lib/attendance/sheet-summary.ts`). No new formula anywhere in this plan.
- No raw `#rrggbb` / `oklch(...)` / `slate-*` / `zinc-*` / `gray-*` / `bg-white` / `bg-black` classes (Hard Rule #7) — every class below is an existing semantic token or an explicit Aurora Vault brand token (`brand-indigo`, etc.) already used elsewhere in this file family.
- No new `DataTable`-shell usage and no new `ROUTE_ACCESS` entry — both were investigated and rejected/unnecessary during design (see the spec's "Why not..." sections).
- Reuse `rateTone()` for all rate coloring (moving, not duplicating, its mint/85/95 thresholds).
- No pagination, no search box on the new page (v1) — deliberately a pure Server Component.
- Spec: `docs/superpowers/specs/2026-07-26-attendance-term-sheet-summary-page-design.md`.

---

## File Structure

| File                                                             | Change                                                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `lib/attendance/rate-tone.ts` (new)                              | `rateTone()`, moved out of `student-lookup-sheet.tsx`                                                     |
| `lib/attendance/sheet-summary.ts`                                | Add `TermSummaryEnrolment`, `buildTermSummaryRows()`, `monthsInRange()`                                   |
| `components/attendance/student-lookup-sheet.tsx`                 | Revert to search-first list; add "View whole term summary" link; import `rateTone` instead of defining it |
| `app/(attendance)/attendance/[sectionId]/page.tsx`               | Remove the now-unused `rollups`/`getRollupForSection` wiring; pass `sectionId` to the dialog              |
| `app/(attendance)/attendance/[sectionId]/summary/page.tsx` (new) | The new page                                                                                              |
| `components/attendance/term-sheet-summary-table.tsx` (new)       | The wide grouped-header table                                                                             |
| `__tests__/attendance/sheet-summary.test.ts`                     | Add tests for `buildTermSummaryRows`, `monthsInRange`                                                     |
| `__tests__/attendance/student-lookup-sheet.test.tsx`             | Rewrite the State-1 (list) tests for the simplified list; State-2 tests untouched                         |
| `__tests__/attendance/term-sheet-summary-table.test.tsx` (new)   | Component test for the wide table                                                                         |

---

### Task 1: Extract `rateTone` to a shared module

**Files:**

- Create: `lib/attendance/rate-tone.ts`
- Modify: `components/attendance/student-lookup-sheet.tsx`

**Interfaces:**

- Produces: `export function rateTone(rate: number): { text: string; stroke: string; label: string }`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/attendance/rate-tone.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { rateTone } from '@/lib/attendance/rate-tone';

describe('rateTone', () => {
  it('bands >= 95 as Excellent (mint)', () => {
    expect(rateTone(95)).toEqual({
      text: 'text-brand-mint',
      stroke: 'stroke-brand-mint',
      label: 'Excellent',
    });
    expect(rateTone(100)).toMatchObject({ label: 'Excellent' });
  });

  it('bands 85-94.9 as Watch (amber)', () => {
    expect(rateTone(85)).toEqual({
      text: 'text-brand-amber',
      stroke: 'stroke-brand-amber',
      label: 'Watch',
    });
    expect(rateTone(94.9)).toMatchObject({ label: 'Watch' });
  });

  it('bands below 85 as At risk (destructive)', () => {
    expect(rateTone(84.9)).toEqual({
      text: 'text-destructive',
      stroke: 'stroke-destructive',
      label: 'At risk',
    });
    expect(rateTone(0)).toMatchObject({ label: 'At risk' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/attendance/rate-tone.test.ts`
Expected: FAIL — `lib/attendance/rate-tone` does not exist.

- [ ] **Step 3: Implement**

Create `lib/attendance/rate-tone.ts`:

```ts
// Rate → semantic health band. Drives text color everywhere an attendance
// rate renders (the lookup dialog's hero, the term sheet summary table).
// Thresholds match the rest of this module family — don't invent a second
// set of bands elsewhere.
export function rateTone(rate: number): {
  text: string;
  stroke: string;
  label: string;
} {
  if (rate >= 95)
    return {
      text: 'text-brand-mint',
      stroke: 'stroke-brand-mint',
      label: 'Excellent',
    };
  if (rate >= 85)
    return {
      text: 'text-brand-amber',
      stroke: 'stroke-brand-amber',
      label: 'Watch',
    };
  return {
    text: 'text-destructive',
    stroke: 'stroke-destructive',
    label: 'At risk',
  };
}
```

In `components/attendance/student-lookup-sheet.tsx`, delete the local `rateTone` function (currently lines 80-103) and its preceding `// Rate → semantic health band...` comment, and add an import instead. Change the import block (currently):

```ts
import { presentOnlyCount } from '@/lib/attendance/rollup-math';
import type { RollupRow } from '@/lib/attendance/queries';
import { TrendChart } from '@/components/dashboard/charts/trend-chart';
```

to:

```ts
import { rateTone } from '@/lib/attendance/rate-tone';
import { TrendChart } from '@/components/dashboard/charts/trend-chart';
```

(The `presentOnlyCount`/`RollupRow` imports are removed here as a preview of Task 3's larger revert — leaving them in would be dead code the moment Task 3 lands. If you're executing tasks out of order, leave them in for now and let Task 3 remove them; either order type-checks fine on its own since Task 1 only changes where `rateTone` comes from.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/attendance/rate-tone.test.ts __tests__/attendance/student-lookup-sheet.test.tsx`
Expected: PASS (the existing dialog tests still pass — `rateTone`'s behavior is unchanged, just relocated).

- [ ] **Step 5: Commit**

```bash
git add lib/attendance/rate-tone.ts components/attendance/student-lookup-sheet.tsx __tests__/attendance/rate-tone.test.ts
git commit -m "refactor(attendance): extract rateTone to a shared module"
```

---

### Task 2: `buildTermSummaryRows` + `monthsInRange`

**Files:**

- Modify: `lib/attendance/sheet-summary.ts`
- Test: `__tests__/attendance/sheet-summary.test.ts`

**Interfaces:**

- Consumes: `summarizeByMonth` (already in this file), `monthKeyOf`/`monthLabelOf` (already imported in this file from `@/lib/attendance/sheet-columns`).
- Produces:
  - `export type TermSummaryEnrolment = { enrolmentId: string; indexNumber: number; studentName: string; withdrawn: boolean; enrollmentDate: string | null }`
  - `export function buildTermSummaryRows(enrolments: TermSummaryEnrolment[], calendar: { date: string }[], daily: { sectionStudentId: string; date: string; status: AttendanceStatus | null }[]): { enrolment: TermSummaryEnrolment; months: MonthlySummary[]; term: SummaryStat }[]`
  - `export function monthsInRange(calendar: { date: string }[]): { month: string; label: string }[]`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/attendance/sheet-summary.test.ts`:

```ts
import {
  buildTermSummaryRows,
  monthsInRange,
  type TermSummaryEnrolment,
} from '@/lib/attendance/sheet-summary';

describe('monthsInRange', () => {
  it('returns distinct, sorted month keys with labels from a calendar range', () => {
    const months = monthsInRange([
      { date: '2026-06-29' },
      { date: '2026-06-30' },
      { date: '2026-07-01' },
      { date: '2026-08-15' },
    ]);
    expect(months).toEqual([
      { month: '2026-06', label: 'June 2026' },
      { month: '2026-07', label: 'July 2026' },
      { month: '2026-08', label: 'August 2026' },
    ]);
  });

  it('returns an empty array for an empty calendar', () => {
    expect(monthsInRange([])).toEqual([]);
  });
});

describe('buildTermSummaryRows', () => {
  const calendar = [
    { date: '2026-06-29' },
    { date: '2026-06-30' },
    { date: '2026-07-01' },
  ];

  const normal: TermSummaryEnrolment = {
    enrolmentId: 'e1',
    indexNumber: 1,
    studentName: 'DOE, Jane',
    withdrawn: false,
    enrollmentDate: null,
  };

  it('builds a per-month + term breakdown per student from the calendar and daily marks', () => {
    const rows = buildTermSummaryRows([normal], calendar, [
      { sectionStudentId: 'e1', date: '2026-06-29', status: 'P' },
      { sectionStudentId: 'e1', date: '2026-06-30', status: 'A' },
      { sectionStudentId: 'e1', date: '2026-07-01', status: 'P' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].months.map((m) => m.month)).toEqual(['2026-06', '2026-07']);
    expect(rows[0].months[0].stat).toMatchObject({
      present: 1,
      absent: 1,
      totalDays: 2,
    });
    expect(rows[0].term).toMatchObject({ present: 2, absent: 1, totalDays: 3 });
  });

  it('excludes calendar dates before enrollmentDate (late-enrollee proration)', () => {
    const lateEnrollee: TermSummaryEnrolment = {
      ...normal,
      enrolmentId: 'e2',
      enrollmentDate: '2026-07-01',
    };
    const rows = buildTermSummaryRows([lateEnrollee], calendar, [
      // A back-dated row before enrollment — must be excluded.
      { sectionStudentId: 'e2', date: '2026-06-29', status: 'P' },
      { sectionStudentId: 'e2', date: '2026-07-01', status: 'P' },
    ]);
    expect(rows[0].months.map((m) => m.month)).toEqual(['2026-07']);
    expect(rows[0].term).toMatchObject({ totalDays: 1, present: 1 });
  });

  it('produces a zero-stat month for a student with no marks in a calendar-covered month', () => {
    const rows = buildTermSummaryRows([normal], calendar, []);
    expect(rows[0].months.map((m) => m.month)).toEqual([]);
    expect(rows[0].term).toMatchObject({ totalDays: 0, attendancePct: null });
  });

  it('preserves enrolment identity fields on the row', () => {
    const rows = buildTermSummaryRows([normal], calendar, []);
    expect(rows[0].enrolment).toEqual(normal);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/attendance/sheet-summary.test.ts`
Expected: FAIL — `buildTermSummaryRows`/`monthsInRange`/`TermSummaryEnrolment` don't exist yet.

- [ ] **Step 3: Implement**

Append to `lib/attendance/sheet-summary.ts` (after `currentTermMonthsFromRaw`):

```ts
export type TermSummaryEnrolment = {
  enrolmentId: string;
  indexNumber: number;
  studentName: string;
  withdrawn: boolean;
  enrollmentDate: string | null;
};

/** Distinct calendar months, chronological, with display labels. */
export function monthsInRange(
  calendar: { date: string }[]
): { month: string; label: string }[] {
  const keys = new Set(calendar.map((c) => monthKeyOf(c.date)));
  return Array.from(keys)
    .sort()
    .map((k) => ({ month: k, label: monthLabelOf(k) }));
}

/**
 * Per-student month + term breakdown for the whole roster, from the term's
 * full calendar range and the section's raw daily marks — the server-side
 * revival of the client-side computation `wide-grid.tsx`'s "Show summary"
 * panel used to do (removed when that panel was replaced by the lookup
 * dialog's roster table, which was itself later replaced by this page).
 * Powers the Term Sheet Summary page.
 *
 * Every calendar date becomes a `Mark` for every student (status `null`
 * when no daily row exists for that date) EXCEPT dates before the
 * student's `enrollmentDate` — those are dropped entirely, not zeroed,
 * so a late enrollee's term/month totals aren't diluted by days they
 * weren't enrolled for yet.
 */
export function buildTermSummaryRows(
  enrolments: TermSummaryEnrolment[],
  calendar: { date: string }[],
  daily: {
    sectionStudentId: string;
    date: string;
    status: AttendanceStatus | null;
  }[]
): {
  enrolment: TermSummaryEnrolment;
  months: MonthlySummary[];
  term: SummaryStat;
}[] {
  const dailyByStudent = new Map<
    string,
    Map<string, AttendanceStatus | null>
  >();
  for (const d of daily) {
    let byDate = dailyByStudent.get(d.sectionStudentId);
    if (!byDate) {
      byDate = new Map();
      dailyByStudent.set(d.sectionStudentId, byDate);
    }
    byDate.set(d.date, d.status);
  }

  return enrolments.map((enrolment) => {
    const byDate = dailyByStudent.get(enrolment.enrolmentId);
    const marks: Mark[] = calendar
      .filter(
        (c) => !enrolment.enrollmentDate || c.date >= enrolment.enrollmentDate
      )
      .map((c) => ({
        date: c.date,
        status: byDate?.get(c.date) ?? null,
      }));
    const { months, term } = summarizeByMonth(marks);
    return { enrolment, months, term };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/attendance/sheet-summary.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add lib/attendance/sheet-summary.ts __tests__/attendance/sheet-summary.test.ts
git commit -m "feat(attendance): add buildTermSummaryRows + monthsInRange for the term sheet summary page"
```

---

### Task 3: Revert the dialog to search-first "Look up student"

**Files:**

- Modify: `components/attendance/student-lookup-sheet.tsx`
- Modify: `__tests__/attendance/student-lookup-sheet.test.tsx`

**Interfaces:**

- Produces: `StudentLookupSheet` now takes `{ enrolments: WideGridEnrolment[]; termLabel: string; termId: string; sectionId: string }` (drops `rollups`, adds `sectionId`). Trigger button reads "Look up student"; dialog title is "Attendance lookup" (list state) / "Attendance record" (detail state, unchanged); dialog width reverts to `sm:max-w-2xl`.

- [ ] **Step 1: Write the failing tests**

Replace the roster-table-era tests in `__tests__/attendance/student-lookup-sheet.test.tsx`. The file currently has a `describe('StudentLookupSheet roster table', ...)` block (3 tests, from the earlier merge) and a `describe('StudentLookupSheet detail view', ...)` block (2 tests, still valid — State 2 is unchanged by this task). Replace only the first block and its fixtures; leave the second block and the `vi.mock('next/link', ...)` at the top untouched.

Replace the `enrolments`/`rollups` fixtures and the roster-table `describe` block (everything from `const enrolments: WideGridEnrolment[] = [` through the closing `});` of `describe('StudentLookupSheet roster table', ...)`) with:

```tsx
const enrolments: WideGridEnrolment[] = [
  {
    enrolmentId: 'e1',
    indexNumber: 1,
    studentNumber: 'S1',
    studentName: 'BALDONADO, Luke',
    busNo: null,
    classroomOfficerRole: null,
    academicsNotes: null,
    adminNotes: null,
    withdrawn: false,
    compassionateUsed: 0,
    compassionateAllowance: 5,
    vlUsedThisTerm: 0,
    vlAllowance: 1,
    enrollmentDate: null,
  },
  {
    enrolmentId: 'e2',
    indexNumber: 2,
    studentNumber: 'S2',
    studentName: 'RIBLORA, Ellie',
    busNo: null,
    classroomOfficerRole: null,
    academicsNotes: null,
    adminNotes: null,
    withdrawn: true,
    compassionateUsed: 0,
    compassionateAllowance: 5,
    vlUsedThisTerm: 0,
    vlAllowance: 1,
    enrollmentDate: null,
  },
];

describe('StudentLookupSheet search list', () => {
  it('opens to a searchable flat list of students', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        termLabel="Term 3"
        termId="t3"
        sectionId="sec-1"
      />
    );
    await user.click(screen.getByRole('button', { name: /look up student/i }));
    expect(
      screen.getByRole('heading', { name: 'Attendance lookup' })
    ).toBeInTheDocument();
    expect(screen.getByText('BALDONADO, Luke')).toBeInTheDocument();
    expect(screen.getByText('RIBLORA, Ellie')).toBeInTheDocument();
    expect(screen.getByText('Withdrawn')).toBeInTheDocument();
  });

  it('search filters the list by name', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        termLabel="Term 3"
        termId="t3"
        sectionId="sec-1"
      />
    );
    await user.click(screen.getByRole('button', { name: /look up student/i }));
    await user.type(
      screen.getByPlaceholderText(/type a student name/i),
      'riblora'
    );
    expect(screen.queryByText('BALDONADO, Luke')).not.toBeInTheDocument();
    expect(screen.getByText('RIBLORA, Ellie')).toBeInTheDocument();
  });

  it('clicking a student opens the per-student detail view', async () => {
    const user = userEvent.setup();
    stubFetchOnce(
      jsonResponse({
        termStats: [],
        recentAbsences: [],
        currentTermMonths: [],
      })
    );
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        termLabel="Term 3"
        termId="t3"
        sectionId="sec-1"
      />
    );
    await user.click(screen.getByRole('button', { name: /look up student/i }));
    await user.click(screen.getByText('BALDONADO, Luke'));
    expect(screen.getByText('Attendance record')).toBeInTheDocument();
    expect(screen.getByText('All students')).toBeInTheDocument();
  });

  it('links to the whole term summary page, scoped to the current term, opening in a new tab', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        termLabel="Term 3"
        termId="t3"
        sectionId="sec-1"
      />
    );
    await user.click(screen.getByRole('button', { name: /look up student/i }));
    const link = screen.getByRole('link', {
      name: /view whole term summary/i,
    });
    expect(link).toHaveAttribute(
      'href',
      '/attendance/sec-1/summary?term_id=t3'
    );
    expect(link).toHaveAttribute('target', '_blank');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/attendance/student-lookup-sheet.test.tsx`
Expected: FAIL — the component still renders the roster table, the trigger button still says "Attendance summary", `sectionId` prop doesn't exist, no "View whole term summary" link.

- [ ] **Step 3: Implement**

Replace the full contents of `components/attendance/student-lookup-sheet.tsx` with:

```tsx
'use client';

import {
  ArrowLeft,
  CalendarX2,
  CircleCheck,
  CircleX,
  Clock,
  ExternalLink,
  FileText,
  Search,
  UserSearch,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import type {
  StudentSummaryResponse,
  TermStat,
} from '@/app/api/attendance/student-summary/route';
import type { WideGridEnrolment } from '@/components/attendance/wide-grid';
import { rateTone } from '@/lib/attendance/rate-tone';
import { TrendChart } from '@/components/dashboard/charts/trend-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

// ─── Types ───────────────────────────────────────────────────────────────────

type Props = {
  enrolments: WideGridEnrolment[];
  termLabel: string;
  termId: string;
  sectionId: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-SG', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// Status → Aurora Vault gradient tile recipe (§9.3 status palette).
const TILE: Record<'present' | 'late' | 'absent' | 'excused', string> = {
  present:
    'bg-gradient-to-br from-brand-mint to-brand-sky text-ink shadow-brand-tile-mint',
  late: 'bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber',
  absent:
    'bg-gradient-to-br from-destructive to-destructive/80 text-white shadow-brand-tile-destructive',
  excused:
    'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile',
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </p>
  );
}

function RateHeadline({ rate }: { rate: number | null }) {
  const tone = rate == null ? null : rateTone(rate);
  return (
    <div className="shrink-0 text-right">
      <p
        className={`font-serif text-[26px] font-semibold leading-none tabular-nums ${
          tone?.text ?? 'text-muted-foreground'
        }`}
      >
        {rate != null ? `${rate}%` : '—'}
      </p>
      {tone && (
        <p
          className={`mt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] ${tone.text}`}
        >
          {tone.label}
        </p>
      )}
    </div>
  );
}

function BreakdownCell({
  value,
  label,
  icon: Icon,
  tile,
}: {
  value: number;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tile: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-4">
      <div
        className={`flex size-8 items-center justify-center rounded-xl ${tile}`}
      >
        <Icon className="size-4" />
      </div>
      <p className="font-serif text-[26px] font-semibold leading-none tabular-nums text-foreground">
        {value}
      </p>
      <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StudentLookupSheet({
  enrolments,
  termLabel,
  termId,
  sectionId,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The per-student summary is an action-triggered READ — fetched only once a
  // student is picked (`enabled`), keyed on the selection + the page's
  // selected term so switching students OR switching terms refetches.
  // Forwards the abort signal so a fast back/forward aborts the stale
  // request. While loading (or with no selection) `summary` is null,
  // preserving the prior skeleton-on-`loading` UX.
  const summaryQuery = useQuery({
    queryKey: queryKeys.attendanceStudentSummary(selectedId ?? '', termId),
    queryFn: ({ signal }) =>
      apiFetch<StudentSummaryResponse>(
        `/api/attendance/student-summary?sectionStudentId=${selectedId}&termId=${termId}`,
        { signal }
      ),
    enabled: selectedId !== null,
  });
  // Treat any error the same as the prior `.catch(() => setSummary(null))` —
  // the detail view degrades to the empty/loading-style state rather than
  // surfacing a route error inside the lookup dialog.
  const summary: StudentSummaryResponse | null =
    selectedId !== null && summaryQuery.isSuccess ? summaryQuery.data : null;
  const loading = selectedId !== null && summaryQuery.isPending;

  const selected = enrolments.find((e) => e.enrolmentId === selectedId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return enrolments;
    return enrolments.filter((e) => e.studentName.toLowerCase().includes(q));
  }, [enrolments, query]);

  // Current-term stat + previous terms both come from the canonical rollup via
  // the summary API (proration-aware, EX-as-present, school-day based).
  const currentStat: TermStat | null = useMemo(
    () => (summary?.termStats ?? []).find((t) => t.isCurrent) ?? null,
    [summary]
  );
  const previousTerms: TermStat[] = useMemo(
    () =>
      (summary?.termStats ?? []).filter(
        (t) => !t.isCurrent && t.P + t.L + t.A + t.EX > 0
      ),
    [summary]
  );
  const currentTermMonths = summary?.currentTermMonths ?? [];

  function handleDialogChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setQuery('');
      setSelectedId(null);
    }
  }

  function handleBack() {
    setSelectedId(null);
    setQuery('');
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <UserSearch className="size-3.5" />
          Look up student
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="font-serif text-xl font-semibold">
            {selected ? 'Attendance record' : 'Attendance lookup'}
          </DialogTitle>
        </DialogHeader>

        {/* ── Search / list view ────────────────────────────────────── */}
        {!selectedId && (
          <>
            <div className="shrink-0 space-y-2 border-b border-border px-4 py-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Type a student name…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="w-full justify-center gap-1.5 text-muted-foreground"
              >
                <Link
                  href={`/attendance/${sectionId}/summary?term_id=${termId}`}
                  target="_blank"
                >
                  <ExternalLink className="size-3.5" />
                  View whole term summary
                </Link>
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  No students match &ldquo;{query}&rdquo;
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map((e) => (
                    <li key={e.enrolmentId}>
                      <button
                        onClick={() => setSelectedId(e.enrolmentId)}
                        className="flex w-full items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-muted/50"
                      >
                        <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">
                          {e.indexNumber}
                        </span>
                        <span className="flex-1 text-sm font-medium text-foreground">
                          {e.studentName}
                        </span>
                        {e.withdrawn && (
                          <Badge variant="secondary" className="text-[10px]">
                            Withdrawn
                          </Badge>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {/* ── Detail view ───────────────────────────────────────────── */}
        {selectedId && selected && (
          <div className="flex-1 space-y-6 overflow-y-auto p-6">
            {/* Back */}
            <button
              onClick={handleBack}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3" />
              All students
            </button>

            {/* ── Hero: identity + rate + breakdown in one card ─────── */}
            <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-t from-primary/5 to-card shadow-xs">
              {/* Identity + rate headline */}
              <div className="flex items-center justify-between gap-4 px-5 py-5">
                <div className="min-w-0 space-y-1.5">
                  <Eyebrow>Current term · {termLabel}</Eyebrow>
                  <h2 className="truncate font-serif text-2xl font-semibold leading-tight text-foreground">
                    {selected.studentName}
                  </h2>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-xs text-muted-foreground">
                      {selected.studentNumber}
                    </p>
                    {selected.withdrawn && (
                      <Badge variant="secondary" className="text-[10px]">
                        Withdrawn
                      </Badge>
                    )}
                  </div>
                </div>
                <RateHeadline
                  rate={loading ? null : (currentStat?.rate ?? null)}
                />
              </div>

              {/* Monthly trend chart */}
              <div
                data-testid="rate-trend-chart"
                className="border-t border-border px-3 pb-1 pt-2"
              >
                {loading ? (
                  <div className="h-[100px] animate-pulse rounded-lg bg-muted" />
                ) : currentTermMonths.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    No attendance recorded yet this term.
                  </p>
                ) : (
                  <TrendChart
                    label="Attendance rate"
                    current={currentTermMonths.map((m) => ({
                      x: m.label,
                      y: m.stat.attendancePct ?? 0,
                    }))}
                    height={100}
                    yFormat="percent"
                  />
                )}
              </div>

              {/* Breakdown strip */}
              {loading ? (
                <div className="grid grid-cols-4 divide-x divide-border border-t border-border bg-card/60">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="flex flex-col items-center gap-2 px-2 py-4"
                    >
                      <div className="size-8 animate-pulse rounded-xl bg-muted" />
                      <div className="h-6 w-6 animate-pulse rounded bg-muted" />
                      <div className="h-2 w-10 animate-pulse rounded bg-muted" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-4 divide-x divide-border border-t border-border bg-card/60">
                  <BreakdownCell
                    value={currentStat?.P ?? 0}
                    label="Present"
                    icon={CircleCheck}
                    tile={TILE.present}
                  />
                  <BreakdownCell
                    value={currentStat?.L ?? 0}
                    label="Late"
                    icon={Clock}
                    tile={TILE.late}
                  />
                  <BreakdownCell
                    value={currentStat?.A ?? 0}
                    label="Absent"
                    icon={CircleX}
                    tile={TILE.absent}
                  />
                  <BreakdownCell
                    value={currentStat?.EX ?? 0}
                    label="Excused"
                    icon={FileText}
                    tile={TILE.excused}
                  />
                </div>
              )}
            </div>

            {/* ── This term by month ───────────────────────────────── */}
            {!loading && currentTermMonths.length > 0 && (
              <div className="space-y-2.5">
                <Eyebrow>This term by month</Eyebrow>
                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Month
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Days
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          P
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          L
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          EX
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          A
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Rate
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {currentTermMonths.map((m) => (
                        <tr key={m.month}>
                          <td className="px-4 py-2.5 font-medium text-foreground">
                            {m.label}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {m.stat.totalDays}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {m.stat.present}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {m.stat.late}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {m.stat.excused}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {m.stat.absent}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {m.stat.attendancePct != null
                              ? `${m.stat.attendancePct}%`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Previous Terms ───────────────────────────────────── */}
            {loading ? (
              <div className="space-y-2.5">
                <Eyebrow>Previous terms</Eyebrow>
                <div className="rounded-xl border border-border px-4 py-6 text-center text-xs text-muted-foreground">
                  Loading…
                </div>
              </div>
            ) : (
              previousTerms.length > 0 && (
                <div className="space-y-2.5">
                  <Eyebrow>Previous terms</Eyebrow>
                  <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40">
                          <th className="px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Term
                          </th>
                          <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Rate
                          </th>
                          <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Absent
                          </th>
                          <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Late
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {previousTerms.map((t) => (
                          <tr key={t.termId}>
                            <td className="px-4 py-2.5 font-medium text-foreground">
                              {t.label}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-foreground">
                              {t.rate != null ? `${t.rate}%` : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                              <span
                                className={
                                  t.A > 0
                                    ? 'font-semibold text-destructive'
                                    : 'text-muted-foreground'
                                }
                              >
                                {t.A}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                              <span
                                className={
                                  t.L > 0
                                    ? 'font-semibold text-brand-amber'
                                    : 'text-muted-foreground'
                                }
                              >
                                {t.L}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            )}

            {/* ── Recent Absences ──────────────────────────────────── */}
            {!loading && summary && summary.recentAbsences.length > 0 && (
              <div className="space-y-2.5">
                <Eyebrow>Recent absences</Eyebrow>
                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                  <ul className="divide-y divide-border">
                    {summary.recentAbsences.map((date) => (
                      <li
                        key={date}
                        className="flex items-center gap-3 px-4 py-2.5"
                      >
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-destructive to-destructive/80 text-white shadow-brand-tile-destructive">
                          <CalendarX2 className="size-4" />
                        </div>
                        <p className="flex-1 text-sm font-medium text-foreground">
                          {formatDate(date)}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {date}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* ── Full history ─────────────────────────────────────── */}
            <Button asChild variant="outline" className="w-full">
              <Link href={`/attendance/students/${selected.studentNumber}`}>
                View full attendance details
              </Link>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/attendance/student-lookup-sheet.test.tsx`
Expected: PASS (7 tests: 4 in the new "search list" block + 2 pre-existing "detail view" tests, but note the detail-view tests also need `sectionId="sec-1"` added to their `<StudentLookupSheet>` render calls since the prop is now required — add it to both call sites in the `describe('StudentLookupSheet detail view', ...)` block while you're in this file).

- [ ] **Step 5: Commit**

```bash
git add components/attendance/student-lookup-sheet.tsx __tests__/attendance/student-lookup-sheet.test.tsx
git commit -m "revert(attendance): dialog back to search-first lookup, links to the new term summary page"
```

---

### Task 4: Remove the now-unused `rollups` wiring from the section page

**Files:**

- Modify: `app/(attendance)/attendance/[sectionId]/page.tsx`

**Interfaces:**

- Consumes: `StudentLookupSheet`'s new prop shape from Task 3 (`sectionId` required, `rollups` no longer accepted).

- [ ] **Step 1: Remove the `getRollupForSection` import**

Change (currently):

```ts
import {
  getCompassionateUsageForSection,
  getDailyForSection,
  getRollupForSection,
  getSectionAttendanceSummary,
  getVacationLeaveUsageForSection,
} from '@/lib/attendance/queries';
```

to:

```ts
import {
  getCompassionateUsageForSection,
  getDailyForSection,
  getSectionAttendanceSummary,
  getVacationLeaveUsageForSection,
} from '@/lib/attendance/queries';
```

- [ ] **Step 2: Remove the `rollups` fetch**

Change (currently):

```ts
const [
  calendar,
  events,
  daily,
  quotaByEnrolmentId,
  vlQuotaByEnrolmentId,
  summary,
  schoolConfig,
  rollups,
] = await Promise.all([
  getDedupedSchoolCalendarForTerm(selectedTermId, sectionLevelType),
  getCalendarEventsForTerm(selectedTermId, audienceForEvents),
  getDailyForSection(sectionId, selectedTermId),
  getCompassionateUsageForSection(sectionId, section.academic_year_id),
  getVacationLeaveUsageForSection(
    sectionId,
    section.academic_year_id,
    selectedTermId
  ),
  getSectionAttendanceSummary(sectionId, selectedTermId),
  getSchoolConfig(),
  getRollupForSection(sectionId, selectedTermId),
]);
```

to:

```ts
const [
  calendar,
  events,
  daily,
  quotaByEnrolmentId,
  vlQuotaByEnrolmentId,
  summary,
  schoolConfig,
] = await Promise.all([
  getDedupedSchoolCalendarForTerm(selectedTermId, sectionLevelType),
  getCalendarEventsForTerm(selectedTermId, audienceForEvents),
  getDailyForSection(sectionId, selectedTermId),
  getCompassionateUsageForSection(sectionId, section.academic_year_id),
  getVacationLeaveUsageForSection(
    sectionId,
    section.academic_year_id,
    selectedTermId
  ),
  getSectionAttendanceSummary(sectionId, selectedTermId),
  getSchoolConfig(),
]);
```

- [ ] **Step 3: Update the `<StudentLookupSheet>` call**

Change (currently):

```tsx
<StudentLookupSheet
  enrolments={enrolments}
  rollups={rollups}
  termLabel={selectedTerm?.label ?? ''}
  termId={selectedTermId}
/>
```

to:

```tsx
<StudentLookupSheet
  enrolments={enrolments}
  termLabel={selectedTerm?.label ?? ''}
  termId={selectedTermId}
  sectionId={sectionId}
/>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(attendance)/attendance/[sectionId]/page.tsx"
git commit -m "refactor(attendance): drop the roster-table rollups fetch, no longer used by the dialog"
```

---

### Task 5: The Term Sheet Summary page + wide table component

**Files:**

- Create: `components/attendance/term-sheet-summary-table.tsx`
- Create: `app/(attendance)/attendance/[sectionId]/summary/page.tsx`
- Test: `__tests__/attendance/term-sheet-summary-table.test.tsx`

**Interfaces:**

- Consumes: `buildTermSummaryRows`, `monthsInRange`, `TermSummaryEnrolment` (Task 2), `rateTone` (Task 1), `getDedupedSchoolCalendarForTerm` (`lib/attendance/calendar.ts`, existing), `getDailyForSection` (`lib/attendance/queries.ts`, existing), `ExportSheetButton` (`components/attendance/export-sheet-button.tsx`, existing), `resolveCurrentTermId` (`lib/sis/current-term.ts`, existing), `levelTypeForAudienceLookup` (`lib/sis/levels.ts`, existing).
- Produces: `TermSheetSummaryTable({ rows, months }: { rows: TermSummaryRow[]; months: { month: string; label: string }[] })` where `TermSummaryRow = { enrolment: TermSummaryEnrolment; months: MonthlySummary[]; term: SummaryStat }` (re-exported from the table module for the page to import).

- [ ] **Step 1: Write the failing component test**

Create `__tests__/attendance/term-sheet-summary-table.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TermSheetSummaryTable } from '@/components/attendance/term-sheet-summary-table';
import type { TermSummaryEnrolment } from '@/lib/attendance/sheet-summary';

const months = [
  { month: '2026-06', label: 'June 2026' },
  { month: '2026-07', label: 'July 2026' },
];

const normal: TermSummaryEnrolment = {
  enrolmentId: 'e1',
  indexNumber: 1,
  studentName: 'BALDONADO, Luke',
  withdrawn: false,
  enrollmentDate: null,
};

const lateEnrollee: TermSummaryEnrolment = {
  enrolmentId: 'e2',
  indexNumber: 2,
  studentName: 'RIBLORA, Ellie',
  withdrawn: true,
  enrollmentDate: '2026-07-01',
};

describe('TermSheetSummaryTable', () => {
  it('renders a grouped header — Term Total + one block per month', () => {
    render(
      <TermSheetSummaryTable
        rows={[
          {
            enrolment: normal,
            months: [
              {
                month: '2026-06',
                label: 'June 2026',
                stat: {
                  totalDays: 2,
                  present: 2,
                  late: 0,
                  excused: 0,
                  absent: 0,
                  attendancePct: 100,
                },
              },
              {
                month: '2026-07',
                label: 'July 2026',
                stat: {
                  totalDays: 1,
                  present: 1,
                  late: 0,
                  excused: 0,
                  absent: 0,
                  attendancePct: 100,
                },
              },
            ],
            term: {
              totalDays: 3,
              present: 3,
              late: 0,
              excused: 0,
              absent: 0,
              attendancePct: 100,
            },
          },
        ]}
        months={months}
      />
    );
    expect(screen.getByText('Term total')).toBeInTheDocument();
    expect(screen.getByText('June 2026')).toBeInTheDocument();
    expect(screen.getByText('July 2026')).toBeInTheDocument();
    expect(screen.getByText('BALDONADO, Luke')).toBeInTheDocument();
  });

  it('renders a dash for a month with no data for a student (e.g. before enrollment)', () => {
    render(
      <TermSheetSummaryTable
        rows={[
          {
            enrolment: lateEnrollee,
            // Only July — no June entry at all (enrolled 2026-07-01).
            months: [
              {
                month: '2026-07',
                label: 'July 2026',
                stat: {
                  totalDays: 1,
                  present: 1,
                  late: 0,
                  excused: 0,
                  absent: 0,
                  attendancePct: 100,
                },
              },
            ],
            term: {
              totalDays: 1,
              present: 1,
              late: 0,
              excused: 0,
              absent: 0,
              attendancePct: 100,
            },
          },
        ]}
        months={months}
      />
    );
    expect(screen.getByText('Withdrawn')).toBeInTheDocument();
    // June column for this student should show the null-rate dash, not a number.
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('renders an empty state when there are no students', () => {
    render(<TermSheetSummaryTable rows={[]} months={months} />);
    expect(screen.getByText(/no students enrolled/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/attendance/term-sheet-summary-table.test.tsx`
Expected: FAIL — `components/attendance/term-sheet-summary-table` does not exist.

- [ ] **Step 3: Implement the table component**

Create `components/attendance/term-sheet-summary-table.tsx`:

```tsx
import { Fragment } from 'react';

import { Badge } from '@/components/ui/badge';
import { rateTone } from '@/lib/attendance/rate-tone';
import type {
  MonthlySummary,
  SummaryStat,
  TermSummaryEnrolment,
} from '@/lib/attendance/sheet-summary';

export type TermSummaryRow = {
  enrolment: TermSummaryEnrolment;
  months: MonthlySummary[];
  term: SummaryStat;
};

const EMPTY_STAT: SummaryStat = {
  totalDays: 0,
  present: 0,
  late: 0,
  excused: 0,
  absent: 0,
  attendancePct: null,
};

function pct(p: number | null): string {
  return p == null ? '—' : `${p}%`;
}

const SUB_HEAD_CLASS =
  'px-3 py-1.5 text-right font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground';

// One "Days | P | L | EX | A | Rate" sub-header group — used once for the
// Term Total block and once per month block. A left rule (`border-l-2`) on
// the first cell separates each group visually, matching wide-grid.tsx's
// own column-tag convention.
function SubHeaderGroup() {
  return (
    <Fragment>
      <th className={`border-l-2 border-border ${SUB_HEAD_CLASS}`}>Days</th>
      <th className={SUB_HEAD_CLASS}>P</th>
      <th className={SUB_HEAD_CLASS}>L</th>
      <th className={SUB_HEAD_CLASS}>EX</th>
      <th className={SUB_HEAD_CLASS}>A</th>
      <th className={SUB_HEAD_CLASS}>Rate</th>
    </Fragment>
  );
}

// One "Days | P | L | EX | A | Rate" data-cell group for a single student ×
// (term-total or one month). `EMPTY_STAT` renders as all-zero/dash for a
// month this student has no data for (before enrollment, or not reached
// yet) — visually identical either way, which is the correct call: both
// mean "nothing to report for this student this month."
function StatCells({ stat }: { stat: SummaryStat }) {
  const tone = stat.attendancePct == null ? null : rateTone(stat.attendancePct);
  return (
    <Fragment>
      <td className="border-l-2 border-border px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
        {stat.totalDays}
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
        {stat.present}
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
        {stat.late}
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
        {stat.excused}
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
        {stat.absent}
      </td>
      <td
        className={`px-3 py-2.5 text-right font-mono text-sm font-semibold tabular-nums ${
          tone?.text ?? 'text-muted-foreground'
        }`}
      >
        {pct(stat.attendancePct)}
      </td>
    </Fragment>
  );
}

export function TermSheetSummaryTable({
  rows,
  months,
}: {
  rows: TermSummaryRow[];
  months: { month: string; label: string }[];
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          No students enrolled in this section yet.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th
                rowSpan={2}
                className="sticky left-0 z-10 bg-muted/60 px-3 py-2 text-left align-bottom font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
              >
                Student
              </th>
              <th
                colSpan={6}
                className="border-l-2 border-border bg-brand-indigo/10 px-3 py-2 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-indigo"
              >
                Term total
              </th>
              {months.map((m) => (
                <th
                  key={m.month}
                  colSpan={6}
                  className="border-l-2 border-border bg-muted/40 px-3 py-2 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                >
                  {m.label}
                </th>
              ))}
            </tr>
            <tr className="border-b border-border">
              <th
                className="sticky left-0 z-10 bg-muted/60 px-3 py-1.5"
                aria-hidden
              />
              <SubHeaderGroup key="term" />
              {months.map((m) => (
                <SubHeaderGroup key={m.month} />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const statByMonth = new Map(
                row.months.map((m) => [m.month, m.stat])
              );
              return (
                <tr
                  key={row.enrolment.enrolmentId}
                  className="hover:bg-muted/30"
                >
                  <td className="sticky left-0 z-10 bg-card px-3 py-2.5 font-medium text-foreground">
                    <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                      {row.enrolment.indexNumber}
                    </span>
                    {row.enrolment.studentName}
                    {row.enrolment.withdrawn && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        Withdrawn
                      </Badge>
                    )}
                  </td>
                  <StatCells stat={row.term} />
                  {months.map((m) => (
                    <StatCells
                      key={m.month}
                      stat={statByMonth.get(m.month) ?? EMPTY_STAT}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/attendance/term-sheet-summary-table.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Build the page**

Create `app/(attendance)/attendance/[sectionId]/summary/page.tsx`:

```tsx
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ExportSheetButton } from '@/components/attendance/export-sheet-button';
import { TermSheetSummaryTable } from '@/components/attendance/term-sheet-summary-table';
import { Card, CardDescription } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getDedupedSchoolCalendarForTerm } from '@/lib/attendance/calendar';
import { getDailyForSection } from '@/lib/attendance/queries';
import {
  buildTermSummaryRows,
  monthsInRange,
  type TermSummaryEnrolment,
} from '@/lib/attendance/sheet-summary';
import { sgToday } from '@/lib/dates';
import { resolveCurrentTermId } from '@/lib/sis/current-term';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import { createClient } from '@/lib/supabase/server';

type LevelLite = { code: string; label: string };
type SectionRow = {
  id: string;
  name: string;
  academic_year_id: string;
  level: LevelLite | LevelLite[] | null;
};

export default async function TermSheetSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ term_id?: string }>;
}) {
  const { sectionId } = await params;
  const sp = await searchParams;

  const supabase = await createClient();

  const { data: sectionRaw } = await supabase
    .from('sections')
    .select('id, name, academic_year_id, level:levels(code, label)')
    .eq('id', sectionId)
    .maybeSingle();
  if (!sectionRaw) notFound();
  const section = sectionRaw as SectionRow;
  const level = Array.isArray(section.level) ? section.level[0] : section.level;

  const { data: termsRaw } = await supabase
    .from('terms')
    .select('id, label, term_number, is_current')
    .eq('academic_year_id', section.academic_year_id)
    .order('term_number', { ascending: true });
  type TermRow = {
    id: string;
    label: string;
    term_number: number;
    is_current: boolean;
  };
  const terms = (termsRaw ?? []) as TermRow[];

  const todayIso = sgToday();
  const selectedTermId =
    (sp.term_id && terms.find((t) => t.id === sp.term_id)?.id) ??
    resolveCurrentTermId(terms, todayIso);
  const selectedTerm = terms.find((t) => t.id === selectedTermId) ?? null;

  if (!selectedTermId) {
    return (
      <PageShell>
        <Card className="items-center py-12 text-center">
          <CardDescription>No term configured for this AY.</CardDescription>
        </Card>
      </PageShell>
    );
  }

  const { data: enrolmentsRaw } = await supabase
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, enrollment_date, student:students(last_name, first_name, middle_name)'
    )
    .eq('section_id', sectionId)
    .order('index_number');

  type EnrolmentRow = {
    id: string;
    index_number: number;
    enrollment_status: string;
    enrollment_date: string | null;
    student:
      | { last_name: string; first_name: string; middle_name: string | null }
      | Array<{
          last_name: string;
          first_name: string;
          middle_name: string | null;
        }>
      | null;
  };
  const enrolmentList = (enrolmentsRaw ?? []) as EnrolmentRow[];

  const sectionLevelType = levelTypeForAudienceLookup(level?.code ?? null);

  const [calendar, daily] = await Promise.all([
    getDedupedSchoolCalendarForTerm(selectedTermId, sectionLevelType),
    getDailyForSection(sectionId, selectedTermId),
  ]);

  const enrolments: TermSummaryEnrolment[] = enrolmentList.map((e) => {
    const s = Array.isArray(e.student) ? e.student[0] : e.student;
    const fullName =
      s != null
        ? `${s.last_name}, ${s.first_name}${s.middle_name ? ' ' + s.middle_name : ''}`
        : '—';
    return {
      enrolmentId: e.id,
      indexNumber: e.index_number,
      studentName: fullName,
      withdrawn: e.enrollment_status === 'withdrawn',
      enrollmentDate: e.enrollment_date ?? null,
    };
  });

  const months = monthsInRange(calendar);
  const rows = buildTermSummaryRows(enrolments, calendar, daily);

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Link
            href={`/attendance/${sectionId}?term_id=${selectedTermId}`}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            {section.name}
          </Link>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Term Sheet Summary
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Every student&apos;s monthly attendance breakdown for this term, in
            the same layout as the printed attendance sheet.
          </p>
        </div>
        <ExportSheetButton sectionId={sectionId} termId={selectedTermId} />
      </header>

      {terms.length > 1 && (
        <Tabs value={selectedTermId} aria-label="Term">
          <TabsList>
            {terms.map((t) => (
              <TabsTrigger key={t.id} value={t.id} asChild>
                <Link href={`/attendance/${sectionId}/summary?term_id=${t.id}`}>
                  {t.label}
                  {t.is_current && (
                    <span className="ml-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                      current
                    </span>
                  )}
                </Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {calendar.length === 0 ? (
        <Card className="items-center py-12 text-center">
          <CardDescription>
            No calendar configured for {selectedTerm?.label ?? 'this term'}.
          </CardDescription>
        </Card>
      ) : (
        <TermSheetSummaryTable rows={rows} months={months} />
      )}
    </PageShell>
  );
}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run __tests__/attendance`
Expected: every test in the directory passes.

- [ ] **Step 7: Commit**

```bash
git add components/attendance/term-sheet-summary-table.tsx "app/(attendance)/attendance/[sectionId]/summary/page.tsx" __tests__/attendance/term-sheet-summary-table.test.tsx
git commit -m "feat(attendance): add the Term Sheet Summary page (wide Excel-format replica)"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 2: Production build**

Run: `npx next build`
Expected: clean compile. (If run inside a deeply-nested worktree path on Windows, Turbopack may hit an unrelated `MAX_PATH` panic — if so, verify via a short-path local clone instead, as done for the prior plan's Task 8: `git clone --branch <this-branch> --single-branch --local <worktree-path> /c/tmp/buildcheck && cd /c/tmp/buildcheck && npm install && npx next build`, then `rm -rf /c/tmp/buildcheck` when done.)

- [ ] **Step 3: Manual browser check**

Start `npm run dev`, open `/attendance/[any sectionId]`:

1. Click "Look up student" — confirm it opens to a plain searchable list (no columns beyond name + index + withdrawn badge), title "Attendance lookup", dialog width back to the narrower `sm:max-w-2xl`.
2. Confirm the "View whole term summary" link is above the list, and opens `/attendance/[sectionId]/summary?term_id=[current term]` in a **new tab**.
3. On the new page: confirm the title reads "Term Sheet Summary" (not "Attendance Summary" — that's the other, pre-existing page), the Term Total block appears first (indigo-tinted), followed by one block per month in order, the student column stays visible while scrolling right, and withdrawn students show the badge with `—` in months after they left.
4. Switch terms via the tabs on the new page — confirm the table reloads for that term.
5. Click "Export sheet" on the new page — confirm it downloads the same `.xlsx` the Term sheet's own export button produces (same route, just linked from here too).
6. Back on the dialog: search for a student, click them, confirm the detail view (rate headline, trend chart, month table, previous terms, recent absences) is unchanged from before this work.
7. Confirm `/attendance/summary` (the OTHER, level-wide page — reachable from the Attendance module's own nav, not from this dialog) still works as before and is visually/structurally distinct from the new page.

- [ ] **Step 4: Commit any final fixups**

If manual verification finds anything, fix it, re-run the relevant tests, and commit before moving on.

---

## Self-Review Notes

- **Spec coverage:** route/access (Task 5), why-not-existing-page + why-bespoke (both are design-doc rationale, not code — nothing to implement, correctly not a task), data flow / `buildTermSummaryRows` (Task 2), layout / wide table (Task 5), dialog changes (Task 3), page wiring cleanup (Task 4), edge cases (zero students / no calendar / zero marks / late enrollee / withdrawn — covered by Task 5's page empty-states + Task 2/5's tests), testing (each task has its own). All spec sections have a corresponding task or are non-code rationale.
- **Placeholder scan:** no TBD/TODO; every step has literal file paths, literal before/after code, and literal commands.
- **Type consistency:** `TermSummaryEnrolment` (Task 2, `lib/attendance/sheet-summary.ts`) is the exact type `buildTermSummaryRows` returns rows keyed on and `TermSheetSummaryTable` (Task 5) consumes — no divergence. `rateTone`'s signature (Task 1) is unchanged from its original definition, just relocated, so both `student-lookup-sheet.tsx` (Task 3) and `term-sheet-summary-table.tsx` (Task 5) call it identically. `MonthlySummary`/`SummaryStat` (pre-existing types) are reused as-is throughout, never redefined.
