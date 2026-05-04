# Design — academic year + school calendar redesign

> **Status:** Approved 2026-05-04. Implemented in Sprint 31. Migration 037 + KD #13 / #50 / #76. AY label sweep + UI audience tab + typed event categories + tentative-flag carry-forward dialog.

## Context

Two coupled gaps surfaced together:

1. **AY semantics drift.** HFSE's academic year runs January through November of a single calendar year. AY2026 = calendar 2026, NOT a 2025–2026 split. The AY-code format was already single-year (`^AY[0-9]{4}$`, KD #53), but the *labels* leaked a year-range framing in three places (seed.sql, `lib/academic-year.ts` docstring, `04-database-schema.md`), and one walkthrough doc self-contradicted ("AY2026 = 2026-2027").

2. **Calendar gaps.**
   - No primary/secondary segregation. The `school_calendar` and `calendar_events` tables both lacked an audience column — every entry applied to every section.
   - No typed event taxonomy. `calendar_events` had only a free-form `label` column, so PFE events, term exams, parents dialogue, subject weeks, etc. couldn't be filtered or color-coded.
   - No carry-forward affordance for events. The legacy "Copy holidays from [prior AY]" dialog only handled `school_calendar` rows.

The user explicitly flagged that they didn't yet know which events are static across AYs vs tentative. The design accommodates that uncertainty by deferring to the registrar via a `tentative` flag.

## Locked decisions

1. **AY label** — `"Academic Year 2026"` (single-year, Jan–Nov). All laggards fixed in the same change.
2. **Audience scope** — `audience` enum on both tables: `all | primary | secondary`. No `level_codes[]` array. UI exposes a Primary/Secondary/All filter. Preschool deferred — preschool sections fall back to `audience='all'` and we extend the enum later if needed.
3. **Event taxonomy** — keep KD #50's 5 day-types unchanged (they're the attendance gate). Add a `category` enum on `calendar_events`: `term_exam | term_break | start_of_term | parents_dialogue | subject_week | school_event | pfe | ptc | other`.
4. **Carry-forward** — manual copy-from-prior-AY only. No template table, no auto-copy on AY creation. Existing `copy-holidays-dialog` renamed + expanded to handle `calendar_events` with the new fields. Default `markTentative=true` on every copied row.

## What shipped

### Migration 037 (`037_calendar_audience_and_categories.sql`)
- `school_calendar`: + `audience text NOT NULL DEFAULT 'all'` with `CHECK audience IN ('all','primary','secondary')`. Unique key widened from `(term_id, date)` → `(term_id, audience, date)`. New index `school_calendar_term_audience_date_idx`.
- `calendar_events`: + `audience` (same CHECK) + `category text NOT NULL DEFAULT 'other'` with CHECK over the 9 categories + `tentative bool NOT NULL DEFAULT false`. New index `calendar_events_term_audience_idx`.
- Backfill: every existing row receives the safe defaults; legacy AYs work unchanged.

### Schemas (`lib/schemas/attendance.ts`)
- `AUDIENCE_VALUES` + `Audience` type.
- `EVENT_CATEGORY_VALUES` + `EventCategory` type + `EVENT_CATEGORY_LABELS`.
- `SchoolCalendarUpsertSchema` gains `audience`.
- `CalendarEventCreateSchema` gains `category`, `audience`, `tentative`.
- `CalendarEventUpdateSchema` (new — for PATCH).
- `CopyFromPriorAyPayloadSchema` (new — bulk copy with year-shift already applied client-side; default `markTentative=true`).

### Helpers
- `lib/sis/levels.ts::levelTypeForAudienceLookup(levelOrCode)` — returns `'primary' | 'secondary' | null`. Preschool returns `null` (callers query only `audience='all'`).
- `lib/attendance/calendar.ts` — every read helper takes an `audience` param. `listHolidaysForPriorTerm` generalized → `listPriorAyEntriesForCopy` (returns both holidays + events).

### Attendance gate
- `app/api/attendance/daily/route.ts` resolves the section's level via `levelTypeForAudienceLookup`, queries `audience IN ('all', $level_type)` with `audience = $level_type` taking precedence (`ORDER BY (audience = $level_type) DESC LIMIT 1`).
- `blockCache` key widened to `(termId, date, levelType)`.
- KD #50 remains binding — only the 5 existing day-types gate attendance.

### API routes
- `POST /api/attendance/calendar` — accepts `audience` (default `all`); upsert uses `onConflict: 'term_id,audience,date'`.
- `DELETE /api/attendance/calendar` — accepts `audience` query param (default `all`).
- `POST /api/attendance/calendar/events` — accepts `category`, `audience`, `tentative`.
- `PATCH /api/attendance/calendar/events` (new) — partial update; powers the "Confirm dates" affordance (flips `tentative=false`).
- `POST /api/attendance/calendar/copy-from-prior-ay` (new) — bulk copy of school_calendar overrides + calendar_events with `markTentative` flag.

### UI
- `/sis/calendar` page — reads `?audience=` URL param and threads it through.
- `CalendarAdminClient` — audience filter tab strip (`All | Primary | Secondary`), per-cell precedence rendering, "P"/"S" corner badge for overrides when filter='all', "Tentative only" toggle, "Reset to All" affordance in the date dialog when an override is selected.
- `AddEventDialog` — adds Category + Audience selects + Tentative checkbox.
- `DateActionDialog` — "Set as important date" mode now picks category + tentative; audience inherits the active filter.
- `EventsPanel` — renders category badge + audience badge + tentative badge + "Confirm dates" button.
- `EventChip` — colors itself per `EVENT_CATEGORY_LEGEND_COLOR`; tentative events render with reduced opacity + dashed border.
- `CopyFromPriorAyDialog` (new, replaces `copy-holidays-dialog.tsx`) — two tabs (overrides + events), year-shift, default `markTentative=true`.

### AY label sweep
| File | Change |
| --- | --- |
| `supabase/seed.sql:8` | `'Academic Year 2025-2026'` → `'Academic Year 2026'` |
| `lib/academic-year.ts:40` | docstring example → single-year |
| `docs/context/04-database-schema.md:33-34` | `(covers 2025-2026)` → `(Jan–Nov of the named calendar year)` |
| `sis-walkthrough.md:466` | `"AY2026 = 2026-2027"` → `"AY2026 = calendar year 2026 (Jan–Nov)"` |
| `docs/context/18-ay-setup.md` | one-liner: AY{YYYY} = calendar year {YYYY}, Jan–Nov |
| `.claude/rules/key-decisions.md` KD #13 | extended with single-year framing |

### KDs
- KD #13 — extended with single-year framing.
- KD #50 — extended with audience-precedence rule.
- **KD #76 (new)** — Calendar audience scope + typed event categories. Documents the migration 037 schema, the KD #50 day-type-untouched principle, the carry-forward UX, and the deferred preschool scope.

## Verification

End-to-end smoke test (per `docs/sprints/development-plan.md` workflow):

1. Migration applies cleanly on production-like data.
2. `npx next build` clean.
3. Existing AYs' calendars still render (every row visible at `audience='all'` filter).
4. `/sis/calendar` happy path: switch to Primary, click a school_day to set HBL → primary override row inserts; the 'all' row stays as school_day. Add an event with category=term_exam — only Primary + All filters show it (with "P" badge in All view).
5. Tentative toggle: create an event with `tentative=true`; confirm dashed/dimmed render; "Tentative only" toggle filters to it; "Confirm dates" button flips `tentative=false`.
6. Attendance gate: primary section + primary HBL override → encodable. Secondary section same date + 'all' school_day → encodable. Primary `public_holiday` override → primary 409s, secondary accepts.
7. Carry-forward: from a fresh AY with no calendar entries, `Copy from prior AY` dialog shows both day-type overrides + events tabs; default `markTentative=true`; copied rows render dashed/dimmed.
8. Preschool fallback: YS-L section reads only `audience='all'` rows.

## Files touched

- `supabase/migrations/037_calendar_audience_and_categories.sql` (new)
- `lib/sis/levels.ts`
- `lib/attendance/calendar.ts`
- `lib/schemas/attendance.ts`
- `lib/academic-year.ts`
- `app/api/attendance/daily/route.ts`
- `app/api/attendance/calendar/route.ts`
- `app/api/attendance/calendar/events/route.ts`
- `app/api/attendance/calendar/copy-from-prior-ay/route.ts` (new)
- `app/(sis)/sis/calendar/page.tsx`
- `components/attendance/calendar-admin-client.tsx`
- `components/attendance/copy-from-prior-ay-dialog.tsx` (new — replaces `copy-holidays-dialog.tsx`)
- `supabase/seed.sql`
- `sis-walkthrough.md`
- `docs/context/04-database-schema.md`
- `docs/context/16-attendance-module.md`
- `docs/context/18-ay-setup.md`
- `.claude/rules/key-decisions.md` (KD #13 + #50 + new #76)
- `.claude/rules/project-layout.md`
