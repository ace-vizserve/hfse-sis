# Remove Structure Defaults (Template) — Design

**Date:** 2026-07-20 · **Audience:** dev follow-up (implementation plan)

## Problem

`/sis/admin/template` ("Structure Defaults" per KD #154's rename) is a separately-maintained, AY-agnostic master (`template_sections`, `template_subject_configs`, `template_subject_level_offerings`) with its own edit surface and an explicit "Apply to AY" step (`apply_template_to_ay` RPC, with a diff-review UI per `template-diff.ts`/`app/api/sis/admin/template/diff`). This is a maintained abstraction with an ongoing sync burden: someone edits the master, then has to remember to (re-)apply it, and there's always a live question of whether a given AY's actual config still matches what the master says.

That whole layer is unwanted. A new AY should just start as a direct copy of the most recently completed AY's real, live sections/subject-attachments/weights — no separate master, no apply step, no drift question. After the copy, the new AY's config is edited directly (the existing `/sis/admin/subjects` tree UI stays exactly as-is, just always pointed at a real AY, never a template) — the same way every other AY's data already works.

**Verified during design:** `create_academic_year` (newest live body: migration 080) already contains this exact copy-forward mechanism as a **dormant fallback** — "Legacy fallback: most recent non-test AY (preserves migration 030's behaviour for empty-template installs)," gated on `v_use_template = false`. It only activates today when the template tables happen to be empty. This spec makes that fallback the _only_ path, deletes the template layer entirely, and adds the one genuinely new piece: an explicit, audit-logged confirmation gate.

## Goals

- `/sis/admin/template` and every table/RPC/route backing it are deleted.
- A new AY's sections, subject-level attachments, and subject weights are populated automatically from the most recently completed AY at creation time — unconditionally, no template check.
- A registrar must explicitly confirm the carried-forward starting setup before the AY counts as ready — audit-logged (who, when).
- The existing tree/list editing UI for sections and subjects is untouched — it already operates on live per-AY data and needs no changes beyond no longer having a "Structure Defaults" sibling to also maintain.

## Non-goals

- No diff/review UI between the copy source and the new AY — that's exactly the indirection being removed. The registrar reviews the copied result directly on the new AY's own live pages, the same way they'd review anything else there.
- No change to the existing `sections`/`subject_configs`/`subject_level_offerings` data model (migration 080's subject-scoped collapse stays exactly as shipped 5 days ago) — this spec only removes the template _source_ those tables can be populated from, not their shape.
- No change to mid-year section creation (`POST /api/sections`, the "surprise-late-transfer" case) — orthogonal, already per-AY, untouched.
- Bootstrap case (no prior non-test AY to copy from) is out of scope for new behavior — it already degrades to "starts empty," which is acceptable and effectively unreachable for HFSE going forward (AY2025/2026/2027 already exist).

## Architecture

### 1. Migration — delete the template layer, unconditional copy-forward

- Drop `template_sections`, `template_subject_configs`, `template_subject_level_offerings`.
- Drop `apply_template_to_ay`.
- Re-emit `create_academic_year` (from its migration-080 body, the newest live version — KD #119 hazard applies) removing the `v_use_template` decision and the `template` branches in both the sections copy (step 4) and the subject_configs/subject_level_offerings copy (step 5). The `v_source_ay_id` ("most recent non-test AY") resolution becomes unconditional — always the copy source when one exists.
- Add the confirmation gate as two new nullable columns on `academic_years`: `structure_confirmed_at timestamptz null`, `structure_confirmed_by uuid null references auth.users(id)`. A dedicated column (not just an audit-log row) so the AY-readiness checklist can check it cheaply — paired with a real `audit_log` row on confirm for the traceable history, matching the pattern already used elsewhere (e.g. KD #139's `published_with_gaps` column + audit context).

### 2. New route — confirm the starting setup

`POST /api/sis/ay-setup/confirm-structure` (or nested under the existing ay-setup route family — implementer's call once the exact existing route layout is checked): sets `structure_confirmed_at = now()`, `structure_confirmed_by = auth.user.id` on the target AY, audit-logs a new `ay.structure.confirm` action with the AY code + a snapshot count (sections/subjects/weights carried in) in context. Idempotent re-confirm just updates the timestamp/actor and logs again — re-confirming after making adjustments is a normal, expected flow, not an error.

### 3. Readiness checklist — one new step

The 10-item checklist (`lib/sis/readiness.ts`, `ReadinessStepId`: `ay-setup | calendar | sections | subject-weights | advisers | section-subjects | grading-sheets | virtue-themes | letterhead | app-window`) gains a new `structure-confirmed` step, checking `structure_confirmed_at is not null` — positioned right after `calendar` and before `sections`/`subject-weights`, since those are now pre-populated by the copy and this is the "I've looked at what got carried forward" checkpoint. Follows the existing `STEP_META` + pure-resolver-function pattern already established for every other step (e.g. `resolveSectionsStep`) — a simple done/not_started resolver, no fraction needed. Surfaces on `year-setup-checklist.tsx` with a "Confirm" action button, same interaction language as the rest of that page (KD #109's 2026-07-08 checklist-dashboard rework).

### 4. Deletions

- `app/(sis)/sis/admin/template/` page + its client component.
- `app/api/sis/admin/template/{sections,subject-configs,subject-level-offerings,diff,apply}/` routes.
- `lib/sis/template/queries.ts`, `lib/sis/template-diff.ts`.
- `__tests__/sis/template-diff.test.ts`, `__tests__/sis/template-diff-route.test.ts`.
- The "Structure Defaults" sidebar nav entry (`lib/auth/roles.ts`) and its `ROUTE_ACCESS` row.
- A stale doc-comment in `lib/sis/seeder/structural.ts` (around lines 245-256) references `template_sections` as context for why it re-runs `sync_section_subjects_for_ay` — verified this file does NOT actually query any template table directly (its own section upsert is a raw insert, unrelated to `create_academic_year`'s template branch), so this is a comment-only fix, not a functional change to the seeder.

## Error handling

- No prior non-test AY exists (bootstrap case): `create_academic_year` proceeds with zero sections/configs copied, same as today's "template empty, no fallback source" outcome — the new AY just starts empty and the confirm step still applies (confirming an empty setup is a no-op confirmation, not blocked — the registrar would need to build sections/subjects from scratch first, same as before templates existed).
- Confirm route called on an AY that's already confirmed: succeeds, updates timestamp/actor, logs again — not an error (see above).

## Testing

- `create_academic_year`'s copy-forward branch — DB-backed, manual verification (create a real test AY post-migration, confirm sections/subject_configs/subject_level_offerings match the source AY's counts).
- The confirm route + readiness step — manual verification, consistent with every other DB-backed piece in this repo.
- Grep sweep before deleting: confirm nothing outside the deleted files references `template_sections`/`template_subject_configs`/`template_subject_level_offerings`/`apply_template_to_ay` (verified during design: `readiness.ts`'s only reference is a historical comment, not a query; `lib/sis/seeder/structural.ts`'s references are comment-only per Deletions above; `lib/sis/subject-config-gaps.ts` was flagged in the initial grep and needs the same verification pass before deleting anything).

## Open questions for the implementation plan (not blocking this design)

- Exact route path/placement for the confirm action (which existing ay-setup route file it joins, if any).
