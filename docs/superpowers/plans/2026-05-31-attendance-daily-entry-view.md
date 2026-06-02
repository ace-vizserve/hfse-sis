# Attendance Daily Entry View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in "Daily" view to the section attendance page that lets a form class adviser mark a whole class for one day using a fast "everyone present, tap the exceptions, Submit" flow.

**Architecture:** A URL-driven view toggle (`?view=daily`) on `app/(attendance)/attendance/[sectionId]/page.tsx` swaps the existing `<AttendanceWideGrid>` for a new `<DailyEntry>` client component. The page already fetches everything the daily view needs (`enrolments`, `calendar`, `initialDaily`, `selectedTermId`) — no new server fetch. All write/aggregate logic is **pure functions** in `lib/attendance/daily-entry.ts` (unit-tested with vitest); the component is a thin renderer. Submit reuses the **existing bulk endpoint** `PATCH /api/attendance/daily` (`{ entries: [...] }`, already does the encodable-day gate + teacher section-scoping + append-only write + rollup + drill-cache invalidation + audit) — so **no new API route, schema, or write-helper extraction is needed** (a simplification over the design spec; behaviour is identical).

**Tech Stack:** Next.js 16 App Router (RSC + client components), TypeScript, Tailwind v4, shadcn primitives, zod (existing schemas), vitest.

---

## File Structure

- **Create** `lib/attendance/daily-entry.ts` — pure logic: encodable-date list, default-date pick, per-date loaded-marks map, submit-diff, live tally. No React, no I/O.
- **Create** `__tests__/attendance/daily-entry.test.ts` — vitest unit tests for the above.
- **Create** `components/attendance/daily-entry.tsx` — `'use client'` roster component (date stepper, rows, status control, EX reason, Submit bar).
- **Modify** `app/(attendance)/attendance/[sectionId]/page.tsx` — read `?view=`, render a "Term sheet | Daily" toggle, branch between grid and daily; preserve `view` in term-switcher links.

No migration. No schema change. No new endpoint.

---

## Reference: existing shapes the plan depends on (already in the codebase)

```ts
// components/attendance/wide-grid.tsx
export type WideGridEnrolment = {
  enrolmentId: string; indexNumber: number; studentNumber: string;
  studentName: string; busNo: string | null; classroomOfficerRole: string | null;
  withdrawn: boolean; compassionateUsed: number; compassionateAllowance: number;
  vlUsedThisTerm: number; vlAllowance: number; enrollmentDate: string | null;
};

// lib/attendance/calendar.ts
export type SchoolCalendarRow = {
  id: string; termId: string; date: string; dayType: DayType;
  isHoliday: boolean; label: string | null; audience: Audience; hblOverlay: boolean;
};

// lib/attendance/queries.ts
export type DailyEntryRow = {
  id: string; sectionStudentId: string; termId: string; date: string;
  status: AttendanceStatus; exReason: ExReason | null;
  periodId: string | null; recordedBy: string | null; recordedAt: string;
};

// lib/schemas/attendance.ts
isEncodableDayType(dayType, hblOverlay): boolean
ATTENDANCE_STATUS_VALUES = ['P','L','EX','A','NC']
EX_REASON_VALUES = ['mc','compassionate','school_activity','vacation']
EX_REASON_LABELS, ATTENDANCE_STATUS_LABELS

// PATCH /api/attendance/daily — bulk body (DailyBulkSchema, max 500):
// { entries: Array<{ sectionStudentId, termId, date, status, exReason? }> }
```

---

## Task 1: Pure logic module + tests

**Files:**

- Create: `lib/attendance/daily-entry.ts`
- Test: `__tests__/attendance/daily-entry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/attendance/daily-entry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  encodableDates,
  pickDefaultDate,
  loadedMarksForDate,
  computeSubmitEntries,
  tally,
  type DailyMark,
} from '@/lib/attendance/daily-entry';
import type { SchoolCalendarRow } from '@/lib/attendance/calendar';
import type { DailyEntryRow } from '@/lib/attendance/queries';
import type { WideGridEnrolment } from '@/components/attendance/wide-grid';

function cal(
  date: string,
  dayType: SchoolCalendarRow['dayType'],
  hblOverlay = false
): SchoolCalendarRow {
  return {
    id: date,
    termId: 't1',
    date,
    dayType,
    isHoliday: dayType !== 'school_day' && dayType !== 'hbl',
    label: null,
    audience: 'all',
    hblOverlay,
  };
}
function enr(
  id: string,
  idx: number,
  over: Partial<WideGridEnrolment> = {}
): WideGridEnrolment {
  return {
    enrolmentId: id,
    indexNumber: idx,
    studentNumber: 'S' + idx,
    studentName: 'Name ' + idx,
    busNo: null,
    classroomOfficerRole: null,
    withdrawn: false,
    compassionateUsed: 0,
    compassionateAllowance: 5,
    vlUsedThisTerm: 0,
    vlAllowance: 1,
    enrollmentDate: null,
    ...over,
  };
}
function daily(
  sectionStudentId: string,
  date: string,
  status: DailyEntryRow['status'],
  exReason: DailyEntryRow['exReason'] = null
): DailyEntryRow {
  return {
    id: `${sectionStudentId}-${date}`,
    sectionStudentId,
    termId: 't1',
    date,
    status,
    exReason,
    periodId: null,
    recordedBy: null,
    recordedAt: '2026-06-01T00:00:00Z',
  };
}

describe('encodableDates', () => {
  it('keeps only school_day + hbl + school_holiday-with-overlay, sorted', () => {
    const rows = [
      cal('2026-06-03', 'school_day'),
      cal('2026-06-01', 'public_holiday'),
      cal('2026-06-02', 'hbl'),
      cal('2026-06-04', 'school_holiday', true),
      cal('2026-06-05', 'school_holiday', false),
    ];
    expect(encodableDates(rows)).toEqual([
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
    ]);
  });
});

describe('pickDefaultDate', () => {
  const dates = ['2026-06-02', '2026-06-04', '2026-06-08'];
  it('returns today when today is encodable', () => {
    expect(pickDefaultDate(dates, '2026-06-04')).toBe('2026-06-04');
  });
  it('returns nearest encodable day before today when today is not encodable', () => {
    expect(pickDefaultDate(dates, '2026-06-06')).toBe('2026-06-04');
  });
  it('returns first encodable day when today is before all of them', () => {
    expect(pickDefaultDate(dates, '2026-06-01')).toBe('2026-06-02');
  });
  it('returns last encodable day when today is after all of them', () => {
    expect(pickDefaultDate(dates, '2026-12-31')).toBe('2026-06-08');
  });
  it('returns null when there are no encodable days', () => {
    expect(pickDefaultDate([], '2026-06-04')).toBeNull();
  });
});

describe('loadedMarksForDate', () => {
  it('maps the latest mark per student for the given date', () => {
    const rows = [
      daily('a', '2026-06-04', 'A'),
      daily('b', '2026-06-04', 'EX', 'mc'),
      daily('a', '2026-06-03', 'P'),
    ];
    const map = loadedMarksForDate(rows, '2026-06-04');
    expect(map.get('a')).toEqual({ status: 'A', exReason: null });
    expect(map.get('b')).toEqual({ status: 'EX', exReason: 'mc' });
    expect(map.has('c')).toBe(false);
  });
});

describe('computeSubmitEntries', () => {
  const date = '2026-06-04';
  const termId = 't1';
  const roster = [enr('a', 1), enr('b', 2), enr('c', 3)];
  it('writes P for unmarked students and the explicit exceptions', () => {
    const marks: Map<string, DailyMark> = new Map([
      ['b', { status: 'A', exReason: null }],
    ]);
    const loaded = new Map<string, DailyMark>(); // nothing on file yet
    const entries = computeSubmitEntries({
      roster,
      marks,
      loaded,
      termId,
      date,
    });
    expect(entries).toEqual([
      { sectionStudentId: 'a', termId, date, status: 'P' },
      { sectionStudentId: 'b', termId, date, status: 'A' },
      { sectionStudentId: 'c', termId, date, status: 'P' },
    ]);
  });
  it('includes exReason only for EX marks', () => {
    const marks: Map<string, DailyMark> = new Map([
      ['a', { status: 'EX', exReason: 'mc' }],
    ]);
    const entries = computeSubmitEntries({
      roster: [enr('a', 1)],
      marks,
      loaded: new Map(),
      termId,
      date,
    });
    expect(entries).toEqual([
      { sectionStudentId: 'a', termId, date, status: 'EX', exReason: 'mc' },
    ]);
  });
  it('skips a student whose target equals what is already on file (idempotent re-submit)', () => {
    const marks: Map<string, DailyMark> = new Map([
      ['a', { status: 'A', exReason: null }],
    ]);
    const loaded: Map<string, DailyMark> = new Map([
      ['a', { status: 'A', exReason: null }],
      ['b', { status: 'P', exReason: null }],
    ]);
    const entries = computeSubmitEntries({
      roster: [enr('a', 1), enr('b', 2)],
      marks,
      loaded,
      termId,
      date,
    });
    expect(entries).toEqual([]); // a unchanged, b already P
  });
  it('excludes withdrawn students and late-enrollees before their enrollment date', () => {
    const roster2 = [
      enr('a', 1, { withdrawn: true }),
      enr('b', 2, { enrollmentDate: '2026-06-10' }), // joins after `date`
      enr('c', 3, { enrollmentDate: '2026-06-01' }), // joined before `date`
    ];
    const entries = computeSubmitEntries({
      roster: roster2,
      marks: new Map(),
      loaded: new Map(),
      termId,
      date,
    });
    expect(entries.map((e) => e.sectionStudentId)).toEqual(['c']);
  });
});

describe('tally', () => {
  it('counts P/L/A/EX and unmarked across the eligible roster', () => {
    const roster = [enr('a', 1), enr('b', 2), enr('c', 3), enr('d', 4)];
    const marks: Map<string, DailyMark> = new Map([
      ['a', { status: 'A', exReason: null }],
      ['b', { status: 'L', exReason: null }],
    ]);
    expect(tally({ roster, marks, date: '2026-06-04' })).toEqual({
      P: 0,
      L: 1,
      A: 1,
      EX: 0,
      unmarked: 2,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/attendance/daily-entry.test.ts`
Expected: FAIL — `Cannot find module '@/lib/attendance/daily-entry'`.

- [ ] **Step 3: Write the implementation**

Create `lib/attendance/daily-entry.ts`:

```ts
import type { SchoolCalendarRow } from '@/lib/attendance/calendar';
import type { DailyEntryRow } from '@/lib/attendance/queries';
import type { WideGridEnrolment } from '@/components/attendance/wide-grid';
import {
  isEncodableDayType,
  type AttendanceStatus,
  type ExReason,
} from '@/lib/schemas/attendance';

// A single student's mark for the day being edited.
export type DailyMark = { status: AttendanceStatus; exReason: ExReason | null };

// One entry in the bulk PATCH /api/attendance/daily payload.
export type SubmitEntry = {
  sectionStudentId: string;
  termId: string;
  date: string;
  status: AttendanceStatus;
  exReason?: ExReason;
};

/** Encodable school-day dates for the term, ascending. */
export function encodableDates(calendar: SchoolCalendarRow[]): string[] {
  return calendar
    .filter((c) => isEncodableDayType(c.dayType, c.hblOverlay))
    .map((c) => c.date)
    .sort();
}

/**
 * Default date to open the view on. `today` is a yyyy-MM-dd string.
 * - today, if encodable
 * - else the nearest encodable day before today
 * - else the first encodable day (today precedes all)
 * - null if there are no encodable days
 */
export function pickDefaultDate(
  encodable: string[],
  today: string
): string | null {
  if (encodable.length === 0) return null;
  if (encodable.includes(today)) return today;
  const before = encodable.filter((d) => d < today);
  if (before.length > 0) return before[before.length - 1];
  return encodable[0];
}

/** Latest mark per student for `date` (input rows are latest-first per the query). */
export function loadedMarksForDate(
  daily: DailyEntryRow[],
  date: string
): Map<string, DailyMark> {
  const map = new Map<string, DailyMark>();
  for (const r of daily) {
    if (r.date !== date) continue;
    if (map.has(r.sectionStudentId)) continue; // first seen = latest (query order)
    map.set(r.sectionStudentId, { status: r.status, exReason: r.exReason });
  }
  return map;
}

/** Is this student markable on `date`? (active, joined on/before the date). */
function isEligible(e: WideGridEnrolment, date: string): boolean {
  if (e.withdrawn) return false;
  if (e.enrollmentDate && e.enrollmentDate > date) return false;
  return true;
}

function sameMark(a: DailyMark | undefined, b: DailyMark): boolean {
  return a != null && a.status === b.status && a.exReason === b.exReason;
}

/**
 * Mark-the-exceptions write set: every eligible student gets `P` unless the
 * teacher set an explicit mark. Students whose target already matches what's
 * on file are skipped (idempotent re-submit — append-only ledger stays clean).
 */
export function computeSubmitEntries(input: {
  roster: WideGridEnrolment[];
  marks: Map<string, DailyMark>;
  loaded: Map<string, DailyMark>;
  termId: string;
  date: string;
}): SubmitEntry[] {
  const { roster, marks, loaded, termId, date } = input;
  const out: SubmitEntry[] = [];
  for (const e of roster) {
    if (!isEligible(e, date)) continue;
    const target: DailyMark = marks.get(e.enrolmentId) ?? {
      status: 'P',
      exReason: null,
    };
    if (sameMark(loaded.get(e.enrolmentId), target)) continue;
    out.push({
      sectionStudentId: e.enrolmentId,
      termId,
      date,
      status: target.status,
      ...(target.status === 'EX' && target.exReason
        ? { exReason: target.exReason }
        : {}),
    });
  }
  return out;
}

/** Live tally for the header strip. Unmarked = eligible students with no explicit mark. */
export function tally(input: {
  roster: WideGridEnrolment[];
  marks: Map<string, DailyMark>;
  date: string;
}): { P: number; L: number; A: number; EX: number; unmarked: number } {
  const { roster, marks, date } = input;
  const t = { P: 0, L: 0, A: 0, EX: 0, unmarked: 0 };
  for (const e of roster) {
    if (!isEligible(e, date)) continue;
    const m = marks.get(e.enrolmentId);
    if (!m) {
      t.unmarked += 1;
      continue;
    }
    t[m.status === 'NC' ? 'unmarked' : m.status] += 1;
  }
  return t;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/attendance/daily-entry.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/attendance/daily-entry.ts __tests__/attendance/daily-entry.test.ts
git commit -m "feat(attendance): pure logic for daily entry view (mark-the-exceptions)"
```

---

## Task 2: DailyEntry client component (roster + marks, no submit yet)

**Files:**

- Create: `components/attendance/daily-entry.tsx`

This task renders the roster and lets the teacher set marks in local state. Submit is wired in Task 3. Verification is manual (the project has no React test harness; logic is covered by Task 1).

- [ ] **Step 1: Write the component**

Create `components/attendance/daily-entry.tsx`:

```tsx
'use client';

import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { SchoolCalendarRow } from '@/lib/attendance/calendar';
import type { DailyEntryRow } from '@/lib/attendance/queries';
import type { WideGridEnrolment } from '@/components/attendance/wide-grid';
import {
  computeSubmitEntries,
  encodableDates,
  loadedMarksForDate,
  pickDefaultDate,
  tally,
  type DailyMark,
} from '@/lib/attendance/daily-entry';
import {
  EX_REASON_LABELS,
  type AttendanceStatus,
  type ExReason,
} from '@/lib/schemas/attendance';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

function todayLocalIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

const STATUS_BTN: Record<
  'P' | 'L' | 'A' | 'EX',
  { label: string; on: string }
> = {
  P: {
    label: 'P',
    on: 'bg-gradient-to-b from-chart-5 to-chart-3 text-white shadow-xs',
  },
  L: {
    label: 'L',
    on: 'bg-gradient-to-b from-brand-amber to-brand-amber/80 text-white shadow-xs',
  },
  A: {
    label: 'A',
    on: 'bg-gradient-to-b from-destructive to-destructive/80 text-white shadow-xs',
  },
  EX: {
    label: 'EX',
    on: 'bg-gradient-to-b from-brand-indigo to-brand-navy text-white shadow-xs',
  },
};
const EX_REASONS: ExReason[] = [
  'mc',
  'compassionate',
  'school_activity',
  'vacation',
];

export function DailyEntry({
  sectionId,
  termId,
  enrolments,
  calendar,
  initialDaily,
}: {
  sectionId: string;
  termId: string;
  enrolments: WideGridEnrolment[];
  calendar: SchoolCalendarRow[];
  initialDaily: DailyEntryRow[];
}) {
  void sectionId; // not needed for the write (the bulk endpoint keys on sectionStudentId)
  const router = useRouter();

  const dates = useMemo(() => encodableDates(calendar), [calendar]);
  const [date, setDate] = useState<string | null>(() =>
    pickDefaultDate(dates, todayLocalIso())
  );

  // Roster shown for marking: active + late-enrollees (withdrawn excluded).
  const roster = useMemo(
    () => enrolments.filter((e) => !e.withdrawn),
    [enrolments]
  );

  const loaded = useMemo(
    () =>
      date
        ? loadedMarksForDate(initialDaily, date)
        : new Map<string, DailyMark>(),
    [initialDaily, date]
  );

  // Local marks: seeded from what's on file for the date. Re-seeds on date change
  // via the `key` on the inner panel (see render) so we never carry marks across days.
  const [marks, setMarks] = useState<Map<string, DailyMark>>(
    () => new Map(loaded)
  );
  const [saving, setSaving] = useState(false);

  function setMark(enrolmentId: string, m: DailyMark | null) {
    setMarks((cur) => {
      const next = new Map(cur);
      if (m) next.set(enrolmentId, m);
      else next.delete(enrolmentId);
      return next;
    });
  }

  const counts = date ? tally({ roster, marks, date }) : null;
  const exMissingReason = [...marks.values()].some(
    (m) => m.status === 'EX' && !m.exReason
  );

  const idx = date ? dates.indexOf(date) : -1;
  const canPrev = idx > 0;
  const canNext = idx >= 0 && idx < dates.length - 1;
  function step(delta: number) {
    if (idx < 0) return;
    const nd = dates[idx + delta];
    if (nd) setDate(nd);
  }

  async function submit() {
    if (!date) return;
    const entries = computeSubmitEntries({
      roster,
      marks,
      loaded,
      termId,
      date,
    });
    if (entries.length === 0) {
      toast.info('No changes to submit.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/attendance/daily', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'Save failed');
      toast.success(
        `Saved attendance for ${formatLongDate(date)} (${entries.length} updated).`
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // ── Empty state — no encodable day to mark ──────────────────────────────
  if (!date || roster.length === 0) {
    return (
      <Card className="items-center gap-2 py-12 text-center">
        <p className="font-serif text-xl font-semibold text-foreground">
          {roster.length === 0
            ? 'No students to mark'
            : 'No school day to mark'}
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {roster.length === 0
            ? 'This section has no active students enrolled.'
            : 'There are no encodable school days in this term yet. Configure the school calendar first.'}
        </p>
      </Card>
    );
  }

  return (
    <div key={date} className="space-y-4">
      {/* Date strip + tally */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            disabled={!canPrev}
            onClick={() => step(-1)}
            aria-label="Previous day"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="min-w-[200px] text-center">
            <p className="font-serif text-lg font-semibold leading-tight text-foreground">
              {formatLongDate(date)}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {date}
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            disabled={!canNext}
            onClick={() => step(1)}
            aria-label="Next day"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {counts && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
            <span>
              <span className="font-semibold text-brand-mint">{counts.P}</span>{' '}
              Present
            </span>
            <span>
              <span className="font-semibold text-brand-amber">{counts.L}</span>{' '}
              Late
            </span>
            <span>
              <span className="font-semibold text-destructive">{counts.A}</span>{' '}
              Absent
            </span>
            <span>
              <span className="font-semibold text-brand-indigo">
                {counts.EX}
              </span>{' '}
              Excused
            </span>
            <span>{counts.unmarked} unmarked → Present</span>
          </div>
        )}
      </div>

      {/* Roster */}
      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-border">
          {roster.map((e) => {
            const beforeJoin = !!e.enrollmentDate && e.enrollmentDate > date;
            const m = marks.get(e.enrolmentId);
            const active: 'P' | 'L' | 'A' | 'EX' = m
              ? m.status === 'NC'
                ? 'P'
                : m.status
              : 'P';
            return (
              <li
                key={e.enrolmentId}
                className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                  beforeJoin ? 'bg-muted/40 opacity-40' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">
                    {e.indexNumber}
                  </span>
                  <span className="text-sm font-medium text-foreground">
                    {e.studentName}
                  </span>
                </div>

                {beforeJoin ? (
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Before enrolment date
                  </span>
                ) : (
                  <div className="flex flex-col items-end gap-1.5">
                    <div className="inline-flex overflow-hidden rounded-lg border border-border">
                      {(['P', 'L', 'A', 'EX'] as const).map((s) => {
                        const isOn = active === s && (m != null || s === 'P');
                        const explicit =
                          m != null &&
                          (m.status === s || (s === 'P' && m.status === 'P'));
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() =>
                              setMark(
                                e.enrolmentId,
                                s === 'EX'
                                  ? {
                                      status: 'EX',
                                      exReason: m?.exReason ?? null,
                                    }
                                  : { status: s, exReason: null }
                              )
                            }
                            className={`w-11 py-1.5 text-center font-mono text-xs font-semibold transition-colors ${
                              isOn && explicit
                                ? STATUS_BTN[s].on
                                : 'text-muted-foreground hover:bg-muted/60'
                            } ${active === s && !explicit ? 'text-foreground' : ''}`}
                          >
                            {STATUS_BTN[s].label}
                          </button>
                        );
                      })}
                    </div>
                    {m?.status === 'EX' && (
                      <div className="inline-flex flex-wrap justify-end gap-1">
                        {EX_REASONS.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() =>
                              setMark(e.enrolmentId, {
                                status: 'EX',
                                exReason: r,
                              })
                            }
                            className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
                              m.exReason === r
                                ? 'bg-brand-indigo text-white'
                                : 'border border-border text-muted-foreground hover:bg-muted/60'
                            }`}
                          >
                            {EX_REASON_LABELS[r]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Submit bar */}
      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-background/95 py-3 backdrop-blur">
        <p className="text-xs text-muted-foreground">
          {exMissingReason
            ? 'Choose a reason for each Excused student to submit.'
            : counts
              ? `${counts.P + counts.unmarked} present · ${counts.L + counts.A + counts.EX} exceptions`
              : ''}
        </p>
        <Button onClick={submit} disabled={saving || exMissingReason}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Submit attendance
        </Button>
      </div>
    </div>
  );
}
```

> Note on state re-seeding: the panel's outermost element has `key={date}`, so stepping the date remounts the inner tree and `useState(() => new Map(loaded))` re-seeds `marks` from that date's on-file marks — same `key`-remount technique used to fix the term-switch staleness bug on the grid.

- [ ] **Step 2: Typecheck via build**

Run: `npx next build`
Expected: Compiles successfully; no TypeScript errors in `components/attendance/daily-entry.tsx`. (It is not yet imported anywhere, so it only needs to typecheck.)

- [ ] **Step 3: Commit**

```bash
git add components/attendance/daily-entry.tsx
git commit -m "feat(attendance): DailyEntry roster component (mark-the-exceptions UI)"
```

---

## Task 3: Wire the view toggle into the page

**Files:**

- Modify: `app/(attendance)/attendance/[sectionId]/page.tsx`

- [ ] **Step 1: Add `view` to the searchParams type + parse it**

In `app/(attendance)/attendance/[sectionId]/page.tsx`, change the `searchParams` type and read the value. Find:

```tsx
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ term_id?: string }>;
}) {
  const { sectionId } = await params;
  const sp = await searchParams;
```

Replace with:

```tsx
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ term_id?: string; view?: string }>;
}) {
  const { sectionId } = await params;
  const sp = await searchParams;
  const view: 'sheet' | 'daily' = sp.view === 'daily' ? 'daily' : 'sheet';
```

- [ ] **Step 2: Import DailyEntry**

Find the existing import:

```tsx
import { StudentLookupSheet } from '@/components/attendance/student-lookup-sheet';
```

Add directly below it:

```tsx
import { DailyEntry } from '@/components/attendance/daily-entry';
```

- [ ] **Step 3: Preserve `view` in the term-switcher links**

In the term switcher, find:

```tsx
                <Link href={`/attendance/${sectionId}?term_id=${t.id}`}>
```

Replace with:

```tsx
                <Link
                  href={`/attendance/${sectionId}?term_id=${t.id}${view === 'daily' ? '&view=daily' : ''}`}
                >
```

- [ ] **Step 4: Add the Term sheet | Daily toggle in the header actions**

Find the header actions block:

```tsx
<StudentLookupSheet
  enrolments={enrolments}
  initialDaily={daily}
  termLabel={selectedTerm?.label ?? ''}
/>
```

Insert this directly **above** the `<StudentLookupSheet ... />`:

```tsx
<Tabs value={view} aria-label="View">
  <TabsList>
    <TabsTrigger value="sheet" asChild>
      <Link href={`/attendance/${sectionId}?term_id=${selectedTermId}`}>
        Term sheet
      </Link>
    </TabsTrigger>
    <TabsTrigger value="daily" asChild>
      <Link
        href={`/attendance/${sectionId}?term_id=${selectedTermId}&view=daily`}
      >
        Daily
      </Link>
    </TabsTrigger>
  </TabsList>
</Tabs>
```

(`Tabs`, `TabsList`, `TabsTrigger` are already imported on this page.)

- [ ] **Step 5: Branch the body between grid and daily**

Find the grid usage (added earlier this session, includes the `key`):

```tsx
<AttendanceWideGrid
  key={`${sectionId}:${selectedTermId}`}
  sectionId={sectionId}
  termId={selectedTermId}
  enrolments={enrolments}
  calendar={calendar}
  events={events}
  initialDaily={daily}
  canWriteNc={canWriteNc}
/>
```

Wrap it in a conditional and add the daily branch:

```tsx
{
  view === 'daily' ? (
    <DailyEntry
      key={`daily:${sectionId}:${selectedTermId}`}
      sectionId={sectionId}
      termId={selectedTermId}
      enrolments={enrolments}
      calendar={calendar}
      initialDaily={daily}
    />
  ) : (
    <AttendanceWideGrid
      key={`${sectionId}:${selectedTermId}`}
      sectionId={sectionId}
      termId={selectedTermId}
      enrolments={enrolments}
      calendar={calendar}
      events={events}
      initialDaily={daily}
      canWriteNc={canWriteNc}
    />
  );
}
```

- [ ] **Step 6: Build**

Run: `npx next build`
Expected: Compiles successfully, 0 TypeScript errors, page count unchanged (no new route).

- [ ] **Step 7: Commit**

```bash
git add "app/(attendance)/attendance/[sectionId]/page.tsx"
git commit -m "feat(attendance): Term sheet | Daily view toggle on section page"
```

---

## Task 4: Full verification

- [ ] **Step 1: Run the unit suite**

Run: `npx vitest run __tests__/attendance/daily-entry.test.ts`
Expected: PASS.

- [ ] **Step 2: Run the full build**

Run: `npx next build`
Expected: Clean compile, all pages generated.

- [ ] **Step 3: Manual happy path** (on a seeded section with a current term, e.g. AY9999 P6 Grit)
  1. Open `/attendance/<sectionId>` — confirm it lands on **Term sheet** (default) with the grid.
  2. Click **Daily** — lands on today's roster; everyone shows on **P**; tally reads "N unmarked → Present".
  3. Mark 2 students Absent, 1 Late, 1 Excused → choosing EX shows the reason chips; pick **Medical certificate**. Tally updates live; Submit stays disabled until the EX reason is chosen.
  4. Click **Submit attendance** → success toast with a count.
  5. Switch to **Term sheet** → confirm today's column shows those 4 marks and everyone else `P`. Confirm the four stat cards updated.

- [ ] **Step 4: Idempotency + back-fill**
  1. Back on **Daily** for the same date, with no changes, click Submit → "No changes to submit." (no duplicate ledger rows).
  2. Step the date back (`‹`) to a prior school day, mark someone Absent, Submit → switch to Term sheet and confirm it landed on the correct earlier column.

- [ ] **Step 5: Edge cases**
  1. A late-enrollee row (if present) before its enrolment date renders dimmed with "Before enrolment date" and is excluded from Submit.
  2. Withdrawn students do not appear in the Daily roster.
  3. Switch to a future/empty term → Daily shows the "No school day to mark" empty state.

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test(attendance): verify daily entry view end-to-end"
```

---

## Self-review notes (coverage vs spec)

- **Mark-the-exceptions + Submit** → Task 1 (`computeSubmitEntries`) + Task 2 (Submit bar) + reused bulk endpoint.
- **Toggle, Term sheet default, URL-driven** → Task 3.
- **Date stepper over encodable days, default today** → Task 1 (`encodableDates`, `pickDefaultDate`) + Task 2 (stepper).
- **Pre-load existing marks / re-open shows prior marks** → Task 1 (`loadedMarksForDate`) + Task 2 (`key={date}` re-seed).
- **Idempotent re-submit** → Task 1 (`computeSubmitEntries` skips unchanged) — achieved client-side instead of the spec's server-side skip, since the existing bulk endpoint already does everything else and we avoid touching the shared write path.
- **Late-enrollee gate / withdrawn exclusion / EX-reason-required / non-encodable empty state** → Task 1 (`isEligible`) + Task 2 (render + disabled Submit).
- **Rollup, audit, drill invalidation, teacher section-scoping, encodable-day server gate** → inherited unchanged from the existing `PATCH /api/attendance/daily`.
- **Deferred (matches spec "optional v1"):** VL per-term-quota soft-warning toast — not included; can be added later mirroring the grid's KD #94 check.
