# Attendance Template Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the in-system attendance Term sheet a modern, template-faithful encoding surface (context band, `SH/SE/PH/EX` column tags, roster Details, per-month + term Summary) and add an `.xlsx` export that reproduces HFSE's `AY2026 Term 3 Attendance.xlsx` literally.

**Architecture:** Two pure libs (`sheet-summary.ts` summary math + `sheet-columns.ts` tag/date/month axis helpers) are the single source of truth shared by both the live grid and the export, so screen and print can't drift. The live Term sheet (`wide-grid.tsx` + a new `sheet-context.tsx`) gains progressive-disclosure bands. A new server-only export builder + route streams the workbook using the existing SheetJS pattern.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript, `@tanstack/react-query` (existing grid mutation), `xlsx` (SheetJS, server-only), shadcn `Collapsible` (to install) + existing `Tooltip`, Vitest (jsdom + RTL for component tests; node for pure tests).

## Global Constraints

- **No v1 migration.** Everything resolves from existing tables (`bus_no` + `classroom_officer_role` already exist, migration 015). `Academics`/`Admin` are read-only placeholders in v1.
- **Attendance-% formula (HFSE, read from the workbook):** `Attendance % = (Present + Late + Excused) / TotalDays`, where `TotalDays = count of days carrying a P/L/EX/A mark`. `NC` and unmarked days are excluded from both numerator and denominator. 1 decimal place; `null` when `TotalDays === 0`.
- **This formula intentionally diverges from the dashboard** ("Present ÷ school days"). Do NOT change the dashboard rollup (`lib/attendance/queries.ts::getSectionAttendanceSummary`).
- **Hard Rule #7 (design tokens):** no raw `#rrggbb` / `oklch()` / `slate-*` / `zinc-*` / `gray-*` / `bg-white` in `app/` or `components/`. Use semantic / Aurora-Vault tokens and the existing `ChartLegendChip` colors.
- **KD #132 marking palette** (P light-blue / A yellow / EX cyan / L pink via `STATUS_CELL_WASH`) is unchanged.
- **`wide-grid.tsx` render-perf invariants** (native `<select>`, single `cells` Map, no per-cell prop drilling, `useMemo`'d columns) must be preserved — see the header comment in that file.
- **Export gate:** `registrar | school_admin | superadmin` plus the section's own assigned teachers.

---

## File Structure

- **Create** `lib/attendance/sheet-columns.ts` — pure axis helpers: `resolveColumnTag`, `eachDateInclusive`, `monthsInRange`, `monthKeyOf`, `monthLabelOf`, `MONTH_NAMES`, `ColumnTagCode`.
- **Create** `lib/attendance/sheet-summary.ts` — pure summary math: `Mark`, `SummaryStat`, `summarizeMarks`, `summarizeByMonth`, `MonthlySummary`.
- **Create** `lib/attendance/sheet-export.ts` — server-only `buildAttendanceSheetWorkbook(input)` + `AttendanceSheetExportInput` type.
- **Create** `app/api/attendance/[sectionId]/export/route.ts` — GET, streams `.xlsx`.
- **Create** `components/attendance/sheet-context.tsx` — context card + collapsible term-calendar lists (client).
- **Create** `components/attendance/export-sheet-button.tsx` — download button (client).
- **Create** `components/ui/collapsible.tsx` — shadcn primitive (installed).
- **Modify** `components/attendance/wide-grid.tsx` — SE/EX column tags; Details toggle; Summary toggle.
- **Modify** `app/(attendance)/attendance/[sectionId]/page.tsx` — resolve FCA name; mount context card + export button; pass term start/end.
- **Create** tests: `__tests__/attendance/sheet-summary.test.ts`, `__tests__/attendance/sheet-columns.test.ts`, `__tests__/attendance/sheet-export.test.ts`.

---

### Task 1: Pure summary engine (`sheet-summary.ts`)

**Files:**

- Create: `lib/attendance/sheet-summary.ts`
- Create: `lib/attendance/sheet-columns.ts` (month helpers only in this task; tag/date helpers added in Task 2)
- Test: `__tests__/attendance/sheet-summary.test.ts`

**Interfaces:**

- Produces: `summarizeMarks(marks: Mark[]): SummaryStat`; `summarizeByMonth(marks: Mark[]): { months: MonthlySummary[]; term: SummaryStat }`; types `Mark`, `SummaryStat`, `MonthlySummary`. Month helpers `monthKeyOf`, `monthLabelOf`, `MONTH_NAMES` live in `sheet-columns.ts` and are imported here.

- [ ] **Step 1: Write the month helpers in `sheet-columns.ts`** (this file is completed in Task 2; create it now with only the month helpers)

```ts
// lib/attendance/sheet-columns.ts
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** 'YYYY-MM' bucket key for an ISO date. */
export function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** 'June 2026' display label for a 'YYYY-MM' key. */
export function monthLabelOf(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}
```

- [ ] **Step 2: Write the failing test** `__tests__/attendance/sheet-summary.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  summarizeMarks,
  summarizeByMonth,
} from '@/lib/attendance/sheet-summary';

describe('summarizeMarks', () => {
  it('counts P/L/EX/A and computes % as (P+L+EX)/total', () => {
    const stat = summarizeMarks([
      { date: '2026-06-29', status: 'P' },
      { date: '2026-06-30', status: 'L' },
      { date: '2026-07-01', status: 'EX' },
      { date: '2026-07-02', status: 'A' },
    ]);
    expect(stat).toEqual({
      totalDays: 4,
      present: 1,
      late: 1,
      excused: 1,
      absent: 1,
      attendancePct: 75, // (1+1+1)/4 = 75.0
    });
  });

  it('excludes NC and null from both numerator and denominator', () => {
    const stat = summarizeMarks([
      { date: '2026-06-29', status: 'P' },
      { date: '2026-06-30', status: 'NC' },
      { date: '2026-07-01', status: null },
    ]);
    expect(stat.totalDays).toBe(1);
    expect(stat.attendancePct).toBe(100);
  });

  it('returns null % when there are no counted marks', () => {
    expect(
      summarizeMarks([{ date: '2026-06-29', status: 'NC' }]).attendancePct
    ).toBeNull();
    expect(summarizeMarks([]).attendancePct).toBeNull();
  });

  it('rounds % to 1 decimal place', () => {
    // 2 present of 3 marked = 66.666… → 66.7
    const stat = summarizeMarks([
      { date: '2026-06-29', status: 'P' },
      { date: '2026-06-30', status: 'P' },
      { date: '2026-07-01', status: 'A' },
    ]);
    expect(stat.attendancePct).toBe(66.7);
  });
});

describe('summarizeByMonth', () => {
  it('buckets by calendar month (sorted) and returns a term total', () => {
    const { months, term } = summarizeByMonth([
      { date: '2026-06-29', status: 'P' },
      { date: '2026-07-01', status: 'A' },
      { date: '2026-07-02', status: 'P' },
    ]);
    expect(months.map((m) => m.month)).toEqual(['2026-06', '2026-07']);
    expect(months[0].label).toBe('June 2026');
    expect(months[1].stat).toMatchObject({
      present: 1,
      absent: 1,
      totalDays: 2,
    });
    expect(term).toMatchObject({ present: 2, absent: 1, totalDays: 3 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run __tests__/attendance/sheet-summary.test.ts`
Expected: FAIL — cannot resolve `@/lib/attendance/sheet-summary`.

- [ ] **Step 4: Write `lib/attendance/sheet-summary.ts`**

```ts
import { monthKeyOf, monthLabelOf } from '@/lib/attendance/sheet-columns';
import type { AttendanceStatus } from '@/lib/schemas/attendance';

export type Mark = { date: string; status: AttendanceStatus | null };

export type SummaryStat = {
  /** Days carrying a counted mark (P/L/EX/A). NC and null are excluded. */
  totalDays: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
  /** (P+L+EX)/totalDays * 100, 1dp. null when totalDays === 0. */
  attendancePct: number | null;
};

export type MonthlySummary = {
  month: string;
  label: string;
  stat: SummaryStat;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * HFSE sheet formula (read from AY2026 Term 3 Attendance.xlsx):
 *   TotalDays = count of P/L/EX/A marks (COUNTA over the date range)
 *   Attendance % = (Present + Late + Excused) / TotalDays
 * NC and unmarked days are excluded — they behave like the template's blank cell.
 */
export function summarizeMarks(marks: Mark[]): SummaryStat {
  let present = 0;
  let late = 0;
  let excused = 0;
  let absent = 0;
  for (const mk of marks) {
    switch (mk.status) {
      case 'P':
        present++;
        break;
      case 'L':
        late++;
        break;
      case 'EX':
        excused++;
        break;
      case 'A':
        absent++;
        break;
      default:
        break; // 'NC' and null excluded
    }
  }
  const totalDays = present + late + excused + absent;
  const attendancePct =
    totalDays === 0
      ? null
      : round1(((present + late + excused) / totalDays) * 100);
  return { totalDays, present, late, excused, absent, attendancePct };
}

/** Per-student: month blocks (chronological) + term total. */
export function summarizeByMonth(marks: Mark[]): {
  months: MonthlySummary[];
  term: SummaryStat;
} {
  const byMonth = new Map<string, Mark[]>();
  for (const mk of marks) {
    const k = monthKeyOf(mk.date);
    const arr = byMonth.get(k) ?? [];
    arr.push(mk);
    byMonth.set(k, arr);
  }
  const months: MonthlySummary[] = Array.from(byMonth.keys())
    .sort()
    .map((k) => ({
      month: k,
      label: monthLabelOf(k),
      stat: summarizeMarks(byMonth.get(k)!),
    }));
  return { months, term: summarizeMarks(marks) };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/attendance/sheet-summary.test.ts`
Expected: PASS (4 in `summarizeMarks`, 1 in `summarizeByMonth`).

- [ ] **Step 6: Commit**

```bash
git add lib/attendance/sheet-summary.ts lib/attendance/sheet-columns.ts __tests__/attendance/sheet-summary.test.ts
git commit -m "feat(attendance): pure summary engine for sheet (P+L+EX)/marked-days"
```

---

### Task 2: Column-tag + date/axis helpers (`sheet-columns.ts`)

**Files:**

- Modify: `lib/attendance/sheet-columns.ts` (add tag + date helpers to the month helpers from Task 1)
- Test: `__tests__/attendance/sheet-columns.test.ts`

**Interfaces:**

- Consumes: `CalendarEventRow` from `@/lib/attendance/calendar`, `DayType` from `@/lib/schemas/attendance`.
- Produces: `resolveColumnTag({ dayType, events }): ColumnTagCode | null`; `eachDateInclusive(startIso, endIso): string[]`; `monthsInRange(startIso, endIso): string[]`; type `ColumnTagCode = 'PH'|'SH'|'HBL'|'NC'|'SE'|'EX'`.

- [ ] **Step 1: Write the failing test** `__tests__/attendance/sheet-columns.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  resolveColumnTag,
  eachDateInclusive,
  monthsInRange,
} from '@/lib/attendance/sheet-columns';
import type { CalendarEventRow } from '@/lib/attendance/calendar';

function ev(
  category: CalendarEventRow['category'],
  date = '2026-07-01'
): CalendarEventRow {
  return {
    id: 'e',
    termId: 't',
    startDate: date,
    endDate: date,
    label: 'x',
    category,
    audience: 'all',
    tentative: false,
  };
}

describe('resolveColumnTag', () => {
  it('tags holidays from day_type', () => {
    expect(resolveColumnTag({ dayType: 'public_holiday', events: [] })).toBe(
      'PH'
    );
    expect(resolveColumnTag({ dayType: 'school_holiday', events: [] })).toBe(
      'SH'
    );
    expect(resolveColumnTag({ dayType: 'no_class', events: [] })).toBe('NC');
  });
  it('shows EX for an exam event on a school day', () => {
    expect(
      resolveColumnTag({ dayType: 'school_day', events: [ev('term_exam')] })
    ).toBe('EX');
  });
  it('shows SE for any non-exam event on a school day', () => {
    expect(
      resolveColumnTag({ dayType: 'school_day', events: [ev('school_event')] })
    ).toBe('SE');
  });
  it('exam wins over a co-located non-exam event', () => {
    expect(
      resolveColumnTag({
        dayType: 'school_day',
        events: [ev('school_event'), ev('term_exam')],
      })
    ).toBe('EX');
  });
  it('holiday day-type wins over an event on the same date', () => {
    expect(
      resolveColumnTag({
        dayType: 'public_holiday',
        events: [ev('school_event')],
      })
    ).toBe('PH');
  });
  it('HBL day-type with no event tags HBL; a plain school day is untagged', () => {
    expect(resolveColumnTag({ dayType: 'hbl', events: [] })).toBe('HBL');
    expect(resolveColumnTag({ dayType: 'school_day', events: [] })).toBeNull();
    expect(resolveColumnTag({ dayType: null, events: [] })).toBeNull();
  });
});

describe('eachDateInclusive', () => {
  it('enumerates every calendar date incl weekends, inclusive of both ends', () => {
    expect(eachDateInclusive('2026-06-29', '2026-07-02')).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
    ]);
  });
});

describe('monthsInRange', () => {
  it('lists every YYYY-MM the window touches', () => {
    expect(monthsInRange('2026-06-29', '2026-09-04')).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/attendance/sheet-columns.test.ts`
Expected: FAIL — `resolveColumnTag`/`eachDateInclusive`/`monthsInRange` not exported.

- [ ] **Step 3: Append the helpers to `lib/attendance/sheet-columns.ts`**

```ts
import type { CalendarEventRow } from '@/lib/attendance/calendar';
import type { DayType } from '@/lib/schemas/attendance';

export type ColumnTagCode = 'PH' | 'SH' | 'HBL' | 'NC' | 'SE' | 'EX';

/**
 * The single most-informative tag for a date column, matching HFSE's sheet:
 * holidays show PH/SH/NC from day_type; an exam event shows EX; any other
 * event shows SE; HBL keeps its tag; a plain (or unconfigured) school day is
 * untagged. Holiday day-types win over events; exam wins over other events.
 */
export function resolveColumnTag(args: {
  dayType: DayType | null;
  events: CalendarEventRow[];
}): ColumnTagCode | null {
  const { dayType, events } = args;
  if (dayType === 'public_holiday') return 'PH';
  if (dayType === 'school_holiday') return 'SH';
  if (dayType === 'no_class') return 'NC';
  if (events.some((e) => e.category === 'term_exam')) return 'EX';
  if (events.length > 0) return 'SE';
  if (dayType === 'hbl') return 'HBL';
  return null;
}

/** Every calendar date in [startIso, endIso] inclusive (incl weekends), yyyy-MM-dd. */
export function eachDateInclusive(startIso: string, endIso: string): string[] {
  const parse = (iso: string) =>
    new Date(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10))
    );
  const pad = (n: number) => String(n).padStart(2, '0');
  const out: string[] = [];
  const d = parse(startIso);
  const end = parse(endIso);
  while (d.getTime() <= end.getTime()) {
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Every 'YYYY-MM' the window [startIso, endIso] touches, chronological. */
export function monthsInRange(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let y = Number(startIso.slice(0, 4));
  let m = Number(startIso.slice(5, 7));
  const endY = Number(endIso.slice(0, 4));
  const endM = Number(endIso.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/attendance/sheet-columns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/attendance/sheet-columns.ts __tests__/attendance/sheet-columns.test.ts
git commit -m "feat(attendance): column-tag + date/month axis helpers for sheet fidelity"
```

---

### Task 3: Install Collapsible + build the context/calendar component

**Files:**

- Create: `components/ui/collapsible.tsx` (shadcn install)
- Create: `components/attendance/sheet-context.tsx`

**Interfaces:**

- Consumes: `CalendarEventRow`, `SchoolCalendarRow` from `@/lib/attendance/calendar`; `EVENT_CATEGORY_LABELS`, `DAY_TYPE_LABELS` from `@/lib/schemas/attendance`.
- Produces: `<SheetContextCard term courseLabel sectionName formAdviser scheduleLabel calendar events />` default export `SheetContextCard`.

- [ ] **Step 1: Install the shadcn Collapsible primitive**

Run:

```bash
npx shadcn@latest add collapsible
```

Expected: creates `components/ui/collapsible.tsx` exporting `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`. If the CLI prompts or fails in this environment, use the MCP tools `mcp__shadcn__get_add_command_for_items` then `mcp__shadcn__view_items_in_registries` for `collapsible` and write the file from the returned source. Do NOT substitute a different primitive (per project rule).

- [ ] **Step 2: Verify install**

Run: `git status --porcelain components/ui/collapsible.tsx`
Expected: the file is present (untracked).

- [ ] **Step 3: Write `components/attendance/sheet-context.tsx`**

```tsx
'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, GraduationCap, User } from 'lucide-react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Card } from '@/components/ui/card';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';

// Groups the four dated lists that the HFSE sheet shows as header boxes.
// Public/School holidays come from school_calendar day_type; School Events
// (SE) and Examinations (EX) come from calendar_events category.
type DatedItem = { date: string; label: string };

function formatRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10))
    ).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

export default function SheetContextCard({
  term,
  courseLabel,
  sectionName,
  formAdviser,
  scheduleLabel,
  calendar,
  events,
}: {
  term: { label: string };
  courseLabel: string;
  sectionName: string;
  formAdviser: string | null;
  scheduleLabel: string | null;
  calendar: SchoolCalendarRow[];
  events: CalendarEventRow[];
}) {
  const [open, setOpen] = useState(false);

  const lists = useMemo(() => {
    const publicHolidays: DatedItem[] = calendar
      .filter((c) => c.dayType === 'public_holiday')
      .map((c) => ({ date: c.date, label: c.label ?? 'Public holiday' }));
    const schoolHolidays: DatedItem[] = calendar
      .filter((c) => c.dayType === 'school_holiday')
      .map((c) => ({ date: c.date, label: c.label ?? 'School holiday' }));
    const examinations: DatedItem[] = events
      .filter((e) => e.category === 'term_exam')
      .map((e) => ({ date: e.startDate, label: e.label }));
    const schoolEvents: DatedItem[] = events
      .filter((e) => e.category !== 'term_exam')
      .map((e) => ({ date: e.startDate, label: e.label }));
    return { publicHolidays, schoolHolidays, examinations, schoolEvents };
  }, [calendar, events]);

  const totalDated =
    lists.publicHolidays.length +
    lists.schoolHolidays.length +
    lists.examinations.length +
    lists.schoolEvents.length;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <Meta icon={GraduationCap} label="Course" value={courseLabel} />
        <Meta label="Section" value={sectionName} />
        <Meta label="Term" value={term.label} />
        {scheduleLabel && <Meta label="Schedule" value={scheduleLabel} />}
        <Meta
          icon={User}
          label="Form Class Adviser"
          value={formAdviser ?? 'Unassigned'}
        />
      </div>

      <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
        <CollapsibleTrigger className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground">
          <CalendarDays className="size-3.5" aria-hidden />
          Term calendar
          <span className="text-muted-foreground/70">({totalDated})</span>
          <ChevronDown
            className={
              'size-3.5 transition-transform ' + (open ? 'rotate-180' : '')
            }
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DateList title="School Events" items={lists.schoolEvents} />
          <DateList title="School Holidays" items={lists.schoolHolidays} />
          <DateList title="Public Holidays" items={lists.publicHolidays} />
          <DateList title="Examinations" items={lists.examinations} />
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function DateList({ title, items }: { title: string; items: DatedItem[] }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-indigo-deep">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <ul className="space-y-1 text-xs text-foreground">
          {items.map((it, i) => (
            <li key={`${it.date}-${i}`} className="flex gap-2">
              <span className="shrink-0 font-mono text-muted-foreground">
                {formatRange(it.date, it.date)}
              </span>
              <span className="truncate" title={it.label}>
                {it.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify it type-checks / builds**

Run: `npx tsc --noEmit`
Expected: no errors in the two new files. (If `brand-indigo-deep` is not a token, confirm against `app/globals.css` — it is used in `wide-grid.tsx` already, so it exists.)

- [ ] **Step 5: Commit**

```bash
git add components/ui/collapsible.tsx components/attendance/sheet-context.tsx
git commit -m "feat(attendance): collapsible context card + term-calendar lists"
```

---

### Task 4: Page wiring — resolve FCA name, mount context card, thread term dates

**Files:**

- Modify: `app/(attendance)/attendance/[sectionId]/page.tsx`

**Interfaces:**

- Consumes: `getTeacherEmailMap(): Promise<Array<[userId, email]>>` (`@/lib/auth/teacher-emails`), `getStaffDisplayEntries(): Promise<Array<[email, name]>>` (`@/lib/auth/staff-list`), `SheetContextCard` (Task 3).
- Produces: a resolved `adviserName: string | null`, mounted `<SheetContextCard>` on the sheet view, and `selectedTerm.start_date/end_date` available for the export button (Task 9).

- [ ] **Step 1: Add imports** near the existing imports in `page.tsx`

```tsx
import { getTeacherEmailMap } from '@/lib/auth/teacher-emails';
import { getStaffDisplayEntries } from '@/lib/auth/staff-list';
import SheetContextCard from '@/components/attendance/sheet-context';
```

- [ ] **Step 2: Resolve the adviser display name** — replace the existing adviser block (currently lines ~122–131, which fetch `adviserUserId` and comment "we skip that here")

```tsx
// Form adviser display (for the context card).
const { data: advisers } = await supabase
  .from('teacher_assignments')
  .select('teacher_user_id, role')
  .eq('section_id', sectionId)
  .eq('role', 'form_adviser')
  .limit(1);
const adviserUserId = advisers?.[0]?.teacher_user_id ?? null;

const [emailEntries, nameEntries] = await Promise.all([
  getTeacherEmailMap(),
  getStaffDisplayEntries(),
]);
const emailByUserId = new Map(emailEntries);
const nameByEmail = new Map(nameEntries);
const adviserEmail = adviserUserId
  ? (emailByUserId.get(adviserUserId) ?? null)
  : null;
const adviserName = adviserEmail
  ? (nameByEmail.get(adviserEmail) ?? adviserEmail)
  : null;
```

- [ ] **Step 3: Mount the context card on the sheet view** — immediately before the `{view === 'daily' ? (` block (after the term-level stats grid)

```tsx
{
  view === 'sheet' && (
    <SheetContextCard
      term={{ label: selectedTerm?.label ?? '' }}
      courseLabel={level?.label ?? ''}
      sectionName={section.name}
      formAdviser={adviserName}
      scheduleLabel={null}
      calendar={calendar}
      events={events}
    />
  );
}
```

(Note: `scheduleLabel` stays `null` until the section query selects `schedule`; selecting it is optional polish — the card hides the row when null. Leave `null` for v1 to avoid widening the section query.)

- [ ] **Step 4: Verify build + manual smoke**

Run: `npx next build`
Expected: clean compile.
Manual: open `/attendance/<sectionId>` (Term sheet). The context card shows Course · Section · Term · Form Class Adviser (a real name, not blank), and "Term calendar (N)" expands to the four dated lists.

- [ ] **Step 5: Commit**

```bash
git add "app/(attendance)/attendance/[sectionId]/page.tsx"
git commit -m "feat(attendance): resolve form-adviser name + mount sheet context card"
```

---

### Task 5: Wide-grid — `SE`/`EX` column tags from events

**Files:**

- Modify: `components/attendance/wide-grid.tsx`

**Interfaces:**

- Consumes: `resolveColumnTag`, `ColumnTagCode` (`@/lib/attendance/sheet-columns`).
- Produces: column headers that render `PH/SH/HBL/NC/SE/EX` via one shared resolver; the `★` event marker is replaced by the SE/EX tag.

- [ ] **Step 1: Add imports + a tag→color map** (near the existing `DAY_TYPE_CHIP_COLOR`)

```tsx
import {
  resolveColumnTag,
  type ColumnTagCode,
} from '@/lib/attendance/sheet-columns';

// Tag → ChartLegendChip color. PH/SH/HBL/NC keep their existing day-type
// colors; EX (examination) reuses the notable 'primary' wash, SE (school
// event) reuses 'fresh'. Letter + tooltip always present — color is never
// the only signal.
const COLUMN_TAG_COLOR: Record<ColumnTagCode, ChartLegendChipColor> = {
  PH: 'very-stale',
  SH: 'stale',
  HBL: 'primary',
  NC: 'neutral',
  EX: 'primary',
  SE: 'fresh',
};
```

- [ ] **Step 2: Compute the tag per column** — in the `columns` `useMemo`, add a `tag` field to each returned column object

```tsx
return {
  iso: c.date,
  dayType: c.dayType,
  encodable: isEncodableDayType(c.dayType),
  label: c.label,
  events: evBy(c.date),
  drawMonthBoundary: isMonthStart && idx > 0,
  tag: resolveColumnTag({ dayType: c.dayType, events: evBy(c.date) }),
};
```

- [ ] **Step 3: Render the tag instead of the old day-type chip + `★`** — in the date-row header cell, replace the `headerChipLabel` block AND the `c.events.length > 0` star block with a single tag chip

```tsx
{
  c.tag && (
    <div className="mt-0.5 flex justify-center">
      <ChartLegendChip
        color={COLUMN_TAG_COLOR[c.tag]}
        label={c.tag}
        className="px-1 py-px text-[9px] tracking-[0.1em]"
      />
    </div>
  );
}
```

Delete the now-unused `DAY_TYPE_HEADER_CHIP_LABEL` constant and the `headerChipLabel` local. The `dayTypeTitle` tooltip (which already appends the event label) stays — so hovering an SE/EX column still names the event.

- [ ] **Step 4: Update the legend** — add SE/EX rows to the "Calendar · column header" legend block

```tsx
          <DayTypeLegendChip dayType="hbl" letter="HBL" description="HBL · Attendance recorded" />
          <DayTypeLegendChip dayType="no_class" letter="NC" description="No class" />
          <span className="inline-flex items-center gap-2">
            <ChartLegendChip color={COLUMN_TAG_COLOR.SE} label="SE" />
            <span className="text-[12px] font-medium text-foreground">School event</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <ChartLegendChip color={COLUMN_TAG_COLOR.EX} label="EX" />
            <span className="text-[12px] font-medium text-foreground">Examination</span>
          </span>
```

Remove the now-stale `★ marks dates with a calendar event.` footnote line.

- [ ] **Step 5: Verify build + manual smoke**

Run: `npx next build`
Expected: clean compile (no unused-symbol errors — confirm `DAY_TYPE_HEADER_CHIP_LABEL` is fully removed).
Manual: a date with a `term_exam` event shows `EX`; a date with a `school_event` shows `SE`; holidays still show PH/SH; hover shows the event label.

- [ ] **Step 6: Commit**

```bash
git add components/attendance/wide-grid.tsx lib/attendance/sheet-columns.ts
git commit -m "feat(attendance): SE/EX column tags on the term sheet from calendar events"
```

---

### Task 6: Wide-grid — "Details" toggle (roster columns)

**Files:**

- Modify: `components/attendance/wide-grid.tsx`

**Interfaces:**

- Consumes: existing `WideGridEnrolment.busNo` + `classroomOfficerRole`.
- Produces: a `showDetails` toggle that adds `Bus No. / Student Care`, `Academics`, `Admin` columns to the roster pane. Academics/Admin render `—` (read-only placeholders, no persistence).

- [ ] **Step 1: Add toggle state + a derived bus/care string** — inside `AttendanceWideGrid`, after `const [cells, setCells] = …`

```tsx
const [showDetails, setShowDetails] = useState(false);
const [showSummary, setShowSummary] = useState(false); // used in Task 7

function busCareLabel(e: WideGridEnrolment): string {
  return [e.busNo, e.classroomOfficerRole].filter(Boolean).join(' / ') || '—';
}
```

- [ ] **Step 2: Add a toolbar above the grid card** — render a small control row before the `<Card className="p-0 overflow-hidden">`

```tsx
<div className="flex flex-wrap items-center gap-2">
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
</div>
```

- [ ] **Step 3: Widen the roster pane colgroup + header when `showDetails`** — in the roster-pane `<colgroup>`, append three columns conditionally

```tsx
<colgroup>
  <col style={{ width: 40 }} />
  <col style={{ width: 180 }} />
  {showDetails && <col style={{ width: 120 }} />}
  {showDetails && <col style={{ width: 90 }} />}
  {showDetails && <col style={{ width: 90 }} />}
</colgroup>
```

And in the roster header second row (the `# | Student` row), append three `<TableHead>` when `showDetails`:

```tsx
<TableHead className="h-auto border-b border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground">
  Student
</TableHead>;
{
  showDetails && (
    <>
      <TableHead className="h-auto border-b border-l border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground">
        Bus / Student Care
      </TableHead>
      <TableHead className="h-auto border-b border-l border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground">
        Academics
      </TableHead>
      <TableHead className="h-auto border-b border-l border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground">
        Admin
      </TableHead>
    </>
  );
}
```

Also bump the "Roster" `colSpan` from `2` to `{showDetails ? 5 : 2}`.

- [ ] **Step 4: Add the three body cells per roster row** — after the student-name `<TableCell>` in the roster-pane body

```tsx
{
  showDetails && (
    <>
      <TableCell className="overflow-hidden border-l border-border px-2 py-1 text-[11px] text-foreground">
        {busCareLabel(e)}
      </TableCell>
      <TableCell className="border-l border-border px-2 py-1 text-center text-[11px] text-muted-foreground">
        —
      </TableCell>
      <TableCell className="border-l border-border px-2 py-1 text-center text-[11px] text-muted-foreground">
        —
      </TableCell>
    </>
  );
}
```

- [ ] **Step 5: Verify build + manual smoke**

Run: `npx next build`
Expected: clean compile.
Manual: "Show details" reveals the three columns; Bus/Student Care shows e.g. `BUS 5 / HAPI HAUS`; Academics/Admin show `—`; roster and calendar panes stay row-aligned (row heights unchanged).

- [ ] **Step 6: Commit**

```bash
git add components/attendance/wide-grid.tsx
git commit -m "feat(attendance): roster Details toggle (bus/care + academics/admin placeholders)"
```

---

### Task 7: Wide-grid — "Summary" toggle (per-month + term stats)

**Files:**

- Modify: `components/attendance/wide-grid.tsx`
- Test: `__tests__/attendance/wide-grid-summary.test.tsx`

**Interfaces:**

- Consumes: `summarizeByMonth`, `type Mark` (`@/lib/attendance/sheet-summary`).
- Produces: a `showSummary` panel (a `<Card>` below the grid) listing each non-withdrawn student's per-month + term Total/P/L/EX/A/% computed from the live `cells` Map.

- [ ] **Step 1: Add the summary import**

```tsx
import { summarizeByMonth, type Mark } from '@/lib/attendance/sheet-summary';
```

- [ ] **Step 2: Derive per-student marks from the cells Map** — add a `useMemo` after `monthGroups`

```tsx
// Per-student marks (from the live cells Map) → summary rows. Recomputes on
// edit so the panel stays live. Withdrawn rows excluded (match the roster).
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

- [ ] **Step 3: Render the summary card** — after the grid `<Card>` and before the legend `<Card>`

```tsx
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
```

- [ ] **Step 4: Add the `SummaryStudentRows` helper component** at the bottom of the file (sibling to `StatusLegendChip`)

```tsx
function SummaryStudentRows({
  name,
  months,
  term,
}: {
  name: string;
  months: import('@/lib/attendance/sheet-summary').MonthlySummary[];
  term: import('@/lib/attendance/sheet-summary').SummaryStat;
}) {
  const pct = (p: number | null) => (p == null ? '—' : `${p.toFixed(1)}%`);
  return (
    <>
      {months.map((m, i) => (
        <TableRow key={m.month}>
          {i === 0 ? (
            <TableCell
              rowSpan={months.length + 1}
              className="px-3 py-2 align-top font-medium text-foreground"
            >
              {name}
            </TableCell>
          ) : null}
          <TableCell className="px-2 py-2 text-muted-foreground">
            {m.label}
          </TableCell>
          <TableCell className="px-2 py-2 text-right tabular-nums">
            {m.stat.totalDays}
          </TableCell>
          <TableCell className="px-2 py-2 text-right tabular-nums">
            {m.stat.present}
          </TableCell>
          <TableCell className="px-2 py-2 text-right tabular-nums">
            {m.stat.late}
          </TableCell>
          <TableCell className="px-2 py-2 text-right tabular-nums">
            {m.stat.excused}
          </TableCell>
          <TableCell className="px-2 py-2 text-right tabular-nums">
            {m.stat.absent}
          </TableCell>
          <TableCell className="px-2 py-2 text-right tabular-nums">
            {pct(m.stat.attendancePct)}
          </TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-muted/30 font-semibold">
        <TableCell className="px-2 py-2">Term total</TableCell>
        <TableCell className="px-2 py-2 text-right tabular-nums">
          {term.totalDays}
        </TableCell>
        <TableCell className="px-2 py-2 text-right tabular-nums">
          {term.present}
        </TableCell>
        <TableCell className="px-2 py-2 text-right tabular-nums">
          {term.late}
        </TableCell>
        <TableCell className="px-2 py-2 text-right tabular-nums">
          {term.excused}
        </TableCell>
        <TableCell className="px-2 py-2 text-right tabular-nums">
          {term.absent}
        </TableCell>
        <TableCell className="px-2 py-2 text-right tabular-nums">
          {pct(term.attendancePct)}
        </TableCell>
      </TableRow>
    </>
  );
}
```

- [ ] **Step 5: Write a component test** `__tests__/attendance/wide-grid-summary.test.tsx`

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttendanceWideGrid } from '@/components/attendance/wide-grid';
import type { SchoolCalendarRow } from '@/lib/attendance/calendar';

const cal: SchoolCalendarRow[] = [
  {
    id: '1',
    termId: 't',
    date: '2026-06-29',
    dayType: 'school_day',
    isHoliday: false,
    label: null,
    audience: 'all',
    hblOverlay: false,
  },
  {
    id: '2',
    termId: 't',
    date: '2026-07-01',
    dayType: 'school_day',
    isHoliday: false,
    label: null,
    audience: 'all',
    hblOverlay: false,
  },
];

it('summary panel computes (P+L+EX)/marked-days from seeded marks when toggled', async () => {
  const { default: userEvent } = await import('@testing-library/user-event');
  const user = userEvent.setup();
  render(
    <AttendanceWideGrid
      sectionId="s"
      termId="t"
      canWriteNc={false}
      events={[]}
      calendar={cal}
      enrolments={[
        {
          enrolmentId: 'e1',
          indexNumber: 1,
          studentNumber: 'S1',
          studentName: 'DOE, Jane',
          busNo: null,
          classroomOfficerRole: null,
          withdrawn: false,
          compassionateUsed: 0,
          compassionateAllowance: 5,
          vlUsedThisTerm: 0,
          vlAllowance: 1,
          enrollmentDate: null,
        },
      ]}
      initialDaily={[
        {
          id: 'd1',
          sectionStudentId: 'e1',
          termId: 't',
          date: '2026-06-29',
          status: 'P',
          exReason: null,
          periodId: null,
          recordedBy: null,
          recordedAt: '',
        },
        {
          id: 'd2',
          sectionStudentId: 'e1',
          termId: 't',
          date: '2026-07-01',
          status: 'A',
          exReason: null,
          periodId: null,
          recordedBy: null,
          recordedAt: '',
        },
      ]}
    />
  );
  await user.click(screen.getByRole('button', { name: /show summary/i }));
  // Term total row: 2 marked days, 1 present, 1 absent → 50.0%
  expect(screen.getByText('Term total')).toBeInTheDocument();
  expect(screen.getByText('50.0%')).toBeInTheDocument();
});
```

(If `@testing-library/user-event` is not installed, replace the click with `fireEvent.click` from `@testing-library/react`.)

- [ ] **Step 6: Run the test**

Run: `npx vitest run __tests__/attendance/wide-grid-summary.test.tsx`
Expected: PASS.

- [ ] **Step 7: Verify build + manual smoke**

Run: `npx next build`
Expected: clean compile.
Manual: "Show summary" reveals per-student month rows + a term-total row; editing a cell updates the numbers live.

- [ ] **Step 8: Commit**

```bash
git add components/attendance/wide-grid.tsx __tests__/attendance/wide-grid-summary.test.tsx
git commit -m "feat(attendance): live per-month + term summary panel on the term sheet"
```

---

### Task 8: Export builder (`sheet-export.ts`)

**Files:**

- Create: `lib/attendance/sheet-export.ts`
- Test: `__tests__/attendance/sheet-export.test.ts`

**Interfaces:**

- Consumes: `summarizeMarks` (`sheet-summary`); `resolveColumnTag`, `eachDateInclusive`, `monthsInRange`, `monthLabelOf` (`sheet-columns`); `AttendanceStatus`, `DayType` (`schemas/attendance`); `CalendarEventRow` (`calendar`); `xlsx`.
- Produces: `buildAttendanceSheetWorkbook(input: AttendanceSheetExportInput): Buffer`; `type AttendanceSheetExportInput`.

- [ ] **Step 1: Write the failing test** `__tests__/attendance/sheet-export.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildAttendanceSheetWorkbook,
  type AttendanceSheetExportInput,
} from '@/lib/attendance/sheet-export';

function baseInput(): AttendanceSheetExportInput {
  return {
    schoolName: 'HFSE INTERNATIONAL SCHOOL',
    sheetName: 'P1 Obedience',
    term: {
      label: 'Term 3',
      termNumber: 3,
      startDate: '2026-06-29',
      endDate: '2026-07-02',
    },
    courseLabel: 'Primary One',
    sectionName: 'Obedience',
    formAdviser: 'Ms. Kristel',
    scheduleLabel: null,
    calendarByDate: new Map([
      ['2026-06-29', { dayType: 'school_day', label: null }],
      ['2026-06-30', { dayType: 'school_day', label: null }],
      ['2026-07-01', { dayType: 'public_holiday', label: 'Youth Day' }],
      ['2026-07-02', { dayType: 'school_day', label: null }],
    ]),
    events: [],
    students: [
      {
        indexNumber: 1,
        fullName: 'DOE, Jane',
        busCare: 'BUS 5',
        withdrawn: false,
        marksByDate: new Map([
          ['2026-06-29', 'P'],
          ['2026-06-30', 'L'],
          ['2026-07-02', 'A'],
        ]),
      },
    ],
  };
}

describe('buildAttendanceSheetWorkbook', () => {
  it('produces one worksheet named after the section', () => {
    const wb = XLSX.read(buildAttendanceSheetWorkbook(baseInput()), {
      type: 'buffer',
    });
    expect(wb.SheetNames).toContain('P1 Obedience');
  });

  it('writes the title band + class info', () => {
    const wb = XLSX.read(buildAttendanceSheetWorkbook(baseInput()), {
      type: 'buffer',
    });
    const ws = wb.Sheets['P1 Obedience'];
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
    }) as string[][];
    const flat = aoa.flat().map(String);
    expect(flat).toContain('HFSE INTERNATIONAL SCHOOL');
    expect(flat).toContain('STUDENT ATTENDANCE SHEET');
    expect(flat).toContain('Ms. Kristel');
    expect(flat).toContain('Primary One');
  });

  it('renders every date in the term window incl weekends', () => {
    const wb = XLSX.read(buildAttendanceSheetWorkbook(baseInput()), {
      type: 'buffer',
    });
    const ws = wb.Sheets['P1 Obedience'];
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
    }) as string[][];
    const flat = aoa.flat().map(String);
    // 2026-06-29..2026-07-02 = 4 dates including weekend boundaries
    for (const d of ['29 Jun', '30 Jun', '1 Jul', '2 Jul']) {
      expect(flat.some((c) => c.includes(d))).toBe(true);
    }
  });

  it('writes the marks and the HFSE summary (P+L+EX)/marked-days', () => {
    const wb = XLSX.read(buildAttendanceSheetWorkbook(baseInput()), {
      type: 'buffer',
    });
    const ws = wb.Sheets['P1 Obedience'];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as (
      | string
      | number
    )[][];
    const flat = aoa.flat();
    // marks present
    expect(flat).toContain('P');
    expect(flat).toContain('L');
    expect(flat).toContain('A');
    // term summary: 3 marked days, (P+L)=2 in-attendance → 66.7
    expect(flat).toContain(66.7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/attendance/sheet-export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/attendance/sheet-export.ts`**

```ts
import 'server-only';

import * as XLSX from 'xlsx';

import type { CalendarEventRow } from '@/lib/attendance/calendar';
import {
  eachDateInclusive,
  monthLabelOf,
  monthsInRange,
  resolveColumnTag,
} from '@/lib/attendance/sheet-columns';
import { summarizeMarks, type Mark } from '@/lib/attendance/sheet-summary';
import type { AttendanceStatus, DayType } from '@/lib/schemas/attendance';

// Literal reproduction of HFSE's per-section attendance sheet
// (AY2026 Term 3 Attendance.xlsx). One worksheet. Summary VALUES are
// precomputed via the shared summary engine (not Excel formulas) so the
// export and the live panel can't diverge.

export type AttendanceSheetExportInput = {
  schoolName: string; // 'HFSE INTERNATIONAL SCHOOL' | 'HFSE YOUNGSTARTERS'
  sheetName: string; // worksheet tab name, e.g. 'P1 Obedience'
  term: {
    label: string;
    termNumber: number;
    startDate: string;
    endDate: string;
  };
  courseLabel: string;
  sectionName: string;
  formAdviser: string | null;
  scheduleLabel: string | null;
  /** date → { dayType, label } from school_calendar (dates not present = no tag). */
  calendarByDate: Map<string, { dayType: DayType; label: string | null }>;
  events: CalendarEventRow[];
  students: Array<{
    indexNumber: number;
    fullName: string;
    busCare: string | null;
    withdrawn: boolean;
    marksByDate: Map<string, AttendanceStatus | null>;
  }>;
};

const SUMMARY_SUBCOLS = [
  'Total Days',
  'Present',
  'Late',
  'Excused',
  'Absent',
  'Attendance %',
] as const;

function shortDate(iso: string): string {
  return new Date(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10))
  ).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
}

export function buildAttendanceSheetWorkbook(
  input: AttendanceSheetExportInput
): Buffer {
  const dates = eachDateInclusive(input.term.startDate, input.term.endDate);
  const months = monthsInRange(input.term.startDate, input.term.endDate);
  const eventsByDate = (iso: string) =>
    input.events.filter((e) => iso >= e.startDate && iso <= e.endDate);

  const aoa: (string | number)[][] = [];
  const merges: XLSX.Range[] = [];

  // ── Title band ──
  aoa.push([input.schoolName]);
  aoa.push(['STUDENT ATTENDANCE SHEET']);
  aoa.push([]);

  // ── Class info + legend (compact rows) ──
  aoa.push([
    'Term',
    String(input.term.termNumber),
    '',
    'LEGEND',
    'P',
    'Present',
  ]);
  aoa.push(['Course', input.courseLabel, '', '', 'A', 'Absent']);
  aoa.push([
    'Section',
    input.sectionName,
    '',
    '',
    'EX',
    'Excused (MC or Excuse Leave)',
  ]);
  aoa.push([
    'Form Class Adviser',
    input.formAdviser ?? '',
    '',
    '',
    'L',
    'Late',
  ]);
  if (input.scheduleLabel) aoa.push(['Schedule', input.scheduleLabel]);
  aoa.push([]);

  // ── Dated lists (Events / Holidays / PH / Examination) ──
  const exams = input.events.filter((e) => e.category === 'term_exam');
  const schoolEvents = input.events.filter((e) => e.category !== 'term_exam');
  const phRows = dates
    .filter((d) => input.calendarByDate.get(d)?.dayType === 'public_holiday')
    .map((d) => ({
      date: d,
      label: input.calendarByDate.get(d)?.label ?? 'Public holiday',
    }));
  const shRows = dates
    .filter((d) => input.calendarByDate.get(d)?.dayType === 'school_holiday')
    .map((d) => ({
      date: d,
      label: input.calendarByDate.get(d)?.label ?? 'School holiday',
    }));
  const listBlock = (
    title: string,
    items: Array<{ date: string; label: string }>
  ) => {
    aoa.push([title]);
    for (const it of items) aoa.push([shortDate(it.date), it.label]);
  };
  listBlock(
    'SCHOOL EVENTS',
    schoolEvents.map((e) => ({ date: e.startDate, label: e.label }))
  );
  listBlock('SCHOOL HOLIDAY', shRows);
  listBlock('PUBLIC HOLIDAY', phRows);
  listBlock(
    'EXAMINATION',
    exams.map((e) => ({ date: e.startDate, label: e.label }))
  );
  aoa.push([]);

  // ── Grid header rows ──
  // Row A: fixed roster headers + date tags + summary block group labels.
  // Row B: blank roster cells + the date numbers + summary sub-columns.
  const fixedHeaders = [
    'Index No',
    'Bus No. / Student Care',
    'Academics',
    'Admin',
    'Full Name',
  ];
  const tagRow: (string | number)[] = fixedHeaders.map(() => '');
  const dateRow: (string | number)[] = [...fixedHeaders];

  for (const iso of dates) {
    const cal = input.calendarByDate.get(iso) ?? null;
    const tag = resolveColumnTag({
      dayType: cal?.dayType ?? null,
      events: eventsByDate(iso),
    });
    tagRow.push(tag ?? '');
    dateRow.push(shortDate(iso));
  }
  // Summary group headers: one block per month + a term-total block.
  const summaryGroupStart = tagRow.length;
  for (const mk of [...months, 'TERM']) {
    const groupLabel =
      mk === 'TERM' ? `${input.term.label} total` : monthLabelOf(mk);
    const start = tagRow.length;
    tagRow.push(groupLabel);
    dateRow.push(SUMMARY_SUBCOLS[0]);
    for (let i = 1; i < SUMMARY_SUBCOLS.length; i++) {
      tagRow.push('');
      dateRow.push(SUMMARY_SUBCOLS[i]);
    }
    merges.push({ s: { r: 0, c: start }, e: { r: 0, c: tagRow.length - 1 } }); // placeholder; re-based below
  }
  // The two header rows are appended after the title/legend/list block, so the
  // merge row indices computed above (r:0) must be shifted to the real row.
  const tagRowIndex = aoa.length;
  const dateRowIndex = aoa.length + 1;
  aoa.push(tagRow);
  aoa.push(dateRow);
  // Re-base the summary group merges onto tagRowIndex.
  const rebased = merges.map((m) => ({
    s: { r: tagRowIndex, c: m.s.c },
    e: { r: tagRowIndex, c: m.e.c },
  }));

  // ── Student rows ──
  for (const st of input.students) {
    const row: (string | number)[] = [
      st.indexNumber,
      st.busCare ?? '',
      '', // Academics — placeholder (v1)
      '', // Admin — placeholder (v1)
      st.withdrawn ? `${st.fullName || ''} (Withdrawn)`.trim() : st.fullName,
    ];
    for (const iso of dates) {
      const s = st.marksByDate.get(iso) ?? null;
      row.push(s && s !== 'NC' ? s : ''); // NC → blank (matches template)
    }
    // Per-month + term summary VALUES.
    const allMarks: Mark[] = dates.map((d) => ({
      date: d,
      status: st.marksByDate.get(d) ?? null,
    }));
    for (const mk of [...months, 'TERM']) {
      const scoped =
        mk === 'TERM'
          ? allMarks
          : allMarks.filter((m) => m.date.slice(0, 7) === mk);
      const stat = summarizeMarks(scoped);
      row.push(
        stat.totalDays,
        stat.present,
        stat.late,
        stat.excused,
        stat.absent,
        stat.attendancePct == null ? '' : stat.attendancePct
      );
    }
    aoa.push(row);
  }

  // ── Build worksheet ──
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Title merges across the first few columns for readability.
  rebased.push(
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }
  );
  ws['!merges'] = rebased;

  const wb = XLSX.utils.book_new();
  // Excel tab names cap at 31 chars and forbid : \ / ? * [ ].
  const safeTab = input.sheetName.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, safeTab);
  void summaryGroupStart; // (kept for readability; not needed downstream)
  void dateRowIndex;
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/attendance/sheet-export.test.ts`
Expected: PASS (4 assertions). If the `void`/unused locals trip a lint rule during build, delete `summaryGroupStart`, `dateRowIndex` and their `void` lines.

- [ ] **Step 5: Commit**

```bash
git add lib/attendance/sheet-export.ts __tests__/attendance/sheet-export.test.ts
git commit -m "feat(attendance): xlsx export builder reproducing the HFSE sheet"
```

---

### Task 9: Export route + "Export sheet" button

**Files:**

- Create: `app/api/attendance/[sectionId]/export/route.ts`
- Create: `components/attendance/export-sheet-button.tsx`
- Modify: `app/(attendance)/attendance/[sectionId]/page.tsx` (mount the button)

**Interfaces:**

- Consumes: `buildAttendanceSheetWorkbook` + `AttendanceSheetExportInput` (Task 8); `requireRole`; existing loaders `getDailyForSection`, `getDedupedSchoolCalendarForTerm`, `getCalendarEventsForTerm`; `getTeacherEmailMap` + `getStaffDisplayEntries`.
- Produces: `GET /api/attendance/[sectionId]/export?term_id=…` → `.xlsx`; `<ExportSheetButton sectionId termId />`.

- [ ] **Step 1: Write the route** `app/api/attendance/[sectionId]/export/route.ts`

```ts
import { type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  getCalendarEventsForTerm,
  getDedupedSchoolCalendarForTerm,
} from '@/lib/attendance/calendar';
import { getDailyForSection } from '@/lib/attendance/queries';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import { getTeacherEmailMap } from '@/lib/auth/teacher-emails';
import { getStaffDisplayEntries } from '@/lib/auth/staff-list';
import {
  buildAttendanceSheetWorkbook,
  type AttendanceSheetExportInput,
} from '@/lib/attendance/sheet-export';
import type { AttendanceStatus, DayType } from '@/lib/schemas/attendance';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  const { sectionId } = await params;
  const termId = new URL(req.url).searchParams.get('term_id');
  if (!termId)
    return new Response('Missing required ?term_id= parameter.', {
      status: 400,
    });

  // Gate: registrar+ OR a teacher assigned to this section.
  const auth = await requireRole([
    'registrar',
    'school_admin',
    'superadmin',
    'teacher',
  ]);
  if ('error' in auth) return auth.error;
  const service = createServiceClient();
  if (auth.user.role === 'teacher') {
    const session = await getSessionUser();
    const { data: assigned } = await service
      .from('teacher_assignments')
      .select('id')
      .eq('section_id', sectionId)
      .eq('teacher_user_id', session?.id ?? '')
      .limit(1);
    if (!assigned || assigned.length === 0) {
      return new Response('Not assigned to this section.', { status: 403 });
    }
  }

  // Section + level + AY.
  const { data: sectionRaw } = await service
    .from('sections')
    .select('id, name, academic_year_id, level:levels(code, label)')
    .eq('id', sectionId)
    .maybeSingle();
  if (!sectionRaw) return new Response('Section not found.', { status: 404 });
  const section = sectionRaw as {
    id: string;
    name: string;
    academic_year_id: string;
    level:
      | { code: string; label: string }
      | { code: string; label: string }[]
      | null;
  };
  const level = Array.isArray(section.level) ? section.level[0] : section.level;

  // Term.
  const { data: termRaw } = await service
    .from('terms')
    .select('id, label, term_number, start_date, end_date')
    .eq('id', termId)
    .maybeSingle();
  if (!termRaw) return new Response('Term not found.', { status: 404 });
  const term = termRaw as {
    id: string;
    label: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
  };
  if (!term.start_date || !term.end_date) {
    return new Response('Term has no start/end dates configured.', {
      status: 400,
    });
  }

  // Form adviser name.
  const { data: advisers } = await service
    .from('teacher_assignments')
    .select('teacher_user_id')
    .eq('section_id', sectionId)
    .eq('role', 'form_adviser')
    .limit(1);
  const adviserUserId = advisers?.[0]?.teacher_user_id ?? null;
  const [emailEntries, nameEntries] = await Promise.all([
    getTeacherEmailMap(),
    getStaffDisplayEntries(),
  ]);
  const adviserEmail = adviserUserId
    ? (new Map(emailEntries).get(adviserUserId) ?? null)
    : null;
  const formAdviser = adviserEmail
    ? (new Map(nameEntries).get(adviserEmail) ?? adviserEmail)
    : null;

  // Roster.
  const { data: enrolmentsRaw } = await service
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, bus_no, classroom_officer_role, student:students(student_number, last_name, first_name, middle_name)'
    )
    .eq('section_id', sectionId)
    .order('index_number');

  // Calendar + events + daily.
  const levelType = levelTypeForAudienceLookup(level?.code ?? null);
  const [calendar, events, daily] = await Promise.all([
    getDedupedSchoolCalendarForTerm(termId, levelType),
    getCalendarEventsForTerm(termId, levelType ?? 'all'),
    getDailyForSection(sectionId, termId),
  ]);

  const calendarByDate = new Map<
    string,
    { dayType: DayType; label: string | null }
  >();
  for (const c of calendar)
    calendarByDate.set(c.date, { dayType: c.dayType, label: c.label });

  // marks grouped by section_student_id.
  const marksByEnrolment = new Map<string, Map<string, AttendanceStatus>>();
  for (const d of daily) {
    const m =
      marksByEnrolment.get(d.sectionStudentId) ??
      new Map<string, AttendanceStatus>();
    m.set(d.date, d.status);
    marksByEnrolment.set(d.sectionStudentId, m);
  }

  type EnrRow = {
    id: string;
    index_number: number;
    enrollment_status: string;
    bus_no: string | null;
    classroom_officer_role: string | null;
    student:
      | {
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name: string | null;
        }
      | Array<{
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name: string | null;
        }>
      | null;
  };
  const students: AttendanceSheetExportInput['students'] = (
    (enrolmentsRaw ?? []) as EnrRow[]
  ).map((e) => {
    const s = Array.isArray(e.student) ? e.student[0] : e.student;
    const fullName = s
      ? `${s.last_name}, ${s.first_name}${s.middle_name ? ' ' + s.middle_name : ''}`
      : '';
    return {
      indexNumber: e.index_number,
      fullName,
      busCare:
        [e.bus_no, e.classroom_officer_role].filter(Boolean).join(' / ') ||
        null,
      withdrawn: e.enrollment_status === 'withdrawn',
      marksByDate: marksByEnrolment.get(e.id) ?? new Map(),
    };
  });

  const isYoungstarters = (level?.code ?? '').toUpperCase().startsWith('YS');
  const input: AttendanceSheetExportInput = {
    schoolName: isYoungstarters
      ? 'HFSE YOUNGSTARTERS'
      : 'HFSE INTERNATIONAL SCHOOL',
    sheetName: section.name,
    term: {
      label: term.label,
      termNumber: term.term_number,
      startDate: term.start_date,
      endDate: term.end_date,
    },
    courseLabel: level?.label ?? '',
    sectionName: section.name,
    formAdviser,
    scheduleLabel: null,
    calendarByDate,
    events,
    students,
  };

  const buffer = buildAttendanceSheetWorkbook(input);
  const sanitize = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_');
  const filename = `Attendance_${sanitize(section.name)}_${sanitize(term.label)}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
```

(Confirm `requireRole`'s return shape exposes `auth.user.role` — read `lib/auth/require-role.ts`; if the field is named differently, adjust the `auth.user.role` access accordingly.)

- [ ] **Step 2: Write the button** `components/attendance/export-sheet-button.tsx`

```tsx
'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ExportSheetButton({
  sectionId,
  termId,
}: {
  sectionId: string;
  termId: string;
}) {
  return (
    <Button asChild variant="outline" size="sm" className="gap-1.5">
      <a
        href={`/api/attendance/${sectionId}/export?term_id=${termId}`}
        download
      >
        <Download className="size-3.5" />
        Export sheet
      </a>
    </Button>
  );
}
```

- [ ] **Step 3: Mount the button** in `page.tsx` — in the header action cluster, next to the "Configure calendar" button (sheet view only)

```tsx
{
  view === 'sheet' && (
    <ExportSheetButton sectionId={sectionId} termId={selectedTermId} />
  );
}
```

Add the import: `import { ExportSheetButton } from '@/components/attendance/export-sheet-button';`

- [ ] **Step 4: Verify build + manual smoke**

Run: `npx next build`
Expected: clean compile.
Manual: on the Term sheet, click "Export sheet" → a `.xlsx` downloads. Open it: title band, class info, legend, dated lists, every term date as a column with PH/SH/SE/EX tags, P/A/EX/L marks, and per-month + term summary blocks whose % = `(P+L+EX)/marked-days`. Verify a teacher assigned to the section can export; a non-assigned teacher gets 403.

- [ ] **Step 5: Commit**

```bash
git add "app/api/attendance/[sectionId]/export/route.ts" components/attendance/export-sheet-button.tsx "app/(attendance)/attendance/[sectionId]/page.tsx"
git commit -m "feat(attendance): xlsx export route + Export sheet button"
```

---

## Final verification

- [ ] Run the full attendance test suite: `npx vitest run __tests__/attendance/`
- [ ] Run `npx next build` — clean compile required.
- [ ] Manual happy-path: Term sheet shows context card + tags + Details + Summary; export reproduces the template.
- [ ] Run `/sync-docs` to add a KD for this feature and update the dev plan.

## Self-review against the spec

- **Surfaces** (spec §Surfaces): Term sheet (Tasks 4–7), Daily untouched (no task touches `daily-entry.tsx`), export (Tasks 8–9). ✓
- **Context card + calendar disclosure** (spec §live sheet): Tasks 3–4. ✓
- **SE/EX column tags** (spec §data mapping): Task 5. ✓
- **Details toggle / 3 roster columns** (spec §live sheet + §deferred columns): Task 6 (Academics/Admin read-only placeholders, no migration). ✓
- **Summary toggle, HFSE formula** (spec §data mapping + §formula): Tasks 1 + 7; NC excluded; `(P+L+EX)/marked-days`; dashboard untouched. ✓
- **Export `.xlsx`, literal, all dates incl weekends, summary blocks, gate** (spec §export): Tasks 8–9. ✓
- **No v1 migration** (spec §global): bus/care reuse existing columns; Academics/Admin placeholders. ✓
- **Out of scope** (spec): Bus Summary tab, Reference dropdown, Academics/Admin persistence — none built. ✓
- **Placeholder scan:** the only `—` placeholders are the intentional read-only Academics/Admin cells (spec-sanctioned). No TBD steps. ✓
- **Type consistency:** `Mark`, `SummaryStat`, `MonthlySummary`, `ColumnTagCode`, `AttendanceSheetExportInput` used consistently across Tasks 1/2/7/8/9. ✓
