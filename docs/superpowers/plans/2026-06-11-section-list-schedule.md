# Official section list + structured schedule — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the class template to HFSE's official per-level section list (P1–P6, S1–S4, 21 sections — YS deferred) and add a structured `schedule` field, propagated through `apply_template_to_ay` and editable in SIS Admin. Auto-enrollment consuming the schedule is the NEXT step (not here).

**Architecture:** One migration (add column + reset template rows + thread `schedule` through the template→AY copy RPCs) + schema constants + the SIS Admin template editor (schedule select + chip) + a read-only chip on `/sis/sections`. No auto-enrollment change.

**Tech Stack:** Next.js 16, Supabase/Postgres (migrations user-applied per KD #139), zod, shadcn `Select`, Aurora Vault tokens. **Spec:** `docs/superpowers/specs/2026-06-11-section-list-schedule-design.md`.

---

## File structure

- **Create** `supabase/migrations/074_section_schedule.sql` — add `schedule` to `sections` + `template_sections`; reset template P1–P6/S1–S4 to the official list; re-emit `apply_template_to_ay` (+ any other template→sections copy RPC) to carry `schedule`.
- **Modify** the section schema module (locate: `rg -l "section" lib/schemas`) — add `SCHEDULE_VALUES`/`Schedule`/`SCHEDULE_LABELS` + `schedule` on the section create/edit schema.
- **Modify** the SIS Admin template editor Sections tab + its section create/update API route — schedule `<Select>` + persist + chip. (Locate: `rg -l "template_sections|template/subject|Add section" app/api/sis/admin/template components/sis`.)
- **Modify** the `/sis/sections` roster view — read-only schedule chip. (Locate: `components/sis/*section*` + `app/(sis)/sis/sections`.)

---

## Task 1: Schema constants + section schema

**Files:** the section schema module (find it first), e.g. `lib/schemas/section.ts`.

- [ ] **Step 1: Locate the section schema** — `rg -n "level_id|form_class_adviser|SectionCreate|class_type" lib/schemas` to find where section create/edit zod lives (or confirm there isn't one and add to the nearest section schema file). Read it.

- [ ] **Step 2: Add the schedule constants + field**

```ts
export const SCHEDULE_VALUES = ['morning', 'afternoon', 'whole_day'] as const;
export type Schedule = (typeof SCHEDULE_VALUES)[number];
export const SCHEDULE_LABELS: Record<Schedule, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  whole_day: 'Whole Day',
};
```

Add `schedule: z.enum(SCHEDULE_VALUES).nullable().optional()` to the section create/edit schema (matching its existing style — transform `''`→null if the form sends empty).

- [ ] **Step 3: Verify** — `npx tsc --noEmit 2>&1 | grep -v validator.ts | grep "error TS"` → none.

- [ ] **Step 4: Commit**

```bash
git add lib/schemas/<section-schema-file>.ts
git commit -m "feat(sections): schedule constants + schema field (morning/afternoon/whole_day)"
```

---

## Task 2: Migration — column + official template list + RPC threading

**Files:** Create `supabase/migrations/074_section_schedule.sql`.

- [ ] **Step 1: Read the CURRENT LIVE RPCs that copy template_sections → sections** before writing. `rg -n "apply_template_to_ay|template_sections" supabase/migrations/*.sql` — find the **newest** `create or replace function apply_template_to_ay` body (post-teardown, after migrations 062–066) and any `create_academic_year` / idempotent-setup RPC (migration 030) that inserts into `public.sections` from `template_sections`. Copy each newest body verbatim as the base (KD #119 hazard — never re-emit from a stale body).

- [ ] **Step 2: Write the migration**

```sql
-- Migration 074: structured section schedule + official HFSE template list.
-- Adds sections.schedule + template_sections.schedule (morning/afternoon/whole_day),
-- resets the class template's P1–P6 + S1–S4 rows to HFSE's official virtue sections,
-- and threads `schedule` through every template→sections copy. YS/CS rows untouched.

alter table public.sections
  add column if not exists schedule text
  check (schedule is null or schedule in ('morning','afternoon','whole_day'));

alter table public.template_sections
  add column if not exists schedule text
  check (schedule is null or schedule in ('morning','afternoon','whole_day'));

-- Reset official primary/secondary template sections (idempotent: delete-then-insert,
-- scoped to the 10 levels; YS-L/J/S + CS1/CS2 template rows left intact).
delete from public.template_sections
where level_id in (select id from public.levels
                   where code in ('P1','P2','P3','P4','P5','P6','S1','S2','S3','S4'));

insert into public.template_sections (level_id, name, schedule)
select l.id, v.name, v.schedule
from (values
  ('P1','Obedience','morning'),   ('P1','Patience','morning'),   ('P1','Respect','afternoon'),
  ('P2','Honesty','morning'),     ('P2','Humility','morning'),   ('P2','Gentleness','afternoon'),
  ('P3','Courageous','morning'),  ('P3','Courtesy','morning'),   ('P3','Responsibility','afternoon'),
  ('P4','Diligence','morning'),   ('P4','Trust','morning'),      ('P4','Compassion','afternoon'),
  ('P5','Commitment','morning'),  ('P5','Tenacity','morning'),   ('P5','Perseverance','afternoon'),
  ('P6','Grit','morning'),        ('P6','Loyalty','afternoon'),
  ('S1','Discipline','whole_day'),
  ('S2','Integrity','whole_day'),
  ('S3','Consistency','whole_day'),
  ('S4','Excellence','whole_day')
) as v(level_code, name, schedule)
join public.levels l on l.code = v.level_code;
```

Then append the re-emitted `apply_template_to_ay` (and any other copy RPC found in Step 1) with **only** `schedule` added to the template→sections `SELECT … INSERT …` (every other column/clause identical to the live body). If `apply_template_to_ay` uses a unique key like `(academic_year_id, level_id, name)` for its UPSERT, keep it; just carry `schedule` in the insert + (if it UPDATEs existing) the update set.

- [ ] **Step 3: Hand off for application** — migrations are user-applied (KD #139). Note in the task report that `074` must be applied to test + prod before the UI/verification steps can be checked against real data. Do NOT block the build on it.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/074_section_schedule.sql
git commit -m "feat(sections): migration 074 — schedule column + official template list + RPC threading"
```

---

## Task 3: SIS Admin template editor — schedule select + chip + persistence

**Files:** the template editor Sections tab component + its section create/update API route (locate in Step 1).

- [ ] **Step 1: Locate** — `rg -ln "template_sections|Sections|Add section|class_type" components/sis app/api/sis/admin/template`; read the section add/edit component + the POST/PATCH route(s) that write `template_sections`.

- [ ] **Step 2: API route** — accept `schedule` in the create/update body, validate against `SCHEDULE_VALUES` (or the section zod schema from Task 1), persist to `template_sections.schedule`. Match the route's existing validation style (manual or zod per KD #23).

- [ ] **Step 3: UI** — add a **Schedule** `<Select>` to the section add/edit form (options Morning/Afternoon/Whole Day + a "None" clearing option → null). Use the canonical shadcn `Select` (KD #44 — no native input). Render a schedule chip on each section row via `SCHEDULE_LABELS` (omit when null). Tokens only.

- [ ] **Step 4: Verify** — `npx tsc --noEmit …` (none) + `npx next build` ("Compiled successfully").

- [ ] **Step 5: Commit**

```bash
git add components/sis/<editor>.tsx app/api/sis/admin/template/<route>.ts
git commit -m "feat(sis): template editor — section schedule select + chip + persistence"
```

---

## Task 4: `/sis/sections` read-only schedule chip

**Files:** the `/sis/sections` list component (locate).

- [ ] **Step 1: Locate + read** — `rg -ln "sections" app/(sis)/sis/sections components/sis` → the per-AY section roster list.
- [ ] **Step 2: Add a schedule chip** column/cell using `SCHEDULE_LABELS` (read-only; null → no chip). If the loader doesn't already select `schedule`, add it to the select.
- [ ] **Step 3: Verify** — tsc + `npx next build`.
- [ ] **Step 4: Commit**

```bash
git add app/(sis)/sis/sections/... components/sis/...
git commit -m "feat(sis): show section schedule on the sections roster"
```

---

## Task 5: KD + docs

- [ ] **Step 1:** Append a KD to `.claude/rules/key-decisions/records.md` (next number) — "Structured section schedule + official template list (migration 074). `sections`/`template_sections` gain `schedule` (morning/afternoon/whole_day); the class template's P1–P6/S1–S4 rows reset to HFSE's official virtue sections (name = virtue only; YS deferred); `apply_template_to_ay` + other template→sections copies carry `schedule`; editable in SIS Admin template editor. Auto-enrollment matching `preferredSchedule` against `schedule` is a follow-up. class_type unchanged (admissions dimension)." Add the index row in `.claude/rules/key-decisions.md`.
- [ ] **Step 2: Commit** + run `/sync-docs` if project-layout/migration list needs the 074 entry.

---

## Self-review (against spec)

- Schema column + CHECK + nullable (Task 2). ✓
- Official 21-row list, name=virtue, YS/CS untouched, idempotent (Task 2). ✓
- `apply_template_to_ay` + other copy sites carry schedule, re-emitted from live defs (Task 2 Step 1). ✓
- Constants + label map + schema field (Task 1). ✓
- Template editor select+chip+persist (Task 3); `/sis/sections` chip (Task 4). ✓
- Auto-enrollment explicitly NOT touched. ✓

## Verification (whole feature)

- `npx tsc --noEmit` + `npx next build` green.
- After 074 applied: template P1–P6/S1–S4 = the 21 official rows w/ schedules; YS rows intact; applying to a fresh test AY yields `sections` with `schedule` populated.
- Template editor: add/edit a section schedule → persists + chip; `/sis/sections` shows chips.
- One branch `feat/section-schedule`; `feature-dev:code-reviewer` pass (RPC re-emit correctness, idempotent scoped reset, schema/label consistency); merge + push. Migration 074 user-applied.
