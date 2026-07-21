# Static AY Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 4's "copy sections/subjects/weights from the prior AY" mechanism with a fixed, hardcoded default baseline that's identical every time a new AY is created, remove the now-pointless confirmation gate, and stop every section — anywhere, not just at AY creation — from having subjects auto-attached without an explicit registrar action.

**Architecture:** One migration replaces `create_academic_year`'s copy-forward body with literal `VALUES`-list inserts for sections/subject_level_offerings/subject_configs, sourced from HFSE's real per-level virtue-section list (KD #144) and the confirmed DepEd Order 8 s.2015 per-subject-code weight table (already correctly implemented in `lib/sis/subjects/weight-defaults.ts`, just not yet used anywhere in bulk). A second change removes `sync_section_subjects_for_ay`'s blanket "attach every level subject to every new section" call from the one real production caller (`POST /api/sections`) and replaces its seeder-only safety-net use with explicit, registrar-realistic attachment. A third change removes `lib/sis/level-profiles.ts` (the wrong flat per-level-type weight model) and its 3 consumers.

**Tech Stack:** Postgres/PL-pgSQL (Supabase), Next.js 16 API routes + Server Components, TanStack Query, shadcn/Radix UI — consistent with the rest of this repo, no new dependencies.

## Global Constraints

- Nothing in this plan touches a live database — every migration is written and reviewed, application to a real Supabase project is a human's job with real credentials, exactly as with every other migration this session.
- No new admin-editable surface of any kind for the default catalog — it's a fixed list baked into a migration, never a table with its own UI/API.
- `applyTrackBundle`, the Section Subjects panel, and the Mother Tongue language sub-choice UI are unchanged — they become the _only_ way subjects get attached to a section.
- Hard Rule #7 (design-token discipline) applies to every JSX file touched.
- Plain-English user-facing copy — no dev jargon in any string a registrar/school_admin would see.
- Never create backwards-compatibility shims for removed concepts (no re-exports, no "kept for now" dead code) — if something is confirmed unused, delete it outright, per this repo's stated convention.

---

### Task 1: Migration — static default seeding, drop the confirmation columns

**Files:**

- Create: `supabase/migrations/090_static_ay_defaults.sql`

**Interfaces:**

- Re-emits `public.create_academic_year(text, text)` — same signature, new body.
- Drops: `public.academic_years.structure_confirmed_at`, `public.academic_years.structure_confirmed_by`.
- Return shape: `{ ay_id, ay_code, ay_slug, ay_existed, terms_inserted, sections_seeded, subject_configs_seeded, tables_created }` — note `sections_copied`/`subject_configs_copied`/`source` from migration 089 are renamed/removed (Task 2 updates the one reader).

- [ ] **Step 1: Write the migration**

```sql
-- 090_static_ay_defaults.sql
--
-- Replaces migration 089's "copy sections/subjects/weights from the most
-- recently created prior AY" mechanism with a fixed, hardcoded default —
-- every new AY starts from the SAME baseline every time, not from
-- whatever the previous AY currently happens to look like. See
-- docs/superpowers/specs/2026-07-21-static-ay-defaults-design.md.
--
-- Also drops the confirmation-gate columns 089 added — nothing to
-- confirm anymore since the baseline never varies AY to AY.

-- =====================================================================
-- 1. Drop the confirmation-gate columns.
-- =====================================================================

alter table public.academic_years
  drop column if exists structure_confirmed_at,
  drop column if exists structure_confirmed_by;

-- =====================================================================
-- 2. Ensure ECON and CCA exist in the global subjects catalog —
--    catalog-only, no offering, no weight config, for future-readiness.
--    No-op if already present (both are already in supabase/seed.sql,
--    but the live prod database's actual state is unverified — this is
--    safe either way).
-- =====================================================================

insert into public.subjects (code, name, is_examinable)
values
  ('ECON', 'Economics', true),
  ('CCA', 'Co-curricular Activities', false)
on conflict (code) do nothing;

-- =====================================================================
-- 3. Re-emit create_academic_year — migration 089 body (the newest live
--    definition, KD #119 hazard) with the copy-forward source resolution
--    and both copy branches removed, replaced by static-default seeding.
--    Every other step (academic_years upsert, terms, sync_section_
--    subjects_for_ay call REMOVED — see design doc §3, admissions DDL)
--    unchanged in spirit; sections/subject_configs/subject_level_
--    offerings insertion is entirely new.
-- =====================================================================

create or replace function public.create_academic_year(
  p_ay_code text,
  p_label   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code                 text := upper(trim(p_ay_code));
  v_label                text := trim(p_label);
  v_slug                 text;
  v_ay_id                uuid;
  v_existing_ay_id        uuid;
  v_existed               boolean;
  v_terms_inserted        int := 0;
  v_sections_seeded       int := 0;
  v_subject_configs_seeded int := 0;
begin
  if v_code !~ '^AY[0-9]{4}$' then
    raise exception 'Invalid AY code: %. Expected format AY2027.', p_ay_code;
  end if;
  if v_label is null or v_label = '' then
    raise exception 'AY label is required.';
  end if;

  v_slug := 'ay' || substring(v_code from 3);

  -- 1. academic_years — reuse if present, otherwise insert.
  select id into v_existing_ay_id
  from public.academic_years
  where ay_code = v_code;

  if v_existing_ay_id is not null then
    v_ay_id   := v_existing_ay_id;
    v_existed := true;
  else
    insert into public.academic_years (ay_code, label, is_current)
    values (v_code, v_label, false)
    returning id into v_ay_id;
    v_existed := false;
  end if;

  -- 2. terms (T1–T4) — insert only the missing term_numbers.
  insert into public.terms (academic_year_id, term_number, label, is_current)
  select v_ay_id, n, 'Term ' || n || ' — ' || v_code, false
  from generate_series(1, 4) as g(n)
  where not exists (
    select 1 from public.terms
    where academic_year_id = v_ay_id and term_number = n
  );
  get diagnostics v_terms_inserted = row_count;

  -- 3. sections — fixed HFSE virtue-name list (KD #144), only when the
  --    AY has no sections yet. class_type left null — the registrar
  --    assigns Global/Standard per Secondary section when relevant.
  if not exists (select 1 from public.sections where academic_year_id = v_ay_id) then
    insert into public.sections (academic_year_id, level_id, name, class_type, schedule, form_class_adviser)
    select v_ay_id, l.id, x.name, null, x.schedule, null
    from (values
      ('P1', 'Obedience', 'morning'),
      ('P1', 'Patience', 'morning'),
      ('P1', 'Respect', 'afternoon'),
      ('P2', 'Honesty', 'morning'),
      ('P2', 'Humility', 'morning'),
      ('P2', 'Gentleness', 'afternoon'),
      ('P3', 'Courageous', 'morning'),
      ('P3', 'Courtesy', 'morning'),
      ('P3', 'Responsibility', 'afternoon'),
      ('P4', 'Diligence', 'morning'),
      ('P4', 'Trust', 'morning'),
      ('P4', 'Compassion', 'afternoon'),
      ('P5', 'Commitment', 'morning'),
      ('P5', 'Tenacity', 'morning'),
      ('P5', 'Perseverance', 'afternoon'),
      ('P6', 'Grit', 'morning'),
      ('P6', 'Loyalty', 'afternoon'),
      ('S1', 'Discipline', 'whole_day'),
      ('S2', 'Integrity', 'whole_day'),
      ('S3', 'Consistency', 'whole_day'),
      ('S4', 'Excellence', 'whole_day')
    ) as x(level_code, name, schedule)
    join public.levels l on l.code = x.level_code;
    get diagnostics v_sections_seeded = row_count;
  end if;

  -- 4. subject_level_offerings — fixed per-level subject applicability,
  --    only when the AY has none yet. Verified against real AY2026 data
  --    with two corrections: P6 gains MANDARIN (was a gap, not
  --    intentional — every other Primary level has it); Secondary S3/S4
  --    stays at its current real 9-subject set (no Global-track-only
  --    subjects — HFSE doesn't run Global track that far yet).
  if not exists (select 1 from public.subject_level_offerings where academic_year_id = v_ay_id) then
    insert into public.subject_level_offerings (academic_year_id, subject_id, level_id)
    select v_ay_id, s.id, l.id
    from (values
      ('P1', 'CL'), ('P1', 'ENG'), ('P1', 'FIL'), ('P1', 'MANDARIN'), ('P1', 'MAPEH'), ('P1', 'MATH'), ('P1', 'SCI'),
      ('P2', 'CL'), ('P2', 'ENG'), ('P2', 'FIL'), ('P2', 'MANDARIN'), ('P2', 'MAPEH'), ('P2', 'MATH'), ('P2', 'SCI'),
      ('P3', 'CL'), ('P3', 'ENG'), ('P3', 'FIL'), ('P3', 'MANDARIN'), ('P3', 'MAPEH'), ('P3', 'MATH'), ('P3', 'SCI'),
      ('P4', 'CL'), ('P4', 'ENG'), ('P4', 'FIL'), ('P4', 'MANDARIN'), ('P4', 'MAPEH'), ('P4', 'MATH'), ('P4', 'SCI'),
      ('P5', 'CL'), ('P5', 'ENG'), ('P5', 'FIL'), ('P5', 'MANDARIN'), ('P5', 'MAPEH'), ('P5', 'MATH'), ('P5', 'SCI'),
      ('P6', 'CL'), ('P6', 'ENG'), ('P6', 'FIL'), ('P6', 'MANDARIN'), ('P6', 'MAPEH'), ('P6', 'MATH'), ('P6', 'SCI'),
      ('S1', 'ARTD'), ('S1', 'CA'), ('S1', 'COMP'), ('S1', 'ENG'), ('S1', 'FIL'), ('S1', 'GP'), ('S1', 'HIST'), ('S1', 'HUM'), ('S1', 'LIT'), ('S1', 'MATH'), ('S1', 'PEH'), ('S1', 'PESTD'), ('S1', 'SCI'),
      ('S2', 'ARTD'), ('S2', 'CA'), ('S2', 'COMP'), ('S2', 'ENG'), ('S2', 'FIL'), ('S2', 'GP'), ('S2', 'HIST'), ('S2', 'HUM'), ('S2', 'LIT'), ('S2', 'MATH'), ('S2', 'PEH'), ('S2', 'PESTD'), ('S2', 'SCI'),
      ('S3', 'CA'), ('S3', 'ENG'), ('S3', 'FIL'), ('S3', 'LIT'), ('S3', 'MATH'), ('S3', 'PEH'), ('S3', 'PESTD'), ('S3', 'SCI'), ('S3', 'SS'),
      ('S4', 'CA'), ('S4', 'ENG'), ('S4', 'FIL'), ('S4', 'LIT'), ('S4', 'MATH'), ('S4', 'PEH'), ('S4', 'PESTD'), ('S4', 'SCI'), ('S4', 'SS')
    ) as x(level_code, subject_code)
    join public.levels l on l.code = x.level_code
    join public.subjects s on s.code = x.subject_code
    on conflict (subject_id, level_id, academic_year_id) do nothing;
  end if;

  -- 5. subject_configs (weights) — one row per DISTINCT subject code
  --    actually referenced by step 4 (subject_configs has no level
  --    dimension, migration 080), only when the AY has none yet. Weights
  --    match lib/sis/subjects/weight-defaults.ts's bucket logic exactly
  --    — keep both in sync by hand if HFSE's weight table ever changes.
  if not exists (select 1 from public.subject_configs where academic_year_id = v_ay_id) then
    insert into public.subject_configs (
      academic_year_id, subject_id,
      ww_weight, pt_weight, qa_weight,
      ww_max_slots, pt_max_slots, qa_max
    )
    select v_ay_id, s.id, x.ww, x.pt, x.qa, 5, 5, 30
    from (values
      ('MATH', 0.40, 0.40, 0.20),
      ('SCI', 0.40, 0.40, 0.20),
      ('MAPEH', 0.20, 0.60, 0.20),
      ('CL', 0.20, 0.60, 0.20),
      ('CA', 0.20, 0.60, 0.20),
      ('PEH', 0.20, 0.60, 0.20),
      ('PESTD', 0.20, 0.60, 0.20),
      ('ENG', 0.30, 0.50, 0.20),
      ('FIL', 0.30, 0.50, 0.20),
      ('MANDARIN', 0.30, 0.50, 0.20),
      ('HIST', 0.30, 0.50, 0.20),
      ('HUM', 0.30, 0.50, 0.20),
      ('LIT', 0.30, 0.50, 0.20),
      ('SS', 0.30, 0.50, 0.20),
      ('GP', 0.30, 0.50, 0.20),
      ('COMP', 0.30, 0.50, 0.20),
      ('ARTD', 0.30, 0.50, 0.20)
    ) as x(subject_code, ww, pt, qa)
    join public.subjects s on s.code = x.subject_code
    where exists (
      select 1 from public.subject_level_offerings slo
      where slo.academic_year_id = v_ay_id and slo.subject_id = s.id
    );
    get diagnostics v_subject_configs_seeded = row_count;
  end if;

  -- 6. Admissions DDL — already idempotent.
  perform public.create_ay_admissions_tables(v_slug);

  return jsonb_build_object(
    'ay_id',                    v_ay_id,
    'ay_code',                  v_code,
    'ay_slug',                  v_slug,
    'ay_existed',               v_existed,
    'terms_inserted',           v_terms_inserted,
    'sections_seeded',          v_sections_seeded,
    'subject_configs_seeded',   v_subject_configs_seeded,
    'tables_created', jsonb_build_array(
      v_slug || '_enrolment_applications',
      v_slug || '_enrolment_status',
      v_slug || '_enrolment_documents',
      v_slug || '_discount_codes'
    )
  );
end;
$$;

revoke all on function public.create_academic_year(text, text) from public;
grant execute on function public.create_academic_year(text, text) to service_role;
```

- [ ] **Step 2: Self-check the SQL**

Read the file back and verify: every level code used (`P1`-`P6`, `S1`-`S4`) matches `public.levels.code` exactly (10 rows, migration 086's fixed catalog — no `YS`/`CS1`/`CS2` references); every subject code used (`CL`, `ENG`, `FIL`, `MANDARIN`, `MAPEH`, `MATH`, `SCI`, `ARTD`, `CA`, `COMP`, `GP`, `HIST`, `HUM`, `LIT`, `PEH`, `PESTD`, `SS`, `ECON`, `CCA`) is either inserted by step 2 above (`ECON`, `CCA`) or already exists in `supabase/seed.sql`'s subject list — confirm this by reading `supabase/seed.sql`'s subject INSERT block yourself rather than trusting this step's memory of it. Confirm the weight bucket values in step 5 sum to exactly 1.00 for every row (`0.40+0.40+0.20`, `0.20+0.60+0.20`, `0.30+0.50+0.20`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/090_static_ay_defaults.sql
git commit -m "feat(sis): replace AY copy-forward with a fixed static default catalog"
```

---

### Task 2: Sync `app/api/sis/ay-setup/route.ts` to the renamed RPC return fields

**Files:**

- Modify: `app/api/sis/ay-setup/route.ts`

**Interfaces:**

- Consumes: `create_academic_year`'s new return shape (Task 1) — `sections_seeded`/`subject_configs_seeded` replace `sections_copied`/`subject_configs_copied`; `source` no longer exists (this route never read it).

- [ ] **Step 1: Update the field reads**

In `app/api/sis/ay-setup/route.ts`, find the block reading `summary.sections_copied` and `summary.subject_configs_copied` (search for those exact strings — read the current file first, since this plan doesn't have its exact current line numbers verbatim). Replace:

```typescript
const sectionsCopied =
  typeof summary.sections_copied === 'number' ? summary.sections_copied : 0;
const configsCopied =
  typeof summary.subject_configs_copied === 'number'
    ? summary.subject_configs_copied
    : 0;
const alreadyExisted =
  ayExisted &&
  termsInserted === 0 &&
  sectionsCopied === 0 &&
  configsCopied === 0;
```

with:

```typescript
const sectionsSeeded =
  typeof summary.sections_seeded === 'number' ? summary.sections_seeded : 0;
const configsSeeded =
  typeof summary.subject_configs_seeded === 'number'
    ? summary.subject_configs_seeded
    : 0;
const alreadyExisted =
  ayExisted &&
  termsInserted === 0 &&
  sectionsSeeded === 0 &&
  configsSeeded === 0;
```

Then find every other reference to `sectionsCopied`/`configsCopied` further down in the same file (there is at least one more — likely inside the audit-log `context` object and/or the JSON success response) and rename to `sectionsSeeded`/`configsSeeded` to match, updating any JSON key names those call sites expose (e.g. if the audit context or API response currently has a key literally named `sectionsCopied`, rename it to `sectionsSeeded` for the same honesty reason the RPC fields were renamed — read the full file to find every occurrence, don't assume there's only one).

- [ ] **Step 2: Run the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 3: Commit**

```bash
git add app/api/sis/ay-setup/route.ts
git commit -m "refactor(sis): sync ay-setup route to the renamed create_academic_year return fields"
```

---

### Task 3: Rewrite the AY-Setup wizard's copy-forward preview into a static-default preview

**Files:**

- Modify: `lib/sis/ay-setup/queries.ts`
- Modify: `components/sis/ay-setup-wizard.tsx`

**Interfaces:**

- `getCopyForwardPreview` → rename to `getAySetupPreview`, new return shape: `{ ay_already_exists: boolean; terms_to_insert: number; will_seed_defaults: boolean }` (drops `source_ay_code`, `sections_to_copy`, `subject_configs_to_copy`).

- [ ] **Step 1: Rewrite the preview function**

Read the current full `getCopyForwardPreview` function in `lib/sis/ay-setup/queries.ts` (roughly lines 150-230, but verify against the live file). Rename it to `getAySetupPreview`. Keep the existing target-AY lookup, existing-terms count, and `termsToInsert` calculation exactly as they are. Replace everything from the "Pre-compute target-side counts" comment onward (the sections/subject_configs existence checks, the prior-AY lookup, and the final return) with:

```typescript
const targetHasSections = (targetSectionsRes.count ?? 0) > 0;
const targetHasConfigs = (targetConfigsRes.count ?? 0) > 0;

return {
  ay_already_exists: targetId !== null,
  terms_to_insert: termsToInsert,
  // The RPC only seeds the static default catalog when the AY has
  // NEITHER sections NOR subject_configs yet — matches
  // create_academic_year's own idempotency guards (migration 090).
  will_seed_defaults: !targetHasSections && !targetHasConfigs,
};
```

Keep the `targetSectionsRes`/`targetConfigsRes` `Promise.all` fetch exactly as it already is (still needed for the two booleans above) — only the prior-AY lookup block and the return shape change. Update the `CopyForwardPreview` type (rename to `AySetupPreview`, new fields matching the above) and its doc comment to describe the static-default model instead of copy-forward.

- [ ] **Step 2: Find and update the one caller**

Grep for `getCopyForwardPreview` across the repo — update the import/call site (almost certainly the AY-Setup wizard's preview-fetch, and possibly an API route it goes through) to the new name `getAySetupPreview`.

- [ ] **Step 3: Update the wizard's Review step JSX**

In `components/sis/ay-setup-wizard.tsx`, update the `preview` type (the block around `source_ay_code: string | null; sections_to_copy: number; subject_configs_to_copy: number;`) to match the new `AySetupPreview` shape. Replace the conditional block reading `preview.source_ay_code`/`preview.sections_to_copy`/`preview.subject_configs_to_copy` (the `{preview.source_ay_code ? (...) : (...)}` block) with a single, unconditional `ReviewRow`:

```tsx
<ReviewRow
  label="Sections & subjects"
  value={
    preview.will_seed_defaults
      ? "HFSE's standard starting catalog will be created — sections, subjects, and weights, ready to edit"
      : 'Already configured — nothing will be added'
  }
/>
```

- [ ] **Step 4: Run the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add lib/sis/ay-setup/queries.ts components/sis/ay-setup-wizard.tsx
git commit -m "refactor(sis): rewrite the AY-Setup wizard's preview for the static default catalog"
```

---

### Task 4: Remove the structure-confirmation feature entirely

**Files:**

- Delete: `app/api/sis/ay-setup/confirm-structure/route.ts`
- Modify: `lib/audit/log-action.ts`
- Modify: `lib/audit/humanize.ts`
- Modify: `lib/sis/readiness.ts`
- Modify: `lib/sis/year-setup.ts`
- Modify: `components/sis/year-setup/year-setup-checklist.tsx`
- Modify: `__tests__/sis/readiness.test.ts`

**Interfaces:**

- Removes: `'ay.structure.confirm'` from `AuditAction`, `ReadinessStepId`'s `'structure-confirmed'` member, `resolveStructureConfirmedStep`, `STEP_META['structure-confirmed']`.

- [ ] **Step 1: Delete the route**

```bash
git rm "app/api/sis/ay-setup/confirm-structure/route.ts"
```

- [ ] **Step 2: Remove the audit action + humanizer label**

In `lib/audit/log-action.ts`, remove the `| 'ay.structure.confirm'` line from the `AuditAction` union. In `lib/audit/humanize.ts`, remove the `'ay.structure.confirm': 'AY starting setup confirmed',` entry from the label map.

- [ ] **Step 3: Remove the readiness step**

In `lib/sis/readiness.ts`: remove `'structure-confirmed'` from the `ReadinessStepId` union; remove the `STEP_META['structure-confirmed']` entry; renumber every subsequent entry's `step` field down by 1 (`sections` back to 3, `subject-weights` to 4, `advisers` to 5, `section-subjects` to 6, `grading-sheets` to 7, `virtue-themes` to 8, `letterhead` to 9, `app-window` to 10); delete the `resolveStructureConfirmedStep` function; find and remove its call from the aggregating function (`getAyReadiness`) — both the `steps` array entry and whatever `academic_years` select fetched `structure_confirmed_at` (that column no longer exists per Task 1's migration, so this select MUST be updated or the query will error against a live DB).

- [ ] **Step 4: Remove the checklist summary case**

In `lib/sis/year-setup.ts`, remove the `case 'structure-confirmed':` block from `checklistSummary`.

- [ ] **Step 5: Remove the UI row**

In `components/sis/year-setup/year-setup-checklist.tsx`, find and remove the "Confirm starting setup" row and its mutation (the `useMutation` calling `POST /api/sis/ay-setup/confirm-structure`) — read the live file to find the exact block, it was added in the same style as the file's other rows.

- [ ] **Step 6: Update the readiness test**

In `__tests__/sis/readiness.test.ts`, remove the `describe('resolveStructureConfirmedStep', ...)` block (added in the prior session's Task 4.3) and its import. Check whether any test in `buildReadiness`'s describe block references a step count or list that included `structure-confirmed` (e.g. an assertion like "8 required steps" that should now read differently) — update if so.

- [ ] **Step 7: Run the build + tests**

Run: `npx next build && npx vitest run __tests__/sis/readiness.test.ts`
Expected: clean compile, all tests passing.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(sis): remove the structure-confirmation gate — nothing to confirm, the default never varies"
```

---

### Task 5: Stop auto-attaching subjects to new sections

**Files:**

- Modify: `app/api/sections/route.ts`

**Interfaces:**

- Removes the `sync_section_subjects_for_ay` RPC call; `applyTrackBundle` call immediately after is unchanged.

- [ ] **Step 1: Remove the blanket-sync call**

In `app/api/sections/route.ts`, delete the block:

```typescript
// Seed section_subjects defaults for the new section (every subject
// currently configured at its level) — best-effort, matches today's
// "subjects derive from level" behaviour until the registrar customizes
// this section via the Section Subjects panel. Must run BEFORE the
// grading-sheet bulk-create below so bulk-create/route.ts's
// section_subjects intersection (Phase 3) has something to intersect with.
const { error: syncErr } = await service.rpc('sync_section_subjects_for_ay', {
  p_ay_code: ay.ay_code,
});
if (syncErr) {
  console.error(
    '[sections POST] section_subjects sync RPC failed:',
    syncErr.message
  );
}
```

Update the comment above the `applyTrackBundle` call (currently "additively attach the track's static subject bundle on top of whatever the level-wide sync above just seeded... kept as its own explicit step so the bundle is guaranteed present even if the level-wide default set ever narrows") — it now describes the ONLY attachment step, not an additive one; reword accordingly (e.g. "the section starts with zero subjects; when the registrar flags this Secondary section Global/Standard at creation, attach that track's subject bundle — otherwise the section stays empty until the registrar attaches subjects via the Section Subjects panel").

- [ ] **Step 2: Check for a grading-sheet-creation dependency**

The removed block's own comment warned it "Must run BEFORE the grading-sheet bulk-create below so bulk-create/route.ts's section_subjects intersection... has something to intersect with." Read the `create_grading_sheets_for_section` RPC call immediately below in this same file — confirm what happens when a newly-created section has zero `section_subjects` rows (no `class_type` chosen, so `applyTrackBundle` also didn't run). Expected: zero grading sheets get created for that section, which is correct now (nothing to create sheets for yet) — but verify this doesn't produce a hard error the route would need to handle differently. Report what you find; this shouldn't require a code change if `create_grading_sheets_for_section` already tolerates zero `section_subjects` rows gracefully (an empty result, not an error) — confirm this from the RPC's actual definition (grep the migrations for `create_grading_sheets_for_section`) rather than assuming.

- [ ] **Step 3: Run the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add app/api/sections/route.ts
git commit -m "fix(sis): stop auto-attaching every level subject to a section on creation"
```

---

### Task 6: Seeder — replace the blanket sync with realistic explicit attachment

**Files:**

- Modify: `lib/sis/seeder/structural.ts`

**Interfaces:**

- Removes the `sync_section_subjects_for_ay` RPC call; adds explicit per-section subject attachment matching what a real registrar would do.

**Context:** The seeder's own existing comment explains why this call exists: `create_grading_sheets_for_ay` (migration 080) resolves grading-sheet eligibility THROUGH `section_subjects` — a section with none gets zero seeded grading sheets, which would leave the seeded test AY's dashboards/grading pages empty. This task must replace the blanket call with something that produces equivalent (or better — more realistic) `section_subjects` coverage, not just delete it.

- [ ] **Step 1: Read the seeder's section fixture**

Read `lib/sis/seeder/structural.ts` and `lib/sis/seeder/fixtures.ts` in full to find: (a) the seeder's own `SECTIONS` fixture (its section-name/level list — independent of Task 1's migration, confirmed during this plan's research to be a separate raw upsert, not routed through `create_academic_year`) and whether it currently sets `class_type` on any section (confirmed during research: it does not, today); (b) the exact shape of the `sync_section_subjects_for_ay` call site (already known: `lib/sis/seeder/structural.ts` around what was lines 245-266 before Task 5 — re-verify current line numbers since Task 5 doesn't touch this file, so they should be stable, but confirm).

- [ ] **Step 2: Decide and implement replacement attachment logic**

Replace the `sync_section_subjects_for_ay` RPC call with explicit attachment, section by section, for every section this seeder creates/touches in the test AY:

- **Secondary sections** (level type secondary): assign each section a `class_type` (update the section row's `class_type` if it's null — alternate `'Global'`/`'Standard'` across sections deterministically, e.g. by section index, so seeded test data exercises both tracks) if it doesn't already have one, then call `applyTrackBundle` (`lib/sis/section-track.ts`, already imported by `app/api/sections/route.ts` — import it here too) with that `class_type` for the section.
- **Primary sections**: attach every subject_config whose subject is offered at that section's level EXCEPT pick exactly one of FIL/MANDARIN per section (not both) — alternate which one across sections at the same level (deterministic by section index), matching the real "one section is Mother Tongue (Filipino), another is Mother Tongue (Mandarin)" pattern you were told this session. Implement as a direct `section_subjects` insert (`on conflict do nothing`, matching every other write path's tolerance) rather than a new RPC — this is seeder-only logic, doesn't need to be a reusable server function.

Keep the existing "must run before grading-sheet bulk-create" ordering constraint — this replacement logic goes in the exact same place in the seeder's sequence the old call occupied.

- [ ] **Step 3: Run the seeder-related tests**

Find and run whatever test file(s) cover `lib/sis/seeder/structural.ts` (search `__tests__/sis/` for `seeder`/`structural` in the filename). If none exist, this step is a no-op — this repo's convention is no live-DB test harness for seeder logic (manual verification only, consistent with every other DB-backed piece).

- [ ] **Step 4: Run the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add lib/sis/seeder/structural.ts
git commit -m "fix(sis-seeder): replace blanket section_subjects sync with realistic per-section attachment"
```

---

### Task 7: Migration — drop the now-unused `sync_section_subjects_for_ay` RPC

**Files:**

- Create: `supabase/migrations/091_drop_sync_section_subjects_for_ay.sql`

**Interfaces:**

- Drops: `public.sync_section_subjects_for_ay(text)`.

- [ ] **Step 1: Grep-confirm zero remaining callers**

Run: `rg "sync_section_subjects_for_ay" --type ts --type tsx --type sql`
Expected: only this migration's own `drop function` line, plus historical mentions inside migrations 079/080 (which defined it — those stay, migrations are never edited after the fact) and any comments in `app/api/sections/route.ts`/`lib/sis/seeder/structural.ts` that Tasks 5/6 may have left describing the old behavior for historical context (read them — if a comment still claims the RPC is called, fix it; if it's accurately describing what USED to happen and why, it's fine to leave, matching this session's established practice elsewhere). If this grep finds a real remaining caller Tasks 5 or 6 missed, stop and fix that first — do not drop the function while something still calls it.

- [ ] **Step 2: Write the migration**

```sql
-- 091_drop_sync_section_subjects_for_ay.sql
--
-- Removes the RPC behind the blanket "attach every level subject to
-- every new section" behavior (migrations 079/080) — its two real
-- callers (app/api/sections/route.ts, lib/sis/seeder/structural.ts)
-- were both migrated off it to explicit, registrar-realistic attachment
-- in the same branch as this migration. See
-- docs/superpowers/specs/2026-07-21-static-ay-defaults-design.md §3.

drop function if exists public.sync_section_subjects_for_ay(text);
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/091_drop_sync_section_subjects_for_ay.sql
git commit -m "chore(sis): drop the unused sync_section_subjects_for_ay RPC"
```

---

### Task 8: Remove `lib/sis/level-profiles.ts`, redesign `weight-profile.tsx`'s classifier

**Files:**

- Delete: `lib/sis/level-profiles.ts`
- Delete: `__tests__/sis/level-profiles.test.ts`
- Modify: `lib/sis/subjects/weight-defaults.ts`
- Modify: `components/sis/weight-profile.tsx`
- Modify: `app/(sis)/sis/admin/subjects/page.tsx` (or wherever `weight-profile.tsx`'s exports are actually consumed — verify via grep)
- Create/Modify: `__tests__/sis/weight-profile.test.ts` (or wherever tests for this classifier already live, if any — grep first)

**Interfaces:**

- `weight-profile.tsx`'s `WeightProfile` type changes from `'primary' | 'secondary' | 'custom' | 'invalid'` to `'correct' | 'custom' | 'invalid'`.
- `classifyProfile(ww, pt, qa)` → `classifyProfile(subjectCode, ww, pt, qa)`.

- [ ] **Step 1: Move `WeightFractions` out of `level-profiles.ts`**

In `lib/sis/subjects/weight-defaults.ts`, replace the import `import type { WeightFractions } from '@/lib/sis/level-profiles';` with a local type definition (it's the only remaining consumer):

```typescript
export type WeightFractions = { ww: number; pt: number; qa: number };
```

Move this definition to the top of the file, above `MATH_SCIENCE`.

- [ ] **Step 2: Delete `level-profiles.ts` and its test**

```bash
git rm lib/sis/level-profiles.ts
git rm __tests__/sis/level-profiles.test.ts
```

- [ ] **Step 3: Redesign the classifier**

In `components/sis/weight-profile.tsx`, replace the `LEVEL_WEIGHT_PROFILES` import with `import { weightBucketForSubjectCode } from '@/lib/sis/subjects/weight-defaults';`. Replace the `WeightProfile` type, the `PRIMARY_PCT`/`SECONDARY_PCT` constants, and `classifyProfile` with:

```typescript
export type WeightProfile = 'correct' | 'custom' | 'invalid';

export function classifyProfile(
  subjectCode: string,
  ww: number,
  pt: number,
  qa: number
): WeightProfile {
  if (ww + pt + qa !== 100) return 'invalid';
  const expected = weightBucketForSubjectCode(subjectCode);
  const expectedPct = {
    ww: Math.round(expected.ww * 100),
    pt: Math.round(expected.pt * 100),
    qa: Math.round(expected.qa * 100),
  };
  if (ww === expectedPct.ww && pt === expectedPct.pt && qa === expectedPct.qa)
    return 'correct';
  return 'custom';
}
```

Update `PROFILE_LABEL`, `PROFILE_CLASS`, and `PROFILE_TEXT` (all currently keyed `primary | secondary | custom | invalid`) to the new 3-key shape — `correct` should read as clearly positive (reuse whichever of the old `primary`/`secondary` visual treatments reads best as a single "matches the standard" state; the mint/healthy semantic tint per this repo's design-system §9.3 status recipes is the more appropriate choice than either arbitrary old color, since "correct" is a healthy/good state, not one of two arbitrary categories — but read `docs/context/09a-design-patterns.md` §9 before picking the exact token if you're unsure). `custom` and `invalid` keep their existing amber/destructive treatments unchanged.

- [ ] **Step 4: Fix the caller**

Grep for `classifyProfile` to find its call site(s) (likely `app/(sis)/sis/admin/subjects/page.tsx` or a component it renders) — update the call to pass the row's `subject_code` as the new first argument. Update any legend/label copy that referenced "Primary"/"Secondary" profiles to instead describe "matches the standard weight for this subject" vs "custom."

- [ ] **Step 5: Update or write tests**

Grep for existing tests covering `classifyProfile`/`PROFILE_LABEL` (check `__tests__/sis/` and `__tests__/ui/` for a `weight-profile` filename). If found, rewrite their cases for the new 3-state, subject-code-aware signature (test at least: a code matching its correct bucket → `'correct'`; a code with weights from a DIFFERENT bucket → `'custom'`; a row summing to ≠100 → `'invalid'`). If no test file exists yet, do not invent one — this classifier had no dedicated test before this change per repo convention observed elsewhere this session (some pure functions are tested, some aren't; match whatever this specific file's prior state was).

- [ ] **Step 6: Run the build + tests**

Run: `npx next build && npx vitest run`
Expected: clean compile, full suite passing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(sis): replace the flat primary/secondary weight classifier with the per-subject-code model"
```

---

### Final gate

- [ ] `npx vitest run` (full suite) passes.
- [ ] `npx next build` compiles clean.
- [ ] Grep sweep: `rg "level-profiles" --type ts --type tsx` returns zero hits.
- [ ] Grep sweep: `rg "sync_section_subjects_for_ay" --type ts --type tsx` returns zero hits outside historical/comment context (verified in Task 7 Step 1).
- [ ] Grep sweep: `rg "structure_confirmed|confirm-structure|ay.structure.confirm" --type ts --type tsx` returns zero hits.
- [ ] Grep sweep: `rg "sections_copied|subject_configs_copied|source_ay_code|sections_to_copy|subject_configs_to_copy" --type ts --type tsx` returns zero hits.
- [ ] Manual DB-dependent verification (deferred to a human with real Supabase credentials, consistent with every migration this session): apply migrations 090 + 091, create a real test AY, confirm it seeds the exact section/subject/weight catalog from Task 1's tables — not a copy of any existing AY; confirm `/sis/ay-setup`'s Review step shows the new static-default copy, not "copied from AY2026"; confirm creating a brand-new section anywhere (mid-year or at AY setup) starts with zero subjects attached until the registrar acts; confirm the `/sis/admin/subjects` catalog table's weight-profile badge shows "Correct"/"Custom"/"Invalid" per subject, not "Primary"/"Secondary".

## Self-Review Notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-07-21-static-ay-defaults-design.md` maps to a task — §1 (fixed default data) → Task 1; §2 (create_academic_year re-emit) → Task 1; §3 (no auto-attach anywhere) → Tasks 5-7; §4 (confirmation gate removal) → Task 4; §5 (level-profiles.ts removal) → Task 8. The two "Open questions" the spec flagged (seeder decision, exact SQL structure) are resolved in Tasks 6 and 1 respectively, not left open.
- **Newly-discovered scope during planning, folded in:** the AY-Setup wizard's copy-forward preview (`getCopyForwardPreview`, `ay-setup-wizard.tsx`'s Review step) and the one route reading the RPC's renamed return fields (`app/api/sis/ay-setup/route.ts`) were not in the original spec's file list — both are real, load-bearing consumers of the copy-forward model discovered while writing this plan (Tasks 2-3).
- **Placeholder scan:** no TBD/TODO. Tasks 5's Step 2 and 6's Step 1 ask the implementer to read live files before acting rather than presenting invented code — both are investigation steps with clear, bounded instructions, not open-ended asks, consistent with how this session has handled every case where a file's exact live state couldn't be pinned down in advance.
- **Type/naming consistency:** `sections_seeded`/`subject_configs_seeded` (Task 1's RPC return) match exactly what Task 2 reads; `getAySetupPreview`/`AySetupPreview`/`will_seed_defaults` (Task 3) are used consistently between the query function and the wizard.
