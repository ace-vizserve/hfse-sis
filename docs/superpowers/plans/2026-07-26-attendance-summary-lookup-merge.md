# Merge attendance "Show summary" into "Look up student" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the attendance Term-sheet's inline "Show summary" panel with a roster table inside the existing "Look up student" dialog, and replace that dialog's per-student rate ring with a monthly attendance-rate trend chart.

**Architecture:** `StudentLookupSheet` (`components/attendance/student-lookup-sheet.tsx`) grows a new default "roster table" state (search + sort, current-term rollup data) ahead of its existing per-student detail state, which itself gains a new "this term by month" table and a `TrendChart` replacing the SVG rate ring. Both new data feeds (`RollupRow[]` for the table, `MonthlySummary[]` for the month breakdown) reuse existing query/formula code — one query function goes from private to exported, one new pure helper is added — no new API route, no new formula. `wide-grid.tsx` loses its now-redundant inline summary panel entirely.

**Tech Stack:** Next.js 16 App Router (Server Component page + Client Component dialog), `@tanstack/react-query` (KD #24), Recharts via the existing `TrendChart` wrapper (KD #80), Vitest + Testing Library (KD #24 component-test setup).

## Global Constraints

- No raw `#rrggbb` / `oklch(...)` / `slate-*` / `zinc-*` / `gray-*` / `bg-white` / `bg-black` in `app/` or `components/` (Hard Rule #7) — every new class below reuses existing semantic tokens already present in this file (`text-foreground`, `text-muted-foreground`, `border-border`, `bg-card`, `bg-muted`, brand gradient tiles).
- Reuse the existing `rateTone()` mint/amber/destructive color-band function for any new rate coloring — do not invent new thresholds or colors.
- Charts go through the existing `components/dashboard/charts/*` wrapper components only (`TrendChart`) — never import `recharts` directly in a leaf component (KD #80's `next/dynamic` + `ChartSkeleton` pattern lives in the wrapper already).
- `(P + L + EX) / (P + L + EX + A)` (marked-days-only denominator) is the one formula for attendance rate everywhere touched by this plan — already implemented in `recompute_attendance_rollup` (migration 068) and `lib/attendance/sheet-summary.ts::summarizeMarks`. Do not introduce a second formula.
- Toasts (if ever needed) go through `sonner` per KD #21 — not needed by this plan (no mutations are added).
- Spec: `docs/superpowers/specs/2026-07-26-attendance-summary-lookup-merge-design.md`.

---

## File Structure

| File                                                       | Change                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `lib/attendance/queries.ts`                                | Export `getRollupForSection` (was private); add `presentOnlyCount()` helper |
| `lib/attendance/sheet-summary.ts`                          | Add `currentTermMonthsFromRaw()` pure helper                                |
| `app/api/attendance/student-summary/route.ts`              | Add `currentTermMonths` to the response; reuse `presentOnlyCount`           |
| `app/(attendance)/attendance/[sectionId]/page.tsx`         | Fetch rollups, pass as new `rollups` prop                                   |
| `components/attendance/student-lookup-sheet.tsx`           | Roster table (State 1) + month table & trend chart (State 2)                |
| `components/attendance/wide-grid.tsx`                      | Remove `showSummary` state/button/panel/`SummaryStudentRows`                |
| `__tests__/attendance/queries.test.ts` (new)               | `presentOnlyCount` unit tests                                               |
| `__tests__/attendance/sheet-summary.test.ts`               | Add `currentTermMonthsFromRaw` tests                                        |
| `__tests__/attendance/student-lookup-sheet.test.tsx` (new) | Roster table + detail view component tests                                  |
| `__tests__/attendance/wide-grid-summary.test.tsx`          | Delete (tests removed behavior)                                             |

---

### Task 1: Export the rollup query + add `presentOnlyCount`

**Files:**

- Modify: `lib/attendance/queries.ts:210` (`getRollupForSection`)
- Test: `__tests__/attendance/queries.test.ts` (new)

**Interfaces:**

- Produces: `export async function getRollupForSection(sectionId: string, termId: string): Promise<RollupRow[]>` (was module-private) and `export function presentOnlyCount(r: { daysPresent: number; daysLate: number; daysExcused: number }): number`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/attendance/queries.test.ts
import { describe, expect, it } from 'vitest';
import { presentOnlyCount } from '@/lib/attendance/queries';

describe('presentOnlyCount', () => {
  it('subtracts late and excused from the inclusive daysPresent count', () => {
    // daysPresent from the rollup is P+L+EX combined (see migration 068) —
    // present-only P = daysPresent − daysLate − daysExcused.
    expect(
      presentOnlyCount({ daysPresent: 14, daysLate: 1, daysExcused: 2 })
    ).toBe(11);
  });

  it('floors at zero instead of going negative', () => {
    expect(
      presentOnlyCount({ daysPresent: 0, daysLate: 1, daysExcused: 0 })
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/attendance/queries.test.ts`
Expected: FAIL — `presentOnlyCount` is not exported from `@/lib/attendance/queries`.

- [ ] **Step 3: Implement**

In `lib/attendance/queries.ts`, change line 210 from:

```ts
async function getRollupForSection(
```

to:

```ts
export async function getRollupForSection(
```

Then add this new exported function directly below the `RollupRow` type (after line 45, before the `// Internal row shapes` comment on line 47):

```ts
/**
 * `RollupRow.daysPresent` is P+L+EX combined (see migration 068's
 * `recompute_attendance_rollup`: `count(*) filter (where status in
 * ('P','L','EX'))`). Present-ONLY count = daysPresent − daysLate −
 * daysExcused. Shared by the student-summary route and the attendance
 * lookup dialog's roster table so the derivation lives in exactly one
 * place.
 */
export function presentOnlyCount(r: {
  daysPresent: number;
  daysLate: number;
  daysExcused: number;
}): number {
  return Math.max(0, r.daysPresent - r.daysLate - r.daysExcused);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/attendance/queries.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/attendance/queries.ts __tests__/attendance/queries.test.ts
git commit -m "feat(attendance): export getRollupForSection + add presentOnlyCount helper"
```

---

### Task 2: Add `currentTermMonthsFromRaw` to `sheet-summary.ts`

**Files:**

- Modify: `lib/attendance/sheet-summary.ts`
- Test: `__tests__/attendance/sheet-summary.test.ts`

**Interfaces:**

- Consumes: `summarizeByMonth` (already in this file), `AttendanceStatus` (already imported in this file from `@/lib/schemas/attendance`).
- Produces: `export type RawDailyMark = { date: string; status: AttendanceStatus | null; periodId: string | null; recordedAt: string }` and `export function currentTermMonthsFromRaw(rows: RawDailyMark[]): MonthlySummary[]`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/attendance/sheet-summary.test.ts`:

```ts
import { currentTermMonthsFromRaw } from '@/lib/attendance/sheet-summary';

describe('currentTermMonthsFromRaw', () => {
  it('dedupes to the latest recordedAt per (date, periodId), then buckets by month', () => {
    const months = currentTermMonthsFromRaw([
      {
        date: '2026-07-01',
        status: 'A',
        periodId: null,
        recordedAt: '2026-07-01T08:00:00Z',
      },
      {
        // Correction on the same day — later recordedAt wins.
        date: '2026-07-01',
        status: 'P',
        periodId: null,
        recordedAt: '2026-07-01T09:00:00Z',
      },
      {
        date: '2026-06-29',
        status: 'P',
        periodId: null,
        recordedAt: '2026-06-29T08:00:00Z',
      },
    ]);
    expect(months.map((m) => m.month)).toEqual(['2026-06', '2026-07']);
    expect(months[1].stat).toMatchObject({
      present: 1,
      absent: 0,
      totalDays: 1,
    });
  });

  it('returns an empty array for no rows', () => {
    expect(currentTermMonthsFromRaw([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/attendance/sheet-summary.test.ts`
Expected: FAIL — `currentTermMonthsFromRaw` is not exported from `@/lib/attendance/sheet-summary`.

- [ ] **Step 3: Implement**

Append to `lib/attendance/sheet-summary.ts`:

```ts
export type RawDailyMark = {
  date: string;
  status: AttendanceStatus | null;
  periodId: string | null;
  recordedAt: string;
};

/**
 * Dedupes raw `attendance_daily` rows to the latest `recordedAt` per
 * (date, periodId) — same dedup rule the daily-grid + rollup RPC use —
 * then buckets by calendar month via `summarizeByMonth`. Powers the
 * attendance lookup dialog's "This term by month" table. Caller is
 * responsible for pre-filtering `rows` to the term of interest.
 */
export function currentTermMonthsFromRaw(
  rows: RawDailyMark[]
): MonthlySummary[] {
  const sorted = [...rows].sort((a, b) =>
    b.recordedAt.localeCompare(a.recordedAt)
  );
  const seen = new Set<string>();
  const marks: Mark[] = [];
  for (const r of sorted) {
    const key = `${r.date}|${r.periodId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    marks.push({ date: r.date, status: r.status });
  }
  return summarizeByMonth(marks).months;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/attendance/sheet-summary.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add lib/attendance/sheet-summary.ts __tests__/attendance/sheet-summary.test.ts
git commit -m "feat(attendance): add currentTermMonthsFromRaw for the per-student month breakdown"
```

---

### Task 3: Extend `/api/attendance/student-summary` with `currentTermMonths`

**Files:**

- Modify: `app/api/attendance/student-summary/route.ts`

**Interfaces:**

- Consumes: `currentTermMonthsFromRaw` (Task 2), `presentOnlyCount` (Task 1), `type MonthlySummary` from `@/lib/attendance/sheet-summary`, `type AttendanceStatus` from `@/lib/schemas/attendance`.
- Produces: `StudentSummaryResponse.currentTermMonths: MonthlySummary[]` (new field, additive — `termStats`/`recentAbsences` unchanged).

There is no existing route-level test harness in this codebase for API route handlers (verified — no `__tests__` directory mocks Supabase for a route handler directly; route logic here is a thin wrapper around already-tested pure functions from Tasks 1–2). This task is verified manually (Step 3 below) rather than with a new automated test, and is additionally exercised end-to-end by Task 6's component test, which mocks this route's JSON response including `currentTermMonths`.

- [ ] **Step 1: Extend the response type and imports**

In `app/api/attendance/student-summary/route.ts`, change the top imports (lines 1–6) from:

```ts
import { NextRequest, NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { sgToday } from '@/lib/dates';
import { resolveCurrentTermId } from '@/lib/sis/current-term';
import { createServiceClient } from '@/lib/supabase/service';
```

to:

```ts
import { NextRequest, NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { presentOnlyCount } from '@/lib/attendance/queries';
import {
  currentTermMonthsFromRaw,
  type MonthlySummary,
} from '@/lib/attendance/sheet-summary';
import { sgToday } from '@/lib/dates';
import type { AttendanceStatus } from '@/lib/schemas/attendance';
import { resolveCurrentTermId } from '@/lib/sis/current-term';
import { createServiceClient } from '@/lib/supabase/service';
```

Then change the `StudentSummaryResponse` type (lines 20–23) from:

```ts
export type StudentSummaryResponse = {
  termStats: TermStat[];
  recentAbsences: string[]; // ISO date strings (YYYY-MM-DD)
};
```

to:

```ts
export type StudentSummaryResponse = {
  termStats: TermStat[];
  recentAbsences: string[]; // ISO date strings (YYYY-MM-DD)
  currentTermMonths: MonthlySummary[];
};
```

- [ ] **Step 2: Add `term_id` to the daily-ledger select and reuse `presentOnlyCount`**

Change the `dailyResult` query (inside the `Promise.all`, currently):

```ts
    service
      .from('attendance_daily')
      .select('date, status, period_id, recorded_at')
      .eq('section_student_id', sectionStudentId)
      .order('recorded_at', { ascending: false }),
```

to:

```ts
    service
      .from('attendance_daily')
      .select('date, status, term_id, period_id, recorded_at')
      .eq('section_student_id', sectionStudentId)
      .order('recorded_at', { ascending: false }),
```

Change the `RawRow` type (currently):

```ts
type RawRow = {
  date: string;
  status: string;
  period_id: string | null;
  recorded_at: string;
};
```

to:

```ts
type RawRow = {
  date: string;
  status: string;
  term_id: string;
  period_id: string | null;
  recorded_at: string;
};
```

Replace the inline `P` derivation inside the `termStats` map (currently):

```ts
const L = r.days_late ?? 0;
const EX = r.days_excused ?? 0;
const A = r.days_absent ?? 0;
// days_present = P + L + EX → present-only P = days_present − L − EX.
const P = Math.max(0, (r.days_present ?? 0) - L - EX);
```

with:

```ts
const L = r.days_late ?? 0;
const EX = r.days_excused ?? 0;
const A = r.days_absent ?? 0;
const P = presentOnlyCount({
  daysPresent: r.days_present ?? 0,
  daysLate: L,
  daysExcused: EX,
});
```

- [ ] **Step 3: Compute `currentTermMonths` and include it in the response**

The raw daily rows are already fetched (unfiltered by term, per the existing `recentAbsences` logic below them). Right after the `const currentTermId = resolveCurrentTermId(terms, sgToday());` line, add:

```ts
const currentTermMonths: MonthlySummary[] = currentTermId
  ? currentTermMonthsFromRaw(
      ((dailyResult.data ?? []) as RawRow[])
        .filter((row) => row.term_id === currentTermId)
        .map((row) => ({
          date: row.date,
          status: row.status as AttendanceStatus,
          periodId: row.period_id,
          recordedAt: row.recorded_at,
        }))
    )
  : [];
```

Then change the final response (currently):

```ts
return NextResponse.json({
  termStats,
  recentAbsences,
} satisfies StudentSummaryResponse);
```

to:

```ts
return NextResponse.json({
  termStats,
  recentAbsences,
  currentTermMonths,
} satisfies StudentSummaryResponse);
```

- [ ] **Step 4: Manual verification**

Run: `npx tsc --noEmit` (confirms the route still type-checks with the new field wired through)
Expected: no new errors introduced by this file.

Start the dev server (`npm run dev`), open any section's attendance page, click "Look up student" (still the old label until Task 5), pick a student, and inspect the network tab's response for `GET /api/attendance/student-summary?sectionStudentId=...` — confirm the JSON body now includes a `currentTermMonths` array with `month`/`label`/`stat` entries matching the student's current-term marks.

- [ ] **Step 5: Commit**

```bash
git add app/api/attendance/student-summary/route.ts
git commit -m "feat(attendance): add currentTermMonths to the student-summary API response"
```

---

### Task 4: Fetch rollups in the section page and pass them down

**Files:**

- Modify: `app/(attendance)/attendance/[sectionId]/page.tsx`

**Interfaces:**

- Consumes: `getRollupForSection` (Task 1), returns `RollupRow[]`.
- Produces: new `rollups` prop passed to `<StudentLookupSheet>` (consumed starting Task 5).

- [ ] **Step 1: Import and fetch**

Change the import (currently):

```ts
import {
  getCompassionateUsageForSection,
  getDailyForSection,
  getSectionAttendanceSummary,
  getVacationLeaveUsageForSection,
} from '@/lib/attendance/queries';
```

to:

```ts
import {
  getCompassionateUsageForSection,
  getDailyForSection,
  getRollupForSection,
  getSectionAttendanceSummary,
  getVacationLeaveUsageForSection,
} from '@/lib/attendance/queries';
```

Change the parallel fetch (currently):

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

- [ ] **Step 2: Pass the prop**

Change (currently):

```tsx
<StudentLookupSheet
  enrolments={enrolments}
  termLabel={selectedTerm?.label ?? ''}
/>
```

to:

```tsx
<StudentLookupSheet
  enrolments={enrolments}
  rollups={rollups}
  termLabel={selectedTerm?.label ?? ''}
/>
```

(This will show a type error until Task 5 adds the `rollups` prop to `StudentLookupSheet` — that's expected and resolved in the next task. `npx tsc --noEmit` is deferred to Task 5's verification.)

- [ ] **Step 3: Commit**

```bash
git add "app/(attendance)/attendance/[sectionId]/page.tsx"
git commit -m "feat(attendance): fetch section rollups and pass to StudentLookupSheet"
```

---

### Task 5: Roster table (State 1) in `StudentLookupSheet`

**Files:**

- Modify: `components/attendance/student-lookup-sheet.tsx`
- Test: `__tests__/attendance/student-lookup-sheet.test.tsx` (new)

**Interfaces:**

- Consumes: `RollupRow`, `presentOnlyCount` from `@/lib/attendance/queries` (Task 1).
- Produces: `StudentLookupSheet` now takes `{ enrolments: WideGridEnrolment[]; rollups: RollupRow[]; termLabel: string }`. Trigger button label is now "Attendance summary"; dialog title is "Attendance summary" (list state) / "Attendance record" (detail state, unchanged); dialog width is `sm:max-w-4xl`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/attendance/student-lookup-sheet.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StudentLookupSheet } from '@/components/attendance/student-lookup-sheet';
import type { WideGridEnrolment } from '@/components/attendance/wide-grid';
import type { RollupRow } from '@/lib/attendance/queries';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetchOnce } from '../_utils/mock-fetch';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

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

const rollups: RollupRow[] = [
  {
    sectionStudentId: 'e1',
    termId: 't',
    schoolDays: 26,
    daysPresent: 26,
    daysLate: 0,
    daysExcused: 0,
    daysAbsent: 0,
    attendancePct: 100,
  },
  {
    sectionStudentId: 'e2',
    termId: 't',
    schoolDays: 14,
    daysPresent: 6,
    daysLate: 0,
    daysExcused: 0,
    daysAbsent: 8,
    attendancePct: 42.86,
  },
];

describe('StudentLookupSheet roster table', () => {
  it('opens to a roster table joining enrolments with the current-term rollup', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        rollups={rollups}
        termLabel="Term 3"
      />
    );
    await user.click(
      screen.getByRole('button', { name: /attendance summary/i })
    );
    expect(screen.getByText('Attendance summary')).toBeInTheDocument();
    expect(screen.getByText('BALDONADO, Luke')).toBeInTheDocument();
    expect(screen.getByText('RIBLORA, Ellie')).toBeInTheDocument();
    expect(screen.getByText('Withdrawn')).toBeInTheDocument();
    // Days / P / A columns for BALDONADO (26 school days, all present).
    expect(screen.getAllByText('26').length).toBeGreaterThanOrEqual(2);
  });

  it('search filters the roster table by name', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        rollups={rollups}
        termLabel="Term 3"
      />
    );
    await user.click(
      screen.getByRole('button', { name: /attendance summary/i })
    );
    await user.type(
      screen.getByPlaceholderText(/type a student name/i),
      'riblora'
    );
    expect(screen.queryByText('BALDONADO, Luke')).not.toBeInTheDocument();
    expect(screen.getByText('RIBLORA, Ellie')).toBeInTheDocument();
  });

  it('clicking a row opens the per-student detail view', async () => {
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
        rollups={rollups}
        termLabel="Term 3"
      />
    );
    await user.click(
      screen.getByRole('button', { name: /attendance summary/i })
    );
    await user.click(screen.getByText('BALDONADO, Luke'));
    expect(screen.getByText('Attendance record')).toBeInTheDocument();
    expect(screen.getByText('All students')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/attendance/student-lookup-sheet.test.tsx`
Expected: FAIL — `rollups` prop doesn't exist on `StudentLookupSheet`'s props type, button text is still "Look up student", no table rendered.

- [ ] **Step 3: Implement**

Replace the full contents of `components/attendance/student-lookup-sheet.tsx` with:

```tsx
'use client';

import {
  ArrowLeft,
  CalendarX2,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Clock,
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
import { presentOnlyCount, type RollupRow } from '@/lib/attendance/queries';
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
  rollups: RollupRow[];
  termLabel: string;
};

type SortKey =
  | 'studentName'
  | 'schoolDays'
  | 'present'
  | 'late'
  | 'excused'
  | 'absent'
  | 'attendancePct';

type RosterRow = {
  enrolment: WideGridEnrolment;
  schoolDays: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
  attendancePct: number | null;
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

// Rate → semantic health band (drives text color everywhere a rate renders).
function rateTone(rate: number): {
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

function RateRing({ rate }: { rate: number | null }) {
  const size = 116;
  const center = size / 2;
  const r = 50;
  const circumference = 2 * Math.PI * r;
  const clamped = rate == null ? 0 : Math.max(0, Math.min(100, rate));
  const offset = circumference * (1 - clamped / 100);
  const tone = rate == null ? null : rateTone(rate);

  return (
    <div
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="absolute -rotate-90"
        aria-hidden
      >
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          strokeWidth="9"
          className="stroke-muted"
        />
        {rate != null && (
          <circle
            cx={center}
            cy={center}
            r={r}
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`${tone?.stroke} transition-[stroke-dashoffset] duration-500 ease-out`}
          />
        )}
      </svg>
      <div className="relative flex flex-col items-center leading-none">
        <p
          className={`font-serif text-xl font-semibold tabular-nums ${tone?.text ?? 'text-muted-foreground'}`}
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

function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = 'right',
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sortKey === activeKey;
  return (
    <th
      className={`px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-foreground' : ''}`}
      >
        {label}
        {active ? (
          dir === 'asc' ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )
        ) : null}
      </button>
    </th>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StudentLookupSheet({ enrolments, rollups, termLabel }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('studentName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // The per-student summary is an action-triggered READ — fetched only once a
  // student is picked (`enabled`), keyed on the selection so switching students
  // refetches. Forwards the abort signal so a fast back/forward aborts the
  // stale request. While loading (or with no selection) `summary` is null,
  // preserving the prior skeleton-on-`loading` UX.
  const summaryQuery = useQuery({
    queryKey: queryKeys.attendanceStudentSummary(selectedId ?? ''),
    queryFn: ({ signal }) =>
      apiFetch<StudentSummaryResponse>(
        `/api/attendance/student-summary?sectionStudentId=${selectedId}`,
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

  // ── Roster table (State 1) — joins enrolments with the current-term
  // rollup, then filters by search + sorts by the active column.
  const rollupByEnrolment = useMemo(() => {
    const m = new Map<string, RollupRow>();
    for (const r of rollups) m.set(r.sectionStudentId, r);
    return m;
  }, [rollups]);

  const rosterRows: RosterRow[] = useMemo(
    () =>
      enrolments.map((e) => {
        const r = rollupByEnrolment.get(e.enrolmentId);
        return {
          enrolment: e,
          schoolDays: r?.schoolDays ?? 0,
          present: r ? presentOnlyCount(r) : 0,
          late: r?.daysLate ?? 0,
          excused: r?.daysExcused ?? 0,
          absent: r?.daysAbsent ?? 0,
          attendancePct: r?.attendancePct ?? null,
        };
      }),
    [enrolments, rollupByEnrolment]
  );

  const filtered: RosterRow[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? rosterRows.filter((r) =>
          r.enrolment.studentName.toLowerCase().includes(q)
        )
      : rosterRows;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'studentName') {
        return (
          dir * a.enrolment.studentName.localeCompare(b.enrolment.studentName)
        );
      }
      if (sortKey === 'attendancePct') {
        return dir * ((a.attendancePct ?? -1) - (b.attendancePct ?? -1));
      }
      return dir * (a[sortKey] - b[sortKey]);
    });
  }, [rosterRows, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'studentName' ? 'asc' : 'desc');
    }
  }

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
          Attendance summary
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="font-serif text-xl font-semibold">
            {selected ? 'Attendance record' : 'Attendance summary'}
          </DialogTitle>
        </DialogHeader>

        {/* ── Roster table (State 1) ────────────────────────────────── */}
        {!selectedId && (
          <>
            <div className="shrink-0 border-b border-border px-4 py-3">
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
            </div>

            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  No students match &ldquo;{query}&rdquo;
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border">
                      <SortableTh
                        label="Student"
                        sortKey="studentName"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                        align="left"
                      />
                      <SortableTh
                        label="Days"
                        sortKey="schoolDays"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                      />
                      <SortableTh
                        label="P"
                        sortKey="present"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                      />
                      <SortableTh
                        label="L"
                        sortKey="late"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                      />
                      <SortableTh
                        label="EX"
                        sortKey="excused"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                      />
                      <SortableTh
                        label="A"
                        sortKey="absent"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                      />
                      <SortableTh
                        label="Rate"
                        sortKey="attendancePct"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                      />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((row) => {
                      const tone =
                        row.attendancePct == null
                          ? null
                          : rateTone(row.attendancePct);
                      return (
                        <tr
                          key={row.enrolment.enrolmentId}
                          onClick={() =>
                            setSelectedId(row.enrolment.enrolmentId)
                          }
                          className="cursor-pointer transition-colors hover:bg-muted/50"
                        >
                          <td className="px-3 py-2.5">
                            <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">
                              {row.enrolment.indexNumber}
                            </span>{' '}
                            <span className="text-sm font-medium text-foreground">
                              {row.enrolment.studentName}
                            </span>
                            {row.enrolment.withdrawn && (
                              <Badge
                                variant="secondary"
                                className="ml-2 text-[10px]"
                              >
                                Withdrawn
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
                            {row.schoolDays}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
                            {row.present}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
                            {row.late}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
                            {row.excused}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
                            {row.absent}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono text-sm font-semibold tabular-nums ${
                              tone?.text ?? 'text-muted-foreground'
                            }`}
                          >
                            {row.attendancePct != null
                              ? `${row.attendancePct}%`
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="shrink-0 border-t border-border px-6 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {filtered.length} student{filtered.length === 1 ? '' : 's'} ·
              current term · click a row for full history
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
              {/* Identity + rate ring */}
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
                <RateRing rate={loading ? null : (currentStat?.rate ?? null)} />
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

(This step keeps `RateRing` and the detail view exactly as they were — Task 6 replaces the ring and adds the month table. This step's job is State 1 + prop/label/width changes only.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/attendance/student-lookup-sheet.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Type-check the page wiring from Task 4**

Run: `npx tsc --noEmit`
Expected: no errors (the `rollups` prop type mismatch flagged at the end of Task 4 is now resolved).

- [ ] **Step 6: Commit**

```bash
git add components/attendance/student-lookup-sheet.tsx __tests__/attendance/student-lookup-sheet.test.tsx
git commit -m "feat(attendance): roster table as StudentLookupSheet's default view"
```

---

### Task 6: Month breakdown + trend chart (State 2)

**Files:**

- Modify: `components/attendance/student-lookup-sheet.tsx`
- Modify: `__tests__/attendance/student-lookup-sheet.test.tsx`

**Interfaces:**

- Consumes: `TrendChart` from `@/components/dashboard/charts/trend-chart` (`{ label: string; current: {x:string;y:number}[]; height?: number; yFormat?: 'percent' }`), `StudentSummaryResponse.currentTermMonths` (Task 3).
- Produces: detail view now shows a `data-testid="rate-trend-chart"` region (chart or empty/loading state) and a "This term by month" table.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/attendance/student-lookup-sheet.test.tsx`:

```tsx
describe('StudentLookupSheet detail view', () => {
  it('shows the current-term month breakdown and a trend-chart region instead of a ring', async () => {
    const user = userEvent.setup();
    stubFetchOnce(
      jsonResponse({
        termStats: [
          {
            termId: 't3',
            termNumber: 3,
            label: 'Term 3',
            isCurrent: true,
            P: 26,
            L: 0,
            A: 0,
            EX: 0,
            rate: 100,
          },
        ],
        recentAbsences: [],
        currentTermMonths: [
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
              totalDays: 12,
              present: 12,
              late: 0,
              excused: 0,
              absent: 0,
              attendancePct: 100,
            },
          },
        ],
      })
    );
    renderWithClient(
      <StudentLookupSheet
        enrolments={enrolments}
        rollups={rollups}
        termLabel="Term 3"
      />
    );
    await user.click(
      screen.getByRole('button', { name: /attendance summary/i })
    );
    await user.click(screen.getByText('BALDONADO, Luke'));

    expect(await screen.findByText('This term by month')).toBeInTheDocument();
    expect(screen.getByText('June 2026')).toBeInTheDocument();
    expect(screen.getByText('July 2026')).toBeInTheDocument();
    expect(screen.getByTestId('rate-trend-chart')).toBeInTheDocument();
  });

  it('shows a "no data" message instead of a chart when the current term has no months yet', async () => {
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
        rollups={rollups}
        termLabel="Term 3"
      />
    );
    await user.click(
      screen.getByRole('button', { name: /attendance summary/i })
    );
    await user.click(screen.getByText('BALDONADO, Luke'));

    expect(
      await screen.findByText('No attendance recorded yet this term.')
    ).toBeInTheDocument();
    expect(screen.queryByText('This term by month')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/attendance/student-lookup-sheet.test.tsx`
Expected: FAIL — no "This term by month" text, no `data-testid="rate-trend-chart"` element yet.

- [ ] **Step 3: Implement**

Add the `TrendChart` import — change (currently, after Task 5):

```ts
import { presentOnlyCount, type RollupRow } from '@/lib/attendance/queries';
import { Badge } from '@/components/ui/badge';
```

to:

```ts
import { presentOnlyCount, type RollupRow } from '@/lib/attendance/queries';
import { TrendChart } from '@/components/dashboard/charts/trend-chart';
import { Badge } from '@/components/ui/badge';
```

Replace the `RateRing` function (added in Task 5) with a plain headline (no SVG):

```tsx
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
```

(Delete the old `RateRing` function entirely — its `size`/`center`/`r`/`circumference`/SVG markup is no longer used anywhere.)

In the main component, add `currentTermMonths` next to the existing `currentStat`/`previousTerms` derivations — change (currently):

```ts
const previousTerms: TermStat[] = useMemo(
  () =>
    (summary?.termStats ?? []).filter(
      (t) => !t.isCurrent && t.P + t.L + t.A + t.EX > 0
    ),
  [summary]
);
```

to:

```ts
const previousTerms: TermStat[] = useMemo(
  () =>
    (summary?.termStats ?? []).filter(
      (t) => !t.isCurrent && t.P + t.L + t.A + t.EX > 0
    ),
  [summary]
);
const currentTermMonths = summary?.currentTermMonths ?? [];
```

Replace the hero block's identity row + `<RateRing>` call — change (currently):

```tsx
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
  <RateRing rate={loading ? null : (currentStat?.rate ?? null)} />
</div>
```

to:

```tsx
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
  <RateHeadline rate={loading ? null : (currentStat?.rate ?? null)} />
</div>;

{
  /* Monthly trend chart — replaces the rate ring. */
}
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
</div>;
```

Insert the "This term by month" table between the hero card and the "Previous Terms" block — change (currently):

```tsx
            </div>

            {/* ── Previous Terms ───────────────────────────────────── */}
```

to:

```tsx
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/attendance/student-lookup-sheet.test.tsx`
Expected: PASS (5 tests total)

- [ ] **Step 5: Commit**

```bash
git add components/attendance/student-lookup-sheet.tsx __tests__/attendance/student-lookup-sheet.test.tsx
git commit -m "feat(attendance): replace the rate ring with a monthly trend chart + month table"
```

---

### Task 7: Remove Show Summary from `wide-grid.tsx`

**Files:**

- Modify: `components/attendance/wide-grid.tsx`
- Delete: `__tests__/attendance/wide-grid-summary.test.tsx`

**Interfaces:**

- Consumes: none new.
- Produces: `AttendanceWideGrid`'s public props are unchanged; `showSummary` state, the "Show summary" button, the inline summary `<Card>`, and `SummaryStudentRows` no longer exist.

- [ ] **Step 1: Delete the obsolete test**

```bash
rm __tests__/attendance/wide-grid-summary.test.tsx
```

This file's two tests assert on the "Show summary" button and the "Term total" row inside `wide-grid.tsx` — behavior this task removes. `sheet-summary.ts`'s formula coverage lives in `__tests__/attendance/sheet-summary.test.ts` (unaffected by this task) and the merged dialog's equivalent behavior is now covered by `__tests__/attendance/student-lookup-sheet.test.tsx` (Tasks 5–6).

- [ ] **Step 2: Remove the import**

Change (currently, line 91):

```ts
import { summarizeByMonth, type Mark } from '@/lib/attendance/sheet-summary';
```

Delete this line entirely (`summarizeByMonth`/`Mark` are not used anywhere else in `wide-grid.tsx` — verified via `rg "summarizeByMonth|SummaryStudentRows|summaryRows|showSummary|type Mark" components/attendance/wide-grid.tsx`, all remaining matches are removed by this task).

- [ ] **Step 3: Remove the state and computed rows**

Change (currently):

```ts
const [showDetails, setShowDetails] = useState(false);
const [showSummary, setShowSummary] = useState(false);
```

to:

```ts
const [showDetails, setShowDetails] = useState(false);
```

Delete the `summaryRows` `useMemo` block entirely (currently):

```ts
// Per-student marks (from the live cells Map) → summary rows. Recomputes on
// edit so the panel stays live. Withdrawn rows excluded (match the roster).
//
// NOTE: this summary iterates calendar-configured `columns` (school days for
// the selected term); the export builder iterates the full term date window.
// Both feed the same `summarizeMarks` helper, so totals match for normal
// data. The difference is intentional — don't try to "align" them.
const summaryRows = useMemo(() => {
  if (!showSummary) return [];
  return enrolments
    .filter((e) => !e.withdrawn)
    .map((e) => {
      const marks: Mark[] = columns.map((c) => ({
        date: c.iso,
        status: cells.get(keyFor(e.enrolmentId, c.iso))?.status ?? null,
      }));
      return { enrolment: e, ...summarizeByMonth(marks) };
    });
}, [showSummary, enrolments, columns, cells]);
```

- [ ] **Step 4: Remove the toggle button**

Change (currently):

```tsx
        <Button
          type="button"
          variant={showDetails ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowDetails((v) => !v)}
        >
          {showDetails ? 'Hide details' : 'Show details'}
        </Button>
        <Button
          type="button"
          variant={showSummary ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowSummary((v) => !v)}
        >
          {showSummary ? 'Hide summary' : 'Show summary'}
        </Button>
```

to:

```tsx
<Button
  type="button"
  variant={showDetails ? 'secondary' : 'outline'}
  size="sm"
  onClick={() => setShowDetails((v) => !v)}
>
  {showDetails ? 'Hide details' : 'Show details'}
</Button>
```

- [ ] **Step 5: Remove the summary panel and `SummaryStudentRows`**

Delete the entire panel block (currently, right before the "Legend" `<Card>`):

```tsx
{
  /* Summary panel — per-month + term totals per student */
}
{
  showSummary && (
    <Card className="overflow-x-auto p-0">
      <Table noWrapper className="text-[12px]">
        <TableHeader>
          <TableRow>
            <TableHead className="px-3 py-2 text-left">Student</TableHead>
            <TableHead className="px-2 py-2 text-left">Period</TableHead>
            <TableHead className="px-2 py-2 text-right">Days</TableHead>
            <TableHead className="px-2 py-2 text-right">P</TableHead>
            <TableHead className="px-2 py-2 text-right">L</TableHead>
            <TableHead className="px-2 py-2 text-right">EX</TableHead>
            <TableHead className="px-2 py-2 text-right">A</TableHead>
            <TableHead className="px-2 py-2 text-right">Attendance %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summaryRows.map(({ enrolment, months, term }) => (
            <SummaryStudentRows
              key={enrolment.enrolmentId}
              name={enrolment.studentName}
              months={months}
              term={term}
            />
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

{
  /* Legend */
}
```

to:

```tsx
{
  /* Legend */
}
```

Delete the entire `SummaryStudentRows` function (currently, right after `StatusLegendChip`/`DayTypeLegendChip`, before `CellButton`'s comment block — search for `function SummaryStudentRows({` and remove through its closing `}` and the blank line after it).

- [ ] **Step 6: Verify**

Run: `npx vitest run __tests__/attendance`
Expected: PASS — every remaining attendance test file passes; `wide-grid-summary.test.tsx` no longer exists so it doesn't run.

Run: `npx tsc --noEmit`
Expected: no errors (confirms no other file imported `SummaryStudentRows`/`summaryRows`/`showSummary` from `wide-grid.tsx` — none do; it's not exported).

- [ ] **Step 7: Commit**

```bash
git add components/attendance/wide-grid.tsx
git rm __tests__/attendance/wide-grid-summary.test.tsx
git commit -m "refactor(attendance): remove the inline Show Summary panel, superseded by the merged lookup dialog"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS — no regressions in any module's test suite.

- [ ] **Step 2: Production build**

Run: `npx next build`
Expected: clean compile, no type errors (per this project's workflow.md — required before marking any attendance work done).

- [ ] **Step 3: Manual browser check**

Start `npm run dev`, open `/attendance/[any sectionId]`:

1. Click "Attendance summary" — confirm it opens straight to a sortable/searchable table of every student, current term, with Days/P/L/EX/A/Rate columns.
2. Click a column header (e.g. "Rate") — confirm the table re-sorts and the header shows a direction chevron.
3. Type part of a name into the search box — confirm the table filters.
4. Click a row — confirm it transitions to the per-student detail view: name/number header, a plain percentage + tone label (no ring), a monthly trend chart, a "This term by month" table, breakdown tiles, previous terms (if any), recent absences (if any), and the "View full attendance details" link.
5. Click "All students" — confirm it returns to the roster table with the search box cleared.
6. On the Term sheet itself, confirm the "Show summary" button and its inline panel are gone; "Show details" still works as before.
7. Spot-check that the roster table's current-term numbers for one student match that same student's detail-view current-term numbers (they read from the same rollup, so they must agree).

- [ ] **Step 4: Update the design spec status**

In `docs/superpowers/specs/2026-07-26-attendance-summary-lookup-merge-design.md`, change the header line:

```
**Status:** Approved, pending implementation plan
```

to:

```
**Status:** Implemented
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-26-attendance-summary-lookup-merge-design.md
git commit -m "docs: mark attendance summary/lookup merge spec as implemented"
```

---

## Self-Review Notes

- **Spec coverage:** interaction model (Tasks 5–6), data flow / new exports (Tasks 1–2), route extension (Task 3), page wiring (Task 4), visual design / TrendChart replacing the ring (Task 6), wide-grid cleanup (Task 7), testing (each task) — all spec sections have a corresponding task.
- **Placeholder scan:** no TBD/TODO; every step has literal file paths, literal before/after code, and literal shell commands.
- **Type consistency:** `RollupRow` (from `lib/attendance/queries.ts`, Task 1) is the same type threaded through Task 4's page prop and Task 5's component prop. `MonthlySummary` (from `lib/attendance/sheet-summary.ts`, Task 2) is the same type used in Task 3's route response and Task 6's component rendering. `presentOnlyCount` has one signature, used identically in Task 1's test, Task 3's route, and Task 5's component.
