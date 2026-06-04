# Operational School Calendar Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2,570-line school-calendar admin with a modular operational calendar — open/closed days + events-with-categories, edit-by-exception — backed by a view switcher (Term/Month/Week/Day/List) and an extensible filter bar, over the existing schema (no migration).

**Architecture:** A thin orchestrator (`calendar-admin-client`) owns view + filter + selection state and renders a toolbar, the active view, and a single day-action sheet. Pure logic (Open/Closed ⇄ `day_type` mapping, filter predicates, date indexing) lives in tested `lib`/hook modules. Views share one `CalendarCell`. The page RSC aggregates the whole current AY. Mutation API routes and `school_calendar`/`calendar_events` schema are untouched, so the attendance encodable-dates allowlist is preserved byte-for-byte.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript, Tailwind v4, shadcn primitives, `@tanstack/react-table` (List view), vitest. Toasts via `sonner` shim. Dates via `lib/dates.ts` (`sgToday`).

**Spec:** `docs/superpowers/specs/2026-06-04-operational-school-calendar-redesign.md` (Approved; D1 + D2 decided).

**Design-system gate:** Before writing JSX in any UI task (Tasks 5–13), invoke the `ui-ux-pro-max` skill and read `docs/context/09-design-system.md` + `09a-design-patterns.md` (Hard Rule #7). The JSX shown in UI tasks is the **structure + wiring contract**; finalize tokens/primitives against those docs. No raw hex / `slate-*` / `bg-white`.

**Refinement of spec §4.2 (term break):** Per D1, "Term break" is **not** a per-day closed reason in storage (that would be lossy — it collided with `no_class`). Closed reasons that round-trip 1:1 are `public_holiday`, `school_holiday`, `no_class`. A term break is represented as (a) the gap-derived read-only band between term windows and (b) an explicit `term_break` **event**. The day-action sheet's reason dropdown lists Public holiday · School holiday · No class; the "+ Add event" flow offers the `term_break` category for an in-term labelled break.

---

## File Structure

**New — pure logic (`lib/attendance/calendar/`):**
- `operational.ts` — `DayStatus`/`ClosedReason` types + `dayStatusToStorage` / `storageToDayStatus` mapping + `isEncodableStatus`.
- `filters.ts` — `CalendarFilterState`, `CALENDAR_FILTERS` registry, pure predicates, `applyEventFilters` / `applyDayFilters`.

**New — server reads (extend existing):**
- `lib/attendance/calendar.ts` — add `getSchoolCalendarForAy(ayId, audience)` + `getCalendarEventsForAy(ayId, audience)` composing the existing per-term readers (per-term readers stay for other callers).

**New — UI (`components/attendance/calendar/`):**
- `calendar-admin-client.tsx` — orchestrator (replaces the monolith).
- `calendar-toolbar.tsx` — view switcher + Filters popover trigger + `+ Add`.
- `calendar-filter-bar.tsx` — filter popover driven by the registry.
- `day-action-sheet.tsx` — the single edit-by-exception sheet.
- `event-editor-dialog.tsx` — create/edit a `calendar_events` row (lift from the monolith's `AddEventDialog`).
- `calendar-cell.tsx` — shared day cell (status tint + event chips + audience badges).
- `legend.tsx` — status + category legend.
- `views/month-view.tsx`, `views/week-view.tsx`, `views/day-view.tsx`, `views/term-view.tsx`, `views/list-view.tsx`.
- `hooks/use-calendar-index.ts` — memoized `byDate` / `eventsByIso` / `audienceBadgeByIso` (lifted from the monolith).
- `hooks/use-calendar-view-state.ts` — view + cursor + selection + filter state.

**Modified:**
- `app/(sis)/sis/calendar/page.tsx` — aggregate the whole AY; pass terms + AY-wide calendar/events; auto-seed all dated terms.

**Deleted (final task):**
- `components/attendance/calendar-admin-client.tsx` (old monolith) once the new tree is wired and verified.

**Tests (`__tests__/attendance/`):**
- `calendar-operational.test.ts`, `calendar-filters.test.ts`, `calendar-encodable-invariant.test.ts`.

---

## Phase 1 — Foundation + Month/List + Filters + Edit sheet

### Task 1: Operational mapping module

**Files:**
- Create: `lib/attendance/calendar/operational.ts`
- Test: `__tests__/attendance/calendar-operational.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/attendance/calendar-operational.test.ts
import { describe, expect, it } from 'vitest';
import {
  dayStatusToStorage,
  storageToDayStatus,
  isEncodableStatus,
  type DayStatus,
} from '@/lib/attendance/calendar/operational';
import { isEncodableDayType } from '@/lib/schemas/attendance';

const ALL_STATUSES: DayStatus[] = [
  { kind: 'open', hbl: false },
  { kind: 'open', hbl: true },
  { kind: 'closed', reason: 'public_holiday', hblOverlay: false },
  { kind: 'closed', reason: 'school_holiday', hblOverlay: false },
  { kind: 'closed', reason: 'school_holiday', hblOverlay: true },
  { kind: 'closed', reason: 'no_class', hblOverlay: false },
];

describe('operational mapping', () => {
  it('round-trips every DayStatus through storage', () => {
    for (const s of ALL_STATUSES) {
      expect(storageToDayStatus(dayStatusToStorage(s))).toEqual(s);
    }
  });

  it('encodability matches the underlying schema rule', () => {
    for (const s of ALL_STATUSES) {
      const { dayType, hblOverlay } = dayStatusToStorage(s);
      expect(isEncodableStatus(s)).toBe(isEncodableDayType(dayType, hblOverlay));
    }
  });

  it('maps known storage rows to the right UI status', () => {
    expect(storageToDayStatus({ dayType: 'school_day', hblOverlay: false })).toEqual({ kind: 'open', hbl: false });
    expect(storageToDayStatus({ dayType: 'hbl', hblOverlay: false })).toEqual({ kind: 'open', hbl: true });
    expect(storageToDayStatus({ dayType: 'school_holiday', hblOverlay: true })).toEqual({ kind: 'closed', reason: 'school_holiday', hblOverlay: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/attendance/calendar-operational.test.ts`
Expected: FAIL — module `@/lib/attendance/calendar/operational` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/attendance/calendar/operational.ts
import type { DayType } from '@/lib/schemas/attendance';

// "Term break" is intentionally NOT a ClosedReason — it has no lossless
// day_type and is modelled as a `term_break` event + the inter-term gap band
// (spec D1). These three reasons round-trip 1:1 with day_type.
export type ClosedReason = 'public_holiday' | 'school_holiday' | 'no_class';

export type DayStatus =
  | { kind: 'open'; hbl: boolean }
  | { kind: 'closed'; reason: ClosedReason; hblOverlay: boolean };

export type CalendarStorage = { dayType: DayType; hblOverlay: boolean };

export function dayStatusToStorage(s: DayStatus): CalendarStorage {
  if (s.kind === 'open') {
    return { dayType: s.hbl ? 'hbl' : 'school_day', hblOverlay: false };
  }
  if (s.reason === 'school_holiday') {
    return { dayType: 'school_holiday', hblOverlay: s.hblOverlay };
  }
  // public_holiday | no_class
  return { dayType: s.reason, hblOverlay: false };
}

export function storageToDayStatus(s: CalendarStorage): DayStatus {
  switch (s.dayType) {
    case 'school_day':
      return { kind: 'open', hbl: false };
    case 'hbl':
      return { kind: 'open', hbl: true };
    case 'school_holiday':
      return { kind: 'closed', reason: 'school_holiday', hblOverlay: s.hblOverlay };
    case 'public_holiday':
      return { kind: 'closed', reason: 'public_holiday', hblOverlay: false };
    case 'no_class':
      return { kind: 'closed', reason: 'no_class', hblOverlay: false };
  }
}

export function isEncodableStatus(s: DayStatus): boolean {
  return s.kind === 'open' || (s.reason === 'school_holiday' && s.hblOverlay);
}

export const CLOSED_REASON_LABELS: Record<ClosedReason, string> = {
  public_holiday: 'Public holiday',
  school_holiday: 'School holiday',
  no_class: 'No class',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/attendance/calendar-operational.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/attendance/calendar/operational.ts __tests__/attendance/calendar-operational.test.ts
git commit -m "feat(calendar): operational Open/Closed <-> day_type mapping"
```

---

### Task 2: Filter registry + predicates

**Files:**
- Create: `lib/attendance/calendar/filters.ts`
- Test: `__tests__/attendance/calendar-filters.test.ts`

Item shapes reuse `CalendarEventRow` + `SchoolCalendarRow` from `lib/attendance/calendar.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/attendance/calendar-filters.test.ts
import { describe, expect, it } from 'vitest';
import {
  defaultFilterState,
  filterEvents,
  filterDays,
  type CalendarFilterState,
} from '@/lib/attendance/calendar/filters';
import type { CalendarEventRow, SchoolCalendarRow } from '@/lib/attendance/calendar';

const ev = (over: Partial<CalendarEventRow>): CalendarEventRow => ({
  id: 'e', termId: 't', startDate: '2026-04-10', endDate: '2026-04-10',
  label: 'X', category: 'school_event', audience: 'all', tentative: false, ...over,
});
const day = (over: Partial<SchoolCalendarRow>): SchoolCalendarRow => ({
  id: 'd', termId: 't', date: '2026-04-10', dayType: 'school_day',
  isHoliday: false, label: null, audience: 'all', hblOverlay: false, ...over,
});

describe('calendar filters', () => {
  it('default state passes everything', () => {
    const s = defaultFilterState();
    expect(filterEvents([ev({})], s)).toHaveLength(1);
    expect(filterDays([day({})], s)).toHaveLength(1);
  });

  it('date range bounds both events and days', () => {
    const s: CalendarFilterState = { ...defaultFilterState(), from: '2026-04-11', to: '2026-04-30' };
    expect(filterEvents([ev({ startDate: '2026-04-10', endDate: '2026-04-10' })], s)).toHaveLength(0);
    expect(filterEvents([ev({ startDate: '2026-04-09', endDate: '2026-04-12' })], s)).toHaveLength(1); // overlaps
    expect(filterDays([day({ date: '2026-04-10' })], s)).toHaveLength(0);
    expect(filterDays([day({ date: '2026-04-15' })], s)).toHaveLength(1);
  });

  it('category filter selects matching events only', () => {
    const s: CalendarFilterState = { ...defaultFilterState(), categories: ['term_exam'] };
    expect(filterEvents([ev({ category: 'term_exam' }), ev({ category: 'ptc' })], s)).toHaveLength(1);
  });

  it('level filter narrows to the selected audience plus all', () => {
    const s: CalendarFilterState = { ...defaultFilterState(), level: 'primary' };
    const out = filterDays([day({ audience: 'all' }), day({ audience: 'primary' }), day({ audience: 'secondary' })], s);
    expect(out.map((d) => d.audience).sort()).toEqual(['all', 'primary']);
  });

  it('status filter keeps only open or only closed days', () => {
    const open = day({ dayType: 'school_day' });
    const closed = day({ dayType: 'public_holiday' });
    expect(filterDays([open, closed], { ...defaultFilterState(), status: 'open' })).toEqual([open]);
    expect(filterDays([open, closed], { ...defaultFilterState(), status: 'closed' })).toEqual([closed]);
  });

  it('tentative filter keeps only un-confirmed events', () => {
    const s: CalendarFilterState = { ...defaultFilterState(), tentativeOnly: true };
    expect(filterEvents([ev({ tentative: true }), ev({ tentative: false })], s)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/attendance/calendar-filters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/attendance/calendar/filters.ts
import type { CalendarEventRow, SchoolCalendarRow } from '@/lib/attendance/calendar';
import { isEncodableDayType, type Audience, type EventCategory } from '@/lib/schemas/attendance';

export type StatusFilter = 'all' | 'open' | 'closed';

export type CalendarFilterState = {
  from: string | null; // yyyy-MM-dd inclusive
  to: string | null; // yyyy-MM-dd inclusive
  categories: EventCategory[]; // empty = all
  level: Audience; // 'all' | 'primary' | 'secondary'
  status: StatusFilter;
  tentativeOnly: boolean;
  // Reserved for the registrar's #2 filters (spec D3). Add keys here + a
  // CALENDAR_FILTERS entry + a control in calendar-filter-bar.
};

export function defaultFilterState(): CalendarFilterState {
  return { from: null, to: null, categories: [], level: 'all', status: 'all', tentativeOnly: false };
}

function inLevel(rowAudience: Audience, level: Audience): boolean {
  return level === 'all' ? true : rowAudience === 'all' || rowAudience === level;
}

export function filterEvents(events: CalendarEventRow[], s: CalendarFilterState): CalendarEventRow[] {
  return events.filter((e) => {
    if (s.from && e.endDate < s.from) return false; // event ends before window
    if (s.to && e.startDate > s.to) return false; // event starts after window
    if (s.categories.length > 0 && !s.categories.includes(e.category)) return false;
    if (!inLevel(e.audience, s.level)) return false;
    if (s.tentativeOnly && !e.tentative) return false;
    return true;
  });
}

export function filterDays(days: SchoolCalendarRow[], s: CalendarFilterState): SchoolCalendarRow[] {
  return days.filter((d) => {
    if (s.from && d.date < s.from) return false;
    if (s.to && d.date > s.to) return false;
    if (!inLevel(d.audience, s.level)) return false;
    if (s.status !== 'all') {
      const open = isEncodableDayType(d.dayType, d.hblOverlay);
      if (s.status === 'open' && !open) return false;
      if (s.status === 'closed' && open) return false;
    }
    return true;
  });
}

// Registry — drives calendar-filter-bar rendering + makes adding the #2
// filters (spec D3) a one-entry change.
export type CalendarFilterDef = {
  id: keyof CalendarFilterState;
  label: string;
  control: 'date-range' | 'category-multi' | 'level' | 'status' | 'toggle';
};

export const CALENDAR_FILTERS: CalendarFilterDef[] = [
  { id: 'from', label: 'Date range', control: 'date-range' },
  { id: 'categories', label: 'Category', control: 'category-multi' },
  { id: 'level', label: 'Level', control: 'level' },
  { id: 'status', label: 'Status', control: 'status' },
  { id: 'tentativeOnly', label: 'Tentative only', control: 'toggle' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/attendance/calendar-filters.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/attendance/calendar/filters.ts __tests__/attendance/calendar-filters.test.ts
git commit -m "feat(calendar): filter registry + pure predicates"
```

---

### Task 3: Per-AY read helpers

**Files:**
- Modify: `lib/attendance/calendar.ts` (append two exports)

- [ ] **Step 1: Add the AY-wide readers**

Append to `lib/attendance/calendar.ts` (reuses the existing per-term `getSchoolCalendarForTerm` / `getCalendarEventsForTerm` so audience precedence + camel-casing stay identical):

```ts
// AY-wide aggregation — composes the per-term readers across all terms in an
// AY so the operational calendar can navigate continuously (spec D2). Returns
// rows tagged with their term_id (already present on each row).
export async function getSchoolCalendarForAy(
  ayId: string,
  audience: Audience = 'all'
): Promise<SchoolCalendarRow[]> {
  const service = createServiceClient();
  const { data: terms } = await service
    .from('terms')
    .select('id')
    .eq('academic_year_id', ayId);
  const termIds = ((terms ?? []) as Array<{ id: string }>).map((t) => t.id);
  const all = await Promise.all(
    termIds.map((id) => getSchoolCalendarForTerm(id, audience))
  );
  return all.flat();
}

export async function getCalendarEventsForAy(
  ayId: string,
  audience: Audience = 'all'
): Promise<CalendarEventRow[]> {
  const service = createServiceClient();
  const { data: terms } = await service
    .from('terms')
    .select('id')
    .eq('academic_year_id', ayId);
  const termIds = ((terms ?? []) as Array<{ id: string }>).map((t) => t.id);
  const all = await Promise.all(
    termIds.map((id) => getCalendarEventsForTerm(id, audience))
  );
  return all.flat();
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 3: Commit**

```bash
git add lib/attendance/calendar.ts
git commit -m "feat(calendar): AY-wide calendar + events readers"
```

---

### Task 4: Encodable-allowlist invariant test

This guards the §7 guarantee: the redesign must not change which dates are encodable. It pins the mapping against the real schema rule for a representative term's rows.

**Files:**
- Test: `__tests__/attendance/calendar-encodable-invariant.test.ts`

- [ ] **Step 1: Write the test**

```ts
// __tests__/attendance/calendar-encodable-invariant.test.ts
import { describe, expect, it } from 'vitest';
import { isEncodableDayType, DAY_TYPE_VALUES, type DayType } from '@/lib/schemas/attendance';
import { dayStatusToStorage, storageToDayStatus, isEncodableStatus } from '@/lib/attendance/calendar/operational';

describe('encodable allowlist invariant', () => {
  it('storage->status->storage preserves encodability for every day_type x overlay', () => {
    const overlays = [false, true];
    for (const dayType of DAY_TYPE_VALUES as DayType[]) {
      for (const hblOverlay of overlays) {
        const before = isEncodableDayType(dayType, hblOverlay);
        const status = storageToDayStatus({ dayType, hblOverlay });
        const after = isEncodableDayType(
          dayStatusToStorage(status).dayType,
          dayStatusToStorage(status).hblOverlay
        );
        expect(after).toBe(before);
        expect(isEncodableStatus(status)).toBe(before);
      }
    }
  });
});
```

> Note: `hbl_overlay` is only meaningful for `school_holiday` (KD #98); for other day-types the round-trip drops it to false, which is correct because it never affected their encodability. The assertion holds because `isEncodableDayType` ignores overlay for non-`school_holiday` types.

- [ ] **Step 2: Run test**

Run: `npx vitest run __tests__/attendance/calendar-encodable-invariant.test.ts`
Expected: PASS. If it fails, the mapping in Task 1 is wrong — fix `operational.ts`, do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add __tests__/attendance/calendar-encodable-invariant.test.ts
git commit -m "test(calendar): pin encodable-allowlist invariant"
```

---

### Task 5: Calendar index hook

Lift the memoized indexing out of the monolith into a reusable hook so every view shares it.

**Files:**
- Create: `components/attendance/calendar/hooks/use-calendar-index.ts`

- [ ] **Step 1: Implement the hook**

```ts
// components/attendance/calendar/hooks/use-calendar-index.ts
'use client';
import { useMemo } from 'react';
import type { CalendarEventRow, SchoolCalendarRow } from '@/lib/attendance/calendar';
import type { Audience } from '@/lib/schemas/attendance';

export type CalendarIndex = {
  byDate: Map<string, SchoolCalendarRow>; // audience-precedence applied (primary > secondary > all)
  eventsByIso: Map<string, CalendarEventRow[]>; // multi-day events expanded per covered day
  audienceBadgeByIso: Map<string, Audience[]>; // override badges, only when viewing 'all'
};

const rank = (a: Audience) => (a === 'primary' ? 2 : a === 'secondary' ? 1 : 0);

export function useCalendarIndex(
  calendar: SchoolCalendarRow[],
  events: CalendarEventRow[],
  audience: Audience
): CalendarIndex {
  return useMemo(() => {
    const byDate = new Map<string, SchoolCalendarRow>();
    for (const r of calendar) {
      const cur = byDate.get(r.date);
      if (!cur || rank(r.audience) > rank(cur.audience)) byDate.set(r.date, r);
    }

    const eventsByIso = new Map<string, CalendarEventRow[]>();
    for (const e of events) {
      const d = new Date(e.startDate);
      const end = new Date(e.endDate);
      while (d.getTime() <= end.getTime()) {
        const iso = d.toISOString().slice(0, 10);
        (eventsByIso.get(iso) ?? eventsByIso.set(iso, []).get(iso)!).push(e);
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }

    const audienceBadgeByIso = new Map<string, Audience[]>();
    if (audience === 'all') {
      for (const r of calendar) {
        if (r.audience === 'all') continue;
        const arr = audienceBadgeByIso.get(r.date) ?? [];
        if (!arr.includes(r.audience)) arr.push(r.audience);
        audienceBadgeByIso.set(r.date, arr);
        arr.sort((a, b) => (a === 'primary' ? -1 : b === 'primary' ? 1 : 0));
      }
    }
    return { byDate, eventsByIso, audienceBadgeByIso };
  }, [calendar, events, audience]);
}
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/attendance/calendar/hooks/use-calendar-index.ts
git commit -m "feat(calendar): shared calendar index hook"
```

---

### Task 6: Day-action sheet (edit-by-exception)

**Files:**
- Create: `components/attendance/calendar/day-action-sheet.tsx`

> Design-system gate applies. Use shadcn `Sheet` (install via shadcn MCP if `components/ui/sheet.tsx` is missing — do **not** substitute a Dialog), `RadioGroup`, `Select`, `Checkbox`, `Button`. Status/HBL writes hit `POST /api/attendance/calendar` (body `{ termId, audience, entries: [{ date, dayType, label, hblOverlay }] }`); events use the existing event routes via the `event-editor-dialog` (Task wiring).

- [ ] **Step 1: Implement the sheet (structure + wiring contract)**

```tsx
// components/attendance/calendar/day-action-sheet.tsx
'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import type { Audience } from '@/lib/schemas/attendance';
import {
  type DayStatus, type ClosedReason, CLOSED_REASON_LABELS,
  dayStatusToStorage, storageToDayStatus,
} from '@/lib/attendance/calendar/operational';
import type { CalendarEventRow, SchoolCalendarRow } from '@/lib/attendance/calendar';

export function DayActionSheet({
  iso, termId, audience, row, events, editable,
  onClose, onSaved, onAddEvent, onEditEvent, onDeleteEvent,
}: {
  iso: string | null;
  termId: string;
  audience: Audience;
  row: SchoolCalendarRow | null;
  events: CalendarEventRow[];
  editable: boolean; // false for between-term break days (no term_id)
  onClose: () => void;
  onSaved: () => void;
  onAddEvent: (iso: string) => void;
  onEditEvent: (e: CalendarEventRow) => void;
  onDeleteEvent: (id: string) => void;
}) {
  const initial: DayStatus = row
    ? storageToDayStatus({ dayType: row.dayType, hblOverlay: row.hblOverlay })
    : { kind: 'open', hbl: false };
  const [status, setStatus] = useState<DayStatus>(initial);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!iso) return;
    setBusy(true);
    try {
      const { dayType, hblOverlay } = dayStatusToStorage(status);
      const res = await fetch('/api/attendance/calendar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ termId, audience, entries: [{ date: iso, dayType, label: row?.label ?? null, hblOverlay }] }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'Save failed');
      toast.success('Day updated.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={iso !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader><SheetTitle>{iso}</SheetTitle></SheetHeader>
        {!editable ? (
          <p className="text-sm text-muted-foreground">Term break — outside any term. Add a labelled break via an event on the adjacent term days.</p>
        ) : (
          <div className="space-y-4">
            <RadioGroup
              value={status.kind}
              onValueChange={(k) => setStatus(k === 'open' ? { kind: 'open', hbl: false } : { kind: 'closed', reason: 'public_holiday', hblOverlay: false })}
            >
              <label className="flex items-center gap-2"><RadioGroupItem value="open" /> Open</label>
              <label className="flex items-center gap-2"><RadioGroupItem value="closed" /> Closed</label>
            </RadioGroup>

            {status.kind === 'open' && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={status.hbl} onCheckedChange={(v) => setStatus({ kind: 'open', hbl: Boolean(v) })} />
                HBL (taught remotely)
              </label>
            )}

            {status.kind === 'closed' && (
              <div className="space-y-2">
                <Select
                  value={status.reason}
                  onValueChange={(r) => setStatus({ kind: 'closed', reason: r as ClosedReason, hblOverlay: status.hblOverlay })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CLOSED_REASON_LABELS) as ClosedReason[]).map((r) => (
                      <SelectItem key={r} value={r}>{CLOSED_REASON_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {status.reason === 'school_holiday' && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={status.hblOverlay} onCheckedChange={(v) => setStatus({ kind: 'closed', reason: 'school_holiday', hblOverlay: Boolean(v) })} />
                    Attendance still taken (HBL overlay)
                  </label>
                )}
              </div>
            )}

            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Events</p>
              {events.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-sm">
                  <span>{e.label}</span>
                  <span className="flex gap-2">
                    <button type="button" onClick={() => onEditEvent(e)} aria-label="Edit">✎</button>
                    <button type="button" onClick={() => onDeleteEvent(e.id)} aria-label="Delete">🗑</button>
                  </span>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => iso && onAddEvent(iso)}>+ Add event</Button>
            </div>

            <Button type="button" onClick={save} disabled={busy}>Save</Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Install `Sheet` primitive if missing**

Run: check `components/ui/sheet.tsx` exists. If not: use the shadcn MCP `get_add_command_for_items` + run it to add `sheet`. Then `npx tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add components/attendance/calendar/day-action-sheet.tsx
git commit -m "feat(calendar): edit-by-exception day-action sheet"
```

---

### Task 7: Shared calendar cell + legend

**Files:**
- Create: `components/attendance/calendar/calendar-cell.tsx`
- Create: `components/attendance/calendar/legend.tsx`

> Lift the in-cell rendering (date number, status tint via `DAY_TYPE_STYLES`/`ChartLegendChip`, event chips, audience corner badges, today ring, selected state) from the monolith's `MonthView` cell into a standalone `CalendarCell` that takes a `SchoolCalendarRow | null`, the day's events, flags (`isToday`, `outOfMonth`, `selected`, `clickable`), and an `onClick`. The legend lists the status colors (School day / Public holiday / School holiday / HBL / No class / Term break) + an Important-date chip, reusing `ChartLegendChip` so cell + legend match 1:1. Keep the existing color mapping (`DAY_TYPE_LEGEND_COLOR`, `EVENT_CATEGORY_LEGEND_COLOR`).

- [ ] **Step 1: Implement `CalendarCell`** — props interface:

```tsx
// components/attendance/calendar/calendar-cell.tsx — signature contract
'use client';
export type CalendarCellProps = {
  iso: string;
  dayNumber: number;
  row: import('@/lib/attendance/calendar').SchoolCalendarRow | null;
  events: import('@/lib/attendance/calendar').CalendarEventRow[];
  audienceBadges: import('@/lib/schemas/attendance').Audience[];
  isToday: boolean;
  outOfMonth?: boolean;
  isBreak?: boolean; // between-term gap day — render the "break" band, non-editable
  selected?: boolean;
  clickable: boolean;
  onClick: () => void;
};
export function CalendarCell(props: CalendarCellProps): React.JSX.Element { /* lifted cell JSX */ }
```

- [ ] **Step 2: Implement `legend.tsx`** — static `ChartLegendChip` row (lift from monolith lines ~637–656, add a "Term break" chip).

- [ ] **Step 3: Verify compile** — `npx tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add components/attendance/calendar/calendar-cell.tsx components/attendance/calendar/legend.tsx
git commit -m "feat(calendar): shared cell + legend"
```

---

### Task 8: Month view

**Files:**
- Create: `components/attendance/calendar/views/month-view.tsx`

> Lift `buildMonthWeekdayRows` + the month grid/nav from the monolith, but render each day via `CalendarCell` and resolve each cell's `row`/`events` from a passed-in `CalendarIndex`. Add `isBreak` detection: a weekday inside the AY span but outside every term window. Props:

```tsx
export type MonthViewProps = {
  terms: Array<{ id: string; startDate: string; endDate: string }>; // AY-wide, to detect break gaps + resolve term per date
  index: import('../hooks/use-calendar-index').CalendarIndex;
  cursor: Date; // first-of-visible-month
  onCursor: (d: Date) => void;
  selectedIsos: Set<string>;
  onDayClick: (iso: string) => void;
};
```

- [ ] **Step 1: Implement month view** (grid + prev/next/today nav clamped to AY span; cell click → `onDayClick`).
- [ ] **Step 2: Compile** — `npx tsc --noEmit` clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(calendar): month view on shared cell"`

---

### Task 9: List view

**Files:**
- Create: `components/attendance/calendar/views/list-view.tsx`

> Chronological table (use the unified `<DataTable>` shell, KD #84, with `namespace: 'cal'` to avoid the URL footgun) of **events + closures** within the active date range. Columns: Date · Type (Closure reason / Event category chip) · Label · Level · Tentative. Rows derive from filtered `days` (closed only) + filtered `events`, merged + sorted by date.

```tsx
export type ListViewProps = {
  days: import('@/lib/attendance/calendar').SchoolCalendarRow[]; // already filtered; closures surfaced
  events: import('@/lib/attendance/calendar').CalendarEventRow[]; // already filtered
  onRowClick: (iso: string) => void;
};
```

- [ ] **Step 1: Implement list view.**
- [ ] **Step 2: Compile** — clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(calendar): list view"`

---

### Task 10: Filter bar + toolbar

**Files:**
- Create: `components/attendance/calendar/calendar-filter-bar.tsx`
- Create: `components/attendance/calendar/calendar-toolbar.tsx`

> `calendar-filter-bar` renders one control per `CALENDAR_FILTERS` entry (date-range → two `DatePicker`s per KD #44; category-multi → checkbox list with color swatches; level → `Select`; status → `Select`; toggle → `Checkbox`) inside a `Popover`, emitting a new `CalendarFilterState`. `calendar-toolbar` = view switcher (`Tabs`: Term/Month/Week/Day/List) + Filters `Popover` trigger (with an active-filter count badge) + `+ Add` (`DropdownMenu`: Add event, Copy from prior AY).

- [ ] **Step 1: Implement filter bar** (props: `value: CalendarFilterState`, `onChange`, plus category color map).
- [ ] **Step 2: Implement toolbar** (props: `view`, `onView`, `filterState`, `onFilter`, `onAddEvent`, `copyFromPriorAyProps`).
- [ ] **Step 3: Compile** — clean.
- [ ] **Step 4: Commit** — `git commit -m "feat(calendar): toolbar + filter bar"`

---

### Task 11: Orchestrator + page wiring (Phase 1 integration)

**Files:**
- Create: `components/attendance/calendar/calendar-admin-client.tsx`
- Create: `components/attendance/calendar/hooks/use-calendar-view-state.ts`
- Create: `components/attendance/calendar/event-editor-dialog.tsx` (lift `AddEventDialog` from the monolith)
- Modify: `app/(sis)/sis/calendar/page.tsx`

- [ ] **Step 1: `use-calendar-view-state.ts`** — `useState` for `view`, `cursor`, `selectedIsos`, `filterState` (init `defaultFilterState()`), plus reset-on-term/AY helpers.

- [ ] **Step 2: `event-editor-dialog.tsx`** — lift the monolith's `AddEventDialog` verbatim (create/edit `calendar_events`, category incl. `term_break`, level, tentative, date range bounded to a term). Keep its existing POST/PATCH calls.

- [ ] **Step 3: Orchestrator** — compose: `useCalendarIndex(filteredCalendar, filteredEvents, level)`; render `CalendarToolbar`, `Legend`, the active view (Month/List for Phase 1; Week/Day/Term wired in Phase 2), `DayActionSheet`, `EventEditorDialog`, `CopyFromPriorAyDialog`. Apply `filterDays`/`filterEvents` before indexing. Resolve `editable`/`isBreak` per clicked date from the AY terms list.

```tsx
// shape contract
export function CalendarAdminClient(props: {
  ayId: string;
  terms: Array<{ id: string; label: string; startDate: string; endDate: string }>; // dated terms, AY-wide
  level: Audience;
  calendar: SchoolCalendarRow[]; // AY-wide
  events: CalendarEventRow[]; // AY-wide
  copyFromPriorAyProps?: CopyFromPriorAyProps | null;
}): React.JSX.Element
```

- [ ] **Step 4: Rewire `page.tsx`** — replace per-term fetch with AY-wide: keep current-AY + terms load; auto-seed **every dated term** (loop `ensureTermSeeded`); fetch `getSchoolCalendarForAy` + `getCalendarEventsForAy`; pass to the new `CalendarAdminClient` (import path `@/components/attendance/calendar/calendar-admin-client`). Keep the audience query param as the `level` default. Keep the no-terms / no-dates empty states.

- [ ] **Step 5: Compile + manual smoke**

Run: `npx tsc --noEmit` (clean) then `npx next build` (clean compile).
Manual: load `/sis/calendar` → Month renders the current month; click a day → sheet opens; mark Closed → save → cell updates; switch to List → closures + events listed; apply Category + Status + Level + date-range filters → list/grid narrow correctly.

- [ ] **Step 6: Commit** — `git commit -m "feat(calendar): operational orchestrator + AY-wide page wiring (Month/List)"`

---

## Phase 2 — Week / Day / Term views

### Task 12: Week + Day views

**Files:**
- Create: `components/attendance/calendar/views/week-view.tsx`
- Create: `components/attendance/calendar/views/day-view.tsx`

- [ ] **Step 1: Week view** — single Mon–Fri week (cursor-driven), larger `CalendarCell`s with more event detail; reuses the index + break detection.
- [ ] **Step 2: Day view** — one day: full event list + `DayActionSheet`-style status summary; "prev/next day" nav.
- [ ] **Step 3: Wire both into the orchestrator's view switch.**
- [ ] **Step 4: Compile + manual** — `npx tsc --noEmit` clean; switch Week/Day, navigate, edit a day.
- [ ] **Step 5: Commit** — `git commit -m "feat(calendar): week + day views"`

### Task 13: Term view

**Files:**
- Create: `components/attendance/calendar/views/term-view.tsx`

- [ ] **Step 1:** Lift the monolith's `TermStripView` (full-term Mon–Fri strip) onto `CalendarCell` + the index; scope to the term containing `cursor`.
- [ ] **Step 2:** Wire into the view switch.
- [ ] **Step 3: Compile + manual** — clean; Term view renders the full strip.
- [ ] **Step 4: Commit** — `git commit -m "feat(calendar): term strip view"`

---

## Phase 3 — Cleanup + break bands + verification

### Task 14: Break bands, decommission monolith, final verification

**Files:**
- Modify: views (break-band polish)
- Delete: `components/attendance/calendar-admin-client.tsx`

- [ ] **Step 1:** Ensure between-term gap weekdays render as a non-editable "Term break" band across Month/Week/Term (via `CalendarCell isBreak`), and that a `term_break` event labels them.
- [ ] **Step 2:** Confirm nothing imports the old monolith (`grep -r "calendar-admin-client'" app components` returns only the new path), then delete the old file.
- [ ] **Step 3:** Full test run — `npx vitest run __tests__/attendance/` (operational + filters + invariant all pass).
- [ ] **Step 4:** `npx next build` clean.
- [ ] **Step 5: Manual regression (critical, §7 + §9):** pick a term, open `/attendance/[sectionId]` for one of its sections, note the encodable days; make no calendar changes; confirm the attendance grid still shows exactly those days. Then via the new calendar: mark a day Closed → re-open the attendance grid → that day disappears from encodable; revert → it returns.
- [ ] **Step 6: Commit** — `git commit -m "refactor(calendar): retire monolith; break bands; verify allowlist intact"`

---

## Self-Review

**Spec coverage:**
- Operational model (open/closed + events) → Tasks 1, 6. ✅
- No-migration mapping (§4.2, refined per D1) → Task 1 + header refinement. ✅
- Attendance preservation (§7) → Tasks 4, 14 step 5. ✅
- Views Term/Month/Week/Day/List (§5.2) → Tasks 8 (Month), 9 (List), 12 (Week/Day), 13 (Term). ✅
- Filter bar + extensible registry (§5.3) → Tasks 2, 10. ✅
- Level dimension (filter + per-level data) → Tasks 2 (predicate), 6/10 (audience writes/level filter). ✅
- AY-wide continuous nav + break bands (D2/D1) → Tasks 3, 8, 14. ✅
- Component breakup (§6) → Tasks 5–13 file structure. ✅
- Testing (§9) → Tasks 1, 2, 4, 14. ✅
- Design-system compliance (§10) → header gate + per-UI-task note. ✅

**Placeholders:** Pure-logic tasks (1–5) carry full code + tests. UI tasks (6–13) carry exact files, prop/interface contracts, and explicit lift-from-monolith sources + verification — JSX styling is intentionally finalized against the design-system docs at build time per the header gate (not a placeholder; a documented gate). The `#2` filters are a reserved registry slot per spec D3.

**Type consistency:** `DayStatus`/`ClosedReason`/`CalendarStorage` (Task 1) are reused unchanged in Tasks 4 + 6. `CalendarFilterState` + `filterDays`/`filterEvents` (Task 2) reused in Tasks 9, 11. `CalendarIndex` (Task 5) reused in Tasks 8, 11, 12, 13. `getSchoolCalendarForAy`/`getCalendarEventsForAy` (Task 3) consumed in Task 11. Names consistent throughout.
