# School Calendar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/sis/calendar` as a two-view admin instrument (Month grid + Full-term strip) with a shared cell recipe, stronger color weight, and editorial typography — replacing the generic-shadcn look with the HFSE data-first aesthetic.

**Architecture:** Single-file redesign (`components/attendance/calendar-admin-client.tsx`) plus a one-line page-shell widen. Two views compose from the same data + cell recipe, differing only in scale and per-cell chrome. View state lives in React; toggle via `Tabs variant="segmented"`. No new primitives, no new tokens, no schema changes.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, shadcn `Tabs` / `Calendar` primitives, react-day-picker v9, Aurora Vault design tokens.

**Non-TDD note:** Design-system CSS changes do not benefit from unit tests (asserting class strings tells you nothing about visual craft). Each task's verification is `npx next build` clean + targeted browser smoke on `/sis/calendar` at 1440px viewport.

**Spec:** `docs/superpowers/specs/2026-04-25-school-calendar-redesign-design.md`

---

## File Map

- **Modify:** `app/(sis)/sis/calendar/page.tsx` — widen PageShell (Task 1)
- **Modify:** `components/attendance/calendar-admin-client.tsx` — everything else (Tasks 2–9)

No new files. Existing helpers (`parseIso`, `formatIso`, `formatHumanDate`, `bannerTypeFromModifiers`, dialogs, `CopyHolidaysDialog`, etc.) stay in place.

---

## Task 1: Widen PageShell on the calendar page

The page is currently inside `max-w-6xl` (1152px) which doesn't give the bigger cells room. Scope the widen to just this page.

**Files:**
- Modify: `app/(sis)/sis/calendar/page.tsx`

- [ ] **Step 1: Change the PageShell opener**

Find `<PageShell>` (around line 113) and change to `<PageShell className="max-w-[1400px]">`. No other changes in this file.

- [ ] **Step 2: Build**

```bash
npx next build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add "app/(sis)/sis/calendar/page.tsx"
git commit -m "feat(sis-calendar): widen page shell to 1400px for the two-view redesign"
```

---

## Task 2: Rewrite `DAY_TYPE_STYLES` to the §4.1 cell recipe

The current map uses weak washes and flat chip colors. Replace with solid medium tint + inset colored ring (cell) + gradient chip (chip). All Aurora Vault tokens — no Tailwind defaults, no `dark:` branches.

**Files:**
- Modify: `components/attendance/calendar-admin-client.tsx`

- [ ] **Step 1: Replace `DAY_TYPE_STYLES` with the spec §4.1 recipe**

Locate `const DAY_TYPE_STYLES: Record<DayType, { cell: string; chip: string; blurb: string }>` (around line 79). Replace the whole block with:

```tsx
const DAY_TYPE_STYLES: Record<DayType, { cell: string; chip: string; blurb: string }> = {
  school_day: {
    cell: "bg-brand-mint/50 text-ink font-semibold shadow-[inset_0_0_0_1px_rgba(34,197,94,0.35)] hover:bg-brand-mint/60",
    chip: "bg-gradient-to-b from-chart-5 to-chart-3 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]",
    blurb: "Regular in-school day. Attendance is taken.",
  },
  public_holiday: {
    cell: "bg-destructive/22 text-ink font-semibold shadow-[inset_0_0_0_1px_rgba(239,68,68,0.45)] hover:bg-destructive/30",
    chip: "bg-gradient-to-b from-destructive to-destructive/80 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]",
    blurb: "National / public closure. No attendance taken.",
  },
  school_holiday: {
    cell: "bg-brand-amber/35 text-ink font-semibold shadow-[inset_0_0_0_1px_rgba(245,158,11,0.55)] hover:bg-brand-amber/45",
    chip: "bg-gradient-to-b from-brand-amber to-brand-amber/80 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]",
    blurb: "School-only closure (staff PD, founder's day). No attendance taken.",
  },
  hbl: {
    cell: "bg-primary/30 text-ink font-semibold shadow-[inset_0_0_0_1px_rgba(79,70,229,0.4)] hover:bg-primary/40",
    chip: "bg-gradient-to-b from-brand-indigo to-brand-indigo-deep text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]",
    blurb: "Home-based learning. Attendance still taken; counts as a school day.",
  },
  no_class: {
    cell: "bg-muted text-muted-foreground font-semibold shadow-[inset_0_0_0_1px_var(--av-hairline-strong)] hover:bg-muted/90",
    chip: "bg-gradient-to-b from-ink-4 to-ink-3 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]",
    blurb: "School-wide no class. No attendance taken.",
  },
};
```

- [ ] **Step 2: Build**

```bash
npx next build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add components/attendance/calendar-admin-client.tsx
git commit -m "feat(sis-calendar): DAY_TYPE_STYLES → spec §4.1 recipe (solid tint + inset ring + gradient chip)"
```

---

## Task 3: Add view state + segmented toggle in the toolbar

Introduce `view: 'month' | 'term'` in `CalendarAdminClient` and render the Month/Full-term toggle using `Tabs variant="segmented"` in the existing toolbar.

**Files:**
- Modify: `components/attendance/calendar-admin-client.tsx`

- [ ] **Step 1: Add the Tabs import**

At the top of the file, add `Tabs`, `TabsList`, `TabsTrigger` to the existing `@/components/ui/tabs` import. If there's no existing tabs import, add a new line after the `Select` import:

```tsx
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
```

- [ ] **Step 2: Add view state to `CalendarAdminClient`**

Locate `export function CalendarAdminClient({...})`. Inside the function body, near the existing `useState` calls (around line 145–157), add:

```tsx
const [view, setView] = useState<"month" | "term">("month");
```

Reset this on `switchTerm` — in the existing `function switchTerm(next: string)`, add `setView("month");` right before `setSelectedDates([]);` so that switching terms drops back to month view.

- [ ] **Step 3: Render the toggle in the toolbar**

Find the existing term-selector toolbar row — the `<div className="flex flex-wrap items-end gap-3">` containing the term `Select` (around line 301). In the right-side action cluster (the `<div className="ml-auto flex flex-wrap items-center gap-2">` near line 327), insert the toggle BEFORE the existing `CopyHolidaysDialog` / Multi-select / Add-date-range buttons:

```tsx
<Tabs value={view} onValueChange={(v) => setView(v as "month" | "term")}>
  <TabsList variant="segmented">
    <TabsTrigger value="month">Month</TabsTrigger>
    <TabsTrigger value="term">Full term</TabsTrigger>
  </TabsList>
</Tabs>
```

- [ ] **Step 4: Branch the view render**

Find the existing `{selectedTerm && <MonthView ... />}` block (around line 410). Wrap it with a conditional on `view`:

```tsx
{selectedTerm && view === "month" && (
  <MonthView
    term={selectedTerm}
    daysByType={daysByType}
    multiSelect={multiSelect}
    selectedDates={selectedDates}
    onSelectDates={setSelectedDates}
    onDayClick={(iso) => setDateDialogIso(iso)}
  />
)}
{selectedTerm && view === "term" && (
  <TermStripView
    term={selectedTerm}
    daysByType={daysByType}
    multiSelect={multiSelect}
    selectedDates={selectedDates}
    onSelectDates={setSelectedDates}
    onDayClick={(iso) => setDateDialogIso(iso)}
  />
)}
```

`TermStripView` is built in Task 6. It'll error-not-defined until then — acceptable interim, fixed before commit.

- [ ] **Step 5: Add a minimal TermStripView stub so Task 3 ships green**

Add a stub at the same scope as `MonthView` (append after `MonthView` function definition):

```tsx
function TermStripView(props: React.ComponentProps<typeof MonthView>) {
  // Placeholder — full implementation in Task 6.
  return (
    <div className="rounded-xl border border-hairline bg-card p-6 text-sm text-muted-foreground">
      Term strip view — coming in the next commit.
    </div>
  );
}
```

- [ ] **Step 6: Build**

```bash
npx next build
```

Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add components/attendance/calendar-admin-client.tsx
git commit -m "feat(sis-calendar): add view state + Tabs segmented toggle (Month/Full term)"
```

---

## Task 4: MonthView — editorial layout per spec §5

Rebuild the MonthView card with the spec's eyebrow meta-strip, editorial month caption, weekday header band, 144px cells, serif tabular-nums day numbers. The cell tinting (Task 2) already cascades into here via `modifiersClassNames` so this task is layout + typography only.

**Files:**
- Modify: `components/attendance/calendar-admin-client.tsx`

- [ ] **Step 1: Replace the MonthView `classNames` block**

Locate the `sharedCalendarProps` declaration inside `MonthView` and its `classNames: { ... }` subobject. Replace the whole `classNames` block with:

```tsx
classNames: {
  root: "w-full",
  month: "flex w-full flex-col gap-4",
  // Editorial month caption — serif display face, left-aligned, hairline underline.
  month_caption:
    "flex h-[56px] w-full items-center justify-between border-b border-hairline px-2 pb-3 font-serif text-[30px] font-semibold leading-none tracking-tight text-foreground",
  // Weekday header band — bg-muted tint + inset highlight.
  weekdays:
    "flex rounded-lg border border-hairline bg-muted/40 px-2 py-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)]",
  weekday:
    "flex-1 text-center text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-ink-4 select-none",
  week: "mt-1 flex w-full",
  day: "p-0.5",
  day_button:
    "flex aspect-square size-auto w-full min-w-(--cell-size) flex-col items-start justify-start gap-1 rounded-lg px-3 pt-3 font-serif text-[22px] font-semibold tabular-nums leading-none transition-all hover:-translate-y-0.5 hover:shadow-md group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] group-data-[focused=true]/day:ring-ring/50",
},
```

- [ ] **Step 2: Bump the cell size to 144px**

In the same `sharedCalendarProps`, change `className: "[--cell-size:--spacing(28)] w-full"` (or whatever it's currently set to) to:

```tsx
className: "[--cell-size:--spacing(36)] w-full",
```

- [ ] **Step 3: Replace the MonthView return with the editorial card shell**

Find the `return (<div className="rounded-xl...">...` in MonthView and replace with:

```tsx
const monthLabel = month.toLocaleString("en-SG", { month: "long", year: "numeric" });

// Count school-day rows already classified for this term (= everything
// except weekends that has a row in school_calendar).
const totalSchoolDays =
  daysByType.school_day.length +
  daysByType.public_holiday.length +
  daysByType.school_holiday.length +
  daysByType.hbl.length +
  daysByType.no_class.length;

// Compute week-of-term — 1-indexed number of Mondays from term start to today.
const now = new Date();
const termStart = parseIso(term.startDate);
const daysSinceStart = Math.max(
  0,
  Math.floor((now.getTime() - termStart.getTime()) / 86400000),
);
const weekOfTerm = Math.min(13, Math.floor(daysSinceStart / 7) + 1);

return (
  <div className="rounded-xl border border-hairline bg-card shadow-sm ring-1 ring-inset ring-hairline">
    {/* Eyebrow meta-strip */}
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-muted/30 px-6 py-3 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.4)]">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {term.label}
        <span className="mx-2 text-hairline-strong">·</span>
        Week <span className="tabular-nums">{weekOfTerm}</span> of 13
      </p>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <span className="tabular-nums">{totalSchoolDays}</span> days classified
      </p>
    </div>
    {/* Calendar grid */}
    <div className="p-6 md:p-8">
      {multiSelect ? (
        <Calendar
          {...sharedCalendarProps}
          mode="multiple"
          selected={selectedDates}
          onSelect={(next) => onSelectDates(next ?? [])}
        />
      ) : (
        <Calendar
          {...sharedCalendarProps}
          mode="single"
          onDayClick={(day, modifiers) => {
            if (modifiers.disabled) return;
            onDayClick(formatIso(day));
          }}
        />
      )}
    </div>
  </div>
);
```

- [ ] **Step 4: Build**

```bash
npx next build
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add components/attendance/calendar-admin-client.tsx
git commit -m "feat(sis-calendar): MonthView — editorial layout, 144px cells, meta-strip"
```

---

## Task 5: Update DayButtonWithBanner for the new cell craft

Make the in-cell banner chip larger and position it at the bottom-left of the cell. Event labels render as italic mono under the day number (A-view) — add that rendering here too via a `modifiers.eventDay` check passed through.

**Files:**
- Modify: `components/attendance/calendar-admin-client.tsx`

- [ ] **Step 1: Replace DayButtonWithBanner**

Locate `function DayButtonWithBanner(props: ...)` and replace with:

```tsx
function DayButtonWithBanner(props: React.ComponentProps<typeof DayButton>) {
  const { modifiers, children } = props;
  const bannerType = bannerTypeFromModifiers(modifiers as Record<string, unknown>);
  return (
    <CalendarDayButton {...props}>
      <span className="font-serif text-[22px] font-semibold tabular-nums leading-none">
        {/* `children` is already the day number rendered by react-day-picker;
           we wrap it in a span so the cell's flex-col layout stacks correctly. */}
        {children}
      </span>
      {bannerType && (
        <span className="mt-auto self-stretch rounded-md px-2 py-0.5 text-center font-mono text-[9px] font-semibold uppercase leading-tight tracking-[0.14em]">
          <span className={`inline-block rounded-md px-1.5 py-0.5 ${DAY_TYPE_STYLES[bannerType].chip}`}>
            {DAY_TYPE_SHORT_LABEL[bannerType]}
          </span>
        </span>
      )}
    </CalendarDayButton>
  );
}
```

- [ ] **Step 2: Build**

```bash
npx next build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add components/attendance/calendar-admin-client.tsx
git commit -m "feat(sis-calendar): DayButtonWithBanner — bottom-anchored gradient chip"
```

---

## Task 6: Build TermStripView — 13-week strip per spec §6

Replace the Task 3 stub with the real term strip. 7-column grid of cells with a 56px left rail for W1..W13. Each week row spans the same 7 weekdays as the month view. Uses the same `DAY_TYPE_STYLES[...].cell` recipe for coloring.

**Files:**
- Modify: `components/attendance/calendar-admin-client.tsx`

- [ ] **Step 1: Build the week-grouping helper**

Just above the `function TermStripView(...)` definition, add this helper:

```tsx
// Group every day within [termStart, termEnd] into rows keyed by Monday-
// starting week number. Weekends are INCLUDED so each row is a full 7-day
// strip (weekends render as disabled cells). Day objects carry their ISO
// date + classified day-type (or null for pre-weekend cells).
type StripDay = {
  iso: string;
  date: Date;
  dayType: DayType | null;
  isWeekend: boolean;
  isEvent: boolean;
  isToday: boolean;
  isFirstOfMonth: boolean;
};
type StripWeek = { weekNumber: number; days: (StripDay | null)[] };

function buildStripWeeks(
  termStartIso: string,
  termEndIso: string,
  dayTypeByIso: Map<string, DayType>,
  eventIsos: Set<string>,
): StripWeek[] {
  const start = parseIso(termStartIso);
  const end = parseIso(termEndIso);

  // Align to the Monday of the first week.
  const firstMonday = new Date(start);
  const startDow = start.getDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
  const shift = startDow === 0 ? -6 : 1 - startDow; // Mon → 0, Tue → -1, Sun → -6
  firstMonday.setDate(start.getDate() + shift);

  const weeks: StripWeek[] = [];
  const todayIso = formatIso(new Date());
  const cursor = new Date(firstMonday);
  let weekNumber = 1;

  while (cursor.getTime() <= end.getTime()) {
    const days: (StripDay | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor);
      const iso = formatIso(d);
      const inRange = d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
      if (!inRange) {
        days.push(null);
      } else {
        const dow = d.getDay();
        days.push({
          iso,
          date: new Date(d),
          dayType: dayTypeByIso.get(iso) ?? null,
          isWeekend: dow === 0 || dow === 6,
          isEvent: eventIsos.has(iso),
          isToday: iso === todayIso,
          isFirstOfMonth: d.getDate() === 1,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push({ weekNumber, days });
    weekNumber++;
  }
  return weeks;
}
```

- [ ] **Step 2: Replace the TermStripView stub with the real implementation**

Locate the stub `function TermStripView(props: React.ComponentProps<typeof MonthView>) { ... }` from Task 3 and replace with:

```tsx
function TermStripView({
  term,
  daysByType,
  multiSelect,
  selectedDates,
  onSelectDates,
  onDayClick,
}: {
  term: TermOption;
  daysByType: Record<DayType, Date[]> & { event: Date[] };
  multiSelect: boolean;
  selectedDates: Date[];
  onSelectDates: (next: Date[]) => void;
  onDayClick: (iso: string) => void;
}) {
  // Flatten daysByType into an iso→dayType map for O(1) lookup per cell.
  const dayTypeByIso = useMemo(() => {
    const m = new Map<string, DayType>();
    (Object.keys(daysByType) as Array<keyof typeof daysByType>).forEach((key) => {
      if (key === "event") return;
      daysByType[key as DayType].forEach((d) => m.set(formatIso(d), key as DayType));
    });
    return m;
  }, [daysByType]);

  const eventIsoSet = useMemo(() => {
    const s = new Set<string>();
    daysByType.event.forEach((d) => s.add(formatIso(d)));
    return s;
  }, [daysByType]);

  const weeks = useMemo(
    () => buildStripWeeks(term.startDate, term.endDate, dayTypeByIso, eventIsoSet),
    [term.startDate, term.endDate, dayTypeByIso, eventIsoSet],
  );

  const selectedIsoSet = useMemo(
    () => new Set(selectedDates.map(formatIso)),
    [selectedDates],
  );

  function toggleSelection(iso: string, d: Date) {
    if (selectedIsoSet.has(iso)) {
      onSelectDates(selectedDates.filter((x) => formatIso(x) !== iso));
    } else {
      onSelectDates([...selectedDates, d]);
    }
  }

  return (
    <div className="rounded-xl border border-hairline bg-card shadow-sm ring-1 ring-inset ring-hairline">
      {/* Eyebrow meta-strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-muted/30 px-6 py-3 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.4)]">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Full term
          <span className="mx-2 text-hairline-strong">·</span>
          <span className="tabular-nums">{weeks.length}</span> weeks
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Switch → Month to drill down
        </p>
      </div>
      {/* Term grid */}
      <div className="p-6 md:p-8">
        <div className="mb-3 flex items-baseline justify-between border-b border-hairline pb-3">
          <h3 className="font-serif text-[24px] font-semibold tracking-tight text-foreground">
            {term.label} · {term.startDate} → {term.endDate}
          </h3>
        </div>
        {/* Weekday header */}
        <div className="mb-1 grid grid-cols-[56px_repeat(7,1fr)] gap-1">
          <div />
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div
              key={d}
              className="rounded-md bg-muted/40 px-2 py-1.5 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)]"
            >
              {d}
            </div>
          ))}
        </div>
        {/* Weeks */}
        <div className="space-y-1">
          {weeks.map((wk) => (
            <div
              key={wk.weekNumber}
              className="grid grid-cols-[56px_repeat(7,1fr)] gap-1"
            >
              <div className="flex items-center justify-center rounded-md bg-muted/40 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                W{wk.weekNumber}
              </div>
              {wk.days.map((d, idx) => {
                if (!d) {
                  return <div key={idx} className="aspect-[1.2/1] opacity-0" />;
                }
                const tintClass = d.isWeekend
                  ? "bg-background text-hairline-strong shadow-[inset_0_0_0_1px_var(--av-hairline)]"
                  : d.dayType
                    ? DAY_TYPE_STYLES[d.dayType].cell
                    : "bg-background shadow-[inset_0_0_0_1px_var(--av-hairline)]";
                const isSelected = selectedIsoSet.has(d.iso);
                const todayClass = d.isToday
                  ? "shadow-[inset_0_0_0_2px_var(--av-indigo)]"
                  : "";
                const selectedClass = isSelected
                  ? "scale-[0.98] ring-2 ring-brand-indigo/40 ring-offset-1 ring-offset-card"
                  : "";
                const firstOfMonthClass = d.isFirstOfMonth
                  ? "mt-2 border-t border-hairline/40 pt-2"
                  : "";
                const clickable = !d.isWeekend;

                return (
                  <button
                    key={d.iso}
                    type="button"
                    disabled={!clickable}
                    onClick={() => {
                      if (!clickable) return;
                      if (multiSelect) toggleSelection(d.iso, d.date);
                      else onDayClick(d.iso);
                    }}
                    className={[
                      "relative aspect-[1.2/1] rounded-md p-1 text-left font-serif text-[13px] font-semibold tabular-nums leading-none transition-all",
                      tintClass,
                      todayClass,
                      selectedClass,
                      firstOfMonthClass,
                      clickable && "hover:-translate-y-0.5 hover:shadow-md cursor-pointer",
                      !clickable && "cursor-not-allowed",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    title={formatHumanDate(d.iso)}
                  >
                    <span>{d.date.getDate()}</span>
                    {d.isEvent && (
                      <span className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build**

```bash
npx next build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add components/attendance/calendar-admin-client.tsx
git commit -m "feat(sis-calendar): TermStripView — 13-week strip with left rail, same cell recipe"
```

---

## Task 7: Multi-select halo + today inset ring on MonthView

Apply the spec §4.2 state modifiers to the MonthView. `CalendarDayButton` already carries the basic gradient selected-state from the primitive work; add the multi-select halo + today's inset 2px ring via `modifiersClassNames`.

**Files:**
- Modify: `components/attendance/calendar-admin-client.tsx`

- [ ] **Step 1: Extend modifiersClassNames in MonthView**

Find `modifiersClassNames: { ... }` inside MonthView's `sharedCalendarProps` and add these keys (merge with existing — don't clobber `school_day`, `public_holiday`, etc.):

```tsx
modifiersClassNames: {
  school_day: DAY_TYPE_STYLES.school_day.cell,
  public_holiday: DAY_TYPE_STYLES.public_holiday.cell,
  school_holiday: DAY_TYPE_STYLES.school_holiday.cell,
  hbl: DAY_TYPE_STYLES.hbl.cell,
  no_class: DAY_TYPE_STYLES.no_class.cell,
  eventDay:
    'relative after:content-[""] after:absolute after:bottom-2 after:left-1/2 after:-translate-x-1/2 after:h-1.5 after:w-1.5 after:rounded-full after:bg-primary',
  today: "shadow-[inset_0_0_0_2px_var(--av-indigo)]",
  selected: "scale-[0.98] ring-2 ring-brand-indigo/40 ring-offset-1 ring-offset-card",
},
```

Also extend the `modifiers` object to include `today: [new Date()]`:

```tsx
modifiers: {
  school_day: daysByType.school_day,
  public_holiday: daysByType.public_holiday,
  school_holiday: daysByType.school_holiday,
  hbl: daysByType.hbl,
  no_class: daysByType.no_class,
  eventDay: daysByType.event,
  today: [new Date()],
},
```

- [ ] **Step 2: Build**

```bash
npx next build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add components/attendance/calendar-admin-client.tsx
git commit -m "feat(sis-calendar): MonthView today + multi-select state modifiers"
```

---

## Task 8: Align the Legend strip + pre-existing legend cleanup

The top-of-page legend strip already migrated to `ChartLegendChip` earlier this session. Verify it reads cleanly with the new cell recipe colors, and add a thin hairline border around it for craft parity with the calendar card.

**Files:**
- Modify: `components/attendance/calendar-admin-client.tsx`

- [ ] **Step 1: Tighten the legend strip styling**

Find the existing legend block (around line 394):

```tsx
<div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-[11px] text-muted-foreground">
```

Replace with:

```tsx
<div className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-muted/25 px-4 py-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)]">
```

(One line change — swap `border-border` → `border-hairline` for token consistency, swap `bg-muted/30` → `bg-muted/25` to match the new calendar-card eyebrow-strip tone, drop the `text-[11px] text-muted-foreground` since `ChartLegendChip` children set their own typography, add the inset-highlight shadow.)

- [ ] **Step 2: Build**

```bash
npx next build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add components/attendance/calendar-admin-client.tsx
git commit -m "feat(sis-calendar): legend strip — hairline border + matching inset highlight"
```

---

## Task 9: Verification pass

Visual smoke across both views + edge cases. No code changes unless a bug surfaces.

**Files:**
- No code changes unless a smoke issue is found.

- [ ] **Step 1: Clean build**

```bash
rm -rf .next && npx next build
```

Expected: clean build, no warnings from our changes.

- [ ] **Step 2: Grep for Hard Rule violations in the file**

```bash
grep -nE "emerald-|amber-[0-9]+|dark:" components/attendance/calendar-admin-client.tsx || echo "CLEAN"
```

Expected: `CLEAN` output (or no matches) — the file should have zero Tailwind default colors and zero `dark:` branches.

- [ ] **Step 3: Visual smoke — Month view**

Load `/sis/calendar` in a browser at 1440px. Verify:
- Card carries the ring-inset + shadow-sm craft
- Eyebrow strip shows `TERM 1 · WEEK N OF 13` left, `NN days classified` right — in mono uppercase
- Month caption renders serif `text-[30px]`, left-aligned
- Weekday band is bg-muted/40 tinted with inset highlight
- Cells are ~130–150px wide
- Day-type tints read at a glance (school/public/school-hol/hbl/no-class)
- Today has a 2px inset indigo ring
- Hover lifts the cell (-translate-y-0.5)
- Click a weekday → date-action dialog opens
- Toggle multi-select, click 3 days → selected halo shows, scale-[0.98] applied

- [ ] **Step 4: Visual smoke — Full term view**

Click "Full term" in the toolbar toggle. Verify:
- All 13 weeks stack without scrolling on a 1440 × 900 viewport
- Left rail shows W1..W13 in mono uppercase
- Cells ~65–80px wide
- Same day-type tints cascade from MonthView
- Month-boundary cells (first-of-month) have a subtle `border-t border-hairline/40` above them
- Today has the 2px indigo ring
- Event-day cells show a 4px primary dot at bottom
- Clicking a day opens the date-action dialog (same as month view)
- Multi-select works — clicking toggles selection; halo + scale visible

- [ ] **Step 5: Term switch resets view**

With view = "Full term", switch the term in the dropdown. Expect the view to reset to Month (per `switchTerm` logic in Task 3).

- [ ] **Step 6: Keyboard pass**

Tab through the toolbar → segmented toggle → calendar cells. Focus rings visible everywhere. Arrow keys within the grid navigate days (react-day-picker behavior in Month; no arrow nav in Term strip — acceptable).

- [ ] **Step 7: Update dev plan + CLAUDE.md session-context note**

Append a row in `docs/sprints/development-plan.md` under the running follow-ups, dated 2026-04-25, noting: school calendar redesign shipped (two views, cell recipe, widened PageShell, Hard Rule violations cleared in the file).

Update the `## Session context` block in `CLAUDE.md` — the "non-flat primitive refresh" entry can stay (already records what shipped); append a compact "school calendar redesigned (2026-04-25)" note so future sessions know this landed.

- [ ] **Step 8: Commit docs**

```bash
git add docs/sprints/development-plan.md CLAUDE.md
git commit -m "docs: record school-calendar redesign (two views + cell recipe + widened shell)"
```

---

## Self-review notes

**1. Spec coverage:**

- §1 Goal (two views): Tasks 3 (toggle) + 4 (MonthView) + 6 (TermStripView) ✓
- §2 Diagnosis (size, weight, aesthetic, layout, info density): Tasks 1 (size) + 2 (weight/aesthetic) + 3+6 (layout) + 4+5 (info density) ✓
- §3.1 Two views + shared recipe: Task 2 (recipe) + 4 + 6 ✓
- §3.2 View state + Tabs segmented: Task 3 ✓
- §3.3 PageShell widen: Task 1 ✓
- §4.1 Per-type recipe: Task 2 ✓
- §4.2 State modifiers (today, multi-select, hover, focus): Task 7 (Month) + Task 6 inline (Term strip) ✓
- §5 A-view layout: Task 4 ✓
- §5.3 Eyebrow meta-strip content (week-of-term, classified-count): Task 4 ✓
- §6 C-view layout: Task 6 ✓
- §7 Shared chrome (page header, toolbar, legend, dialogs, action buttons): existing chrome stays; toolbar toggle added in Task 3; legend strip tightened in Task 8 ✓
- §8 Typography + tokens + no dark branches: enforced through Tasks 2/4/6; grep-checked in Task 9 step 2 ✓
- §9 Out of scope (week view, agenda, URL deep-link, print, mobile, schema): no tasks touch these ✓
- §10 Migration impact (two files): Tasks 1 + all else ✓
- §11 Verification: Task 9 ✓

**2. Placeholder scan:** No TBD/TODO/"add appropriate X" in any step. Every code block shows full content. No "similar to Task N."

**3. Type consistency:** `DayType`, `StripDay`, `StripWeek`, `DAY_TYPE_STYLES[...].cell` / `.chip` references match between Tasks 2, 4, 5, 6, 7, 8. `CalendarAdminClient` state variables (`view`, `multiSelect`, `selectedDates`) reused consistently. Both `MonthView` and `TermStripView` share the same props shape via Task 3's component signature.
