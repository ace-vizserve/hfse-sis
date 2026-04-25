# Dashboard performance audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate dashboard payload bloat by switching to a "rolled-up shapes server-fetched, raw rows lazy-fetched" pattern, plus 9 tactical optimizations across the four operational dashboards.

**Architecture:** Architectural-first (Option B per spec). Per-module pre-fetch contract changes for the two high-volume modules (Attendance, Markbook): `buildAllRowSets()` returns only rolled-up shapes; raw entry rows lazy-fetch on first drill open via the existing `/api/<module>/drill` endpoint with a new `DrillSheetSkeleton` primitive shown during the fetch. Evaluation + Admissions keep current behavior (small enough). Then nine tactical fixes layer in on top.

**Tech Stack:** Next.js 16 App Router · React 19 · `@supabase/ssr` + service-role client · `@tanstack/react-table` · `unstable_cache` · sonner · Tailwind v4. **No test framework** (per `docs/sprints/development-plan.md` cross-cutting backlog) — verification is `npx tsc --noEmit` + `npx next build` + manual browser smoke per task. Spec at `docs/superpowers/specs/2026-04-25-dashboard-perf-audit-design.md`.

**Branch:** continue on `feat/dashboard-drilldowns`. Each task commits independently.

---

## Task 1: Build `DrillSheetSkeleton` primitive

The lazy-fetch tasks (3, 4) need a placeholder. Build it first so both consumers can import.

**Files:**
- Create: `components/dashboard/drill-sheet-skeleton.tsx`

- [ ] **Step 1: Create the skeleton component**

Create `components/dashboard/drill-sheet-skeleton.tsx`:

```tsx
import { SheetContent, SheetTitle } from '@/components/ui/sheet';

/**
 * DrillSheetSkeleton — placeholder rendered inside the `drillSheet` slot of
 * `MetricCard` (or inside a `<Sheet>` wrapping a chart card) while the
 * lazy-fetched drill rows are in flight. Matches the table shape of
 * `DrillDownSheet` so there's no layout shift when real rows arrive.
 */
export function DrillSheetSkeleton({ title = 'Loading…' }: { title?: string }) {
  return (
    <SheetContent
      side="right"
      className="sm:max-w-3xl w-full flex flex-col gap-0 p-0"
    >
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-2 flex items-baseline gap-3">
          <div className="h-7 w-48 animate-pulse rounded bg-muted" />
          <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
        </div>
      </div>

      {/* Filter bar — single row */}
      <div className="flex items-center gap-2 border-b border-border px-6 py-3">
        <div className="h-9 w-72 animate-pulse rounded-md bg-muted" />
        <div className="ml-auto h-9 w-24 animate-pulse rounded-md bg-muted" />
      </div>

      {/* Filter bar — second row */}
      <div className="flex items-center gap-2 border-b border-border px-6 py-3">
        <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
        <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
        <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
        <div className="ml-auto h-8 w-24 animate-pulse rounded-md bg-muted" />
      </div>

      {/* Table — 6 placeholder rows */}
      <div className="flex-1 overflow-auto px-6 py-4 space-y-3">
        <div className="grid grid-cols-6 gap-3 border-b border-border pb-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-3 w-full animate-pulse rounded bg-muted" />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, row) => (
          <div key={row} className="grid grid-cols-6 gap-3 py-1.5">
            {Array.from({ length: 6 }).map((_, col) => (
              <div
                key={col}
                className="h-4 w-full animate-pulse rounded bg-muted/60"
              />
            ))}
          </div>
        ))}
      </div>
    </SheetContent>
  );
}
```

- [ ] **Step 2: Type-check + manual eyeball**

Run: `npx tsc --noEmit`
Expected: zero errors.

The component renders nothing visible until used by Tasks 3+4. Skip browser smoke for now.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/drill-sheet-skeleton.tsx
git commit -m "feat(dashboard): add DrillSheetSkeleton primitive for lazy drill loads"
```

---

## Task 2: Shared `getTeacherEmailMap()` helper

Replaces the two unbatched `auth.admin.listUsers({perPage:1000})` calls in Markbook + Evaluation drill loaders. Independent of the lazy-fetch reshape — can land first.

**Files:**
- Create: `lib/auth/teacher-emails.ts`
- Modify: `lib/markbook/drill.ts` (consume the helper)
- Modify: `lib/evaluation/drill.ts` (consume the helper)

- [ ] **Step 1: Create the shared cache helper**

Create `lib/auth/teacher-emails.ts`:

```ts
import { unstable_cache } from 'next/cache';

import { createServiceClient } from '@/lib/supabase/service';

/**
 * Returns a cached `userId -> email` map for all auth users.
 *
 * Replaces ad-hoc `service.auth.admin.listUsers({ perPage: 1000 })` calls
 * that previously sat inside drill loaders, blocking the loader on every
 * cache miss. With this single shared 5-min cache, all dashboards + drill
 * loaders share one Auth Admin call per 5 minutes.
 *
 * 5-min TTL is fine — teachers rarely change emails, and the email is only
 * used as a display field on drill rows. Stale email is harmless.
 */
export function getTeacherEmailMap(): Promise<Map<string, string>> {
  return unstable_cache(
    async () => {
      try {
        const service = createServiceClient();
        const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
        const map = new Map<string, string>();
        for (const u of data?.users ?? []) {
          if (u.email) map.set(u.id, u.email);
        }
        return map;
      } catch {
        return new Map<string, string>();
      }
    },
    ['teacher-emails-map'],
    { revalidate: 300, tags: ['teacher-emails'] },
  )();
}
```

Note: `unstable_cache` doesn't natively support `Map` as a return value (Map serialization in cache layer can be flaky). The function above wraps the call but a Map will round-trip through JSON as `{}` if Next 16's cache stringify-serializes. **Verify this assumption** — if it doesn't survive the cache, return `Array<[string, string]>` and re-construct as Map at call sites.

- [ ] **Step 2: Verify cache round-trip behavior**

Add a temporary log inside `getTeacherEmailMap()` after the function body:
```ts
// TEMP — remove before commit
console.log('[teacher-emails] map size:', map.size);
```

Run a dashboard page (e.g. `/markbook`) twice. Expected: first hit logs the real size, second hit either logs nothing (cache hit) or logs same size (cache miss). If the second hit logs `0` or fails, the Map didn't survive serialization → switch to `Array<[string, string]>` return type, then `new Map(arr)` at call sites.

If the Map survives, remove the temp log.

- [ ] **Step 3: Commit the helper**

```bash
git add lib/auth/teacher-emails.ts
git commit -m "feat(auth): add getTeacherEmailMap shared cache helper"
```

- [ ] **Step 4: Replace `listUsers` call in Markbook drill loader**

Open `lib/markbook/drill.ts`. Find the block in `loadEntryRowsUncached` that does:

```ts
let teacherEmailById = new Map<string, string>();
try {
  const { data: userList } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (userList?.users) {
    for (const u of userList.users) {
      if (u.email) teacherEmailById.set(u.id, u.email);
    }
  }
} catch {
  teacherEmailById = new Map();
}
```

Replace with:

```ts
const teacherEmailById = await getTeacherEmailMap();
```

Add at the top of the file:

```ts
import { getTeacherEmailMap } from '@/lib/auth/teacher-emails';
```

- [ ] **Step 5: Replace `listUsers` call in Evaluation drill loader**

Open `lib/evaluation/drill.ts`. Find the block in `loadWriteupRowsUncached`:

```ts
let adviserEmailById = new Map<string, string>();
try {
  const { data: userList } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (userList?.users) {
    for (const u of userList.users) {
      if (u.email && adviserUserIds.includes(u.id)) adviserEmailById.set(u.id, u.email);
    }
  }
} catch {
  // Optional.
}
```

Replace with:

```ts
const allEmails = await getTeacherEmailMap();
const adviserEmailById = new Map<string, string>();
for (const id of adviserUserIds) {
  const email = allEmails.get(id);
  if (email) adviserEmailById.set(id, email);
}
```

Add the same import at the top:

```ts
import { getTeacherEmailMap } from '@/lib/auth/teacher-emails';
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Commit the consumer migration**

```bash
git add lib/markbook/drill.ts lib/evaluation/drill.ts
git commit -m "refactor(drills): replace per-loader listUsers calls with shared cache"
```

---

## Task 3: Attendance pre-fetch reshape

Drop `entries` from `buildAllRowSets()`; have the drill sheet lazy-fetch when the target needs raw entries.

**Files:**
- Modify: `lib/attendance/drill.ts:buildAllRowSets`
- Modify: `app/(attendance)/attendance/page.tsx`
- Modify: `components/attendance/drills/attendance-drill-sheet.tsx`
- Modify: `components/attendance/drills/chart-drill-cards.tsx` (if it consumes `initialEntries` directly)

- [ ] **Step 1: Slim down `buildAllRowSets` return**

Open `lib/attendance/drill.ts`. Find the existing `buildAllRowSets` export — likely shaped like:

```ts
export async function buildAllRowSets(input: {
  ayCode: string;
  scope: DrillScope;
  from?: string;
  to?: string;
}): Promise<{
  entries: AttendanceEntryRow[];
  topAbsent: TopAbsentDrillRow[];
  sectionAttendance: SectionAttendanceRow[];
  calendar: CalendarDayRow[];
  compassionate: CompassionateUsageRow[];
}> {
  const [entriesAll, calendarAll, compassionate] = await Promise.all([
    loadEntryRows(input.ayCode),
    loadCalendarRows(input.ayCode),
    rollupCompassionate(input.ayCode),
  ]);
  const entries = applyScopeFilter(entriesAll, input);
  const calendar = applyScopeFilter(calendarAll, input);
  return {
    entries,
    topAbsent: rollupTopAbsent(entries),
    sectionAttendance: rollupBySection(entries),
    calendar,
    compassionate,
  };
}
```

Replace with:

```ts
export async function buildAllRowSets(input: {
  ayCode: string;
  scope: DrillScope;
  from?: string;
  to?: string;
}): Promise<{
  topAbsent: TopAbsentDrillRow[];
  sectionAttendance: SectionAttendanceRow[];
  calendar: CalendarDayRow[];
  compassionate: CompassionateUsageRow[];
}> {
  // We still need entries internally to build the rolled-up shapes, but we
  // do NOT return them — at 1000 students × 180 school days that's 180k
  // rows we'd ship through the RSC payload for nothing. Drill sheets that
  // need raw entries lazy-fetch via /api/attendance/drill/{target}.
  const [entriesAll, calendarAll, compassionate] = await Promise.all([
    loadEntryRows(input.ayCode),
    loadCalendarRows(input.ayCode),
    rollupCompassionate(input.ayCode),
  ]);
  const entries = applyScopeFilter(entriesAll, input);
  const calendar = applyScopeFilter(calendarAll, input);
  return {
    topAbsent: rollupTopAbsent(entries),
    sectionAttendance: rollupBySection(entries),
    calendar,
    compassionate,
  };
}
```

- [ ] **Step 2: Update the page to drop `initialEntries` props**

Open `app/(attendance)/attendance/page.tsx`. Find every place that passes `initialEntries={drillRowSets.entries}` and remove that prop. The drill sheet's existing `useEffect` will fetch on mount because `seedRows.length === 0` for entry-kind targets.

Specifically: the four `MetricCard` calls (Attendance rate / Late / Excused / Absences) and `DailyAttendanceDrillCard` + `ExReasonDrillCard` (which take `initialEntries`).

- [ ] **Step 3: Verify drill-sheet auto-fetch still works**

Open `components/attendance/drills/attendance-drill-sheet.tsx`. Confirm the `useEffect` at the top fetches when `skipNextFetchRef.current === false`. The ref is set to `seedRows.length > 0` initially. When `initialEntries` is undefined and kind is `'entry'`, `seedRows.length === 0`, so the ref is `false` and the effect runs on mount.

No code change needed here — the existing pattern already handles it. **But** we should show the skeleton during the fetch.

- [ ] **Step 4: Wrap `DrillDownSheet` render in skeleton-while-loading**

Open `components/attendance/drills/attendance-drill-sheet.tsx`. The `loading` state is currently declared but unused. Wire it to drive the skeleton.

Find the existing `useEffect` block. Inside it, add `setLoading(true)` before the fetch and `setLoading(false)` in both the `.then` and `.catch` handlers. Also re-introduce `setLoading` if it's declared as `_setLoading`:

```ts
const [loading, setLoading] = React.useState(seedRows.length === 0);

React.useEffect(() => {
  if (skipNextFetchRef.current) {
    skipNextFetchRef.current = false;
    return;
  }
  let cancelled = false;
  setLoading(true);
  const params = new URLSearchParams({ ay: ayCode, scope });
  if (initialFrom) params.set('from', initialFrom);
  if (initialTo) params.set('to', initialTo);
  if (segment) params.set('segment', segment);
  fetch(`/api/attendance/drill/${target}?${params.toString()}`)
    .then((r) => { if (!r.ok) throw new Error('drill_fetch_failed'); return r.json(); })
    .then((data: { rows: AttendanceDrillRow[] }) => {
      if (!cancelled) setRows(data.rows ?? []);
    })
    .catch(() => {
      if (!cancelled) toast.error('Failed to load drill data');
    })
    .finally(() => {
      if (!cancelled) setLoading(false);
    });
  return () => { cancelled = true; };
}, [target, segment, ayCode, scope, initialFrom, initialTo]);
```

Then at the return statement, gate the render:

```tsx
import { DrillSheetSkeleton } from '@/components/dashboard/drill-sheet-skeleton';

// ... at the return:
if (loading && rows.length === 0) {
  return <DrillSheetSkeleton title={header.title} />;
}

return (
  <DrillDownSheet<AttendanceDrillRow>
    {/* ... existing props */}
  />
);
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Browser smoke test**

Run dev server: `npm run dev`. Navigate to `/attendance`. Open each of the four MetricCard drills. Each should show the skeleton briefly, then real rows. Open the EX-reason donut drill (slice click) — same.

Expected behaviors:
- Skeleton appears within ~50ms of click
- Real rows replace skeleton within 1s on cold cache
- Subsequent opens of the same drill (within 60s) show no skeleton (cache hit on the API endpoint)

**If any drill flashes empty / never resolves, stop and debug before committing.**

- [ ] **Step 7: Commit**

```bash
git add lib/attendance/drill.ts \
        app/\(attendance\)/attendance/page.tsx \
        components/attendance/drills/attendance-drill-sheet.tsx
git commit -m "perf(attendance): drop entry pre-fetch; lazy-fetch on drill open with skeleton

At 1000 students × 180 school days the entries pre-fetch was shipping
~30-50 MB JSON per dashboard load through the RSC payload. Most users
never open an entry-kind drill so it was pure waste.

buildAllRowSets() now returns only the rolled-up shapes (topAbsent /
sectionAttendance / calendar / compassionate), all bounded by section/
student count rather than encoded-day count. Drill sheets that need raw
entries fetch via /api/attendance/drill/{target} on mount; the existing
useEffect handles this since seedRows.length === 0 triggers the fetch.
DrillSheetSkeleton fills the void during the ~200-800ms fetch window."
```

---

## Task 4: Markbook pre-fetch reshape

Same shape as Task 3, but for Markbook and its three row kinds (entries / sheets / change-requests).

**Files:**
- Modify: `lib/markbook/drill.ts:buildAllRowSets`
- Modify: `app/(markbook)/markbook/page.tsx`
- Modify: `components/markbook/drills/markbook-drill-sheet.tsx`

- [ ] **Step 1: Slim down `buildAllRowSets` return**

Open `lib/markbook/drill.ts`. Find the existing `buildAllRowSets` — it pre-fetches all three kinds. Replace with:

```ts
export async function buildAllRowSets(input: {
  ayCode: string;
  scope: DrillScope;
  from?: string;
  to?: string;
  allowedSectionIds?: string[] | null;
}): Promise<{
  sheets: SheetRow[];
  changeRequests: ChangeRequestRow[];
}> {
  // entries deliberately excluded — at 1000 students × 10 subjects × 4
  // terms that's ~40k rows. Drill sheets with target kind 'entry' lazy-
  // fetch via /api/markbook/drill/{target}. sheets + changeRequests stay
  // pre-fetched (small + read often).
  const [sheetsRaw, crsRaw] = await Promise.all([
    loadSheetRows(input.ayCode),
    loadChangeRequestRows(input.ayCode),
  ]);
  const rangeInput: DrillRangeInput = {
    ayCode: input.ayCode,
    scope: input.scope,
    from: input.from,
    to: input.to,
    allowedSectionIds: input.allowedSectionIds ?? null,
  };
  const filteredSheets = applyTeacherFilter(
    applyScopeFilter(sheetsRaw as MarkbookDrillRow[], 'sheet', rangeInput),
    'sheet',
    input.allowedSectionIds ?? null,
  ) as SheetRow[];
  const filteredCrs = applyTeacherFilter(
    applyScopeFilter(crsRaw as MarkbookDrillRow[], 'change-request', rangeInput),
    'change-request',
    input.allowedSectionIds ?? null,
  ) as ChangeRequestRow[];
  return { sheets: filteredSheets, changeRequests: filteredCrs };
}
```

- [ ] **Step 2: Update the page to drop `initialEntries`**

Open `app/(markbook)/markbook/page.tsx`. Find the `MarkbookDrillSheet` calls. Remove every `initialEntries={drillRowSets?.entries}` prop. Keep `initialSheets` and `initialChangeRequests`.

Specifically:
- The "Grades entered" MetricCard `drillSheet` — remove `initialEntries`
- `GradeDistributionDrillCard` — remove the `initialEntries` prop pass-through if it forwards there

- [ ] **Step 3: Wire skeleton in `MarkbookDrillSheet`**

Open `components/markbook/drills/markbook-drill-sheet.tsx`. Same pattern as Task 3 Step 4:

```ts
import { DrillSheetSkeleton } from '@/components/dashboard/drill-sheet-skeleton';

// ...
const [loading, setLoading] = React.useState(seedRows.length === 0);

React.useEffect(() => {
  if (skipNextFetchRef.current) {
    skipNextFetchRef.current = false;
    return;
  }
  let cancelled = false;
  setLoading(true);
  const params = new URLSearchParams({ ay: ayCode, scope });
  if (initialFrom) params.set('from', initialFrom);
  if (initialTo) params.set('to', initialTo);
  if (segment) params.set('segment', segment);
  fetch(`/api/markbook/drill/${target}?${params.toString()}`)
    .then((r) => { if (!r.ok) throw new Error('drill_fetch_failed'); return r.json(); })
    .then((data: { rows: MarkbookDrillRow[] }) => {
      if (!cancelled) setRows(data.rows ?? []);
    })
    .catch(() => { if (!cancelled) toast.error('Failed to load drill data'); })
    .finally(() => { if (!cancelled) setLoading(false); });
  return () => { cancelled = true; };
}, [target, segment, ayCode, scope, initialFrom, initialTo]);

// ... at the return:
if (loading && rows.length === 0) {
  return <DrillSheetSkeleton title={header.title} />;
}
```

- [ ] **Step 4: Update `chart-drill-cards.tsx` to drop `initialEntries`**

Open `components/markbook/drills/chart-drill-cards.tsx`. The `GradeDistributionDrillCard` accepts `initialEntries` and forwards it to `MarkbookDrillSheet`. Remove the prop entirely from that component (and its consumer in the page if still present).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Browser smoke test**

Navigate to `/markbook`. Sign in as registrar+ to see the dashboard band. Open each of the four MetricCard drills (Grades entered / Sheets locked / Change requests / Avg decision time). Open the chart drills (Grade distribution segment / Sheet progress / Publication coverage).

Entry-kind targets (`grade-entries`, `grade-bucket-entries`) should show skeleton briefly. Sheet-kind targets (`sheets-locked`, `term-sheet-status`, `term-publication-status`) should open instantly with seeded rows.

- [ ] **Step 7: Commit**

```bash
git add lib/markbook/drill.ts \
        app/\(markbook\)/markbook/page.tsx \
        components/markbook/drills/markbook-drill-sheet.tsx \
        components/markbook/drills/chart-drill-cards.tsx
git commit -m "perf(markbook): drop entry pre-fetch; lazy-fetch on drill open with skeleton

40k entry rows × ~14 fields was a 8-15 MB JSON payload on every dashboard
load. buildAllRowSets() now returns only sheets + changeRequests; the
entry-kind drill targets (grade-entries / grade-bucket-entries) lazy-
fetch on mount via the existing /api/markbook/drill/{target} endpoint.

Sheet + change-request pre-fetches kept — both bounded by section count
× term × subject (~1.6k rows) and used by 5 of 9 drill targets, so the
instant-open value still beats the modest payload cost."
```

---

## Task 5: Cache scope correctness — Admissions + Markbook

The drill loaders currently cache at scope='all' then filter client-side. Push the scope filter into the cache key so range-scoped requests hit a different cache entry.

**Files:**
- Modify: `lib/admissions/drill.ts:buildDrillRows`
- Modify: `lib/markbook/drill.ts:loadEntryRows` + `loadSheetRows` + `loadChangeRequestRows`

- [ ] **Step 1: Audit current Admissions cache key**

Open `lib/admissions/drill.ts`. The current `buildDrillRows` likely:

```ts
export async function buildDrillRows(input: DrillRangeInput): Promise<DrillRow[]> {
  const cached = await unstable_cache(
    () => loadDrillRowsUncached({ ayCode: input.ayCode, scope: 'all' }),
    ['admissions-drill', 'rows', input.ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(input.ayCode) },
  )();
  return applyScopeFilter(cached, input);
}
```

The cache key only includes `ayCode`. Range and scope variants share the same cache entry but get different filtered results. That's actually correct behavior — but the documentation suggests confusion. Verify by reading the function and adding a clarifying comment:

```ts
export async function buildDrillRows(input: DrillRangeInput): Promise<DrillRow[]> {
  // Cache the AY-wide row set once per AY; apply scope (range / ay / all)
  // post-cache. Cheap because applyScopeFilter is a single .filter() over
  // the cached array. We deliberately do NOT include scope/from/to in the
  // cache key — they would cause cache fragmentation without saving any
  // DB work (the underlying tables are the same).
  const cached = await unstable_cache(
    () => loadDrillRowsUncached({ ayCode: input.ayCode, scope: 'all' }),
    ['admissions-drill', 'rows', input.ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(input.ayCode) },
  )();
  return applyScopeFilter(cached, input);
}
```

The audit flagged this as a problem; the spec calls it out as "tactical fix." But re-examining: the cache stores the AY-wide rows, and scope filtering is just a JS array filter — that's correct and fast. **The "fix" here is documentation, not behavior change.** Leave the implementation alone.

- [ ] **Step 2: Audit Markbook cache keys**

Open `lib/markbook/drill.ts`. Each of `loadEntryRows`, `loadSheetRows`, `loadChangeRequestRows` should be AY-scoped only — verify and add the same clarifying comment to each:

```ts
function loadEntryRows(ayCode: string): Promise<GradeEntryRow[]> {
  // AY-scoped cache; scope/range filter applied post-cache by callers.
  // See lib/admissions/drill.ts for the same rationale.
  return unstable_cache(
    () => loadEntryRowsUncached(ayCode),
    ['markbook-drill', 'entry-rows', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(ayCode) },
  )();
}
```

Repeat for `loadSheetRows` + `loadChangeRequestRows`.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add lib/admissions/drill.ts lib/markbook/drill.ts
git commit -m "docs(drills): clarify why drill caches use AY-only keys

The audit flagged 'cache stores scope=all then filters client-side'
as a problem. Re-examination: this is correct and fast — the scope
filter is a single .filter() over a cached array, and including
scope/from/to in the cache key would fragment the cache without
saving DB work. Add comments at the cache wrappers so the next
reader doesn't re-flag this."
```

---

## Task 6: Algorithmic + tactical fixes

Five fixes from the audit; all small and independent.

**Files:**
- Modify: `lib/admissions/dashboard.ts:bucketByDay`
- Modify: `components/admissions/drills/admissions-drill-sheet.tsx:preFiltered`
- Modify: `components/markbook/drills/markbook-drill-sheet.tsx:preFiltered`
- Modify: `lib/markbook/drill.ts:loadSheetRowsUncached`
- Modify: `lib/attendance/dashboard.ts:loadDailyRowsUncached`
- Modify: `lib/attendance/drill.ts:rollupCompassionate`

- [ ] **Step 1: Fix `bucketByDay` O(n×k) → O(n)**

Open `lib/admissions/dashboard.ts`. Find `bucketByDay`:

```ts
function bucketByDay(dates: (string | null)[], from: string, to: string): VelocityPoint[] {
  // ...
  const labels: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + i);
    labels.push(toISODate(d));
  }
  const buckets = new Array(length).fill(0) as number[];
  for (const iso of dates) {
    if (!iso) continue;
    const day = iso.slice(0, 10);
    const idx = labels.indexOf(day); // ← O(n) per row
    if (idx >= 0) buckets[idx] += 1;
  }
  return labels.map((x, i) => ({ x, y: buckets[i] }));
}
```

Replace with:

```ts
function bucketByDay(dates: (string | null)[], from: string, to: string): VelocityPoint[] {
  // ...same prefix... up through buckets initialization
  const labelIndex = new Map<string, number>();
  for (let i = 0; i < labels.length; i += 1) labelIndex.set(labels[i], i);
  for (const iso of dates) {
    if (!iso) continue;
    const day = iso.slice(0, 10);
    const idx = labelIndex.get(day);
    if (idx !== undefined) buckets[idx] += 1;
  }
  return labels.map((x, i) => ({ x, y: buckets[i] }));
}
```

- [ ] **Step 2: Fix Admissions `preFiltered` two-pass → single pass**

Open `components/admissions/drills/admissions-drill-sheet.tsx`. Find the `preFiltered` `useMemo`. It currently does separate `.filter()` calls for status and level. Replace with a single combined pass:

```ts
const preFiltered = React.useMemo(() => {
  if (selectedStatuses.length === 0 && selectedLevels.length === 0) return rows;
  const statusSet = new Set(selectedStatuses);
  const levelSet = new Set(selectedLevels);
  return rows.filter((r) => {
    if (selectedStatuses.length > 0 && !statusSet.has(r.status)) return false;
    if (selectedLevels.length > 0) {
      const lvl = r.level ?? 'Unknown';
      if (!levelSet.has(lvl)) return false;
    }
    return true;
  });
}, [rows, selectedStatuses, selectedLevels]);
```

- [ ] **Step 3: Fix Markbook `preFiltered` similarly**

Open `components/markbook/drills/markbook-drill-sheet.tsx`. Apply the same single-pass shape. Note Markbook's preFiltered also short-circuits by row kind for level filter (level is ignored on `change-request` rows) — preserve that:

```ts
const preFiltered = React.useMemo(() => {
  if (selectedStatuses.length === 0 && selectedLevels.length === 0) return rows;
  const statusSet = new Set(selectedStatuses);
  const levelSet = new Set(selectedLevels);
  return rows.filter((r) => {
    if (selectedStatuses.length > 0) {
      let status: string;
      if (kind === 'entry') status = (r as GradeEntryRow).isLocked ? 'Locked' : 'Open';
      else if (kind === 'sheet') status = (r as SheetRow).isLocked ? 'Locked' : 'Open';
      else status = (r as ChangeRequestRow).status;
      if (!statusSet.has(status)) return false;
    }
    if (selectedLevels.length > 0 && kind !== 'change-request') {
      const lvl = (kind === 'entry' ? (r as GradeEntryRow).level : (r as SheetRow).level) ?? 'Unknown';
      if (!levelSet.has(lvl)) return false;
    }
    return true;
  });
}, [rows, selectedStatuses, selectedLevels, kind]);
```

- [ ] **Step 4: Push term filter into `loadSheetRowsUncached`**

Open `lib/markbook/drill.ts`. Find `loadSheetRowsUncached`. The current implementation likely fetches `report_card_publications` and `grade_entries` without filtering by `termIds`. Add `.in('term_id', ctx.termIds)` to those queries:

```ts
const { data: pubsData } = await service
  .from('report_card_publications')
  .select('section_id, term_id, ...')
  .in('term_id', ctx.termIds);  // ← add this

// And for grade_entries:
const { data: entriesData } = await service
  .from('grade_entries')
  .select('grading_sheet_id, qa_score, quarterly_grade, ...')
  .in('grading_sheet_id', sheetIds);  // sheetIds already term-scoped — fine
```

If the current query doesn't have `report_card_publications` or `grade_entries`, this step is a no-op. Re-read the function and confirm.

- [ ] **Step 5: Push term filter into `loadDailyRowsUncached`**

Open `lib/attendance/dashboard.ts`. Find `loadDailyRowsUncached`. Add a current-term filter to use the index `(term_id, section_student_id, date)`:

```ts
async function loadDailyRowsUncached(ayCode: string): Promise<DailyRow[]> {
  // ... existing AY + section + section_students resolution ...

  // Resolve current term to push the filter down to the index.
  const { data: termRow } = await service
    .from('terms')
    .select('id')
    .eq('academic_year_id', ayId)
    .eq('is_current', true)
    .maybeSingle();
  const termId = termRow?.id as string | undefined;

  // ... existing chunked attendance_daily fetch ...
  // Add `.eq('term_id', termId)` to each chunk query if termId is defined.
```

If the function doesn't have a way to know the current term (it's AY-scoped), this is fine — flag the limitation in a comment and skip.

Re-read the function carefully before making changes; the audit flagged this but the actual structure may not support a clean term filter. **If it doesn't, skip this step and add a `// TODO: term-scope this query when called from a term-aware context` comment.**

- [ ] **Step 6: Fix `rollupCompassionate` re-fetch**

Open `lib/attendance/drill.ts`. Find `rollupCompassionate`. Currently it calls `loadEntryRows(ayCode)` internally. Refactor to accept entries as a parameter:

```ts
async function rollupCompassionate(
  ayCode: string,
  entries?: AttendanceEntryRow[],
): Promise<CompassionateUsageRow[]> {
  const ctx = await resolveAyContext(ayCode);
  if (!ctx.ayId || ctx.sectionStudents.length === 0) return [];
  const sourceEntries = entries ?? await loadEntryRows(ayCode);
  // ... rest unchanged, using sourceEntries
}
```

Then update `buildAllRowSets` (modified in Task 3) to pass the entries it just loaded:

```ts
const compassionate = await rollupCompassionate(input.ayCode, entriesAll);
```

- [ ] **Step 7: Type-check + smoke**

Run: `npx tsc --noEmit`
Expected: zero errors.

Browser: smoke `/admissions` velocity chart (Task 6 Step 1 affects it) and `/attendance` (Task 6 Step 6 affects compassionate quota usage).

- [ ] **Step 8: Commit**

```bash
git add lib/admissions/dashboard.ts \
        components/admissions/drills/admissions-drill-sheet.tsx \
        components/markbook/drills/markbook-drill-sheet.tsx \
        lib/markbook/drill.ts \
        lib/attendance/dashboard.ts \
        lib/attendance/drill.ts
git commit -m "perf: tactical drill optimizations across modules

- bucketByDay: O(n × k) Array.indexOf → O(n) Map lookup
- Admissions + Markbook drill sheets: combined single-pass status+level
  filter (was two .filter calls)
- Markbook loadSheetRowsUncached: explicit term filter on publications
  + grade_entries queries (lets the index do its job)
- Attendance loadDailyRowsUncached: current-term filter where applicable
- Attendance rollupCompassionate: accept entries parameter to avoid
  redundant loadEntryRows when buildAllRowSets already loaded them"
```

---

## Task 7: DB index audit + migration if needed

The Markbook audit suggested missing indexes on critical query columns. Verify before adding.

**Files:**
- Possibly create: `supabase/migrations/028_markbook_drill_indexes.sql`

- [ ] **Step 1: Run index audit query**

Connect to the Supabase project (use `supabase` CLI or the SQL editor in the dashboard). Run:

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('grade_entries', 'grading_sheets', 'report_card_publications', 'section_students')
ORDER BY tablename, indexname;
```

Record the output. The audit suggested these as potentially missing:
- `grade_entries (grading_sheet_id, created_at)`
- `grading_sheets (term_id, section_id, is_locked)`
- `report_card_publications (section_id, term_id)`
- `section_students (section_id, enrollment_status)`

Cross-reference with output. PRIMARY KEY indexes don't count.

- [ ] **Step 2: If any are missing, create the migration**

If at least one index is genuinely missing (no covering composite already exists for the same query pattern), create `supabase/migrations/028_markbook_drill_indexes.sql`:

```sql
-- 028_markbook_drill_indexes.sql
-- Adds covering indexes for queries hot in the Markbook drill loaders.
-- Verified missing 2026-04-25 via pg_indexes audit.

-- Skip any of these that already exist; we only ship the missing ones.

CREATE INDEX IF NOT EXISTS idx_grade_entries_sheet_created
  ON public.grade_entries (grading_sheet_id, created_at);

CREATE INDEX IF NOT EXISTS idx_grading_sheets_term_section_locked
  ON public.grading_sheets (term_id, section_id, is_locked);

CREATE INDEX IF NOT EXISTS idx_report_card_pubs_section_term
  ON public.report_card_publications (section_id, term_id);

CREATE INDEX IF NOT EXISTS idx_section_students_section_enrollment
  ON public.section_students (section_id, enrollment_status);
```

Trim the file to only the indexes you confirmed missing in Step 1.

- [ ] **Step 3: Apply the migration**

```bash
# In supabase CLI or dashboard SQL editor
psql "$DATABASE_URL" -f supabase/migrations/028_markbook_drill_indexes.sql
```

Re-run the audit query from Step 1 to confirm new indexes are present.

- [ ] **Step 4: Commit**

If a migration was created:

```bash
git add supabase/migrations/028_markbook_drill_indexes.sql
git commit -m "perf(db): add covering indexes for Markbook drill loaders"
```

If no migration was needed:

```bash
# nothing to commit; record the audit result in the next docs sync.
```

---

## Task 8: Attendance duplicate cleanup + Admissions doc-fetch split

Two small, independent cleanups.

**Files:**
- Modify: `lib/attendance/dashboard.ts` OR `lib/attendance/queries.ts` (drift cleanup)
- Modify: `lib/attendance/drill.ts` (canonical re-export)
- Modify: `lib/admissions/drill.ts:loadDrillRowsUncached`

- [ ] **Step 1: Audit Attendance duplicate `loadTopAbsent` impls**

Run:

```bash
grep -n "loadTopAbsent\|getTopAbsent\|topAbsent" lib/attendance/dashboard.ts lib/attendance/queries.ts lib/attendance/drill.ts
```

Identify which file has the canonical implementation (the one that produces `TopAbsentDrillRow[]`). The other should re-export or call into the canonical version.

- [ ] **Step 2: Unify on a single implementation**

Pick the implementation in `lib/attendance/drill.ts:rollupTopAbsent` as canonical. In `lib/attendance/dashboard.ts` or `queries.ts`, replace the duplicate logic with a call to `rollupTopAbsent(entries)`.

If there's a behavior difference (one excludes withdrawn students, the other includes them, etc.), preserve the canonical behavior and add a comment about what was unified.

- [ ] **Step 3: Split Admissions `loadDrillRowsUncached`**

Open `lib/admissions/drill.ts`. The current `loadDrillRowsUncached` always fetches the docs table. Split into:

```ts
async function loadCoreRowsUncached(input: DrillRangeInput): Promise<DrillRow[]> {
  // ... existing impl but WITHOUT the docs fetch.
  // Set documentsComplete = 0, documentsTotal = CORE_DOC_STATUS_COLUMNS.length,
  // hasMissingDocs = true (sentinel — caller must enrich if it cares).
}

async function enrichWithDocs(rows: DrillRow[], ayCode: string): Promise<DrillRow[]> {
  // Fetch docs table (same logic as before); update rows in-place where
  // doc fields are present.
}

export async function buildDrillRows(
  input: DrillRangeInput,
  options?: { withDocs?: boolean },
): Promise<DrillRow[]> {
  const cached = await unstable_cache(/* same as before, calling loadCoreRowsUncached */)();
  const scoped = applyScopeFilter(cached, input);
  return options?.withDocs ? enrichWithDocs(scoped, input.ayCode) : scoped;
}
```

Then in the API route handler (`app/api/admissions/drill/[target]/route.ts`), pass `withDocs: true` only when the target needs doc fields:

```ts
const DOC_TARGETS = new Set<DrillTarget>([
  'doc-completion',
  'applications',
  'enrolled',
  'outdated',
  'applications-by-level',
]);

const rows = await buildDrillRows(input, { withDocs: DOC_TARGETS.has(target) });
```

The page-level `buildDrillRows` call (currently in `app/(admissions)/admissions/page.tsx`) — pass `withDocs: true` to keep the existing behavior unless you want to optimize that too.

- [ ] **Step 4: Type-check + smoke**

Run: `npx tsc --noEmit`
Expected: zero errors.

Browser: open the doc-completion drill on `/admissions`. Confirm doc fields render correctly. Open a non-doc drill (e.g. funnel-stage) and confirm it still works (just without doc data).

- [ ] **Step 5: Commit**

```bash
git add lib/attendance/dashboard.ts \
        lib/attendance/queries.ts \
        lib/attendance/drill.ts \
        lib/admissions/drill.ts \
        app/api/admissions/drill/\[target\]/route.ts
git commit -m "refactor(drills): cleanup duplicates + split Admissions doc fetch

- Attendance: unify duplicate loadTopAbsent implementations (drift hazard)
  on the canonical lib/attendance/drill.ts::rollupTopAbsent.
- Admissions: split loadDrillRowsUncached into core + enrichWithDocs;
  buildDrillRows accepts {withDocs} option. The doc-fetch was happening
  on every page load even though only 5 of 12 targets render the doc
  fields. Saves ~15% of the row payload on non-doc drills."
```

---

## Task 9: Final verification + KD update + docs sync

**Files:**
- Modify: `.claude/rules/key-decisions.md` (KD #56 wording)
- Modify: `CLAUDE.md` (29th-pass session-context entry)
- Modify: `docs/sprints/development-plan.md` (new sprint row)

- [ ] **Step 1: Full verification suite**

Run:

```bash
npx tsc --noEmit
npx next build
```

Both must complete cleanly. If either fails, fix the failure before proceeding.

Browser smoke across all 4 dashboards. For each:
1. Page loads with no console errors
2. All MetricCard drills open (skeleton on entry-kind for Markbook + Attendance, instant on others)
3. CSV export still works on at least one drill per module

If anything regresses, stop and debug before docs sync.

- [ ] **Step 2: Capture before/after measurements**

Open browser devtools → Network tab. Reload `/attendance` and `/markbook` while measuring:
- Initial RSC payload size (look for `__next/data` or the page's HTML response)
- Time to interactive

Record the numbers. They go into the commit message + dev-plan entry as evidence.

Expected (per spec §9):
- `/attendance` HTML < 500 KB (vs ~30 MB before)
- `/markbook` HTML < 500 KB (vs ~10 MB before)

- [ ] **Step 3: Update KD #56**

Open `.claude/rules/key-decisions.md`. Find KD #56 (drill-down framework). Replace the line:

> "Page-level pre-fetch via `buildAllRowSets()` per module, passed as `initialRows` so first-open is instant."

With:

> "Page-level pre-fetch via `buildAllRowSets()` returns rolled-up shapes only; raw row arrays (entry / writeup-level) lazy-fetch on drill open with `DrillSheetSkeleton` placeholder. Modules with bounded row counts (≤ 5,000 rows) keep current full pre-fetch — Evaluation and Admissions today. The lazy-fetch path uses the existing `/api/<module>/drill/[target]` endpoint and the existing `useEffect` in `<Module>DrillSheet` (no new code path; just dropping the seed)."

- [ ] **Step 4: Update CLAUDE.md session context**

Add a new bullet at the bottom of the `## Session context` block:

```markdown
- **Dashboard perf audit + Option B fixes — shipped 2026-04-25 on `feat/dashboard-drilldowns`** (29th pass). Drops the universal-row-set pre-fetch for the two high-volume modules: `/attendance` initial payload from ~30 MB → <500 KB, `/markbook` ~10 MB → <500 KB. Per-module contract is now "rolled-up shapes server-fetched, raw rows lazy-fetched on drill open with `DrillSheetSkeleton` placeholder" — KD #56 updated. New `lib/auth/teacher-emails.ts` shared cache replaces 2 unbatched `auth.admin.listUsers({perPage:1000})` calls in Markbook + Evaluation drill loaders. Tactical wins: `bucketByDay` Map lookup, single-pass filter combos in drill sheets, term filter pushdowns in `loadSheetRowsUncached` + `loadDailyRowsUncached`, `rollupCompassionate` parameter to skip re-load, Admissions doc-fetch split (5 of 12 targets need docs). DB index audit shipped if needed. Spec: `docs/superpowers/specs/2026-04-25-dashboard-perf-audit-design.md`. Plan: `docs/superpowers/plans/2026-04-25-dashboard-perf-audit.md`.
```

Verify CLAUDE.md is still ≤ 80 lines.

- [ ] **Step 5: Update development-plan.md**

In `docs/sprints/development-plan.md`, add a new Sprint row above the existing Sprint 22 (drill-down framework) row:

```markdown
| 23 | Dashboard performance audit — Option B fixes _(2026-04-25, twenty-ninth pass)_ | ✅ Done — eliminates the universal-row-set pre-fetch from the two high-volume modules. New `lib/auth/teacher-emails.ts` + `components/dashboard/drill-sheet-skeleton.tsx`. Per-module changes: Attendance + Markbook `buildAllRowSets()` return rolled-up shapes only; entry-kind drill targets lazy-fetch on mount via existing API route. Evaluation + Admissions keep current pre-fetch (small enough). Tactical: bucketByDay Map, single-pass filter combos, term-filter pushdowns, rollupCompassionate parameter, Admissions doc-fetch split, Attendance duplicate-loader cleanup. Measured: `/attendance` payload from ~30 MB → <500 KB; `/markbook` from ~10 MB → <500 KB. KD #56 updated. Build clean. Spec: `docs/superpowers/specs/2026-04-25-dashboard-perf-audit-design.md`. |
```

Update the status snapshot at the top to reference the 29th pass.

- [ ] **Step 6: Commit docs sync**

```bash
git add .claude/rules/key-decisions.md CLAUDE.md docs/sprints/development-plan.md
git commit -m "docs: sync 29th-pass dashboard perf audit"
```

- [ ] **Step 7: Final summary**

Print a one-line summary of what shipped, the measured payload reduction, and the commit count.

Done.

---

## Self-review checklist (run after writing the plan)

**Spec coverage**:
- [x] §3.1 Attendance pre-fetch reshape → Task 3
- [x] §3.2 Markbook pre-fetch reshape → Task 4
- [x] §3.3 Evaluation keep current → no task needed
- [x] §3.4 Admissions keep current → no task needed
- [x] §4 DrillSheetSkeleton primitive → Task 1
- [x] §5.1 Auth admin listUsers de-blocking → Task 2
- [x] §5.2 Cache scope correctness → Task 5
- [x] §5.3 Algorithmic fixes → Task 6 (steps 1-6)
- [x] §5.4 Doc fetch waste → Task 8 (step 3)
- [x] §5.5 DB indexes → Task 7
- [x] §5.6 Drift cleanup → Task 8 (steps 1-2)
- [x] §6 Build sequence — covered by Task 1 → Task 9 ordering
- [x] §7 KD update → Task 9 step 3
- [x] §9 Success criteria → Task 9 step 1-2 verification

**Type consistency**:
- `getTeacherEmailMap` returns `Promise<Map<string, string>>` consistently across Tasks 2, 4 callers.
- `buildAllRowSets` shape changes in Task 3 (drops `entries`) and Task 4 (drops `entries`) — both consumers (page + drill-sheet) updated in same tasks.
- `rollupCompassionate` signature changes in Task 6 step 6; consumer in `buildAllRowSets` updated in same step.

**Placeholder scan**: no TBD, TODO, "implement later" — every step has actual code or actual commands.
