# Operational School Calendar — Redesign Spec

**Date:** 2026-06-04
**Status:** Approved (2026-06-04) — D1 + D2 accepted as the leanings below.
**Surface:** `/sis/calendar` (SIS Admin → School calendar)
**Roles:** registrar, school_admin, superadmin (unchanged)
**Migration required:** No — pure UI/UX rebuild over the existing schema.

---

## 1. Problem

The school calendar admin (`components/attendance/calendar-admin-client.tsx`, ~2,570 lines) is hard to maintain and noisy to operate. A registrar configuring a term faces a stacked pile of single-purpose controls — Audience tabs, Month/Full-term view tabs, Copy-from-prior-AY, Multi-select mode, Add-date-range, Tentative-only filter — plus a per-date concept model with **five day-types** (`school_day`, `public_holiday`, `school_holiday`, `hbl`, `no_class`) and a sixth **HBL-overlay** modifier. The mental model is ~10 concepts for what the registrar thinks of as a simple job: "track which days are school days, and what events happen."

The complexity has two distinct sources that the redesign treats differently:

- **A functional layer** — day-types decide which dates teachers may take attendance on (the encodable-dates allowlist, KD #50/#98). This is load-bearing and must be preserved exactly.
- **An informational layer** — `calendar_events` (label + category + level + tentative). This genuinely is "just dates + categories."

Most of the noise is (a) the rich day-type enum and (b) the cross-cutting toggles stacked on top — not the events.

## 2. Goals

1. **Reframe editing as an operational calendar**: every weekday is *open* (school in session) by default; the registrar only marks *exceptions* (closures + events). Two concepts replace ~10: **open/closed days (with a reason)** and **events (with a category)**.
2. **Conventional view + filter layer**: a single segmented **view switcher** (Term · Month · Week · Day · List) and a single **filter bar** (date range, category, level, status, tentative, + room to grow). Power through a familiar calendar-app convention, not one-off buttons.
3. **Maintainability**: break the monolith into an orchestrator + toolbar + filter bar + one file per view + one edit sheet + shared cell/hooks.
4. **Preserve all current behavior**: the attendance encodable-dates allowlist, per-level overrides, HBL, tentative events, and copy-from-prior-AY all keep working.
5. **Extensible filters**: new "school-related" filters (TBD by the registrar after the rebuild) slot into a filter registry without structural change.

## 3. Non-goals

- **No schema change / migration.** We reinterpret existing columns for the UI.
- **No change to attendance encoding logic** (`isEncodableDayType`, `getEncodableDatesForTerm`, the daily writer's gate).
- **No new event categories or day-types.** Same vocabularies.
- We are **not** building the additional "#2" school filters yet — the registrar will specify them after the rebuild. The design only reserves the slot.
- Parent/public-facing calendar rendering is out of scope (this is the admin surface only).

## 4. The operational model

### 4.1 Two concepts

- **Day status** — every in-term weekday is **Open** or **Closed**.
  - *Open* = school in session, attendance taken. Sub-state: **in-school** or **HBL** (taught remotely, still counts/encodable).
  - *Closed* = no attendance. Carries a **reason**: Public holiday · Term break · School holiday · No class.
- **Events** — dated annotations that do **not** change open/closed status: label + **category** (term exam, start of term, parents' dialogue, subject week, school event, PFE, PTC, other) + level + tentative.

> **Note — closure reason vs event category are different fields.** Closure reason maps to `school_calendar.day_type` (drives attendance). Event category maps to `calendar_events.category` (informational). The UI gives both a consistent "category chip" visual language, but they remain distinct underneath. The spec never merges them.

### 4.2 Mapping to existing storage (no migration)

`school_calendar.day_type` + `hbl_overlay` ⇄ the Open/Closed UI:

| UI state | `day_type` | `hbl_overlay` | Encodable? |
| --- | --- | --- | --- |
| Open · in-school | `school_day` | false | ✅ |
| Open · HBL | `hbl` | false | ✅ |
| Closed · Public holiday | `public_holiday` | false | ❌ |
| Closed · Term break | `no_class`¹ | false | ❌ |
| Closed · School holiday | `school_holiday` | false | ❌ |
| Closed · School holiday + attendance (HBL overlay) | `school_holiday` | true | ✅ |
| Closed · No class | `no_class` | false | ❌ |

¹ **Open decision (D1):** "Term break" currently has no dedicated `day_type`. Two options: (a) reuse `no_class` as the closed reason and rely on the `calendar_events` `term_break` category for the labelled band; (b) treat break dates as the gap *between* term windows (no row at all). See §7.

`calendar_events` is unchanged: `term_id`, `start_date`, `end_date`, `label`, `category`, `audience`, `tentative`.

### 4.3 Edit-by-exception interaction

Default state needs no input — the page already auto-seeds every in-term weekday as `school_day` (`ensureTermSeeded`, idempotent). The registrar only touches exceptions.

Clicking a day opens **one sheet** (replaces today's `DateActionDialog` + day-type cycle + separate event dialogs):

```
Mon, 15 Sep 2026
 Status:  (●Open)  ○Closed          □ HBL (taught remotely)
 If Closed → Reason: [ Public holiday ▾ ]
            (Public holiday · Term break · School holiday · No class)
 Events on this day:
   ● Term 1 Exam   (Exam)          ✎  🗑
   [ + Add event ]
 Applies to:  (●All)  ○Primary  ○Secondary
```

- **Open/Closed** writes the corresponding `day_type` (table above) via the existing `POST /api/attendance/calendar`.
- **HBL** checkbox: on Open toggles `school_day`↔`hbl`; on Closed+School-holiday toggles `hbl_overlay`.
- **Applies to** = audience scope (All/Primary/Secondary), writing to the same per-level rows as today.
- **Events** add/edit/delete via existing `…/calendar/events` routes.

## 5. Views & filters

### 5.1 Scope of data

The calendar loads the **whole current AY** (all terms aggregated), so Month/Week/Day/List navigate **continuously across the year** rather than being trapped in one term. Each date resolves to its containing term for editing. **Between-term break dates** (outside every term window) render as a read-only "Term break" band derived from the term boundaries — not editable as `school_calendar` rows (they have no `term_id`); the registrar labels a break via an event on the adjacent in-term dates or via D1. The **Term view** focuses a single term (today's full-term strip).

> This is the key scope decision (D2). Alternative: keep strictly term-scoped (simpler, reuses current per-term fetch) and let only List span terms. Recommended: AY-wide, phased (see §8).

### 5.2 Views (one segmented switcher)

| View | Purpose |
| --- | --- |
| **Month** (default) | Mon–Fri grid, current month; the everyday editing surface. |
| **Week** | Single Mon–Fri week, larger cells, more event detail. |
| **Day** | One day, full event list + status — good for dense days. |
| **Term** | Full-term Mon–Fri strip (existing `TermStripView`), one term. |
| **List** | Chronological table of closures + events; pairs with date-from/to; CSV-friendly later. |

Weekends remain non-rendered (not school days) across all grid views, consistent with today.

### 5.3 Filter bar (one popover, extensible)

| Filter | Behavior |
| --- | --- |
| **Date range** (from / to) | Bounds List + scopes grid navigation. |
| **Category** (multi-select, color swatches) | Selecting highlights matching events with their category color and dims the rest. |
| **Level** (All / Primary / Secondary) | Filters per-level rows + events; the lens for adding/tracking level-specific events. |
| **Status** (Open / Closed) | Show only open or only closed days. |
| **Tentative** (toggle) | Show only un-confirmed events (today's "Tentative only"). |
| **…#2 (TBD)** | Reserved slots via a filter registry; registrar specifies after rebuild. |

Filters are declared in a single `CALENDAR_FILTERS` registry (id, label, type, predicate) so adding one is a registry entry + a control, not new wiring.

## 6. Component architecture

Replace the monolith with focused units under `components/attendance/calendar/`:

```
calendar-admin-client.tsx     orchestrator — owns view + filter + selection state; renders toolbar, active view, sheets
calendar-toolbar.tsx          [view switcher] [Filters ▾] [+ Add ▾]
calendar-filter-bar.tsx       the filter popover, driven by the filter registry
day-action-sheet.tsx          the single edit-by-exception sheet (§4.3)
event-editor-dialog.tsx       create/edit a calendar_events row
views/month-view.tsx
views/week-view.tsx
views/day-view.tsx
views/term-view.tsx           (lift-and-shift of today's TermStripView)
views/list-view.tsx
calendar-cell.tsx             shared day cell (status tint + event chips + badges)
legend.tsx                    status + category legend
hooks/use-calendar-index.ts   byDate / eventsByIso / audience-badge memoized indexes (lifted from today's component)
hooks/use-calendar-filters.ts filter state + predicate application
```

- Existing `copy-from-prior-ay-dialog.tsx` is reused as an item under `[+ Add ▾]` / an "Actions" affordance.
- Server read helpers (`lib/attendance/calendar.ts`) extend from per-term to **per-AY** aggregation (new `getSchoolCalendarForAy` / `getCalendarEventsForAy` composing the existing per-term readers); existing per-term helpers stay for other callers.
- Mutation API routes (`/api/attendance/calendar`, `/api/attendance/calendar/events`) are **unchanged**.

## 7. Attendance-preservation guarantee

The attendance grid and daily writer read `school_calendar` via `isEncodableDayType(day_type, hbl_overlay)` and `getEncodableDatesForTerm`. Because the redesign:

- writes the **same `day_type` + `hbl_overlay` values** (§4.2 table),
- keeps per-level `audience` rows and precedence,
- changes **no** API route or schema,

…the encodable-dates allowlist is byte-for-byte unaffected. This is an invariant the implementation must hold; it is covered by a test (see §9).

## 8. Phasing

Built in reviewable chunks, each independently shippable:

- **Phase 1 — Foundation + Month/List.** File split; `use-calendar-index` + `use-calendar-filters`; per-AY read helpers; `day-action-sheet`; Month + List views; filter bar (date range, category, level, status, tentative); legend. Term-scoped fallback acceptable if AY-wide aggregation slips.
- **Phase 2 — Week/Day/Term views** on the shared cell + index.
- **Phase 3 — AY-wide continuous navigation + break bands** (if not already in Phase 1) and filter-registry polish for the #2 filters.

## 9. Testing

- **Invariant test (critical):** for a representative term, the set of encodable dates produced by `getEncodableDatesForTerm` is identical before and after the redesign for the same underlying rows. (Pure data check — no UI.)
- **Mapping test:** the Open/Closed/HBL ⇄ `day_type`/`hbl_overlay` table (§4.2) round-trips in both directions.
- **Filter predicate tests:** each filter in the registry includes a pure predicate with unit tests (category highlight, level, status, tentative, date range).
- **Manual happy-path** per `workflow.md`: configure a closure, add an event, switch all five views, apply each filter, verify the attendance grid for that term still renders the same encodable days.

## 10. Design-system compliance

All JSX conforms to `docs/context/09-design-system.md` + `09a-design-patterns.md` (Hard Rule #7): tokens only, shadcn primitives first, status colors via the §9.3 recipes, one primary action per view. The `ui-ux-pro-max` skill is invoked before writing frontend code (per `always-do-first.md`). Category/status colors continue to use the `ChartLegendChip` palette so cell chips and the legend match 1:1.

## 11. Open questions / decisions

- **D1 — Term break storage. [DECIDED 2026-06-04]** Gap-derived read-only band for display + an explicit labelled `term_break` *event* for the break, since break dates have no `term_id`.
- **D2 — AY-wide vs term-scoped data scope (§5.1). [DECIDED 2026-06-04]** AY-wide continuous navigation, phased (term-scoped fallback acceptable for Phase 1).
- **D3 — The "#2" school-related filters.** Deferred to the registrar after the rebuild; filter registry reserves the slot.
- **Multi-select bulk classify** — keep (as a lighter affordance, e.g. range/shift-click within a view) or drop? Leaning: keep a minimal range-apply in the day sheet's scope rather than a separate mode. Resolve in the plan.
```
