# Official section list + structured schedule (class template) — design spec

**Date:** 2026-06-11
**Status:** Design — approved, pending plan
**Scope:** Step 1 of the sections/schedule rework. Fixes the **class-template** section list to HFSE's official per-level sections and adds a **structured `schedule`** field. Auto-enrollment consuming the schedule is a deliberate **separate next step** (out of scope here).

## Context

The class template (`template_sections`, KD #66) is the single master section list; `apply_template_to_ay` propagates it into each AY's `public.sections`. Today the template holds placeholder sections seeded from the AY9999 test environment (migration 032), not HFSE's real classes. Separately, `sections.schedule` does not exist — schedule is only conveyed by a naming convention (`"… | Morning"`), which `lib/sis/class-assignment.ts` fuzzy-matches against `app.preferredSchedule` (the code comment explicitly flags this as fragile).

This step makes the template list official and gives schedule a real column. It does **not** touch class type (`class_type` is an admissions-application dimension fed to auto-enrollment — unchanged), Youngstarters (Faith/Love → tier+schedule mapping is unconfirmed; **deferred** pending academics), or Cambridge curriculum (a section/subject distinction; SOW machinery already removed — `CS1`/`CS2` levels left dormant).

## The official list (this step)

Levels already exist (migration 029). 21 sections across P1–P6 + S1–S4. **Name = the virtue only** (level is a separate FK; schedule a separate field). Display recombines as "Primary One · Obedience · Morning".

| Level (code)         | Sections — `name` (schedule)                                         |
| -------------------- | -------------------------------------------------------------------- |
| Primary One (P1)     | Obedience (morning), Patience (morning), Respect (afternoon)         |
| Primary Two (P2)     | Honesty (morning), Humility (morning), Gentleness (afternoon)        |
| Primary Three (P3)   | Courageous (morning), Courtesy (morning), Responsibility (afternoon) |
| Primary Four (P4)    | Diligence (morning), Trust (morning), Compassion (afternoon)         |
| Primary Five (P5)    | Commitment (morning), Tenacity (morning), Perseverance (afternoon)   |
| Primary Six (P6)     | Grit (morning), Loyalty (afternoon)                                  |
| Secondary One (S1)   | Discipline (whole_day)                                               |
| Secondary Two (S2)   | Integrity (whole_day)                                                |
| Secondary Three (S3) | Consistency (whole_day)                                              |
| Secondary Four (S4)  | Excellence (whole_day)                                               |

**Deferred (not seeded):** Youngstarters (YS-L/J/S) — Faith/Love; both Morning + Afternoon exist but the section→schedule mapping is unconfirmed.

## Design

### 1. Schema (one migration)

- Add `schedule text` to **`public.sections`** and **`public.template_sections`**, `CHECK (schedule IS NULL OR schedule IN ('morning','afternoon','whole_day'))`, **nullable** (preschool/edge + existing rows stay null until set).
- Reset the template's P1–P6 + S1–S4 rows to the official list: `DELETE FROM template_sections WHERE level_id IN (those 10 levels)` then `INSERT` the 21 official rows (name + schedule), resolving `level_id` via `levels.code`. **Idempotent** (delete-then-insert; re-runnable). **YS / CS1 / CS2 template rows are left untouched.**
- `class_type` on the new template rows = `NULL` (not a section attribute here).

### 2. `apply_template_to_ay` carries schedule

Update the RPC so the template→AY copy includes `schedule`. **Critical (KD #119):** re-emit from the **current live** definition (read it first), not an old migration's body — only add the `schedule` column to the SELECT/INSERT; change nothing else. **Audit every other site that copies `template_sections → sections`** (e.g. `create_academic_year` / migration 030 idempotent setup, the AY-setup wizard path) and thread `schedule` through each, so a freshly-created or re-applied AY gets it.

### 3. Schema constants

Add `SCHEDULE_VALUES = ['morning','afternoon','whole_day'] as const`, a `Schedule` type, and `SCHEDULE_LABELS` (`morning`→"Morning", etc.) to the section schema module (`lib/schemas/section.ts` or the existing section schema home). The section create/edit zod schema gains an optional `schedule` enum.

### 4. SIS Admin template editor (`/sis/admin/template`, Sections tab)

- Section add/edit form gains a **Schedule** `<Select>` (Morning / Afternoon / Whole Day, plus "—" for none) — canonical `Select` per design system; not a native input.
- Section rows render a schedule chip (`SCHEDULE_LABELS`); empty when null.
- The create/update section API route(s) accept + persist `schedule` (validated against `SCHEDULE_VALUES`).

### 5. `/sis/sections` (per-AY roster view)

Surface the schedule chip read-only where sections are listed (so the registrar sees it on the AY's applied sections). No new write path here (template editor owns section structure per KD #48/#66).

## Out of scope (explicit)

- **Auto-enrollment** (`class-assignment.ts`) matching `preferredSchedule` against the new `schedule` column — the immediate **next** step/spec.
- **Youngstarters** sections — deferred.
- **Cambridge** curriculum/subjects + `CS1/CS2` level sections.
- **Backfilling existing AYs' sections** — adding the column leaves existing `sections.schedule` null; they get a value when the template is re-applied or a section is edited. `apply_template_to_ay` is non-destructive (won't delete an AY's existing wrong sections) — cleaning a mis-seeded AY stays a manual registrar action, unchanged.

## Data honesty / safety

- Migration is idempotent and scoped to the 10 primary/secondary levels — YS and any other template rows are preserved.
- No data loss in `public.sections` (existing AY rows untouched; only the column is added).
- `class_type` semantics unchanged.

## Verification

- `npx tsc --noEmit` + `npx next build` clean.
- After migration: `template_sections` for P1–P6/S1–S4 = exactly the 21 official rows with correct schedules; YS rows intact.
- Applying the template to a fresh test AY produces `sections` rows carrying `schedule`.
- Template editor: add/edit a section with a schedule → persists + chip renders; reload shows it.
- One small branch; `feature-dev:code-reviewer` pass (focus: the `apply_template_to_ay` / section-copy RPCs re-emitted from live defs with only `schedule` added; idempotent scoped delete; schedule CHECK + label map).
