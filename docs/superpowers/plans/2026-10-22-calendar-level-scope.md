# Calendar: one "Who is it for?" for every entry type, down to a single level

Date: 2026-10-22. Asked by Mr Ace: "I can select grade level specific and whole level or whole school, like combine the idea" + "in the select there is the option for only specific levels then the pick levels component will show".

## What changes for users

The add/edit dialog on the school calendar has ONE "Who is it for?" dropdown, the same for every type (holidays, HBL, no class, exams, school events…):

```
Who is it for?   [ Whole school        ▾ ]
                   Whole school
                   Primary
                   Secondary
                   Specific levels…
                   Specific classes…      ← informational events only

→ "Specific levels…" picked: the P1–P6 / S1–S4 chips appear below.
```

A closure for one level now works: "No class — P1" closes P1 that day; every other level is a normal school day (attendance taken, counted in days present).

## The rule (decided)

`school_calendar.audience` gains the ten level codes P1–P6, S1–S4 (one row per level). For a section on a date, the row that applies is, in order: **its level code → its band (primary/secondary) → 'all'**. YS (Youngstarters) gets no level option; it keeps matching its band ('primary') and 'all', exactly as today.

- `calendar_events.audience` stays three-valued. Events already scope by `levels` / `section_ids` (migration 158). Day and event audiences become two types: `Audience` (events, unchanged) and a new `DayAudience = Audience | LevelCode`.
- Existing rows are untouched — every one is 'all' / 'primary' / 'secondary' and reads the same.
- "Specific classes…" is offered for informational events only. No closure has ever been per-class.
- Several levels picked for a closure = one request writing one row per level per date (the POST route takes `audiences: DayAudience[]`; `audience` stays accepted for old callers).
- Primary / Secondary on an informational event = `levels: null` with that audience (the existing shape). Editing an event whose levels are exactly one band's full set shows "Primary" / "Secondary".

## Phases (each gated: tests + tsc + a reviewer pass before the next starts)

### Phase 1 — Database + the school-day rule

- Migration `196_school_calendar_level_audience.sql`: widen `school_calendar_audience_chk` to the ten codes; update the column comment; redefine `attendance_write_blocked` (latest def: migration 149) to match `sc.audience = l.code` too and rank code → band → all.
- `lib/schemas/attendance.ts`: `DAY_AUDIENCE_VALUES`, `DayAudience`, `DAY_AUDIENCE_LABELS` (codes label as the code, e.g. "P1").
- `lib/attendance/school-days.ts`: readers take the section's **level code** (`levelCode: string | null`) instead of `levelType`; band derived inside via `levelTypeForAudienceLookup`. `decideNonSchoolDay` ranks code → band → all. Checker cache key + `.in('audience', …)` include the code.
- Tests: `__tests__/attendance/school-days.test.ts` — level row beats band row beats all; a P1 closure does not close P2; YS unaffected. SQL mirror checked on the local stack (apply 196 locally, call `attendance_write_blocked` for a P1 and a P2 student on a P1-closed date).

### Phase 2 — Every reader passes the level code

From the 2026-10-22 audit (exhaustive list; each needs code, not band):

- `lib/attendance/calendar.ts` — `audienceFilterValues` (add the code; the admin 'all' view reads every code), `getDedupedSchoolCalendarForTerm` + `getEncodableDatesForTerm` (code param, three-tier rank), `isHoliday` (unused — delete), `listPriorAyEntriesForCopy`.
- `lib/attendance/queries.ts` — `countSchoolDaysByMonth` (three-tier rank), `getMonthlyBreakdown` (already has the code), `getSectionAttendanceSummary` (selects `levels(level_type)` only — add `code`).
- `lib/attendance/adviser-dashboard-queries.ts` (178, 196, 278–296).
- `app/api/attendance/daily/route.ts` (354), `lib/declarations/register.ts`, `lib/declarations/filing-window.ts` (group key), `lib/declarations/parent.ts` (expose `levelCode` on `LinkedStudent`) → `app/api/parent/v2/declarations/route.ts`, `app/api/declarations/staff/route.ts`.
- Pages / exports: `app/(attendance)/attendance/[sectionId]/page.tsx`, `.../summary/page.tsx`, `app/api/attendance/[sectionId]/export/route.ts`.
- Report card: `lib/report-card/build-report-card.ts` cache key `${termId}:${levelCode}` and the matching preload in `app/(markbook)/markbook/report-cards/section/[sectionId]/print/page.tsx`.
- Deliberately unchanged ('all' only, by design): `drill.ts`, `dashboard.ts` day-type donut + "is today a school day", `loadTermTripContext`.
- Tests: update `monthly-school-days`, `cleared-marks-adviser-dashboard`, `perf/query-budget`; add a monthly-count case with a P1-only closure.

### Phase 3 — Write routes accept levels

- `SchoolCalendarUpsertSchema`: `audience: DayAudience`, new `audiences: DayAudience[]` (1–13). Route upserts entries × audiences in one call; audit rows unchanged in shape.
- `app/api/attendance/calendar/route.ts` autofill (43–45) and DELETE (`?audience=`, 201–231) accept codes — today an unknown value silently falls back to 'all', which would delete the wrong row.
- `CopyFromPriorAyPayloadSchema.dayTypeRows[].audience` → `DayAudience`.
- Tests: route-level zod tests for the new shapes; DELETE with `?audience=P1` touches only the P1 row.

### Phase 4 — The form and the calendar screens

- `event-editor-dialog.tsx`: one "Who is it for?" Select (Whole school / Primary / Secondary / Specific levels… / Specific classes… — last one events only). "Specific levels…" reveals the existing chip rows (reuse `ScopeBand` from `event-scope-field.tsx`, export it); "Specific classes…" reveals the existing class picker. Remove the per-type split and the "no level column" comments. Default: Whole school.
- `hooks/use-calendar-index.ts`, `calendar-admin-client.tsx` (`daySheetRowsByAudience`), `day-action-sheet.tsx` (`AUDS`, labels, revert = DELETE `?audience=P1`), `views/list-view.tsx` (level column + facet), `lib/attendance/calendar-filters.ts` (`inLevel`: a P1 row passes the Primary filter), `copy-from-prior-ay-dialog.tsx` labels, `lib/audit/humanize.ts` labels.
- Sidebar Audience tabs stay Whole school / Primary / Secondary.
- Verify in the browser on the local stack myself (screenshots): add "No class — P1" for a date, open a P1 and a P2 register on that date (P1 blocked, P2 markable), check the day sheet, list view and filters.

### Phase 5 — Docs

- KD #233 in `docs/key-decisions/attendance.md` + its row in the KD index (needs Mr Ace's approval — the index is a protected rules file).
- `docs/context/16-attendance-module.md` calendar section; session-log entry.

## Shipping

Built on local `main`, which also carries the unpushed billing work. Commits touch no billing files, so they can go to `origin/main` on their own (rebuilt on top of `origin/main` with `git merge-tree`, the way the New event button fix went). Migration 196 must reach production before the code deploys. Billing's 188–195 are not on production yet; 196 does not depend on them.
