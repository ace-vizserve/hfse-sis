# Static AY Defaults — Design

**Date:** 2026-07-21 · **Audience:** dev follow-up (implementation plan)

## Problem

The just-shipped Phase 4 of the admissions-session consolidated plan (`docs/superpowers/specs/2026-07-20-remove-structure-defaults-template-design.md`) removed the "Structure Defaults" (template) admin page correctly, but replaced it with the wrong mechanism: `create_academic_year` now unconditionally **copies** a new AY's sections/subjects/weights from the most recently created prior AY. That's not what was actually wanted — a copy-forward means each new AY's starting point silently depends on whatever the previous AY happens to currently look like (including any drift, mistakes, or since-customized state), which is exactly the kind of unpredictable inheritance a fixed baseline is supposed to avoid. It's also why a "confirm you reviewed what got copied" gate seemed necessary — the outcome wasn't predictable in advance.

The correct model: every new AY starts from the **same fixed, hardcoded default** every time — a known set of sections, a known subject catalog per level, and known per-subject weights. Nothing to review, because it's always identical. The registrar's job each new AY is to **edit that starting point** (add/remove sections, attach/detach subjects, adjust weights) through the same live editing surfaces every other AY's data already uses — not to review an unpredictable copy, and not to maintain a separate admin-editable "template" system (already explicitly rejected — that's what Phase 4 removed).

A second, independent problem surfaced during this redesign: the existing section-creation route (`POST /api/sections`, used every time ANY section is created — mid-year or at AY setup) already blanket-attaches **every subject configured at that section's level** to the section the moment it's created, via `sync_section_subjects_for_ay`. This applies with zero registrar input — including both Mother Tongue languages (Filipino AND Mandarin) and, for Secondary, the full union of both curriculum tracks' subjects — on the theory that the registrar will remove what doesn't apply. That's backwards from how Mother Tongue and track subjects should actually work (per the existing `lib/sis/track-bundles.ts`'s own stated design: Mother Tongue requires a language pick only a registrar can make, and Secondary tracks determine genuinely different subject sets per section). Sections should start with **no subjects attached**, and the registrar attaches what applies — via the existing per-section tools (`applyTrackBundle`, the Section Subjects panel, the Mother Tongue language sub-choice) — not via an unconditional bulk sync.

## Goals

- A new AY, the moment it's created, has a real starting catalog: known sections (with schedules), a known subject-per-level offering list, and correct per-subject weights — ready to use, not empty, not copied from an unpredictable source.
- The registrar's only job after creation is editing that fixed baseline to fit the year — same live pages every other AY already uses (`/sis/sections`, `/sis/admin/subjects`).
- No confirmation step anywhere — nothing varies AY to AY, so there's nothing to review.
- No section — anywhere, anytime, not just at AY creation — gets subjects attached without an explicit registrar action.
- The wrong flat per-level-type weight model (`lib/sis/level-profiles.ts`) is gone, fully replaced by the already-correct per-subject-code model (`lib/sis/subjects/weight-defaults.ts`).

## Non-goals

- No new admin-editable template surface of any kind — the defaults are a fixed list baked into a migration, edited only by a developer via a future migration if HFSE's curriculum ever changes, exactly like migration 074's virtue-section list already works.
- No change to `applyTrackBundle`, the Section Subjects panel, or the Mother Tongue language sub-choice UI — all three stay exactly as they are; they become the _only_ way subjects get attached to a section (previously they were mostly redundant, since the blanket sync already did the work).
- No change to `subject_configs`'s shape (still one row per subject × AY, no level dimension — migration 080 unchanged) or to Hard Rule #1/#4's grade-computation model.
- Nothing in this spec touches a live database — as with every prior task this session, migrations are written and reviewed but application is a human's job with real credentials.

## Architecture

### 1. The fixed default data (baked directly into the migration, no new table)

**Sections** — one row per level, using HFSE's official per-level virtue names (already established by migration 074, most recently the copy-forward source for the now-deleted `template_sections`), `class_type = null` (unset — the registrar assigns Global/Standard per Secondary section when relevant), and the same schedule values migration 074 set:

| Level | Sections (name · schedule)                                           |
| ----- | -------------------------------------------------------------------- |
| P1    | Obedience · Morning, Patience · Morning, Respect · Afternoon         |
| P2    | Honesty · Morning, Humility · Morning, Gentleness · Afternoon        |
| P3    | Courageous · Morning, Courtesy · Morning, Responsibility · Afternoon |
| P4    | Diligence · Morning, Trust · Morning, Compassion · Afternoon         |
| P5    | Commitment · Morning, Tenacity · Morning, Perseverance · Afternoon   |
| P6    | Grit · Morning, Loyalty · Afternoon                                  |
| S1    | Discipline · Whole Day                                               |
| S2    | Integrity · Whole Day                                                |
| S3    | Consistency · Whole Day                                              |
| S4    | Excellence · Whole Day                                               |

**subject_level_offerings** — per-level subject applicability, verified against live AY2026 data (queried during design) with two corrections applied per explicit decision: P6 gains MANDARIN (the live data was missing it — a gap, not an intentional exclusion, per the same 7-subject core every other Primary level has); Secondary S3/S4 stays at its current real 9-subject set (no Global-track-only subjects — HFSE doesn't run Global track that far yet, and this isn't a gap to fix, just current reality):

| Level(s) | Subject codes                                                       |
| -------- | ------------------------------------------------------------------- |
| P1–P6    | CL, ENG, FIL, MANDARIN, MAPEH, MATH, SCI                            |
| S1, S2   | ARTD, CA, COMP, ENG, FIL, GP, HIST, HUM, LIT, MATH, PEH, PESTD, SCI |
| S3, S4   | CA, ENG, FIL, LIT, MATH, PEH, PESTD, SCI, SS                        |

**subjects catalog additions, no offering/weight** — ECON and CCA (from the confirmed DepEd weight table but never yet offered at any HFSE level) get inserted into the global `subjects` catalog if not already present, with **no** `subject_level_offerings` row and **no** `subject_configs` row for any AY — purely so they exist and are ready to configure later via the normal Subject Setup page, exactly like any subject a school_admin adds today.

**subject_configs (weights)** — one row per **distinct subject code actually offered somewhere** in the two tables above (not per level — `subject_configs` has no level dimension since migration 080). Values sourced from the already-correct `lib/sis/subjects/weight-defaults.ts` bucket logic, confirmed against the real DepEd Order 8 s.2015 table:

| Bucket          | Codes                                                  | WW/PT/QA |
| --------------- | ------------------------------------------------------ | -------- |
| Math/Science    | MATH, SCI                                              | 40/40/20 |
| MAPEH-family    | MAPEH, CL, CA, PEH, PESTD                              | 20/60/20 |
| Everything else | ENG, FIL, MANDARIN, HIST, HUM, LIT, SS, GP, COMP, ARTD | 30/50/20 |

`ww_max_slots`/`pt_max_slots`/`qa_max` use the same defaults the Subject Setup form's create-mode already pre-fills: 5/5/30.

(Aside, not an action item: the live AY2026 data has Christian Living's weights recorded as 40/40/20 — that's already wrong today against both the confirmed DepEd table and `weight-defaults.ts`'s own classification of CL as MAPEH-family, 20/60/20. Not something this spec fixes retroactively on the live AY — just confirms the new default uses the correct bucket, and flags the existing AY2026 row as a pre-existing data issue for the registrar to notice separately.)

### 2. `create_academic_year` — replace copy-forward with static-default seeding

Re-emit from migration 089's body (the newest live version — KD #119 hazard applies again). Remove the `v_source_ay_id` resolution and the two source-AY-copy branches for sections and subject_configs/subject_level_offerings. Replace with:

- Insert the fixed section list (Section 1 above) for the new AY, resolving each level by code.
- Insert the fixed subject_level_offerings list, resolving levels and subjects by code.
- Insert one subject_configs row per distinct subject code actually referenced by the offerings just inserted, with weights via the bucket table above (implemented as a `CASE subject_code WHEN ... THEN ...` in SQL — a second, SQL-side copy of `weight-defaults.ts`'s 3-bucket logic, since a `security definer` PL/pgSQL function can't call into TypeScript; keep the two in sync by hand, and note this explicitly in both files' comments so a future weight-bucket change is remembered on both sides).
- **Do not** call `sync_section_subjects_for_ay` (see Section 3 — that call is being removed everywhere, not just here).
- Keep everything else byte-identical to 089's body: `academic_years` upsert, `terms` insert, `create_ay_admissions_tables` call, return shape.

Drop the `structure_confirmed_at`/`structure_confirmed_by` columns added by 089 (nothing to confirm anymore).

### 3. No section ever gets subjects auto-attached

`app/api/sections/route.ts` (the standard section-creation route, the only other real caller besides the seeder): remove its `sync_section_subjects_for_ay` RPC call entirely. `applyTrackBundle` stays exactly as-is immediately after — it already only fires when the registrar explicitly supplied a `class_type` at section creation, which is a deliberate choice, not silent auto-attach. A newly-created section with no `class_type` chosen (the common Primary case, and any Secondary section the registrar hasn't tracked yet) now correctly starts with zero subjects, to be attached via the Section Subjects panel.

Once nothing in application code calls `sync_section_subjects_for_ay` (verify via grep — the seeder at `lib/sis/seeder/structural.ts` is the other known caller and needs its own decision: either stop calling it too, for seeder-fidelity with the new real behavior, or keep calling it if the seeder deliberately wants pre-populated test data for reasons unrelated to matching prod — implementer's call, flag it in the plan for a explicit decision rather than silently picking one), drop the RPC function entirely via the same migration rather than leaving it dormant — it has no historical-audit-trail reason to stay (KD #96's dormant-object precedent applies to audit _actions_, not RPCs with no callers).

### 4. Full removal of the confirmation gate

Delete: `structure_confirmed_at`/`structure_confirmed_by` columns (folded into the Section 2 migration), `POST /api/sis/ay-setup/confirm-structure` route, the `ay.structure.confirm` `AuditAction` + humanizer label (or leave the enum member as a KD #96-style dormant historical entry if any real audit rows were ever created against it — none were, since this never reached a live database, so it can be removed outright, not just left dormant), the `structure-confirmed` `ReadinessStepId`/`STEP_META` entry and its `resolveStructureConfirmedStep` resolver (renumber the remaining steps back down by one), and the checklist UI's "Confirm starting setup" row + its mutation.

### 5. `lib/sis/level-profiles.ts` — full removal

Delete the file and its test (`__tests__/sis/level-profiles.test.ts`). Fix its 3 consumers:

- `lib/sis/subjects/weight-defaults.ts` — only imports the `WeightFractions` type. Move that type definition into `weight-defaults.ts` itself (its only remaining consumer) or a shared small types file — implementer's call.
- `components/sis/weight-profile.tsx` — currently classifies a subject_config row's weights as `'primary' | 'secondary' | 'custom' | 'invalid'` by comparing against the two flat level-type profiles. Redesign as a per-subject-code correctness check instead: given a row's `(subject_code, ww, pt, qa)`, compare against `weightBucketForSubjectCode(subject_code)`'s expected values — `'correct' | 'custom' | 'invalid'` (drop the primary/secondary distinction entirely, since it no longer means anything; a subject either matches its own correct bucket or it's a deliberate custom override). Update the `/sis/admin/subjects` catalog table's badge/legend copy to match the new two-state-plus-invalid model.

## Error handling

- Bootstrap/empty-catalog case no longer exists — the default is always present, so `create_academic_year` never produces an AY with zero sections/subjects the way the old dormant-fallback-with-no-source-AY case could.
- Re-running `create_academic_year` on an already-existing AY code stays idempotent exactly as before (`insert ... where not exists` guards, unchanged from 089's pattern) — a second call is a no-op on the seeding steps.
- `ECON`/`CCA` catalog inserts use `on conflict (code) do nothing` in case a subject with that code already exists (e.g. re-running the migration, or a school_admin having already manually added one before this ships).

## Testing

- The migration's SQL — DB-backed, manual verification only (no live-DB test harness in this repo, consistent with every other migration this session).
- `weight-profile.tsx`'s new classifier — pure function, unit-testable exactly like its predecessor (`classifyProfile`/`PROFILE_LABEL` tests already exist and should be rewritten for the new 3-state model, not just deleted).
- Grep sweep before deleting `level-profiles.ts`: confirm zero remaining references anywhere once the 3 consumers are fixed.
- Grep sweep for `sync_section_subjects_for_ay`: confirm zero remaining callers before dropping the RPC (per Section 3's flagged decision on the seeder).

## Open questions for the implementation plan (not blocking this design)

- Whether `lib/sis/seeder/structural.ts` should stop calling `sync_section_subjects_for_ay` (matching new real behavior) or keep it for deliberately pre-populated test data — flagged in Section 3, needs an explicit decision during planning, not a silent pick.
- Exact SQL structure for the bulk section/offering/weight inserts (CTE-based `VALUES` lists joining to `levels`/`subjects` by code) — mechanical, resolved during plan-writing against the real current schema.
