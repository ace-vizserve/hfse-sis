# Manual Section Assignment — Design

**Date:** 2026-07-20 · **Audience:** dev follow-up (implementation plan)

> **PARTLY SUPERSEDED (2026-08-05, KD #180).** This spec's core rule — **no auto-pick anywhere, the registrar always chooses** — still holds and is unchanged. What no longer holds is the requirement that a section be chosen **at the moment of the Enrolled flip**: HFSE's admission process makes Enrolment step 10 and Class Assignment step 11, done separately by Student Affairs. `section_id` is now optional on that flip, and supplying it requires a placement role. Read the rest of this document with that one substitution in mind.

## Problem

`class-assignment.ts::pickSectionForApplicant` auto-assigns a section on the Enrolled-status flip, scoring candidate sections primarily on `classType`/`preferredSchedule` match and using load only as a tiebreaker. Real grading-sheet data shows HFSE doesn't evenly fill a section toward the 50-student cap before a second section at the same level starts receiving students — the auto-pick gives the registrar no visibility into section state and no say in the outcome, and the scoring heuristic doesn't actually optimize for the balance HFSE wants in practice.

Separately, three different places in the codebase assign a section, each doing it differently: the stage route's silent auto-pick-and-write (Enrolled flip), the `/records/unsynced` recovery dialog (already manual, already shows live counts, but a private one-off implementation in `records-lite-page.tsx`), and — per the sibling level-alias reconciliation spec (`2026-07-18-admissions-level-alias-reconciliation-design.md`) — a planned auto-retry that would have become a third variant.

## Goals

- Every section assignment is a registrar decision, made with full visibility into each candidate section's current headcount.
- One shared implementation (candidates loader + picker UI + write path) used everywhere a section gets assigned — not three separate ones.
- Section creation is reachable inline from the assignment flow, without navigating away.
- Every assignment stays audit-logged (already true via the existing write route).

## Non-goals

- No auto-pick, no scoring/ranking heuristic. The system's job is to show state; the registrar decides. This deliberately removes `pickSectionForApplicant`'s `classType`/`preferredSchedule` match-scoring entirely — not "improve the algorithm," but remove it.
- No change to the 50-student hard cap (Hard Rule #5) — sections at capacity are still excluded from the candidate list, same as today.

## Architecture

### 1. Shared candidates loader

A DB-backed function (home: `lib/sis/class-assignment.ts`, replacing the scoring logic it currently holds) —

```
listAssignableSections(service, ayCode, levelId): Promise<AssignableSection[]>
```

returns `{ id, name, activeCount, classType, schedule }[]`, excluding sections already at the 50-cap, sorted by `activeCount` ascending (surfaces the least-filled section first — the most decision-relevant default for manual balancing, without forcing anything). This generalizes the query `records-lite-page.tsx::loadAvailableSections` already does privately today; that private version is deleted once the shared one exists.

### 2. Shared picker component

One `'use client'` component (e.g. `components/sis/section-assignment-picker.tsx`) rendering: the section list with live "N / 50" counts, `classType`/`schedule` as plain informational chips (context for the registrar's judgment, not used to sort or rank), a "Create new section" affordance, and a Confirm action. Mounted in three places:

- **Enrolled-flip** — inside the class-stage edit flow. Reaching the class stage no longer auto-computes and writes a section; the picker becomes part of that same confirm step, and the registrar's choice is a required input before the flip commits.
- **`/records/unsynced` recovery** — replaces the private dialog in `records-lite-page.tsx` with the shared component.
- **Level-alias reconciliation** (sibling spec) — no special integration needed. Once a saved alias makes a student's level resolvable, that student simply becomes a normal "level known, section not yet assigned" row — which is exactly what `/records/unsynced` already detects and lists. They get assigned through this same canonical picker, no separate code path.

### 3. Section creation, inline

Reuses whichever route SIS Admin's own section-creation flow already calls (to be confirmed by grep during the implementation plan — likely under `/sis/sections` or the per-AY application of the class template, KD #66/#144). Rendered as a compact inline form within the picker (matching this codebase's existing inline-vs-drawer-vs-modal convention for a small, single-object create action) rather than a page navigation. The newly-created section appears in the candidate list immediately.

### 4. Write path

Always `POST /api/sis/students/[enroleeNumber]/assign-section` (KD #90) — unchanged, becomes the single write path for section assignment everywhere instead of one of two. It already does the admissions-side update, `syncOneStudent`, audit-logging (`sis.student.assign_section`, already exists — no new audit action needed), and rollback-on-failure.

`pickSectionForApplicant`'s scoring + auto-write logic is deleted from `class-assignment.ts`. The class-stage route's Enrolled-flip PATCH stops computing a pick server-side; it requires the client to supply the registrar-chosen `section_id`, which the server validates (exists, correct level + AY, still under the 50-cap at write time — a second student could have filled it between page-load and confirm) before committing.

## Interaction with the level-alias reconciliation spec

This simplifies that spec's Section 4 ("Save + retry"). Saving an alias no longer needs to auto-re-run assignment for affected students — it only needs to make their level resolvable. They then surface (or continue to surface) via `/records/unsynced` like any other student missing a section, and get assigned through this same canonical picker. The retry-loop / partial-failure-summary logic drafted in that spec's Section 4 is removed; its "Open questions" note about sync-vs-async retry no longer applies. (This edit is applied directly to that spec file alongside this one.)

## Testing

- `listAssignableSections` — DB-backed; manual verification (matches every other DB-backed piece in this repo — no live-DB test harness exists here).
- Deleting `pickSectionForApplicant`'s scoring: grep for existing test coverage of that function before removing it, and delete/update accordingly rather than leaving a dangling test against removed code.
- The picker component + `assign-section` route: manual verification across all three mount points (Enrolled-flip, unsynced recovery, a post-alias-resolution student).
