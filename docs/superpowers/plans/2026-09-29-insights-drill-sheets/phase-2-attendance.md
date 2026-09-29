# Phase 2 — Attendance Insights drills

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every KPI card, chart segment and list on `/attendance/insights` opens the rows behind it, and each list's row count equals the number it was opened from.

**Depends on:** Phase 1 only (`phase-1-charts.md`). `GroupedBarChartProps.onSegmentClick?: SegmentClickHandler`, where `SegmentClickHandler = (category: string, series?: string) => void` (exported from `components/dashboard/charts/chart-primitives.ts`); it reports `(row.x, series.key)` — the bar's x and its series dataKey, e.g. `('T2', 'AY2025')`. `LabeledPieChart` keeps its existing slice click, now typed `SegmentClickHandler` (called with the slice name only). A zero-value bar or slice draws nothing, so it cannot be clicked — the empty-list case (Review Focus 2) is reached through a KPI card or "See all" reading 0, and the wrappers still guard a missing term window.

**Binding:** the index's Global Constraints and Review Focus (`docs/superpowers/plans/2026-09-29-insights-drill-sheets.md`). Spec: `docs/superpowers/specs/2026-09-29-insights-drill-sheets-design.md` §2 and the Attendance table.

**What this phase adds**

| Block on the page                              | Opens                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Attendance rate / Days absent / Late incidents | `attendance-summary` / `absent` / `lates`, selected term's window            |
| Over their leave quota                         | **new** `over-leave-quota` (over only, both leave types, Leave type column)  |
| Attendance mix slice                           | `present` (**new**) / `lates` / `excused` / `absent`, selected term's window |
| Term-by-term bar                               | `attendance-summary`, that term's window **in that bar's year**              |
| Composition-by-term bar                        | that status's target, that term's window                                     |
| Watchlist card → See all                       | `top-absent`, that term's window                                             |
| Compassionate "Over quota" → See all           | `over-leave-quota` segment `compassionate`                                   |
| Vacation leave → See all                       | `vacation-leave-quota` with the **selected** term's id                       |

**Facts established while writing this phase (read before building):**

- The KPI and pie counts come from `getAttendanceKpisRange` → `kpisFromCounts(sliceMarkCounts(loadMarkCounts(ay), from, to))` (`lib/attendance/dashboard.ts:409`, `:494`). Present = marks with `status === 'P'`; the rate's denominator `encodedDays` = P + L + EX + A (NC excluded) — exactly what the existing `attendance-summary` target returns (`status !== 'NC'`).
- `getAttendanceRateTrendByAy` and `getAttendanceMixByTerm` (`lib/attendance/insights-compare.ts`) slice each term by `getDashboardWindows(ay).term.byNumber[n]`. The page already holds `windows` (selected AY) and `compareWindows` (compare AY) — those are the windows the drills must use.
- The "Over their leave quota" KPI is `compassionateOver.length + vacationOver.length` (page `:260-265`); compassionate is year-to-date (`rollupCompassionate` ignores the window), vacation is per term. A student over both is counted twice, so the drill lists two rows for them — one per leave type.
- The Insights vacation card shows `isOverTermQuota` rows plus `isApproachingVlQuota` rows (`!over && remaining === 0`). The `vacation-leave-quota` drill uses `selectAtRiskVacationLeave` (`used > 0 && (over || remaining <= 0)`). They differ in exactly one case: a student whose allowance is 0 and who took no trips is "approaching" on the card but not in the drill. This phase makes the card use the drill's selector (Task 2.4) so count = rows.
- `AttendanceDrillSheet`'s CSV link (`attendance-drill-sheet.tsx:964-970`) drops `termId`, so a vacation-quota CSV comes back empty. Fixed in Task 2.5 (needed by both quota targets here).
- The page resolves the vacation term from `is_current` (`page.tsx:390-409`) whatever term is picked. Fixed in Task 2.7.

---

### Task 2.1: Pure mapping helpers for the Insights wrappers

**Files:**

- Create: `lib/attendance/insights-drill.ts`
- Test: `__tests__/attendance/insights-drill-mapping.test.ts`

**Interfaces:**

- Consumes: `type DateRange`, `type TermWindows` from `lib/dashboard/range.ts:11,78` (type-only — this module is imported by client components).
- Produces:
  - `export type MixDrillTarget = 'present' | 'lates' | 'excused' | 'absent'` — a subset of `AttendanceDrillTarget` once Task 2.2 adds `'present'` (declared locally so this task type-checks on its own)
  - `export const MIX_SLICE_TARGET: Readonly<Record<string, MixDrillTarget>>` — pie slice name → target
  - `export const MIX_SERIES_TARGET: Readonly<Record<string, MixDrillTarget>>` — composition series key → target
  - `export type TermWindowMap = Record<string, Partial<Record<string, DateRange>>>`
  - `export function buildTermWindowMap(entries: ReadonlyArray<{ ayCode: string; byNumber: TermWindows['byNumber'] }>): TermWindowMap`
  - `export function termWindowFor(map: TermWindowMap, ayCode: string, termLabel: string): DateRange | null`
  - `export function resolveSelectedTermId(terms: ReadonlyArray<{ id: string; term_number: number }>, termNumber: number): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/attendance/insights-drill-mapping.test.ts
import { describe, expect, it } from 'vitest';

import {
  buildTermWindowMap,
  MIX_SERIES_TARGET,
  MIX_SLICE_TARGET,
  resolveSelectedTermId,
  termWindowFor,
} from '@/lib/attendance/insights-drill';

describe('attendance mix → drill target', () => {
  it('maps every pie slice the Insights page draws', () => {
    expect(MIX_SLICE_TARGET).toEqual({
      Present: 'present',
      Late: 'lates',
      Excused: 'excused',
      Absent: 'absent',
    });
  });

  it('maps every composition series key the Insights page draws', () => {
    expect(MIX_SERIES_TARGET).toEqual({
      present: 'present',
      late: 'lates',
      excused: 'excused',
      absent: 'absent',
    });
  });
});

describe('term windows per year', () => {
  const map = buildTermWindowMap([
    {
      ayCode: 'AY2026',
      byNumber: {
        1: { from: '2026-01-05', to: '2026-03-13' },
        2: { from: '2026-03-23', to: '2026-05-29' },
        3: null,
        4: null,
      },
    },
    {
      ayCode: 'AY2025',
      byNumber: {
        1: { from: '2025-01-06', to: '2025-03-14' },
        2: { from: '2025-03-24', to: '2025-05-30' },
        3: { from: '2025-06-23', to: '2025-09-05' },
        4: null,
      },
    },
  ]);

  it('returns the window of the year that was clicked, not the page year', () => {
    expect(termWindowFor(map, 'AY2025', 'T2')).toEqual({
      from: '2025-03-24',
      to: '2025-05-30',
    });
    expect(termWindowFor(map, 'AY2026', 'T2')).toEqual({
      from: '2026-03-23',
      to: '2026-05-29',
    });
  });

  it('returns null for a term with no dates, or a year it was not given', () => {
    expect(termWindowFor(map, 'AY2026', 'T3')).toBeNull();
    expect(termWindowFor(map, 'AY2024', 'T1')).toBeNull();
  });
});

describe('resolveSelectedTermId', () => {
  const terms = [
    { id: 't1', term_number: 1 },
    { id: 't2', term_number: 2 },
    { id: 't3', term_number: 3 },
  ];

  it('returns the id of the term the picker selected', () => {
    expect(resolveSelectedTermId(terms, 2)).toBe('t2');
  });

  it('returns null when the year has no row for that term', () => {
    expect(resolveSelectedTermId(terms, 4)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run __tests__/attendance/insights-drill-mapping.test.ts --pool=threads`
Expected: FAIL — `Failed to resolve import "@/lib/attendance/insights-drill"`.

- [ ] **Step 3: Implement**

```ts
// lib/attendance/insights-drill.ts
import type { DateRange, TermWindows } from '@/lib/dashboard/range';

// Pure lookups the Attendance Insights click wrappers use to turn a clicked
// segment into a drill. Kept apart from lib/attendance/drill.ts because these
// are imported by client components.

/** The four P/L/EX/A drill targets — each is an `AttendanceDrillTarget`. */
export type MixDrillTarget = 'present' | 'lates' | 'excused' | 'absent';

/** Attendance mix pie — the page's slice names → the target whose rows make up that slice. */
export const MIX_SLICE_TARGET: Readonly<Record<string, MixDrillTarget>> = {
  Present: 'present',
  Late: 'lates',
  Excused: 'excused',
  Absent: 'absent',
};

/** Composition-by-term bars — the page's series keys → the same targets. */
export const MIX_SERIES_TARGET: Readonly<Record<string, MixDrillTarget>> = {
  present: 'present',
  late: 'lates',
  excused: 'excused',
  absent: 'absent',
};

/**
 * ayCode → term label ('T1'..'T4') → that term's dates, for every year a
 * chart on the page plots. Plain data so a Server Component can hand it to a
 * client wrapper.
 */
export type TermWindowMap = Record<string, Partial<Record<string, DateRange>>>;

export function buildTermWindowMap(
  entries: ReadonlyArray<{
    ayCode: string;
    byNumber: TermWindows['byNumber'];
  }>
): TermWindowMap {
  const out: TermWindowMap = {};
  for (const { ayCode, byNumber } of entries) {
    const terms: Partial<Record<string, DateRange>> = {};
    for (const n of [1, 2, 3, 4] as const) {
      const w = byNumber[n];
      if (w) terms[`T${n}`] = { from: w.from, to: w.to };
    }
    out[ayCode] = terms;
  }
  return out;
}

/**
 * The dates of one term in one year, or null when that term has none. A null
 * means "do not open a drill" — opening it without dates would list the whole
 * year under a term's label.
 */
export function termWindowFor(
  map: TermWindowMap,
  ayCode: string,
  termLabel: string
): DateRange | null {
  return map[ayCode]?.[termLabel] ?? null;
}

/** The id of the term the page's term picker selected, or null if that term has no row. */
export function resolveSelectedTermId(
  terms: ReadonlyArray<{ id: string; term_number: number }>,
  termNumber: number
): string | null {
  return terms.find((t) => t.term_number === termNumber)?.id ?? null;
}
```

- [ ] **Step 4: Run it — expect pass**

Run: `npx vitest run __tests__/attendance/insights-drill-mapping.test.ts --pool=threads`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/attendance/insights-drill.ts __tests__/attendance/insights-drill-mapping.test.ts && git commit -m "feat(attendance): map Insights chart clicks to drill targets and term windows" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.2: `present` drill target, with KPI parity for every entry target

**Files:**

- Modify: `lib/attendance/drill.ts` — union `:36-48`, `rowKindForTarget` `:61-68`, `applyTargetFilter` `:1327-1330`, `defaultColumnsForTarget` `:1546`, `drillHeaderForTarget` `:1574-1575`
- Modify: `app/api/attendance/drill/[target]/route.ts:24-37` (`VALID_TARGETS`)
- Test: `__tests__/attendance/insights-drill-parity.test.ts`

**Interfaces:**

- Consumes: `applyTargetFilter(rows, target, segment)` (`drill.ts:1309`); `countsFromRows`, `kpisFromCounts`, `sliceMarkCounts`, `type DailyRow` (`lib/attendance/dashboard.ts:29,362,379,409`); `applyDateRangeFilter` (`lib/dashboard/drill-range.ts:30` — the filter `buildAttendanceDrillRows` applies for `from`/`to`).
- Produces: `AttendanceDrillTarget` gains `'present'` (row kind `'entry'`, filter `status === 'P'`).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/attendance/insights-drill-parity.test.ts
/**
 * Attendance Insights: the number on a card or pie slice must equal the rows
 * its drill lists. The card counts through kpisFromCounts over mark buckets;
 * the drill filters entry rows through applyTargetFilter after the same
 * date-window filter buildAttendanceDrillRows applies. Same fixture in, same
 * count out — per target, inside a term window.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
  revalidateTag: () => {},
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    throw new Error('no database in this test');
  },
}));

import {
  countsFromRows,
  kpisFromCounts,
  sliceMarkCounts,
  type DailyRow,
} from '@/lib/attendance/dashboard';
import {
  applyTargetFilter,
  type AttendanceDrillRow,
  type AttendanceEntryRow,
} from '@/lib/attendance/drill';
import { applyDateRangeFilter } from '@/lib/dashboard/drill-range';

let seq = 0;
function entry(
  student: string,
  date: string,
  status: AttendanceEntryRow['status'],
  exReason: string | null = null
): AttendanceEntryRow {
  seq += 1;
  return {
    entryId: `e-${seq}`,
    attendanceDate: date,
    termId: date < '2026-03-20' ? 'term-1' : 'term-2',
    sectionId: 'sec-1',
    sectionName: 'Respect',
    studentSectionId: `ss-${student}`,
    studentName: student,
    studentNumber: `H-${student}`,
    level: 'P5',
    status,
    exReason,
    notes: null,
  };
}

// Already the surviving mark per (student, date) — the dedupe is shared by
// both paths and pinned by drill-supersede / dashboard-supersede tests.
const entries: AttendanceEntryRow[] = [
  entry('Ana', '2026-03-02', 'P'),
  entry('Ana', '2026-03-03', 'L'),
  entry('Ana', '2026-03-24', 'A'),
  entry('Ben', '2026-03-02', 'EX', 'mc'),
  entry('Ben', '2026-03-03', 'NC'),
  entry('Ben', '2026-03-24', 'P'),
  entry('Cleo', '2026-03-02', 'A'),
  entry('Cleo', '2026-03-03', 'P'),
  entry('Cleo', '2026-03-25', 'EX', 'vacation'),
  entry('Cleo', '2026-03-26', 'L'),
];

const asDaily: DailyRow[] = entries.map((e) => ({
  date: e.attendanceDate,
  status: e.status,
  ex_reason: e.exReason,
  section_student_id: e.studentSectionId,
}));

const TERM_1 = { from: '2026-01-05', to: '2026-03-13' };
const TERM_2 = { from: '2026-03-23', to: '2026-05-29' };

function kpisIn(window: { from: string; to: string }) {
  return kpisFromCounts(
    sliceMarkCounts(countsFromRows(asDaily), window.from, window.to)
  );
}

function drillIn(
  target: Parameters<typeof applyTargetFilter>[1],
  window: { from: string; to: string }
): AttendanceDrillRow[] {
  const scoped = applyDateRangeFilter(
    entries,
    { from: window.from, to: window.to },
    (r) => r.attendanceDate
  );
  return applyTargetFilter(scoped as AttendanceDrillRow[], target, null);
}

describe.each([
  ['Term 1', TERM_1],
  ['Term 2', TERM_2],
])('%s window', (_name, window) => {
  it('Present slice = present drill rows', () => {
    expect(drillIn('present', window)).toHaveLength(kpisIn(window).present);
  });

  it('Late card and slice = lates drill rows', () => {
    expect(drillIn('lates', window)).toHaveLength(kpisIn(window).late);
  });

  it('Excused slice = excused drill rows', () => {
    expect(drillIn('excused', window)).toHaveLength(kpisIn(window).excused);
  });

  it('Days absent card and slice = absent drill rows', () => {
    expect(drillIn('absent', window)).toHaveLength(kpisIn(window).absent);
  });

  it('Attendance rate opens its denominator — every marked day, NC excluded', () => {
    expect(drillIn('attendance-summary', window)).toHaveLength(
      kpisIn(window).encodedDays
    );
  });
});

it('present rows are only P marks', () => {
  const rows = drillIn('present', TERM_1) as AttendanceEntryRow[];
  expect(rows.map((r) => r.status)).toEqual(['P', 'P']);
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run __tests__/attendance/insights-drill-parity.test.ts --pool=threads`
Expected: FAIL — the two "Present slice" cases (`present` falls through `applyTargetFilter`'s `default` and returns every row: expected length 2, received 6 in Term 1) and "present rows are only P marks".

- [ ] **Step 3: Implement**

In `lib/attendance/drill.ts`:

Union (`:36-40`) — add after `'absent'`:

```ts
  | 'absent' // absent entries
  | 'present' // present entries (Insights mix pie + composition bars)
```

`rowKindForTarget` (`:62-68`) — add `case 'present':` to the entry group:

```ts
    case 'attendance-summary':
    case 'lates':
    case 'excused':
    case 'absent':
    case 'present':
    case 'daily-attendance-day':
    case 'ex-reason':
      return 'entry';
```

`applyTargetFilter` — add after the `'absent'` case (`:1327-1330`):

```ts
    case 'present':
      return (rows as AttendanceEntryRow[]).filter(
        (r) => r.status === 'P'
      ) as AttendanceDrillRow[];
```

`defaultColumnsForTarget` (`:1546`) — a Present mark carries no reason or note either:

```ts
  if (target === 'lates' || target === 'absent' || target === 'present') {
```

`drillHeaderForTarget` — add after the `'absent'` case:

```ts
    case 'present':
      return { eyebrow: 'Attendance', title: 'Students present on each date' };
```

In `app/api/attendance/drill/[target]/route.ts`, `VALID_TARGETS` — add `'present',` after `'absent',`.

- [ ] **Step 4: Run it — expect pass**

Run: `npx vitest run __tests__/attendance/insights-drill-parity.test.ts __tests__/attendance/drill-card-parity.test.ts --pool=threads`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add lib/attendance/drill.ts "app/api/attendance/drill/[target]/route.ts" __tests__/attendance/insights-drill-parity.test.ts && git commit -m "feat(attendance): present drill target; pin Insights mix counts to drill rows" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.3: `over-leave-quota` drill target

**Files:**

- Modify: `lib/attendance/drill.ts` — union `:36-48`, `AttendanceDrillRowKind` `:50-56`, `rowKindForTarget` `:58-85`, row types (after `VacationLeaveUsageRow` `:158`), `AttendanceDrillRow` `:173-179`, card selection rules (after `selectAtRiskVacationLeave` `:1093`), `BuildDrillRowsInput` comment `:1100`, `buildAttendanceDrillRows` (before the `// compassionate` fallthrough `:1174`), `applyTargetFilter` (after `'vacation-leave-quota'` `:1406-1409`), `DrillColumnKey` + `DRILL_COLUMN_LABELS` `:1420-1471`, column lists `:1508-1518`, `allColumnsForKind` `:1520-1537`, `drillHeaderForTarget` `:1615-1621`
- Modify: `app/api/attendance/drill/[target]/route.ts` — imports `:3-19`, `VALID_TARGETS`, `schoolConfig` `:80-81`, `csvCell` (before the calendar fallthrough `:272`)
- Test: `__tests__/attendance/over-leave-quota-drill.test.ts`

**Interfaces:**

- Consumes: `CompassionateUsageRow` (`:130`), `VacationLeaveUsageRow` (`:145`), `rollupCompassionate(ayCode, preloadedEntries?)` (`:770`), `rollupVacationLeave(ayCode, termId, defaultAllowance, preloadedEntries?)` (`:920`), `loadEntryRows` (`:450`).
- Produces:
  - `export type LeaveQuotaRow = { leaveType: 'compassionate' | 'vacation'; studentSectionId: string; studentName: string; studentNumber: string; sectionId: string; sectionName: string; level: string | null; termNumber: number | null; allowance: number; used: number; isOver: boolean }`
  - `export const LEAVE_TYPE_LABELS: Record<LeaveQuotaRow['leaveType'], string>`
  - `export function toLeaveQuotaRows(compassionate: CompassionateUsageRow[], vacation: VacationLeaveUsageRow[]): LeaveQuotaRow[]`
  - `export function selectOverLeaveQuota(rows: LeaveQuotaRow[], leaveType?: string | null): LeaveQuotaRow[]`
  - `AttendanceDrillTarget` gains `'over-leave-quota'`; `AttendanceDrillRowKind` gains `'leave-quota'`; `DrillColumnKey` gains `'leaveType'`.
  - Route: `GET /api/attendance/drill/over-leave-quota?ay=&termId=&segment=compassionate|vacation` (segment optional).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/attendance/over-leave-quota-drill.test.ts
/**
 * "Over their leave quota" on Attendance Insights counts compassionate-over
 * plus vacation-over (a student over both counts twice). Its drill must list
 * exactly those rows — one per student per leave type — and the compassionate
 * list's "See all" (segment `compassionate`) exactly that list.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
  revalidateTag: () => {},
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    throw new Error('no database in this test');
  },
}));

import {
  applyTargetFilter,
  defaultColumnsForTarget,
  rowKindForTarget,
  selectOverLeaveQuota,
  toLeaveQuotaRows,
  type AttendanceDrillRow,
  type CompassionateUsageRow,
  type LeaveQuotaRow,
  type VacationLeaveUsageRow,
} from '@/lib/attendance/drill';

function compassionate(
  name: string,
  used: number,
  allowance = 5
): CompassionateUsageRow {
  return {
    studentSectionId: `ss-${name}`,
    studentName: name,
    studentNumber: `H-${name}`,
    sectionId: 'sec-1',
    sectionName: 'Respect',
    level: 'P5',
    allowance,
    used,
    remaining: allowance - used,
    isOverQuota: used > allowance,
  };
}

function vacation(
  name: string,
  usedThisTerm: number,
  allowance = 1
): VacationLeaveUsageRow {
  return {
    studentSectionId: `ss-${name}`,
    studentName: name,
    studentNumber: `H-${name}`,
    sectionId: 'sec-1',
    sectionName: 'Respect',
    level: 'P5',
    termId: 'term-2',
    termNumber: 2,
    allowance,
    usedThisTerm,
    remainingThisTerm: Math.max(0, allowance - usedThisTerm),
    isOverTermQuota: usedThisTerm > allowance,
  };
}

const compassionateRows = [
  compassionate('Ana', 0),
  compassionate('Ben', 6), // over
  compassionate('Cleo', 5), // at the limit, not over
  compassionate('Dina', 8), // over
];
const vacationRows = [
  vacation('Ana', 0),
  vacation('Ben', 2), // over — Ben is over BOTH allowances
  vacation('Cleo', 1), // at the limit
  vacation('Eli', 3), // over
];

// The KPI exactly as the Insights page computed it before this phase.
const kpi =
  compassionateRows.filter((r) => r.isOverQuota).length +
  vacationRows.filter((r) => r.isOverTermQuota).length;

const drill = (segment: string | null) =>
  applyTargetFilter(
    toLeaveQuotaRows(compassionateRows, vacationRows) as AttendanceDrillRow[],
    'over-leave-quota',
    segment
  ) as LeaveQuotaRow[];

describe('over-leave-quota drill', () => {
  it('lists as many rows as the KPI counts', () => {
    expect(kpi).toBe(4);
    expect(drill(null)).toHaveLength(kpi);
  });

  it('lists a student over both allowances once per leave type', () => {
    const ben = drill(null).filter((r) => r.studentName === 'Ben');
    expect(ben.map((r) => r.leaveType).sort()).toEqual([
      'compassionate',
      'vacation',
    ]);
  });

  it('never lists someone at, but not over, their allowance', () => {
    expect(drill(null).some((r) => r.studentName === 'Cleo')).toBe(false);
  });

  it('segment compassionate = the compassionate "Over quota" list', () => {
    const rows = drill('compassionate');
    expect(rows.map((r) => r.studentName).sort()).toEqual(
      compassionateRows
        .filter((r) => r.isOverQuota)
        .map((r) => r.studentName)
        .sort()
    );
  });

  it('segment vacation = the vacation over-quota students', () => {
    expect(
      drill('vacation')
        .map((r) => r.studentName)
        .sort()
    ).toEqual(['Ben', 'Eli']);
  });

  it('is the same selection selectOverLeaveQuota makes', () => {
    expect(drill(null)).toEqual(
      selectOverLeaveQuota(toLeaveQuotaRows(compassionateRows, vacationRows))
    );
  });

  it('carries the term for vacation and none for the per-year compassionate allowance', () => {
    const rows = drill(null);
    expect(rows.find((r) => r.leaveType === 'vacation')!.termNumber).toBe(2);
    expect(
      rows.find((r) => r.leaveType === 'compassionate')!.termNumber
    ).toBeNull();
  });

  it('is an empty list, not an error, when nobody is over', () => {
    expect(
      applyTargetFilter(
        toLeaveQuotaRows(
          [compassionate('Ana', 1)],
          [vacation('Ana', 1)]
        ) as AttendanceDrillRow[],
        'over-leave-quota',
        null
      )
    ).toEqual([]);
  });

  it('uses its own row kind and shows a Leave type column', () => {
    expect(rowKindForTarget('over-leave-quota')).toBe('leave-quota');
    expect(defaultColumnsForTarget('over-leave-quota')).toEqual([
      'studentName',
      'sectionName',
      'level',
      'leaveType',
      'termNumber',
      'allowance',
      'used',
    ]);
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run __tests__/attendance/over-leave-quota-drill.test.ts --pool=threads`
Expected: FAIL — `toLeaveQuotaRows is not a function` (and `selectOverLeaveQuota`).

- [ ] **Step 3: Implement — `lib/attendance/drill.ts`**

Union — add after `'vacation-leave-quota'` (change its `;` to nothing and end on the new line):

```ts
  | 'vacation-leave-quota' // student × vacation-leave quota (per term, KD #94)
  | 'over-leave-quota'; // student × leave type, over the allowance only (Attendance Insights)
```

`AttendanceDrillRowKind` — add `| 'leave-quota'` after `'vacation-leave'`.

`rowKindForTarget` — add before `default`:

```ts
    case 'over-leave-quota':
      return 'leave-quota';
```

After `VacationLeaveUsageRow` (`:158`):

```ts
/**
 * One student over ONE leave allowance — the rows behind Attendance Insights'
 * "Over their leave quota" card. That card adds compassionate-over to
 * vacation-over, so a student over both is counted twice; here they are two
 * rows, one per leave type, and the list's length is the card's number.
 */
export type LeaveQuotaRow = {
  leaveType: 'compassionate' | 'vacation';
  studentSectionId: string;
  studentName: string;
  studentNumber: string;
  sectionId: string;
  sectionName: string;
  level: string | null;
  /** Vacation only — the compassionate allowance is per year. */
  termNumber: number | null;
  allowance: number;
  used: number;
  isOver: boolean;
};

export const LEAVE_TYPE_LABELS: Record<LeaveQuotaRow['leaveType'], string> = {
  compassionate: 'Compassionate leave',
  vacation: 'Vacation leave',
};
```

`AttendanceDrillRow` union — add `| LeaveQuotaRow` after `| VacationLeaveUsageRow`.

After `selectAtRiskVacationLeave` (`:1093`):

```ts
/** Both leave roll-ups as one list, one row per student per leave type. */
export function toLeaveQuotaRows(
  compassionate: CompassionateUsageRow[],
  vacation: VacationLeaveUsageRow[]
): LeaveQuotaRow[] {
  const rows: LeaveQuotaRow[] = [];
  for (const r of compassionate) {
    rows.push({
      leaveType: 'compassionate',
      studentSectionId: r.studentSectionId,
      studentName: r.studentName,
      studentNumber: r.studentNumber,
      sectionId: r.sectionId,
      sectionName: r.sectionName,
      level: r.level,
      termNumber: null,
      allowance: r.allowance,
      used: r.used,
      isOver: r.isOverQuota,
    });
  }
  for (const r of vacation) {
    rows.push({
      leaveType: 'vacation',
      studentSectionId: r.studentSectionId,
      studentName: r.studentName,
      studentNumber: r.studentNumber,
      sectionId: r.sectionId,
      sectionName: r.sectionName,
      level: r.level,
      termNumber: r.termNumber,
      allowance: r.allowance,
      used: r.usedThisTerm,
      isOver: r.isOverTermQuota,
    });
  }
  return rows;
}

/**
 * Over the allowance only — the predicate behind both the Insights "Over their
 * leave quota" card and the `over-leave-quota` drill. `leaveType` narrows to
 * one allowance (the compassionate list's "See all"). Furthest over first.
 */
export function selectOverLeaveQuota(
  rows: LeaveQuotaRow[],
  leaveType: string | null = null
): LeaveQuotaRow[] {
  return rows
    .filter((r) => r.isOver && (leaveType == null || r.leaveType === leaveType))
    .sort(
      (a, b) =>
        b.used - b.allowance - (a.used - a.allowance) ||
        a.studentName.localeCompare(b.studentName)
    );
}
```

`BuildDrillRowsInput.termId` comment — change to:

```ts
// termId is required for 'vacation-leave-quota' and 'over-leave-quota'
// (per KD #94 the vacation allowance is per term). Other targets ignore it.
```

`buildAttendanceDrillRows` — insert before `// compassionate` (`:1174`):

```ts
if (kind === 'leave-quota') {
  // One scan feeds both roll-ups — the same two functions buildAllRowSets
  // runs for the Insights card, so the list is made of the card's rows.
  const entries = await loadEntryRows(input.ayCode);
  const [compassionate, vacation] = await Promise.all([
    rollupCompassionate(input.ayCode, entries),
    rollupVacationLeave(
      input.ayCode,
      input.termId ?? null,
      input.defaultVlAllowance ?? 1,
      entries
    ),
  ]);
  return applyTargetFilter(
    toLeaveQuotaRows(compassionate, vacation) as AttendanceDrillRow[],
    input.target,
    input.segment ?? null
  );
}
```

`applyTargetFilter` — after the `'vacation-leave-quota'` case:

```ts
    case 'over-leave-quota':
      return selectOverLeaveQuota(
        rows as LeaveQuotaRow[],
        segment
      ) as AttendanceDrillRow[];
```

`DrillColumnKey` — add `| 'leaveType'` after `| 'isOverTermQuota'`. `DRILL_COLUMN_LABELS` — add `leaveType: 'Leave type',`.

After `VACATION_LEAVE_COLUMNS`:

```ts
const LEAVE_QUOTA_COLUMNS: DrillColumnKey[] = [
  'studentName',
  'sectionName',
  'level',
  'leaveType',
  'termNumber',
  'allowance',
  'used',
];
```

`allColumnsForKind` — add before `case 'calendar-day'`:

```ts
    case 'leave-quota':
      return LEAVE_QUOTA_COLUMNS;
```

`drillHeaderForTarget` — add after `'vacation-leave-quota'`:

```ts
    case 'over-leave-quota':
      return {
        eyebrow: 'Leave quotas',
        title:
          segment === 'compassionate'
            ? 'Students over their compassionate-leave allowance this year'
            : segment === 'vacation'
              ? 'Students over their vacation-leave allowance this term'
              : 'Students over a leave allowance',
      };
```

- [ ] **Step 4: Implement — `app/api/attendance/drill/[target]/route.ts`**

Imports — add `LEAVE_TYPE_LABELS,` after `DRILL_COLUMN_LABELS,` and `type LeaveQuotaRow,` after `type DrillColumnKey,`.

`VALID_TARGETS` — add `'over-leave-quota',` after `'vacation-leave-quota',`.

`schoolConfig` (`:80-81`):

```ts
const schoolConfig =
  target === 'vacation-leave-quota' || target === 'over-leave-quota'
    ? await getSchoolConfig()
    : null;
```

`csvCell` — insert before `// calendar-day` (`:272`):

```ts
if (kind === 'leave-quota') {
  const r = row as LeaveQuotaRow;
  switch (key) {
    case 'studentName':
      return r.studentName;
    case 'studentNumber':
      return r.studentNumber;
    case 'sectionName':
      return r.sectionName;
    case 'level':
      return r.level ?? '';
    case 'leaveType':
      return LEAVE_TYPE_LABELS[r.leaveType];
    case 'termNumber':
      return r.termNumber == null ? 'Whole year' : `T${r.termNumber}`;
    case 'allowance':
      return r.allowance;
    case 'used':
      return r.used;
    default:
      return '';
  }
}
```

- [ ] **Step 5: Run it — expect pass**

Run: `npx vitest run __tests__/attendance/over-leave-quota-drill.test.ts __tests__/attendance/drill-card-parity.test.ts --pool=threads`
Expected: PASS. (`components/attendance/drills/attendance-drill-sheet.tsx` does not type-check yet for the new kind — Task 2.5.)

- [ ] **Step 6: Commit**

```bash
git add lib/attendance/drill.ts "app/api/attendance/drill/[target]/route.ts" __tests__/attendance/over-leave-quota-drill.test.ts && git commit -m "feat(attendance): over-leave-quota drill — both allowances, over only, with a leave type" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.4: The Insights quota lists share the drills' selectors

**Files:**

- Modify: `lib/attendance/drill.ts` (after `selectOverLeaveQuota`, added in Task 2.3)
- Test: `__tests__/attendance/over-leave-quota-drill.test.ts` (append)

**Interfaces:**

- Consumes: `selectAtRiskVacationLeave` (`:1080`), `toLeaveQuotaRows`, `selectOverLeaveQuota`.
- Produces:
  - `export type LeaveQuotaSummary = { compassionateOver: CompassionateUsageRow[]; vacationOver: VacationLeaveUsageRow[]; vacationApproaching: VacationLeaveUsageRow[]; overLeaveQuotaCount: number; haveQuotaRisk: boolean }`
  - `export function summariseLeaveQuota(compassionate: CompassionateUsageRow[], vacation: VacationLeaveUsageRow[]): LeaveQuotaSummary`

Why: the page's vacation card lists over + "approaching" (`isApproachingVlQuota`: not over, `remaining === 0`). Its "See all" opens `vacation-leave-quota` (`selectAtRiskVacationLeave`: `used > 0` and at or over). A student with a 0 allowance who took no trip is "approaching" on the card and absent from the drill. Deriving the card from the drill's selector makes the two the same set; the only visible change is that this student stops showing as "approaching" (they have not used anything).

- [ ] **Step 1: Write the failing test** — append to `__tests__/attendance/over-leave-quota-drill.test.ts` (add `selectAtRiskVacationLeave` and `summariseLeaveQuota` to the existing import from `@/lib/attendance/drill`):

```ts
describe('summariseLeaveQuota — the Insights quota lists', () => {
  const summary = summariseLeaveQuota(compassionateRows, vacationRows);

  it('KPI = over-leave-quota drill rows', () => {
    expect(summary.overLeaveQuotaCount).toBe(drill(null).length);
    expect(summary.overLeaveQuotaCount).toBe(
      summary.compassionateOver.length + summary.vacationOver.length
    );
  });

  it('compassionate list = the compassionate "See all" rows', () => {
    const ids = (rows: Array<{ studentSectionId: string }>) =>
      rows.map((r) => r.studentSectionId).sort();
    expect(ids(summary.compassionateOver)).toEqual(ids(drill('compassionate')));
  });

  it('vacation list (over + approaching) = the vacation-leave-quota drill rows', () => {
    const drillRows = applyTargetFilter(
      vacationRows as AttendanceDrillRow[],
      'vacation-leave-quota',
      null
    );
    expect(
      summary.vacationOver.length + summary.vacationApproaching.length
    ).toBe(drillRows.length);
    expect([...summary.vacationOver, ...summary.vacationApproaching]).toEqual(
      selectAtRiskVacationLeave(vacationRows)
    );
  });

  it('does not call a zero allowance with no trips "approaching"', () => {
    const s = summariseLeaveQuota([], [vacation('Zed', 0, 0)]);
    expect(s.vacationApproaching).toEqual([]);
    expect(s.haveQuotaRisk).toBe(false);
  });

  it('flags risk when anyone is over or at the vacation limit', () => {
    expect(summary.haveQuotaRisk).toBe(true);
    expect(summariseLeaveQuota([], [vacation('Cleo', 1)]).haveQuotaRisk).toBe(
      true
    );
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run __tests__/attendance/over-leave-quota-drill.test.ts --pool=threads`
Expected: FAIL — `summariseLeaveQuota is not a function`.

- [ ] **Step 3: Implement** — in `lib/attendance/drill.ts`, after `selectOverLeaveQuota`:

```ts
export type LeaveQuotaSummary = {
  compassionateOver: CompassionateUsageRow[];
  vacationOver: VacationLeaveUsageRow[];
  vacationApproaching: VacationLeaveUsageRow[];
  overLeaveQuotaCount: number;
  haveQuotaRisk: boolean;
};

/**
 * Everything the Attendance Insights leave-quota KPI and lists show, built
 * from the same selectors their drills filter with — so "Over their leave
 * quota" = the `over-leave-quota` rows, the compassionate list = segment
 * `compassionate`, and the vacation list (over + at the limit) = the
 * `vacation-leave-quota` rows.
 */
export function summariseLeaveQuota(
  compassionate: CompassionateUsageRow[],
  vacation: VacationLeaveUsageRow[]
): LeaveQuotaSummary {
  const compassionateOver = compassionate.filter((r) => r.isOverQuota);
  const vacationAtRisk = selectAtRiskVacationLeave(vacation);
  const vacationOver = vacationAtRisk.filter((r) => r.isOverTermQuota);
  const vacationApproaching = vacationAtRisk.filter((r) => !r.isOverTermQuota);
  return {
    compassionateOver,
    vacationOver,
    vacationApproaching,
    overLeaveQuotaCount: selectOverLeaveQuota(
      toLeaveQuotaRows(compassionate, vacation)
    ).length,
    haveQuotaRisk:
      compassionateOver.length > 0 ||
      vacationOver.length > 0 ||
      vacationApproaching.length > 0,
  };
}
```

- [ ] **Step 4: Run it — expect pass**

Run: `npx vitest run __tests__/attendance/over-leave-quota-drill.test.ts __tests__/attendance/insights-watchlist.test.ts --pool=threads`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/attendance/drill.ts __tests__/attendance/over-leave-quota-drill.test.ts && git commit -m "feat(attendance): Insights leave-quota lists built from the drills' own selectors" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.5: The drill sheet renders leave-quota rows, and its CSV keeps the term

**Files:**

- Modify: `components/attendance/drills/attendance-drill-sheet.tsx` — imports `:20-36`, new column builder (after `buildVacationLeaveColumns`, ends `~:673`), `seedRows` `:744-761`, `hasSeed` `:774-786`, `columns` `:857-890`, `groupAccessor` `:898-922`, `csvParams` `:964-969`
- Test: `__tests__/attendance/leave-quota-drill-columns.test.tsx`

**Interfaces:**

- Consumes: `LeaveQuotaRow`, `LEAVE_TYPE_LABELS`, `DRILL_COLUMN_LABELS`, `defaultColumnsForTarget` (Task 2.3).
- Produces: `export function buildLeaveQuotaColumns(visible: DrillColumnKey[]): ColumnDef<LeaveQuotaRow, unknown>[]` (exported for the test); CSV href now carries `termId`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/attendance/leave-quota-drill-columns.test.tsx
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
  revalidateTag: () => {},
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    throw new Error('no database in this test');
  },
}));

import { buildLeaveQuotaColumns } from '@/components/attendance/drills/attendance-drill-sheet';
import {
  defaultColumnsForTarget,
  DRILL_COLUMN_LABELS,
  type LeaveQuotaRow,
} from '@/lib/attendance/drill';

const row = (over: Partial<LeaveQuotaRow> = {}): LeaveQuotaRow => ({
  leaveType: 'compassionate',
  studentSectionId: 'ss-ben',
  studentName: 'Ben Tan',
  studentNumber: 'H240001',
  sectionId: 'sec-1',
  sectionName: 'Respect',
  level: 'P5',
  termNumber: null,
  allowance: 5,
  used: 6,
  isOver: true,
  ...over,
});

type CellFn = (ctx: { row: { original: LeaveQuotaRow } }) => React.ReactNode;

function renderCell(id: string, original: LeaveQuotaRow) {
  const cols = buildLeaveQuotaColumns(
    defaultColumnsForTarget('over-leave-quota')
  );
  const col = cols.find((c) => c.id === id)!;
  const cell = col.cell as unknown as CellFn;
  render(<>{cell({ row: { original } })}</>);
}

describe('leave-quota drill columns', () => {
  it('builds the default columns in order, plus the View link', () => {
    const cols = buildLeaveQuotaColumns(
      defaultColumnsForTarget('over-leave-quota')
    );
    expect(cols.map((c) => c.id)).toEqual([
      'studentName',
      'sectionName',
      'level',
      'leaveType',
      'termNumber',
      'allowance',
      'used',
      'action',
    ]);
  });

  it('uses the plain-English labels as headers', () => {
    const cols = buildLeaveQuotaColumns(['leaveType', 'termNumber']);
    expect(cols[0]!.header).toBe(DRILL_COLUMN_LABELS.leaveType);
    expect(cols[1]!.header).toBe('Term');
  });

  it('names the leave type in words', () => {
    renderCell('leaveType', row({ leaveType: 'vacation' }));
    expect(screen.getByText('Vacation leave')).toBeTruthy();
  });

  it('says "Whole year" for the per-year compassionate allowance', () => {
    renderCell('termNumber', row());
    expect(screen.getByText('Whole year')).toBeTruthy();
  });

  it('shows the term for vacation leave', () => {
    renderCell('termNumber', row({ leaveType: 'vacation', termNumber: 2 }));
    expect(screen.getByText('T2')).toBeTruthy();
  });

  it('links the student to their attendance page (KD #81)', () => {
    renderCell('studentName', row());
    expect(
      screen.getByRole('link', { name: 'Ben Tan' }).getAttribute('href')
    ).toBe('/attendance/students/H240001');
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run __tests__/attendance/leave-quota-drill-columns.test.tsx --pool=threads`
Expected: FAIL — `buildLeaveQuotaColumns is not a function` (not exported / not defined).

- [ ] **Step 3: Implement** — `components/attendance/drills/attendance-drill-sheet.tsx`

Imports from `@/lib/attendance/drill` — add `LEAVE_TYPE_LABELS,` and `type LeaveQuotaRow,`.

After `buildVacationLeaveColumns` (before `function buildCalendarColumns`):

```tsx
export function buildLeaveQuotaColumns(
  visible: DrillColumnKey[]
): ColumnDef<LeaveQuotaRow, unknown>[] {
  const cols: ColumnDef<LeaveQuotaRow, unknown>[] = [];
  for (const key of visible) {
    switch (key) {
      case 'studentName':
        cols.push({
          id: 'studentName',
          accessorKey: 'studentName',
          header: DRILL_COLUMN_LABELS.studentName,
          cell: ({ row }) => (
            <div className="space-y-0.5">
              <Link
                href={`/attendance/students/${encodeURIComponent(row.original.studentNumber)}`}
                className="font-medium text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
              >
                {row.original.studentName}
              </Link>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {row.original.studentNumber}
              </div>
            </div>
          ),
        });
        break;
      case 'sectionName':
        cols.push({
          id: 'sectionName',
          accessorKey: 'sectionName',
          header: DRILL_COLUMN_LABELS.sectionName,
          cell: ({ row }) => (
            <span className="text-sm">{row.original.sectionName}</span>
          ),
        });
        break;
      case 'level':
        cols.push({
          id: 'level',
          accessorKey: 'level',
          header: DRILL_COLUMN_LABELS.level,
          cell: ({ row }) => (
            <span className="text-sm text-muted-foreground">
              {row.original.level ?? '—'}
            </span>
          ),
        });
        break;
      case 'leaveType':
        cols.push({
          id: 'leaveType',
          accessorFn: (r) => LEAVE_TYPE_LABELS[r.leaveType],
          header: DRILL_COLUMN_LABELS.leaveType,
          cell: ({ row }) => (
            <span className="text-sm">
              {LEAVE_TYPE_LABELS[row.original.leaveType]}
            </span>
          ),
        });
        break;
      case 'termNumber':
        cols.push({
          id: 'termNumber',
          accessorFn: (r) => r.termNumber ?? 0,
          header: DRILL_COLUMN_LABELS.termNumber,
          cell: ({ row }) => (
            <span className="font-mono text-sm tabular-nums text-muted-foreground">
              {row.original.termNumber == null
                ? 'Whole year'
                : `T${row.original.termNumber}`}
            </span>
          ),
        });
        break;
      case 'allowance':
        cols.push({
          id: 'allowance',
          accessorKey: 'allowance',
          header: DRILL_COLUMN_LABELS.allowance,
          cell: ({ row }) => (
            <span className="font-mono tabular-nums">
              {row.original.allowance}
            </span>
          ),
        });
        break;
      case 'used':
        cols.push({
          id: 'used',
          accessorKey: 'used',
          header: DRILL_COLUMN_LABELS.used,
          // Every row here is over its allowance — §9.3 destructive tone.
          cell: ({ row }) => (
            <span className="font-mono font-semibold tabular-nums text-destructive">
              {row.original.used}
            </span>
          ),
        });
        break;
    }
  }
  cols.push({
    id: 'action',
    header: '',
    cell: ({ row }) => (
      <Link
        href={`/attendance/students/${encodeURIComponent(row.original.studentNumber)}`}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        View
        <ArrowUpRight className="size-3" />
      </Link>
    ),
    enableSorting: false,
  });
  return cols;
}
```

`seedRows` memo — this kind is never seeded; add before the calendar fallthrough:

```tsx
if (kind === 'leave-quota') return EMPTY_ROWS;
```

(`EMPTY_ROWS` is declared above the component at `:724`; the memo sits inside it, so it is in scope.)

`hasSeed` — replace the last branch so `leave-quota` is never treated as a calendar seed:

```tsx
            : kind === 'vacation-leave'
              ? initialVacationLeave !== undefined
              : kind === 'leave-quota'
                ? false
                : initialCalendar !== undefined;
```

`columns` memo — add before the calendar fallthrough:

```tsx
if (kind === 'leave-quota')
  return buildLeaveQuotaColumns(visibleColumnKeys) as ColumnDef<
    AttendanceDrillRow,
    unknown
  >[];
```

`groupAccessor` — add `kind === 'leave-quota' ||` to the level-grouping list, and group by leave type under "status":

```tsx
      if (kind === 'leave-quota' && groupBy === 'status') {
        return LEAVE_TYPE_LABELS[(row as LeaveQuotaRow).leaveType];
      }
      if (
        kind === 'top-absent' ||
        kind === 'section-rollup' ||
        kind === 'compassionate' ||
        kind === 'vacation-leave' ||
        kind === 'leave-quota'
      ) {
```

`csvParams` — carry the term, or a vacation-quota CSV is exported empty:

```tsx
if (segment) csvParams.set('segment', segment);
if (termId) csvParams.set('termId', termId);
```

- [ ] **Step 4: Run it — expect pass**

Run: `npx vitest run __tests__/attendance/leave-quota-drill-columns.test.tsx __tests__/ui/data-table-column-label-coverage.test.ts --pool=threads`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean (the new kind is now handled everywhere).

- [ ] **Step 5: Commit**

```bash
git add components/attendance/drills/attendance-drill-sheet.tsx __tests__/attendance/leave-quota-drill-columns.test.tsx && git commit -m "feat(attendance): drill sheet lists leave-quota rows; CSV export keeps the term" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.6: Client click wrappers for the Insights page

**Files:**

- Create: `components/attendance/drills/insights-drill-cards.tsx`
- Test: `__tests__/attendance/insights-drill-cards.test.tsx`

**Interfaces:**

- Consumes: `AttendanceDrillSheet` (props `target, segment?, ayCode, initialFrom?, initialTo?, termId?`); `GroupedBarChart` with Phase 1's `onSegmentClick?: SegmentClickHandler` (reports `(row.x, series.key)`); `LabeledPieChart` `onSegmentClick?: SegmentClickHandler` (called with the slice name only); `MIX_SLICE_TARGET`, `MIX_SERIES_TARGET`, `termWindowFor`, `type TermWindowMap` (Task 2.1).
- Produces (all `'use client'`, all props serializable):
  - `AttendanceMixPieDrill(props: { data: LabeledPieSlice[]; colors: string[]; ayCode: string; from?: string; to?: string })`
  - `TermRateBarsDrill(props: { series: GroupedBarSeries[]; data: Array<Record<string, string | number | null>>; yDomain?: [number, number]; highlightX?: string; termWindows: TermWindowMap })`
  - `CompositionBarsDrill(props: { series: GroupedBarSeries[]; data: Array<Record<string, string | number | null>>; height?: number; ayCode: string; termWindows: TermWindowMap })`
  - `SeeAllDrillButton(props: { target: AttendanceDrillTarget; segment?: string; ayCode: string; from?: string; to?: string; termId?: string; label?: string })`

Design: segments keep Phase 1's hover/pointer treatment (nothing styled here). "See all" is a `ghost` `Button size="sm"`, placed in the card header by the page (Task 2.7). No new tokens.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/attendance/insights-drill-cards.test.tsx
import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Charts stand in as one button per clickable segment, calling the same
// callback the real chart calls — the wiring is what is under test.
vi.mock('@/components/dashboard/charts/grouped-bar-chart', () => ({
  GroupedBarChart: ({
    data,
    series,
    onSegmentClick,
  }: {
    data: Array<Record<string, unknown>>;
    series: Array<{ key: string }>;
    onSegmentClick?: (category: string, series?: string) => void;
  }) => (
    <div>
      {data.flatMap((row) =>
        series.map((s) => (
          <button
            key={`${String(row.x)}:${s.key}`}
            type="button"
            onClick={() => onSegmentClick?.(String(row.x), s.key)}
          >
            {`${String(row.x)}:${s.key}`}
          </button>
        ))
      )}
    </div>
  ),
}));

vi.mock('@/components/dashboard/charts/labeled-pie-chart', () => ({
  LabeledPieChart: ({
    data,
    onSegmentClick,
  }: {
    data: Array<{ name: string }>;
    onSegmentClick?: (name: string) => void;
  }) => (
    <div>
      {data.map((d) => (
        <button
          key={d.name}
          type="button"
          onClick={() => onSegmentClick?.(d.name)}
        >
          {d.name}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@/components/attendance/drills/attendance-drill-sheet', () => ({
  AttendanceDrillSheet: (props: Record<string, unknown>) => (
    <pre data-testid="drill">{JSON.stringify(props)}</pre>
  ),
}));

import {
  AttendanceMixPieDrill,
  CompositionBarsDrill,
  SeeAllDrillButton,
  TermRateBarsDrill,
} from '@/components/attendance/drills/insights-drill-cards';
import type { TermWindowMap } from '@/lib/attendance/insights-drill';

const termWindows: TermWindowMap = {
  AY2026: {
    T1: { from: '2026-01-05', to: '2026-03-13' },
    T2: { from: '2026-03-23', to: '2026-05-29' },
  },
  AY2025: {
    T1: { from: '2025-01-06', to: '2025-03-14' },
    T2: { from: '2025-03-24', to: '2025-05-30' },
  },
};

function openedDrill(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('drill').textContent ?? '{}');
}

describe('AttendanceMixPieDrill', () => {
  it('opens the clicked status for the selected term', () => {
    render(
      <AttendanceMixPieDrill
        data={[
          { name: 'Present', value: 90 },
          { name: 'Absent', value: 3 },
        ]}
        colors={['a', 'b']}
        ayCode="AY2026"
        from="2026-03-23"
        to="2026-05-29"
      />
    );
    expect(screen.queryByTestId('drill')).toBeNull();
    fireEvent.click(screen.getByText('Present'));
    expect(openedDrill()).toMatchObject({
      target: 'present',
      ayCode: 'AY2026',
      initialFrom: '2026-03-23',
      initialTo: '2026-05-29',
    });
  });
});

describe('TermRateBarsDrill', () => {
  const data = [
    { x: 'T1', AY2026: 95, AY2025: 94 },
    { x: 'T2', AY2026: 96, AY2025: 93 },
    { x: 'T3', AY2026: null, AY2025: 92 },
  ];
  const series = [
    { key: 'AY2026', label: 'This year (AY2026)' },
    { key: 'AY2025', label: 'AY2025', muted: true },
  ];

  it("opens the comparison year's term when its bar is clicked", () => {
    render(
      <TermRateBarsDrill
        series={series}
        data={data}
        termWindows={termWindows}
      />
    );
    fireEvent.click(screen.getByText('T2:AY2025'));
    expect(openedDrill()).toMatchObject({
      target: 'attendance-summary',
      ayCode: 'AY2025',
      initialFrom: '2025-03-24',
      initialTo: '2025-05-30',
    });
  });

  it("opens this year's term when this year's bar is clicked", () => {
    render(
      <TermRateBarsDrill
        series={series}
        data={data}
        termWindows={termWindows}
      />
    );
    fireEvent.click(screen.getByText('T1:AY2026'));
    expect(openedDrill()).toMatchObject({
      ayCode: 'AY2026',
      initialFrom: '2026-01-05',
      initialTo: '2026-03-13',
    });
  });

  it('opens nothing for a term that has no dates', () => {
    render(
      <TermRateBarsDrill
        series={series}
        data={data}
        termWindows={termWindows}
      />
    );
    fireEvent.click(screen.getByText('T3:AY2025'));
    expect(screen.queryByTestId('drill')).toBeNull();
  });
});

describe('CompositionBarsDrill', () => {
  it("opens the clicked status in the clicked term's window", () => {
    render(
      <CompositionBarsDrill
        series={[
          { key: 'present', label: 'Present' },
          { key: 'late', label: 'Late' },
        ]}
        data={[
          { x: 'T1', present: 95, late: 2 },
          { x: 'T2', present: 96, late: 1 },
        ]}
        ayCode="AY2026"
        termWindows={termWindows}
      />
    );
    fireEvent.click(screen.getByText('T2:late'));
    expect(openedDrill()).toMatchObject({
      target: 'lates',
      ayCode: 'AY2026',
      initialFrom: '2026-03-23',
      initialTo: '2026-05-29',
    });
  });
});

describe('SeeAllDrillButton', () => {
  it('opens its target with the segment and term it was given', () => {
    render(
      <SeeAllDrillButton
        target="over-leave-quota"
        segment="compassionate"
        ayCode="AY2026"
        termId="term-2"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'See all' }));
    expect(openedDrill()).toMatchObject({
      target: 'over-leave-quota',
      segment: 'compassionate',
      ayCode: 'AY2026',
      termId: 'term-2',
    });
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run __tests__/attendance/insights-drill-cards.test.tsx --pool=threads`
Expected: FAIL — `Failed to resolve import "@/components/attendance/drills/insights-drill-cards"`.

- [ ] **Step 3: Implement**

```tsx
// components/attendance/drills/insights-drill-cards.tsx
'use client';

import * as React from 'react';

import { AttendanceDrillSheet } from '@/components/attendance/drills/attendance-drill-sheet';
import {
  GroupedBarChart,
  type GroupedBarSeries,
} from '@/components/dashboard/charts/grouped-bar-chart';
import {
  LabeledPieChart,
  type LabeledPieSlice,
} from '@/components/dashboard/charts/labeled-pie-chart';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import type { AttendanceDrillTarget } from '@/lib/attendance/drill';
import {
  MIX_SERIES_TARGET,
  MIX_SLICE_TARGET,
  termWindowFor,
  type TermWindowMap,
} from '@/lib/attendance/insights-drill';

// Attendance Insights is a Server Component, and a server page cannot hand a
// click handler to a client chart. These wrappers hold the clicked segment and
// open the drill sheet — the chart-drill-cards.tsx pattern, one per block.

type OpenDrill = {
  target: AttendanceDrillTarget;
  ayCode: string;
  from?: string;
  to?: string;
  segment?: string;
  termId?: string;
};

function DrillHost({
  drill,
  onClose,
  children,
}: {
  drill: OpenDrill | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={drill !== null} onOpenChange={(o) => !o && onClose()}>
      {children}
      {drill && (
        <AttendanceDrillSheet
          key={`${drill.target}|${drill.ayCode}|${drill.from ?? ''}|${drill.to ?? ''}|${drill.segment ?? ''}|${drill.termId ?? ''}`}
          target={drill.target}
          segment={drill.segment ?? null}
          ayCode={drill.ayCode}
          initialFrom={drill.from}
          initialTo={drill.to}
          termId={drill.termId}
        />
      )}
    </Sheet>
  );
}

type ChartData = Array<Record<string, string | number | null>>;

/** Attendance mix pie — a slice opens that status's marks for the selected term. */
export function AttendanceMixPieDrill({
  data,
  colors,
  ayCode,
  from,
  to,
}: {
  data: LabeledPieSlice[];
  colors: string[];
  ayCode: string;
  from?: string;
  to?: string;
}) {
  const [drill, setDrill] = React.useState<OpenDrill | null>(null);
  return (
    <DrillHost drill={drill} onClose={() => setDrill(null)}>
      <LabeledPieChart
        data={data}
        colors={colors}
        onSegmentClick={(name) => {
          const target = MIX_SLICE_TARGET[name];
          if (target) setDrill({ target, ayCode, from, to });
        }}
      />
    </DrillHost>
  );
}

/**
 * Term-by-term attendance rate — a bar opens every marked day of that term in
 * THAT BAR'S year (the series key is the AY code), Status as a column. A term
 * with no dates opens nothing rather than the whole year.
 */
export function TermRateBarsDrill({
  series,
  data,
  yDomain,
  highlightX,
  termWindows,
}: {
  series: GroupedBarSeries[];
  data: ChartData;
  yDomain?: [number, number];
  highlightX?: string;
  termWindows: TermWindowMap;
}) {
  const [drill, setDrill] = React.useState<OpenDrill | null>(null);
  return (
    <DrillHost drill={drill} onClose={() => setDrill(null)}>
      <GroupedBarChart
        series={series}
        data={data}
        yFormat="percent"
        yDomain={yDomain}
        showValueLabels
        highlightX={highlightX}
        onSegmentClick={(term, ayCode) => {
          if (!ayCode) return;
          const w = termWindowFor(termWindows, ayCode, term);
          if (!w) return;
          setDrill({
            target: 'attendance-summary',
            ayCode,
            from: w.from,
            to: w.to,
          });
        }}
      />
    </DrillHost>
  );
}

/** Composition by term — a bar opens that status's marks in that term. */
export function CompositionBarsDrill({
  series,
  data,
  height,
  ayCode,
  termWindows,
}: {
  series: GroupedBarSeries[];
  data: ChartData;
  height?: number;
  ayCode: string;
  termWindows: TermWindowMap;
}) {
  const [drill, setDrill] = React.useState<OpenDrill | null>(null);
  return (
    <DrillHost drill={drill} onClose={() => setDrill(null)}>
      <GroupedBarChart
        series={series}
        data={data}
        yFormat="percent"
        height={height}
        onSegmentClick={(term, statusKey) => {
          const target = statusKey ? MIX_SERIES_TARGET[statusKey] : undefined;
          const w = termWindowFor(termWindows, ayCode, term);
          if (!target || !w) return;
          setDrill({ target, ayCode, from: w.from, to: w.to });
        }}
      />
    </DrillHost>
  );
}

/** "See all" for a block that is itself a short list — opens the full list. */
export function SeeAllDrillButton({
  target,
  segment,
  ayCode,
  from,
  to,
  termId,
  label = 'See all',
}: {
  target: AttendanceDrillTarget;
  segment?: string;
  ayCode: string;
  from?: string;
  to?: string;
  termId?: string;
  label?: string;
}) {
  const [drill, setDrill] = React.useState<OpenDrill | null>(null);
  return (
    <DrillHost drill={drill} onClose={() => setDrill(null)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setDrill({ target, segment, ayCode, from, to, termId })}
      >
        {label}
      </Button>
    </DrillHost>
  );
}
```

- [ ] **Step 4: Run it — expect pass**

Run: `npx vitest run __tests__/attendance/insights-drill-cards.test.tsx --pool=threads`
Expected: PASS (6 tests).

Run: `npx tsc --noEmit`
Expected: clean. (Requires Phase 1's `onSegmentClick` on `GroupedBarChartProps`; if tsc reports it missing, Phase 1 is not merged — stop.)

- [ ] **Step 5: Commit**

```bash
git add components/attendance/drills/insights-drill-cards.tsx __tests__/attendance/insights-drill-cards.test.tsx && git commit -m "feat(attendance): click wrappers for the Insights charts and See all lists" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.7: Wire `/attendance/insights`

**Files:**

- Modify: `app/(attendance)/attendance/insights/page.tsx` (line numbers are today's; apply top to bottom with the Edit tool, anchoring on the quoted text)

**Interfaces:**

- Consumes: everything produced by Tasks 2.1–2.6; `MetricCard.drillSheet?: () => React.ReactNode` (`components/dashboard/metric-card.tsx:62`).
- Produces: no exports. Behaviour: every block drills; vacation leave counted for the **selected** term.

No new unit test: the page is a Server Component; its logic now lives in the tested helpers (`summariseLeaveQuota`, `resolveSelectedTermId`, `buildTermWindowMap`, the wrappers). The render check is Task 2.8's browser step.

- [ ] **Step 1: Imports** (`:20-24`)

Replace:

```tsx
import { GroupedBarChart } from '@/components/dashboard/charts/grouped-bar-chart';
import {
  LabeledPieChart,
  type LabeledPieSlice,
} from '@/components/dashboard/charts/labeled-pie-chart';
```

with:

```tsx
import { AttendanceDrillSheet } from '@/components/attendance/drills/attendance-drill-sheet';
import {
  AttendanceMixPieDrill,
  CompositionBarsDrill,
  SeeAllDrillButton,
  TermRateBarsDrill,
} from '@/components/attendance/drills/insights-drill-cards';
import type { LabeledPieSlice } from '@/components/dashboard/charts/labeled-pie-chart';
```

Replace (`:49-55`):

```tsx
import {
  buildAllRowSets,
  getTopAbsentByTerm,
  type TermWindowInput,
} from '@/lib/attendance/drill';
import { buildAttendanceInsightsExport } from '@/lib/attendance/insights-export';
import { isApproachingVlQuota } from '@/lib/attendance/insights-watchlist';
```

with:

```tsx
import {
  buildAllRowSets,
  getTopAbsentByTerm,
  summariseLeaveQuota,
  type TermWindowInput,
} from '@/lib/attendance/drill';
import {
  buildTermWindowMap,
  resolveSelectedTermId,
} from '@/lib/attendance/insights-drill';
import { buildAttendanceInsightsExport } from '@/lib/attendance/insights-export';
```

- [ ] **Step 2: `InsightChartCard` gets a header action slot** (`:122-158`)

In the props destructure and type, add `action` after `scopeNote`:

```tsx
function InsightChartCard({
  cap,
  title,
  icon: Icon,
  scopeNote,
  action,
  children,
}: {
  cap: string;
  title: string;
  icon: LucideIcon;
  scopeNote?: string;
  /** A "See all" button for blocks that are themselves short lists. */
  action?: ReactNode;
  children: ReactNode;
}) {
```

Replace the `CardAction` block:

```tsx
<CardAction>
  <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
    <Icon className="size-4" />
  </div>
</CardAction>
```

with:

```tsx
<CardAction className="flex items-center gap-2">
  {action}
  <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
    <Icon className="size-4" />
  </div>
</CardAction>
```

- [ ] **Step 3: Quota rows come from the shared selectors** (`:233-293`)

Replace `resolveQuotaRows`, `LeaveQuotaMetric` and `InsightsExportButton` with:

```tsx
/**
 * The quota rows, derived once and shared by all three. `summariseLeaveQuota`
 * uses the same selectors the drill targets filter with, so each list here and
 * the sheet its "See all" opens hold the same students.
 */
async function resolveQuotaRows(
  rowSetsPromise: ReturnType<typeof buildAllRowSets>
) {
  const rowSets = await rowSetsPromise;
  return summariseLeaveQuota(rowSets.compassionate, rowSets.vacationLeave);
}

/** "Over their leave quota" — one KPI card in the hero row. */
async function LeaveQuotaMetric({
  rowSetsPromise,
  ayCode,
  termId,
}: {
  rowSetsPromise: ReturnType<typeof buildAllRowSets>;
  ayCode: string;
  termId: string | null;
}) {
  const { overLeaveQuotaCount } = await resolveQuotaRows(rowSetsPromise);
  return (
    <MetricCard
      label="Over their leave quota"
      value={overLeaveQuotaCount}
      format="number"
      icon={ShieldAlert}
      subtext="Leave quotas"
      drillSheet={() => (
        <AttendanceDrillSheet
          target="over-leave-quota"
          ayCode={ayCode}
          termId={termId ?? undefined}
        />
      )}
    />
  );
}

/** The export button — its CSV carries the quota rows, so it waits too. */
async function InsightsExportButton({
  rowSetsPromise,
  base,
}: {
  rowSetsPromise: ReturnType<typeof buildAllRowSets>;
  base: Omit<
    Parameters<typeof buildAttendanceInsightsExport>[0],
    | 'haveQuotaRisk'
    | 'compassionateOver'
    | 'vacationOver'
    | 'vacationApproaching'
  >;
}) {
  const {
    compassionateOver,
    vacationOver,
    vacationApproaching,
    haveQuotaRisk,
  } = await resolveQuotaRows(rowSetsPromise);
  return (
    <ExportCsvButton
      data={buildAttendanceInsightsExport({
        ...base,
        compassionateOver,
        vacationOver,
        vacationApproaching,
        haveQuotaRisk,
      })}
    />
  );
}
```

- [ ] **Step 4: Vacation leave follows the selected term** (`:390-409`)

Replace the whole `let currentTermId ... }` block with:

```tsx
// The vacation-leave quota is per term (KD #94) and this page is scoped to
// the term in the picker, so the quota is counted for THAT term. It used to
// take the `is_current` term whatever was picked — choosing Term 2 still
// listed another term's vacation leave, and its "See all" could not match.
let selectedTermId: string | null = null;
const { data: ayRow } = await service
  .from('academic_years')
  .select('id')
  .eq('ay_code', selectedAy)
  .maybeSingle();
if (ayRow) {
  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number')
    .eq('academic_year_id', (ayRow as { id: string }).id);
  selectedTermId = resolveSelectedTermId(
    (termRows ?? []) as Array<{ id: string; term_number: number }>,
    selectedTermNumber
  );
}
```

In the `buildAllRowSets` call (`:464-470`), replace `vacationTermId: currentTermId,` with `vacationTermId: selectedTermId,`.

- [ ] **Step 5: Term windows for each plotted year** — after `const trendAys = ...` (`:438`) add:

```tsx
// Every term's dates for each year the term-by-term chart plots, so a bar
// opens that term in THAT bar's year — the comparison year included.
const termWindows = buildTermWindowMap([
  { ayCode: selectedAy, byNumber: windows.term.byNumber },
  ...(compareAy && compareWindows
    ? [{ ayCode: compareAy, byNumber: compareWindows.term.byNumber }]
    : []),
]);
```

- [ ] **Step 6: KPI cards drill** (`:690-728`)

Add to the "Attendance rate this period" `MetricCard`, after `sparkline=...`:

```tsx
            drillSheet={() => (
              <AttendanceDrillSheet
                target="attendance-summary"
                ayCode={selectedAy}
                initialFrom={rangeInput.from}
                initialTo={rangeInput.to}
              />
            )}
```

Add to "Days absent this period", after its `subtext`:

```tsx
            drillSheet={() => (
              <AttendanceDrillSheet
                target="absent"
                ayCode={selectedAy}
                initialFrom={rangeInput.from}
                initialTo={rangeInput.to}
              />
            )}
```

Add to "Late incidents this period", after its `subtext`:

```tsx
            drillSheet={() => (
              <AttendanceDrillSheet
                target="lates"
                ayCode={selectedAy}
                initialFrom={rangeInput.from}
                initialTo={rangeInput.to}
              />
            )}
```

Replace `<LeaveQuotaMetric rowSetsPromise={rowSetsPromise} />` with:

```tsx
<LeaveQuotaMetric
  rowSetsPromise={rowSetsPromise}
  ayCode={selectedAy}
  termId={selectedTermId}
/>
```

- [ ] **Step 7: Charts** (`:741-744`, `:769-776`, `:790-795`)

Replace:

```tsx
<LabeledPieChart data={attendanceMixPieData} colors={attendanceMixColors} />
```

with:

```tsx
<AttendanceMixPieDrill
  data={attendanceMixPieData}
  colors={attendanceMixColors}
  ayCode={selectedAy}
  from={rangeInput.from}
  to={rangeInput.to}
/>
```

Replace:

```tsx
<GroupedBarChart
  series={rateTrendSeries}
  data={rateTrend.data}
  yFormat="percent"
  yDomain={[80, 100]}
  showValueLabels
  highlightX={rateTrendSummary.periodLabel ?? undefined}
/>
```

with:

```tsx
<TermRateBarsDrill
  series={rateTrendSeries}
  data={rateTrend.data}
  yDomain={[80, 100]}
  highlightX={rateTrendSummary.periodLabel ?? undefined}
  termWindows={termWindows}
/>
```

Replace:

```tsx
<GroupedBarChart
  series={ATTENDANCE_MIX_SERIES}
  data={compositionData}
  yFormat="percent"
  height={260}
/>
```

with:

```tsx
<CompositionBarsDrill
  series={ATTENDANCE_MIX_SERIES}
  data={compositionData}
  height={260}
  ayCode={selectedAy}
  termWindows={termWindows}
/>
```

- [ ] **Step 8: Watchlist "See all"** (`:821-827`)

Replace:

```tsx
            {termsWithAbsences.map((t) => (
              <InsightChartCard
                key={t.termNumber}
                cap="Top 5 · ranked by days absent"
                title={`Term ${t.termNumber}`}
                icon={CalendarX}
              >
```

with:

```tsx
            {termsWithAbsences.map((t) => {
              const termWindow = absenceTermWindows.find(
                (w) => w.termNumber === t.termNumber
              );
              return (
              <InsightChartCard
                key={t.termNumber}
                cap="Top 5 · ranked by days absent"
                title={`Term ${t.termNumber}`}
                icon={CalendarX}
                action={
                  termWindow ? (
                    <SeeAllDrillButton
                      target="top-absent"
                      ayCode={selectedAy}
                      from={termWindow.from}
                      to={termWindow.to}
                    />
                  ) : undefined
                }
              >
```

and close the new block: replace the `</InsightChartCard>\n            ))}` that ends this map (`:860-861`) with:

```tsx
              </InsightChartCard>
              );
            })}
```

(Prettier will re-indent the returned JSX on commit.)

- [ ] **Step 9: Leave-quota "See all"** (`:883`, `:902-1069`)

Replace `<LeaveQuotaSection rowSetsPromise={rowSetsPromise} />` with:

```tsx
<LeaveQuotaSection
  rowSetsPromise={rowSetsPromise}
  ayCode={selectedAy}
  termId={selectedTermId}
/>
```

`LeaveQuotaSection` signature:

```tsx
async function LeaveQuotaSection({
  rowSetsPromise,
  ayCode,
  termId,
}: {
  rowSetsPromise: ReturnType<typeof buildAllRowSets>;
  ayCode: string;
  termId: string | null;
}) {
```

On the compassionate card (`cap="Compassionate leave · per year"`), add after `icon={HeartHandshake}`:

```tsx
              action={
                <SeeAllDrillButton
                  target="over-leave-quota"
                  segment="compassionate"
                  ayCode={ayCode}
                  termId={termId ?? undefined}
                />
              }
```

On the vacation card (`cap="Vacation leave · per term"`), add after `icon={Umbrella}`:

```tsx
              action={
                termId ? (
                  <SeeAllDrillButton
                    target="vacation-leave-quota"
                    ayCode={ayCode}
                    termId={termId}
                  />
                ) : undefined
              }
```

- [ ] **Step 10: Check** — `npx tsc --noEmit` → clean; `npx vitest run __tests__/attendance --pool=threads` → PASS. `GroupedBarChart`, `LabeledPieChart` and `isApproachingVlQuota` must no longer be imported by the page (tsc/eslint flags an unused import otherwise).

- [ ] **Step 11: Commit**

```bash
git add "app/(attendance)/attendance/insights/page.tsx" && git commit -m "feat(attendance): every Insights number and chart opens its list; vacation leave follows the selected term" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.8: Phase gate

**Files:** none modified (fix-forward in the owning task's files if a check fails, then re-run the whole gate).

- [ ] **Step 1: Types** — `npx tsc --noEmit` → no errors.
- [ ] **Step 2: Module tests** — `npx vitest run __tests__/attendance --pool=threads` → all pass. Re-run any failure in isolation before calling it a regression (threads pool, shared machine).
- [ ] **Step 3: Column labels** — `npx vitest run __tests__/ui/data-table-column-label-coverage.test.ts --pool=threads` → pass.
- [ ] **Step 4: Open the page (RSC prop errors only fire at render).** Restart `npm run dev` (new route-adjacent files and client modules do not reliably reach a running server), sign in as an academic coordinator / school admin, open `/attendance/insights`, and check the dev terminal stays clean. Then, for the current AY with a comparison year selected:
  1. Each of the 4 KPI cards opens a sheet; "Days absent" and "Late incidents" row counts equal the card; "Attendance rate" count equals the pie's "days marked this period"; "Over their leave quota" count equals the card and shows a Leave type column.
  2. Each pie slice opens its status; the count equals the slice value (hover tooltip).
  3. Term-by-term: click a this-year bar and a comparison-year bar for the same term — the sheets list different years' dates (Review Focus 1). A term with no dates does nothing.
  4. Composition: click a Late bar in one term — dates all fall inside that term.
  5. Each watchlist card's "See all" opens every student with an absence in that term; the card's 5 are its first 5.
  6. Compassionate "See all" count = the card's rows; vacation "See all" count = over + approaching rows on the card.
  7. Switch the term picker to a different term — the vacation list and its "See all" both change to that term; download the vacation sheet's CSV and confirm it has rows when the sheet does.
  8. A zero-value bar or slice draws nothing and cannot be clicked (Phase 1) — that is expected, not a missing drill. Pick a term where nobody is over quota — "Over their leave quota" reads 0 and opens an empty sheet with the empty state, no error (Review Focus 2).
- [ ] **Step 5: Reviewer pass** — dispatch the standing code reviewer on the Phase 2 commits against the index's Review Focus and Global Constraints; resolve findings before Phase 2 is called done. Do not push mid-plan.
