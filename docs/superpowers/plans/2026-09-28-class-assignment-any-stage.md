# Class assignment at any stage; the roster waits for Enrolled

2026-09-28. Mr Ace + Miss Apple.

> ⚠ **SUPERSEDED THE SAME DAY — class assignment is ENROLLED-ONLY.** Miss
> Apple's "editable anytime" turned out to mean the Application preferences
> (level / class type / schedule from the parent form), not the class. Asked
> directly: _"yes po need enrolled na po before namin ma-assign manually yung
> section"_ — Ms Lala assigns it in the old enrolment system once a child is
> fully enrolled, and they want that done in the SIS. So the "choose a class
> before Enrolled" mode (Phase 2 step 1, the Phase 4 choose states) and the
> "Class chosen, not enrolled" cohort were removed before deploy. Everything
> else below shipped: the Enrolled gate in the sync, the seat count (Directus
> can still set a class early), the flip check, the class-stage guard, the
> nightly sync across years, and the in-place "Assign a class" for Enrolled
> children.

## Why

Admissions keep placing children in Directus because the SIS Class Assignment
tile on `/admissions/applications/[enroleeNumber]` has no control — it reads
"Assigned in Records" — and the assign route refuses anyone not Enrolled.
Directus has none of the SIS checks (level match, class size, the class must
exist, enrollment date, late-enrollee check), so its placements arrive broken
("Year 8", "Discipline-1", sections missing in the SIS).

Miss Apple (procedure): the class **is editable at any time**, pre-filled from
the old enrolment link like other fields, and editable from the SIS.

Mr Ace: every side effect of early placement goes away **as long as the
student is enrolled** before they join the roster.

## The rule

- A class can be **chosen** at any application status except Cancelled /
  Withdrawn. Choosing writes only the admissions row
  (`classLevel`, `classSection`, `classStatus='Finished'`, class updated
  date/by). No `students` / `section_students` row, no index number, no
  enrollment date.
- A child **joins the class** (roster row, index number, start date,
  late-enrollee check) only when the application is `Enrolled` or
  `Enrolled (Conditional)`. Whatever tool set the class (SIS, Directus, old
  enrolment link).
- A chosen class **holds a seat**: the 50-cap and the picker's counts include
  children who chose that class but are not on its roster yet (non-terminal
  status).
- Children already on a roster are never removed or changed by this work
  (the ~15 AY2026 in-class-but-Submitted children stay as they are).

## Phase 1 — roster entry requires Enrolled (server)

1. `lib/sync/students.ts::syncOneStudent`: after the Cancelled/Withdrawn
   guard, refuse when `applicationStatus` is not in `ENROLLED_STATUSES`
   (`lib/schemas/enrolment.ts`) with a stable exported reason constant
   (e.g. `NOT_ENROLLED_REASON = 'not enrolled yet'`). Must not alter a child
   already on the roster.
2. Every other admissions → roster path must obey the same rule. Find them
   all: `grep -rn "fetchAdmissionsRoster\|buildSyncPlan\|syncOneStudent" app lib`.
   `lib/supabase/admissions.ts::fetchAdmissionsRoster` currently admits any
   non-terminal status. BEFORE filtering it, read `buildSyncPlan` and confirm
   what it does to a rostered student who is absent from the input rows. If it
   would withdraw/alter them, do not simply filter the fetch — instead stop the
   plan from creating NEW enrolments for non-Enrolled rows while leaving
   existing ones exactly as today. Report which you did and why.
3. `app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route.ts`: the
   post-save sync (~line 800–880) must treat `NOT_ENROLLED_REASON` as an
   expected outcome (not `autoSyncFailed`) — setting the class stage on a
   Submitted child is now legal and means "chosen, waiting".
4. Tests (vitest, explicit `import { describe, it, expect } from 'vitest'`):
   sync refuses Submitted/Processing with the constant; still syncs Enrolled
   and Enrolled (Conditional); bulk path does not newly enrol a Submitted row
   and does not touch an existing rostered one.

Gate: targeted tests pass, `npx tsc --noEmit` clean.

## Phase 2 — choosing a class before Enrolled; seats; the flip (server)

1. `app/api/sis/students/[enroleeNumber]/assign-section/route.ts`:
   - Non-terminal, not-Enrolled status → **choose mode**: validate with
     `validateSectionChoice` (level match + capacity incl. chosen seats,
     excluding this child's own seat), write the admissions class columns,
     do NOT sync, do NOT `completePlacement`. Audit action
     `sis.student.choose_section` with before/after class. Response carries
     `{ mode: 'chosen', sectionName, levelLabel }`.
   - Choose mode may **overwrite** an existing chosen class (change of mind).
   - Enrolled → unchanged behaviour (place / resync), response
     `{ mode: 'placed', ... }`.
   - Cancelled / Withdrawn → 422 as today.
   - Update the header comment accordingly.
2. Seats held by a chosen class — one helper in `lib/sis/class-assignment.ts`
   used by BOTH `validateSectionChoice` and `listAssignableSections` so the
   picker and the cap agree: count admissions status rows for the section's AY
   whose classLevel resolves to the section's level and whose classSection
   matches the section name (use the same normalizer the sync uses, so
   "Discipline-1" = "Discipline 1"), status not Cancelled/Withdrawn, and whose
   studentNumber is NOT already on that section's roster (those are counted in
   the roster number). Add `chosenCount` to `AssignableSection`; `isAtCapacity`
   = `activeCount + chosenCount >= 50`. Optional `excludeEnroleeNumber`.
3. The Enrolled flip (stage route, `application` → Enrolled/Conditional) with
   NO `section_id` but a class already chosen on the row: before writing,
   resolve that chosen class to an SIS section and run `validateSectionChoice`
   (excluding this child's own seat). If the section does not exist or is full,
   refuse with 422 + a machine code (e.g. `chosen_class_unavailable`) and a
   plain message naming the class and why, so the dialog can ask for another
   class. The dialog (`components/sis/edit-stage-dialog.tsx`, inline picker
   near line 700–830) must then offer the picker so the person picks another
   class in the same save.
4. Tests: choose mode writes admissions only; overwrite; capacity counts chosen
   seats; flip refuses an unavailable chosen class; flip with a valid chosen
   class places the child.

Gate: targeted tests pass, tsc clean.

## Phase 3 — nightly safety net across years (server)

1. `app/api/sis/students/auto-sync/route.ts`: run for every in-scope AY
   (current + upcoming accepting, the same window as
   `loadUnsyncedInScope`), not just the current one. Per-AY preload; one
   audit row per AY. Schedule stays `0 15 * * *`.
2. `lib/sis/unsynced-students.ts`: for `not_synced` rows compute a plain
   `blocker` string when the class filled in (Directus / old link) cannot be
   placed: level not recognised (e.g. "Year 8"), class does not exist in the
   SIS for that year, class full. Reuse the resolvers the sync uses.
3. `components/sis/unsynced-students-queue.tsx`: show `blocker` in the reason
   cell in plain English (school admins, no jargon).
4. Tests for the blocker classification.

Gate: targeted tests pass, tsc clean.

## Phase 4 — the Class Assignment tile (UI)

Design (frontend-design pass done in the session; binding docs
`docs/context/09-design-system.md` + `09a-design-patterns.md`):

- Remove the "Assigned in Records" badge. The tile's header right slot stays
  empty (placement actions sit at the bottom, like "Change section" today).
- States, bottom of tile (`components/sis/enrollment-tab.tsx`
  `StageStatusTile`, ~line 1127–1262), gated on `canAssignSection`:

| Application                | Class              | Status line                                | Action (outline, sm)                                               |
| -------------------------- | ------------------ | ------------------------------------------ | ------------------------------------------------------------------ |
| not Enrolled, not terminal | none               | "No class chosen yet"                      | **Choose a class**                                                 |
| not Enrolled, not terminal | chosen             | "Joins {Level · Section} when enrolled"    | **Change class**                                                   |
| Enrolled                   | none               | "Awaiting class assignment"                | **Assign a class** (in place; replaces the /records/unsynced link) |
| Enrolled                   | set, not on roster | "{Level · Section} — not in the class yet" | **Assign a class** (resync)                                        |
| Enrolled                   | on roster          | existing                                   | existing **Change section**                                        |
| Cancelled / Withdrawn      | any                | as today                                   | none                                                               |

- `components/sis/assign-section-dialog.tsx`: add `mode: 'choose' | 'place'`.
  Choose mode title "Choose a class for {name}", description "They join the
  class when their application is Enrolled. No class number or start date is
  given until then." Button "Choose class", toast "Class chosen". Place mode
  unchanged. Section rows show "{active} in class" and, when > 0,
  "· {chosen} chosen, not yet enrolled"; full = active+chosen ≥ 50.
- `app/(admissions)/admissions/applications/[enroleeNumber]/page.tsx`: load
  `listAssignableSections(service, ayCode, levelApplied)` + the application
  fit when the viewer `canAssignSection` and the child is not on a roster;
  pass to the tile. Follow `docs/context/11-performance-patterns.md`
  (parallel, no waterfall).
- Plain-English copy only. Tokens only (Hard Rule #7).

Gate: tsc clean; the admissions detail page renders (RSC prop errors only
show when the page is opened — open it in dev for one Submitted and one
Enrolled AY2027 child).

## Review

A reviewer pass over the whole diff against this plan and the hard rules
before commit.
