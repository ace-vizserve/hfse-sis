# Levels & Grade Progression — Design Spec (SIS Admin redesign, sub-project 1)

**Date:** 2026-07-11 · **Umbrella:** `2026-07-11-sis-admin-redesign-umbrella.md` (decision 1 + 2) · **Status:** user-approved design, spec for implementation planning.

## Purpose

Make grade levels a first-class, registrar-manageable entity: a permanent core (P1–S4) plus volatile levels (Cambridge, Youngstarters) that can be offered or shelved per year, an explicit progression chain the admissions portal reads to pre-select "next level" for returning students, and demand signals when applicants name a level that isn't offered. Config only — no promotion automation (keeps KD #127's stance; extensible later).

**Research anchors (existing-SIS benchmark):** openSIS's per-level "Next Grade" pointer; PowerSchool's catalog-vs-offered-at-school split; Gibbon's sequence-for-display-only; all four surveyed products model parallel programs (Cambridge) as separate level rows, never a `track` column; progression exposed as a suggested default, never a mutation trigger.

## Current state (facts)

- `levels` is global, 15 rows (YS-L/J/S preschool · P1–P6 primary · S1–S4 secondary · CS1/CS2 secondary), columns `id/code/label/level_type` only (migrations 001, 029, 077 label-unique). No sort column — display order is the hardcoded `LEVEL_CODES` tuple in `lib/sis/levels.ts`.
- FK consumers (`on delete restrict`): `sections.level_id`, `subject_configs.level_id`, template tables, evaluation legacy tables.
- `levelApplied` is free text (max-80) at intake; validated against `levels.label` only at class-assignment (`lib/sis/class-assignment.ts:78-85` via `canonicalizeLevelLabel`).
- Weight defaults (primary 40/40/20, secondary 30/50/20) are scattered: `seed.sql`, three seeders, `subject-config-edit-dialog.tsx` prefill, `weight-profile.tsx` classifier. KD #4: actual weights live per (subject × level × AY) in `subject_configs` — that stays.
- Portal API pattern: `app/api/parent/v2/*` — OPTIONS + `corsHeaders` allowlist + IP/user rate limits + Bearer verified via `service.auth.getUser`. No public endpoints exist.
- No levels admin UI exists; closest analog is the global Subjects catalog (`app/(sis)/sis/admin/subjects` + its catalog API route).

## Design

### 1. Schema — migration 078

- `levels` gains:
  - `sort_order smallint NOT NULL` — backfilled from the current `LEVEL_CODES` order; display-only concern.
  - `next_level_id uuid NULL REFERENCES levels(id)` — the progression pointer. NULL = terminal or not-yet-defined.
  - `is_core boolean NOT NULL DEFAULT false` — true for P1–P6, S1–S4. Core levels cannot be deactivated or deleted and are always offered.
- New `ay_level_offerings (academic_year_id uuid FK, level_id uuid FK, UNIQUE(academic_year_id, level_id))` — **volatile levels only**; a row means "offered this AY." Core levels never need rows. Backfill: for each existing AY, insert offerings for volatile levels that have sections in that AY.
- Seeded chain: YS-L→YS-J→YS-S→P1→P2→…→P6→S1→S2→S3→S4(→NULL); CS1→CS2(→NULL until HFSE decides).
- `create_academic_year` RPC re-emitted **from its newest live body** (KD #119 hazard) to copy the source AY's volatile offerings into the new AY.
- No weight columns — profiles stay derived from `level_type`, centralized in code (below).
- `levelApplied` storage unchanged (free text at intake; class-assignment validation unchanged).

### 2. Data layer

- `lib/sis/levels.ts` becomes DB-backed for anything dynamic: a cached loader (service client + `unstable_cache`, tag `levels`) returning ordered level rows (code, label, type, sort_order, next_level_id, is_core). The existing 15-code constants remain as compile-time fallbacks/types; `canonicalizeLevelLabel`/`compareLevelLabels` gain DB-aware variants where consumers need dynamic levels. **This is the riskiest change** — consumers of the hardcoded tuple are audited and switched deliberately, not blanket-replaced.
- New `lib/sis/level-profiles.ts`: single source for the type→weights default map (`primary: 40/40/20`, `secondary: 30/50/20`), consumed by the seeders, the subject-config prefill, and `weight-profile.tsx`'s classifier vocabulary.
- Demand signal: pure helper deriving, for the application-accepting AY, distinct `levelApplied` labels (canonicalized) with applicant counts, joined against offered levels — flags counts on un-offered/unknown labels. Unit-tested.
- Mutations: `PATCH /api/sis/admin/levels/[id]` (label, sort_order, next_level_id), `POST /api/sis/admin/levels` (volatile create: code, label, type, position, next), `DELETE` (volatile only, FK-protected), `PUT /api/sis/admin/levels/[id]/offering` (toggle per AY). All `requireRole(['school_admin','superadmin'])`, zod-validated, audit actions `level.create` / `level.update` / `level.delete` / `level.offering.toggle` with humanizer labels.

### 3. UI — `/sis/admin/levels` ("Grade levels")

Modeled on the Subjects catalog page (role gate, audit, layout patterns; design system 09/09a binding):

- Ordered list (by `sort_order`): code badge · label · type chip · weight-profile chip (from `level-profiles.ts`) · **Next level** dropdown (nullable, all levels selectable, self excluded) · **Core** badge (P1–S4) or **Offered this year** toggle (volatile; AY switcher as on the subjects page) · demand chip when applicants name this level while un-offered ("4 applicants chose CS1 — not offered in AY2026").
- Actions: **Add level** (volatile: code, label, type, position, next level), inline edit, deactivate/delete volatile (blocked with a plain-English message when history exists — the FK restricts anyway), reorder.
- Mental model stated on-page (umbrella principle): one line explaining core-vs-volatile and that "Next level" only suggests — it never moves students.
- Sidebar: "Grade Levels" under the SIS Organisation group; command-palette entry.

### 4. Portal read contract

`GET /api/parent/v2/levels` — mirrors the sibling routes exactly (OPTIONS + `corsHeaders`, IP + per-user rate limits, Bearer via `service.auth.getUser`). Returns, for the application-accepting AY (`getUpcomingAcademicYear()` ?? current):

```json
{
  "ayCode": "AY2027",
  "levels": [
    {
      "code": "P3",
      "label": "Primary Three",
      "type": "primary",
      "sortOrder": 6,
      "nextCode": "P4",
      "offered": true
    }
  ]
}
```

The portal uses `nextCode` to pre-select the next level for returning students. Bearer-gated deliberately — no public-endpoint precedent is created for reference data.

## Out of scope (deferred)

Promotion/rollover automation (KD #127 stance holds); admissions-dashboard demand widgets (sub-project 4 territory); preschool grading (unchanged, `level_type='preschool'` still excluded from markbook); any change to `levelApplied` intake validation.

## Phases (with checks)

1. **Schema + seed** — migration 078 (columns, offerings table, backfills, chain seed, `create_academic_year` re-emit from newest body). _Check:_ migration applies to dev DB; existing suites green; tsc clean.
2. **Data layer** — DB-backed level loader, `level-profiles.ts` centralization, demand-signal helper, admin API routes, portal endpoint. TDD the pure helpers. _Check:_ unit tests + task review.
3. **UI** — the Grade levels page + nav/palette wiring + demand chips. _Check:_ `next build`, design-system pass, task review.
4. **Integration + docs** — AY-creation offering copy verified end-to-end on the test env; KD #153 entry + index row; sync-docs; whole-branch review. _Check:_ full suite + build + final review verdict.

## Verification

- Unit: profiles map, demand-signal helper, chain integrity (no self-reference; cycles rejected in the PATCH route), offering toggle idempotence.
- E2E happy path on AY9999: create a volatile level, set its next pointer, toggle it offered, see it in section-creation level choices and in the portal endpoint payload; confirm demand chip appears when a seeded `levelApplied` names an un-offered level.
- `create_academic_year` on a fresh test AY copies offerings; KD #119 regression grep (RPC re-emitted from newest body, no dropped columns).
