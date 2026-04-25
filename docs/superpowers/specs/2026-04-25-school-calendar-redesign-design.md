# School Calendar Redesign — Design

- **Date:** 2026-04-25
- **Surface:** `/sis/calendar` — admin tool for registrars / school_admin / admin / superadmin
- **File:** `components/attendance/calendar-admin-client.tsx`
- **Predecessor:** Non-flat primitive refresh (same day) added ring + shadow + token migration. This spec rebuilds the calendar's shape and visual weight from scratch — the per-primitive polish didn't address the underlying "it looks like a generic shadcn calendar" problem.

## 1. Goal

Redesign the school calendar so it reads as **the main event on the page** — an admin instrument for scanning and classifying a 13-week term, not a date picker. Two views:

- **Month grid (A-view, default)** — one month, large cells, familiar affordance.
- **Full term strip (C-view, on-demand)** — all 13 weeks stacked vertically, scannable in one eyeful.

Switch between them via a segmented toggle in the toolbar.

## 2. Why now

User-captured diagnosis (five of six issues from the brainstorming triage):

1. **Too small / cramped.** Cells were 80px; the card didn't own its viewport. Felt like a widget.
2. **Visual weight wrong.** Color tints were 12–20% opacity — holidays didn't pop at a glance.
3. **Not on brand.** Looked like generic shadcn with tints, not a crafted HFSE admin tool.
4. **Layout possibly wrong entirely.** Month-at-a-time for a 13-week classification task = 3–4 page-flips per term.
5. **Info density in the mushy middle.** Chip labels were `text-[8px]`, day numbers were `text-base`. Neither was decisive.

Layouts tried in the session that this spec supersedes: several surgical ring + shadow + cell-size tweaks, all still reading as "slightly bigger generic calendar."

## 3. Architecture

### 3.1 Two views, one set of data, one cell recipe

Both views render from the same `daysByType` data and use the same per-cell visual recipe (§4). The views differ only in:

- **Scale** — A uses ~130–150px cells, C uses ~65–80px cells.
- **Per-cell chrome** — A shows the in-cell banner chip + event label; C shows just the day number + event dot (the color IS the chip at that density).
- **Wrapper layout** — A is a 7 × 5 monthly grid with a month caption + nav; C is 13 weekly rows (W1–W13) with a sticky-feeling weekday header.

Term selector, legend strip, multi-select state, dialogs, and all other page chrome are shared — not view-specific.

### 3.2 View state

- Local React state: `view: 'month' | 'term'` in `CalendarAdminClient`, defaults to `'month'`.
- Toggle via `Tabs variant="segmented"` (the 25th-pass pill-style tab rail, not the default gradient-tile variant). Two items: "Month" / "Full term".
- Multi-select state carries across views. If the user starts selecting in C and switches to A, their picked dates persist.
- URL: no view param by default. View is client-state only; it resets on term change. If we later want deep-linkable URLs, add `?view=term` — not in scope for this spec.

### 3.3 Page shell

`PageShell` max-width increases from `max-w-6xl` (1152px) to `max-w-[1400px]` on this page only. Admin data-grids deserve more horizontal real estate than the editorial default. Scoped override, doesn't affect other `/sis/*` surfaces.

## 4. Cell recipe (shared by both views)

One recipe, driven by `DAY_TYPE_STYLES` (existing map, updated). Three stacked elements per day-type:

- **Cell background:** solid medium-saturation wash (~25–50% opacity of the type's base token).
- **Inset colored ring:** `shadow: inset 0 0 0 1px <typeColor>` at 35–55% opacity — gives each type its own "frame" without a drop shadow or gradient background.
- **Serif day number:** `font-serif text-[22px] font-semibold tabular-nums leading-none` — top-anchored in the cell. Legible from any distance.
- **Gradient chip banner (A-view only):** renders only when the day has a non-default type (public_holiday, school_holiday, hbl, no_class). Styled as the Legend chip craft: gradient bg per type + white text + mono uppercase tracking + inset highlight. Small — `text-[9px]` with `tracking-[0.14em]`.
- **Event overlay:** inline italic event label (A-view) or 6px primary dot at the bottom-center of the cell (C-view) — indicates a `calendar_events` row exists for that date.

### 4.1 Per-type recipe table

| Day type | Cell bg | Inset ring | Chip gradient (A only) | Text color |
|---|---|---|---|---|
| `school_day` | `bg-brand-mint/50` | mint / chart-5 at 35% | — (no chip, default state) | `text-ink` |
| `public_holiday` | `bg-destructive/22` | destructive at 45% | `from-destructive to-destructive/80` | `text-ink` (cell), `text-white` (chip) |
| `school_holiday` | `bg-brand-amber/35` | brand-amber at 55% | `from-brand-amber to-brand-amber/80` | `text-ink` (cell), `text-white` (chip) |
| `hbl` | `bg-primary/30` | primary at 40% | `from-brand-indigo to-brand-indigo-deep` | `text-ink` (cell), `text-white` (chip) |
| `no_class` | `bg-muted` | `hairline-strong` | `from-ink-4 to-ink-3` | `text-muted-foreground` (cell), `text-white` (chip) |
| weekend (disabled) | `bg-background` | `hairline` | — | `text-hairline-strong`, cursor not-allowed |

### 4.2 State modifiers (additive on top of the type recipe)

- **Today** — `shadow: inset 0 0 0 2px brand-indigo` (2px ring replaces the type's 1px ring — indigo wins visual priority).
- **Multi-select candidate** — `scale-[0.98]` transform on the cell body (feels "pressed") + `ring-2 ring-brand-indigo/40` halo outside the cell. Halo is distinct from Today's inset ring so a day that's *both* today AND multi-selected shows both: today's inset 2px + selected's outside halo. Multi-select dominates visually via the halo, Today is never lost.
- **Hover (clickable)** — `-translate-y-0.5` + graduated shadow `shadow-md`. Respects the T1 content-surface craft.
- **Focus-visible (keyboard)** — `ring-[3px] ring-ring/50` (unchanged from shadcn default).

No gradients on cell backgrounds. No dark-mode branching in component — all `dark:` handling stays in `globals.css`.

## 5. A-view — month grid

### 5.1 Layout

Card shell → eyebrow meta-strip → month caption + nav → weekday header band → 7-column day grid (rows 4–6 depending on month).

```
┌─ Card shell (ring-1 ring-inset ring-hairline + shadow-sm) ──────────┐
│ ┌─ Eyebrow strip (bg-muted/30 + inset highlight, hairline border) ─┐│
│ │ TERM 1 · WEEK 3 OF 13       ·       16/62 SCHOOL DAYS CLASSIFIED ││
│ └──────────────────────────────────────────────────────────────────┘│
│  p-6 md:p-8                                                          │
│                                                                      │
│ ┌─ Month caption row ──────────────────────────────────────────────┐ │
│ │ September 2026           [‹ prev] [Today] [next ›]                │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌─ Weekday band (bg-muted/40 + inset highlight) ───────────────────┐ │
│ │  MON  TUE  WED  THU  FRI  SAT  SUN                                │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌─ Day grid — 7 cols × 5 rows ─────────────────────────────────────┐ │
│ │  [1][2][3][4][5][6][7]                                             │ │
│ │  [8][9][10]...                                                     │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 Specifics

- **Cell size:** `--cell-size: --spacing(36)` (144px) at the `max-w-[1400px]` viewport. Cells ~130–150px wide including gaps.
- **Cell gap:** `gap-1` (4px) between cells, no hairline dividers — the rings do the separation.
- **Day number:** `font-serif text-[22px] font-semibold tabular-nums leading-none`, top-anchored at `pt-3` inside the cell.
- **Banner chip:** bottom-anchored where present, `text-[9px] font-mono font-semibold uppercase tracking-[0.14em]`. Only for non-default types.
- **Event label:** small italic `text-[10px] text-muted-foreground` below the day number, next to a 6px primary dot. Truncate at one line; full label visible in the per-day dialog.
- **Month caption:** serif `text-[30px] font-semibold tracking-tight`, left-aligned. Nav (prev/next/Today) floats right.
- **Today button:** small `size-sm variant="outline"` — returns to the month containing today.

### 5.3 Eyebrow meta-strip content

- Left: `TERM N · WEEK W OF 13` (computed from today's date vs term start/end).
- Right: `{classified} / {total} SCHOOL DAYS CLASSIFIED` — running count of how many school_day rows are already written to `school_calendar` for this term.

Both mono uppercase `text-[10px] tracking-[0.14em] text-muted-foreground`.

## 6. C-view — full term strip

### 6.1 Layout

Same card shell + eyebrow strip + toolbar. No month caption or nav (the whole term is already visible). Weekday header row positioned above the week rows — not sticky-on-scroll since the entire 13-week strip fits within the card without scrolling on the target viewport.

```
┌─ Card shell ────────────────────────────────────────────────────────┐
│ ┌─ Eyebrow strip ──────────────────────────────────────────────────┐│
│ │ FULL TERM · 13 WEEKS             SWITCH → MONTH TO DRILL DOWN    ││
│ └──────────────────────────────────────────────────────────────────┘│
│  p-6 md:p-8                                                          │
│ ┌─ Term caption ────────────────────────────────────────────────────┐│
│ │ Term 1 · AY2026                                                    ││
│ └───────────────────────────────────────────────────────────────────┘│
│ ┌─ Weekday header (7 cols + 56px left rail) ───────────────────────┐ │
│ │  [  ] MON TUE WED THU FRI SAT SUN                                  │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌─ Weeks W1..W13 ──────────────────────────────────────────────────┐ │
│ │ [W1][1 ][2 ][3 ][4 ][5 ][6 ][7 ]                                    │ │
│ │ [W2][8 ][9 ][10][11][12][13][14]                                    │ │
│ │ ...                                                                 │ │
│ │ [W13][days]                                                        │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 Specifics

- **Cell size:** `--cell-size: --spacing(18)` (~72px). 7 × 13 = 91 cells total, all visible without scrolling on a 1400px wide × ~900px tall viewport.
- **Left rail:** 56px-wide `W1`..`W13` labels, mono uppercase on `bg-muted/40`.
- **Cell content:** day number only (serif `text-[13px] font-semibold tabular-nums`). No banner chip — too cramped at 72px. Color wash + inset ring carry the meaning; the Legend strip above the card documents what each color means.
- **Event dot:** 4px primary dot at `bottom-1 left-1/2`. Important dates still show.
- **Cross-month boundaries:** the strip shows all days in order — a W5 row might span Sep/Oct. Day numbers "restart" naturally as they cross month boundaries (e.g. `...29, 30, 1, 2, 3...`). A small month-boundary separator — `mt-2 border-t border-hairline/40` on the first week of each month — gives a visual cue.

## 7. Shared chrome

### 7.1 Page header

Existing `<header>` pattern (eyebrow + serif hero + description + actions row). **No change** — already on-system.

### 7.2 Toolbar

Single row above the calendar card:

```
┌── Toolbar ──────────────────────────────────────────────────────────┐
│  [Term: Term 1 · AY2026 ▼]  01 Sep → 14 Dec     [Month | Full term] │
└─────────────────────────────────────────────────────────────────────┘
```

- **Left:** Term `Select` trigger (existing) + date-range readout in mono.
- **Right:** Month / Full term segmented toggle. Active state uses the T1 gradient chip treatment from the 25th-pass tabs refresh. Fully keyboard-accessible.

### 7.3 Legend strip

Uses `ChartLegendChip` for each day-type + one Important-date entry:

```
[School] [Public] [School hol] [HBL] [No class]   • Important date overlay
```

- 5 `ChartLegendChip` instances + one inline dot+label.
- Collapse to a `Popover` trigger on viewports < 768px (already crowded toolbar; legend is reference-only).

### 7.4 Action buttons

Move from the legacy top row into the toolbar's right side OR keep in the page header. Four actions total:

- **Copy holidays from AY{prev}** — existing `CopyHolidaysDialog`, stays as-is.
- **Multi-select toggle** — existing behavior.
- **Add date range** — existing `AddEventDialog`.
- **Apply day-type…** — appears only when `multiSelect && selectedDates.length > 0`. Destructive-ish action since it overwrites existing classifications, use `variant="outline"` (not destructive — it's an expected classification operation, not a "careful" one).

Keep in the page header per existing pattern — no movement needed.

### 7.5 Dialogs

All existing dialogs (`DateActionDialog`, `AddEventDialog`, `BulkDayTypeDialog`, `CopyHolidaysDialog`) remain. They inherit the T1 content-surface + inset-ring work from the primitive refresh. No design changes in this spec — they already compose from updated primitives.

## 8. Typography, tokens, and craft parity

All colors resolve to Aurora Vault tokens (`brand-mint`, `brand-amber`, `brand-indigo`, `destructive`, `muted`, `ink-*`, `hairline`). No Tailwind default colors. No hardcoded rgba outside of inset-highlight shadow recipes (which mirror the `shadow-brand-tile` / `shadow-button` pattern).

Dark mode: zero `dark:` branches in this file. All dark-mode overrides live in `globals.css` via the existing `--av-*` tokens.

### 8.1 Typography scale used

| Role | Class string |
|---|---|
| Eyebrow (meta-strip, trust strip, weekday labels in C) | `font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground` |
| Weekday labels (A-view) | `font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4` |
| Month caption (A) | `font-serif text-[30px] font-semibold tracking-tight text-foreground` |
| Term caption (C) | `font-serif text-[24px] font-semibold tracking-tight text-foreground` |
| Day number (A) | `font-serif text-[22px] font-semibold tabular-nums leading-none` |
| Day number (C) | `font-serif text-[13px] font-semibold tabular-nums leading-none` |
| Banner chip (A) | `font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-white` |
| Week label (C rail) | `font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3` |
| Event label (A) | `font-mono text-[10px] text-muted-foreground italic` |

## 9. Explicitly out of scope

- **Week view (M/T/W columns with hour rows).** Not an admin need — days are classified whole; time-of-day granularity doesn't exist in `school_calendar`.
- **Agenda table (B from the layout triage).** Considered, rejected for primary view — spatial weekly patterns are important for this user's task. Could be added as a third view later if demand surfaces; not in this spec.
- **URL deep-linking of view state.** Local client state is sufficient for now. Deep-link later if power users ask.
- **Printable month view.** Not requested; not in scope.
- **Mobile-first redesign.** The admin surface is desktop-only by convention — no one sets a term's holidays on their phone. Responsive degradation is acceptable (toolbar wraps, cells shrink) but no tablet/mobile-optimized layout in this spec.
- **Any change to `school_calendar` schema, `calendar_events` schema, or `POST /api/attendance/calendar` contract.** Data layer unchanged.

## 10. Migration & call-site impact

Single file: `components/attendance/calendar-admin-client.tsx`.

One adjacent file: `app/(sis)/sis/calendar/page.tsx` to widen the `PageShell` (`max-w-[1400px]`). Scoped, no cross-page regressions.

`DAY_TYPE_STYLES` object is updated in place (tints/rings per §4.1). All other references (`DateActionDialog`, `BulkDayTypeDialog`, etc.) read the same object and auto-inherit the new recipe.

No new primitives, no new tokens (the `brand-*` + `ink-*` + `hairline-*` + inset-shadow tokens are all pre-existing).

## 11. Verification

- `npx next build` clean.
- Manual visual smoke at 1440px and 1024px:
  - Both views render; toggle switches smoothly.
  - Each day-type reads at a glance — can spot a holiday from 3 feet away.
  - Today, multi-select, hover, focus states each visually distinct.
  - C-view fits 13 weeks without scroll on a 900px-tall viewport.
- Keyboard: Tab through toolbar → calendar grid. Arrow keys move within the grid (handled by react-day-picker). Enter opens the day dialog.
- No `emerald-*` / `amber-*` / `dark:*` in the diff (grep check).

## 12. Open follow-ups (not blockers)

- Consider extracting `<CalendarEyebrowStrip>` as a shared primitive if other calendar surfaces (DatePicker popover, DateRangePicker) want the same meta-strip.
- Count-classified metric (`16 / 62`) is computed client-side from `daysByType`. If that calculation shows up in other places, consider moving it to `lib/attendance/calendar.ts` as a util.
- The `C`-view month-boundary separator (§6.2) is a visual-only affordance. Revisit if users get confused by the "day-number restart" across months.
