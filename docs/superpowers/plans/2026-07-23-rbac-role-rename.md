# RBAC Role Rename (`registrar`→`academic_coordinator`, `p-file`→`p_file_officer`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `Role` union values `'registrar'` → `'academic_coordinator'` and `'p-file'` → `'p_file_officer'` everywhere they appear as role identifiers (types, route gates, RLS, seeders, UI labels), with **zero change to any permission, route-access rule, or RLS predicate** — every touch point is a like-for-like string substitution, verified end-to-end.

**Architecture:** `Role` is a TypeScript literal union (`lib/auth/roles.ts`) consumed almost everywhere through functions typed `Role` or `Role[]` (`requireRole(allowed: Role[])`, `ROUTE_ACCESS: Array<{ allowed: Role[] }>`, `NavItem.requiresRoles?: Role[]`). Renaming the union and then running `tsc --noEmit` turns the compiler into an exhaustive, zero-miss worklist for every **type-checked** call site — that's the bulk of the ~144 (`'registrar'`) + ~29 (`'p-file'`) files found in the pre-plan scope search. A small number of sites are **not** type-checked against `Role` (a `Set<string>` in the seeder, a hand-synced zod enum, plain-string UI labels, test assertions comparing against raw strings) and need a separate, explicitly enumerated pass. The database side is a single new migration: one `UPDATE` flipping existing users' stored `app_metadata.role`, and one `CREATE OR REPLACE FUNCTION` updating the _body_ of `is_registrar_or_above()` — its **name stays unchanged** (established precedent: migration 039 kept this exact function name through the earlier `admin`→`school_admin` merge; renaming it would require touching every RLS policy that calls it, for zero functional gain).

**Tech Stack:** TypeScript (Next.js 16 App Router), Supabase Postgres (RLS), Zod, Vitest.

## Global Constraints

- Zero change to any `ROUTE_ACCESS` allowed-role set, any RLS policy predicate, or any module a role can reach — this is a rename, not a permissions change (spec §3, §5).
- Do not edit existing files under `supabase/migrations/` — add a new migration only (spec §4).
- Do not rewrite historical KD prose in `.claude/rules/key-decisions/*.md` — the sole exception is KD #2 (the living role-definition index, already precedent-edited once before for the `admin`→`school_admin` merge); every other KD stays frozen (spec §5, §7).
- The SQL function `is_registrar_or_above()` keeps its exact name; only its body changes.
- Distinguish "P-Files" the **module name** (never renamed) from "P-Files" the **role display label** (renamed to "P-File Officer") — several files use the string for both purposes.
- Seed actor email addresses (`'registrar.seed@hfse.test'`, `'p-file.seed@hfse.test'` in `lib/sis/seeder/populated.ts`) are cosmetic identifiers referenced by KD #83's seeder documentation — **do not rename them**, they are not role values.

---

### Task 1: Rename the two authoritative role definitions

**Files:**

- Modify: `lib/auth/roles.ts:3-18` (the `Role` union + `ROLES` array)
- Modify: `lib/schemas/user-admin.ts:8-15` (the hand-synced `RoleEnum` zod schema — its own comment warns it drifts from `Role` silently: "if you add a role, update both")

**Interfaces:**

- Produces: the new `Role` union member values `'academic_coordinator'` and `'p_file_officer'`, which every later task's compiler-driven sweep depends on.

- [ ] **Step 1: Capture a pre-change baseline**

Run these two commands and record their output — later verification compares against this baseline, not an assumed number:

```bash
npx tsc --noEmit
npx vitest run 2>&1 | tail -5
```

Expected: `tsc` exits 0 (clean, since nothing has changed yet). Note the vitest pass count from the summary line (e.g. "Tests 1442 passed").

- [ ] **Step 2: Rename in `lib/auth/roles.ts`**

Change:

```ts
export type Role =
  | 'teacher'
  | 'registrar'
  | 'school_admin'
  | 'superadmin'
  | 'p-file'
  | 'admissions';

export const ROLES: Role[] = [
  'teacher',
  'registrar',
  'school_admin',
  'superadmin',
  'p-file',
  'admissions',
];
```

to:

```ts
export type Role =
  | 'teacher'
  | 'academic_coordinator'
  | 'school_admin'
  | 'superadmin'
  | 'p_file_officer'
  | 'admissions';

export const ROLES: Role[] = [
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
  'p_file_officer',
  'admissions',
];
```

Do **not** touch anything else in this file yet — every other `'registrar'`/`'p-file'` occurrence in this same file (in `PFILES_NAV`, `RECORDS_NAV`, `ATTENDANCE_NAV`, `ADMISSIONS_NAV`, `EVALUATION_NAV`, `SIS_NAV`, `NAV_BY_MODULE.markbook.registrar`, `ROUTE_ACCESS`) is now a **type error** — that's the intended signal Task 2 works from. Leave them as compile errors for now.

- [ ] **Step 3: Rename in `lib/schemas/user-admin.ts`**

Change:

```ts
const RoleEnum = z.enum([
  'teacher',
  'registrar',
  'school_admin',
  'superadmin',
  'p-file',
  'admissions',
]);
```

to:

```ts
const RoleEnum = z.enum([
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
  'p_file_officer',
  'admissions',
]);
```

This schema has no compile-time link to `Role` (its own comment says so) — it will not show up in Task 2's `tsc` sweep, which is why it's fixed explicitly here, in the same task as the type it mirrors, so the two never drift out of sync mid-plan.

- [ ] **Step 4: Confirm the expected error count exists**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: a large number (>100) of errors, all of the shape `Type '"registrar"' is not assignable to type 'Role'` or `Type '"p-file"' is not assignable to type 'Role'`. This confirms Step 2 correctly seeded the worklist for Task 2. Do not attempt to fix any of them in this task.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/roles.ts lib/schemas/user-admin.ts
git commit -m "refactor(auth): rename Role union values (registrar->academic_coordinator, p-file->p_file_officer)"
```

---

### Task 2: Compiler-driven repo-wide sweep of type-checked call sites

**Files:**

- Modify: every file `npx tsc --noEmit` reports an error in, following Task 1's rename. This is expected to include (non-exhaustive — the compiler is the source of truth): `lib/auth/roles.ts` (its own `PFILES_NAV`/`RECORDS_NAV`/`ATTENDANCE_NAV`/`ADMISSIONS_NAV`/`EVALUATION_NAV`/`SIS_NAV`/`NAV_BY_MODULE`/`ROUTE_ACCESS` blocks left mid-error by Task 1), the majority of `app/api/**/route.ts` files (`requireRole([...])` calls), route-group `layout.tsx` guards, page-level inline role checks, `lib/sidebar/registry.ts`, `lib/sidebar/use-realtime-badges.ts`, `lib/auth/staff-list.ts`, `lib/change-requests/sidebar-counts.ts`.

**Interfaces:**

- Consumes: the renamed `Role` union from Task 1.
- Produces: a codebase where `npx tsc --noEmit` exits 0, with every `Role`-typed position using the new literal values.

- [ ] **Step 1: Run the compiler and capture the error list**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | head -50
```

Each line has the shape `path/to/file.ts:LINE:COL - error TS2322: Type '"registrar"' is not assignable to type 'Role'. ...` (or the `'p-file'` equivalent, or `Type '"registrar"' is not assignable to type 'Role[]'` inside an array literal). The file path and line number tell you exactly where to fix.

- [ ] **Step 2: Fix each reported file**

For every error, open the reported file and replace the exact literal at that position:

- `'registrar'` → `'academic_coordinator'`
- `'p-file'` → `'p_file_officer'`

**Worked example** — `lib/auth/roles.ts`'s own `SIS_NAV` block (already in this repo, left broken by Task 1) shows the pattern every other file follows:

Before:

```ts
{
  href: '/records/insights',
  label: 'Insights',
  requiresRoles: ['registrar', 'school_admin', 'superadmin'],
},
```

After:

```ts
{
  href: '/records/insights',
  label: 'Insights',
  requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
},
```

And in `ROUTE_ACCESS`:

Before:

```ts
{ prefix: '/p-files', allowed: ['p-file', 'school_admin', 'superadmin'] },
```

After:

```ts
{ prefix: '/p-files', allowed: ['p_file_officer', 'school_admin', 'superadmin'] },
```

**Do not change anything else on the touched lines** — route prefixes (`'/p-files'`, `'/sis/admin/staff'`, etc.) are URL paths and module names, not role values; they stay exactly as they are. Only the role-string literals inside `Role`/`Role[]`-typed positions change.

A `requireRole([...])` call site follows the identical pattern, e.g. in an API route:

Before:

```ts
const guard = await requireRole(['registrar', 'school_admin', 'superadmin']);
```

After:

```ts
const guard = await requireRole([
  'academic_coordinator',
  'school_admin',
  'superadmin',
]);
```

- [ ] **Step 3: Re-run and repeat until clean**

```bash
npx tsc --noEmit
```

Fixing one file sometimes reveals no new errors (each error is independent — they don't cascade), but re-run after each batch of ~10-15 fixes to track progress and catch typos.

Continue until the command exits 0 with no output.

- [ ] **Step 4: Confirm zero remaining `Role`-typed old-value errors**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: `0`.

- [ ] **Step 5: Commit**

Commit in one or a few logical batches (e.g. by module) rather than one file at a time — this is mechanical, uniform work, so a handful of commits covering all touched files is appropriate:

```bash
git add -A
git commit -m "refactor(auth): apply Role rename across all type-checked call sites"
```

---

### Task 3: Fix role-string usages the compiler cannot see

Some role-string comparisons are not type-checked against `Role` (untyped `Set<string>`, plain test assertions, an already-fixed zod enum in Task 1). These are enumerated explicitly here because `tsc` gives no error for them — they were found by direct inspection during planning, not guessed.

**Files:**

- Modify: `lib/sis/seeder/populated.ts:2625-2630` (the `STAFF_ROLES` set)
- Modify: `__tests__/sis/hub-snapshot.test.ts`
- Modify: `__tests__/change-requests/slot-index-ceiling.test.ts`
- Modify: `__tests__/change-requests/decide.test.ts`

**Interfaces:**

- Consumes: nothing new — pure string-literal fixes.
- Produces: no remaining `'registrar'`/`'p-file'` role-value string outside SQL migrations and frozen KD prose (verified in Task 7).

- [ ] **Step 1: Fix the seeder's untyped role set**

In `lib/sis/seeder/populated.ts`, find:

```ts
const STAFF_ROLES = new Set([
  'teacher',
  'registrar',
  'school_admin',
  'superadmin',
]);
```

Change to:

```ts
const STAFF_ROLES = new Set([
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
]);
```

**Do not touch** `SEEDER_ACTOR_EMAIL = 'registrar.seed@hfse.test'` (line 30) or `replaced_by_email: 'p-file.seed@hfse.test'` (line ~3613) — these are synthetic seed-data email addresses referenced by KD #83's own documentation, not role values. Leave both exactly as they are.

- [ ] **Step 2: Grep the seeder for any other untyped role-string comparisons**

```bash
grep -n "'registrar'\|'p-file'" lib/sis/seeder/populated.ts
```

Expected after Step 1: only the two seed-actor-email lines noted above remain. If any other hit appears that IS a role-value comparison (not an email string), fix it the same way as Step 1.

- [ ] **Step 3: Fix the three test files**

```bash
grep -n "'registrar'\|'p-file'" __tests__/sis/hub-snapshot.test.ts __tests__/change-requests/slot-index-ceiling.test.ts __tests__/change-requests/decide.test.ts
```

For each hit, replace `'registrar'` → `'academic_coordinator'` and `'p-file'` → `'p_file_officer'` — these are almost certainly test fixtures constructing a role value to assert behavior against (e.g. `role: 'registrar'` in a mock user object), not narrative text, so the substitution is direct.

- [ ] **Step 4: Run the affected tests**

```bash
npx vitest run __tests__/sis/hub-snapshot.test.ts __tests__/change-requests/slot-index-ceiling.test.ts __tests__/change-requests/decide.test.ts
```

Expected: all pass (the rename is a value substitution, not a logic change — if a test fails here, the fixture wasn't renamed consistently on both sides of an equality check).

- [ ] **Step 5: Commit**

```bash
git add lib/sis/seeder/populated.ts __tests__/sis/hub-snapshot.test.ts __tests__/change-requests/slot-index-ceiling.test.ts __tests__/change-requests/decide.test.ts
git commit -m "refactor(auth): fix role-string literals not caught by the Role type (seeder set + test fixtures)"
```

---

### Task 4: Update user-facing role display labels

Role **display text** (what a badge/chip/dropdown shows a human) is a plain string, not type-checked against `Role`, and was deliberately left out of Tasks 2-3 because each site needs a judgment call: is this string naming the **role** (rename it) or the **module** (leave it)?

**Files:**

- Modify: `components/sis/staff-visuals.tsx:84-91` (`ROLE_CHIP_LABEL` — the primary role-label map; also review `ROLE_CHIP_TONE` keys, which Task 2 already updated as `Role`-typed, to confirm the tone/label maps still line up 1:1)
- Modify: `components/sis/staff-accounts-client.tsx` — review for a role-selection dropdown's option labels
- Modify: `lib/sidebar/registry.ts` — review "Registrar"/"P-Files" hits
- Modify: `lib/sis/dashboard.ts` — review "Registrar"/"P-Files" hits
- Modify: `lib/sis/hub-module-overview.ts` — review "Registrar"/"P-Files" hits
- Modify: `components/sis/hub-snapshot-card.tsx` — review "Registrar"/"P-Files" hits
- Modify: `lib/p-files/drill.ts` — review "P-Files" hits (this one is very likely the **module** name, not the role — confirm before touching)
- Modify: `app/(records)/records/students/[studentNumber]/page.tsx` — review "Registrar"/"P-Files" hits
- Modify: `app/(dashboard)/page.tsx` — review "Registrar"/"P-Files" hits
- Modify: `components/module-sidebar/sidebar-profile.tsx` — review "Registrar"/"P-Files" hits

**Interfaces:**

- Consumes: nothing new.
- Produces: every human-facing role label reads "Academic Coordinator" / "P-File Officer" instead of "Registrar" / "P-Files"; every human-facing **module** name reads "P-Files" unchanged.

- [ ] **Step 1: Update the primary label map in `staff-visuals.tsx`**

Change:

```ts
const ROLE_CHIP_LABEL: Record<Role, string> = {
  teacher: 'Teacher',
  registrar: 'Registrar',
  school_admin: TABLE_COPY.schoolAdmin,
  superadmin: 'Superadmin',
  'p-file': 'P-Files',
  admissions: 'Admissions',
};
```

to:

```ts
const ROLE_CHIP_LABEL: Record<Role, string> = {
  teacher: 'Teacher',
  academic_coordinator: 'Academic Coordinator',
  school_admin: TABLE_COPY.schoolAdmin,
  superadmin: 'Superadmin',
  p_file_officer: 'P-File Officer',
  admissions: 'Admissions',
};
```

(The object keys `registrar`/`p-file` were already forced to their new spellings by Task 2's `tsc` sweep since this `Record<Role, string>` is `Role`-typed — if Task 2 already renamed the keys, this step is only about the **values** on the right-hand side.)

- [ ] **Step 2: Walk each remaining file from the Files list**

For each file, run:

```bash
grep -n "Registrar\|P-Files" <file>
```

At each hit, read enough surrounding context to decide:

- **Is this a role label** (e.g. inside a role→text lookup, a `<Select>` option for choosing someone's role, a sentence describing what a logged-in user with this role sees)? → rename: `Registrar` → `Academic Coordinator`, `P-Files` → `P-File Officer`.
- **Is this the module name** (e.g. a nav link label, a page title, a sentence about "the P-Files module" or "the P-Files dashboard")? → leave unchanged.

If a single file has both kinds of hit (plausible for `lib/sis/dashboard.ts` or `hub-module-overview.ts`, which surface both a module tile AND may reference role-gated visibility), handle each hit independently — do not blanket-replace the file.

- [ ] **Step 3: Verify no remaining role-label hits**

```bash
grep -rn "'Registrar'\|\"Registrar\"" --include="*.ts" --include="*.tsx" .
```

Expected: zero hits, OR only hits you've confirmed in Step 2 are intentionally something else (there should be none — "Registrar" as a bare capitalized word is not used for anything but the role label in this codebase).

- [ ] **Step 4: Manual smoke check of the Staff page**

Since there's no browser access in this environment, do a careful static read-through: open `components/sis/staff-visuals.tsx`'s `RoleChip` component and confirm it renders `ROLE_CHIP_LABEL[role]` — trace that the updated map value ("Academic Coordinator") will actually reach the rendered badge text for a user whose `role === 'academic_coordinator'`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ui): update role display labels (Registrar->Academic Coordinator, P-Files role label->P-File Officer)"
```

---

### Task 5: New Supabase migration — data migration + RLS helper update

**Files:**

- Create: `supabase/migrations/092_rename_registrar_and_pfile_roles.sql`

**Interfaces:**

- Consumes: nothing (pure SQL).
- Produces: existing `auth.users` rows with the old role strings now carry the new ones; `public.is_registrar_or_above()` (name unchanged) now checks the new role string.

- [ ] **Step 1: Write the migration**

```sql
-- 092_rename_registrar_and_pfile_roles.sql
--
-- Rename two role values app-wide: 'registrar' -> 'academic_coordinator',
-- 'p-file' -> 'p_file_officer'. This is a rename, not a permissions change —
-- every RLS policy and application-level ROUTE_ACCESS rule keeps its exact
-- existing logic; only the role string each checks against changes.
--
-- Context: 'registrar' misdescribed the role's actual job (school-wide
-- academic artifacts — grading sheets, attendance workbooks, report cards —
-- not enrollment/records-office work); 'p-file' was internal jargon. See
-- KD #155 (docs) for the full rationale and the 3-family display grouping
-- this pairs with.
--
-- Precedent: migration 039 (admin -> school_admin) kept the SQL helper
-- function's name unchanged through an earlier role merge, updating only
-- its body via CREATE OR REPLACE. This migration follows the same pattern —
-- renaming the function itself would require touching every RLS policy that
-- calls it, for zero functional gain.
--
-- Idempotent — re-running on a database that already lacks 'registrar'/
-- 'p-file' users is a no-op for the UPDATE, and the function CREATE OR
-- REPLACE re-issues the same definition.

-- 1) Flip live auth users from the old role strings to the new ones.
update auth.users
set raw_app_meta_data = jsonb_set(
  raw_app_meta_data,
  '{role}',
  '"academic_coordinator"'
)
where (raw_app_meta_data ->> 'role') = 'registrar';

update auth.users
set raw_app_meta_data = jsonb_set(
  raw_app_meta_data,
  '{role}',
  '"p_file_officer"'
)
where (raw_app_meta_data ->> 'role') = 'p-file';

-- 2) Refresh is_registrar_or_above() to check the renamed role string.
--    Function NAME is intentionally unchanged (see header note above).
create or replace function public.is_registrar_or_above()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('academic_coordinator', 'school_admin', 'superadmin');
$$;

comment on function public.is_registrar_or_above() is
  'True when the caller has a role of academic_coordinator, school_admin, or superadmin. Function name predates the registrar->academic_coordinator rename (KD #155) and is kept for RLS policy-reference stability. Used to gate registrar-only tables (e.g. grade_audit_log).';
```

- [ ] **Step 2: Apply the migration to the project's Supabase instance**

Follow this repo's normal migration-apply process (the same one used for every prior numbered migration — check `docs/context/04-database-schema.md` or ask the user if the apply mechanism isn't obvious from the repo; this project's migrations are applied to a single shared Supabase project per KD #1, covering both the test AY9999 environment and production).

- [ ] **Step 3: Verify the data migration**

Run against the live database (via the Supabase SQL editor or equivalent):

```sql
select id, raw_app_meta_data ->> 'role' as role
from auth.users
where (raw_app_meta_data ->> 'role') in ('registrar', 'p-file', 'academic_coordinator', 'p_file_officer');
```

Expected: zero rows with `role` = `'registrar'` or `'p-file'`; every previously-affected user now shows `'academic_coordinator'` or `'p_file_officer'`.

- [ ] **Step 4: Verify the RLS helper**

```sql
select proname, prosrc from pg_proc where proname = 'is_registrar_or_above';
```

Expected: the function body contains `'academic_coordinator'`, not `'registrar'`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/092_rename_registrar_and_pfile_roles.sql
git commit -m "feat(db): migration to rename registrar/p-file role values on existing users + RLS helper"
```

---

### Task 6: Documentation — KD update + new KD entry

**Files:**

- Modify: `.claude/rules/key-decisions/platform.md` — update KD #2's role list/descriptions; add new KD entry (next unused number — confirm the current highest number in `.claude/rules/key-decisions.md`'s quick-lookup before choosing it, since other work may have landed since this plan was written)
- Modify: `.claude/rules/key-decisions.md` — add the new KD's row to the quick-lookup index and the topic-file table's KD list for `platform.md`

**Interfaces:**

- Consumes: nothing.
- Produces: an accurate, discoverable record of the rename for future sessions, following this codebase's established KD convention.

- [ ] **Step 1: Confirm the next available KD number**

Open `.claude/rules/key-decisions.md` and read the quick-lookup line's highest number (as of this plan being written, the highest is #154, with gaps at 19/26/30/86 — but re-check, since other work may have added KDs since). Use the next integer after the current highest.

- [ ] **Step 2: Update KD #2 in `platform.md`**

Find:

```markdown
### KD #2

Roles in `app_metadata.role` (`teacher | registrar | school_admin | superadmin | p-file | admissions`); no `user_roles` table. `p-file` is module-scoped; `school_admin` is the consolidated cross-cutting generalist (Sprint 33 — old `admin` retired, see KD #39). HFSE staff fall into one of: teacher (subject + form-class advisers), registrar (Joann), school_admin (office staff including IT-equivalent + executive viewers + the former admin tier), superadmin (system config break-glass), p-file (renewals officer), admissions (funnel team).
```

Replace with (using `<N>` as the actual new KD number chosen in Step 1):

```markdown
### KD #2

Roles in `app_metadata.role` (`teacher | academic_coordinator | school_admin | superadmin | p_file_officer | admissions`); no `user_roles` table. `p_file_officer` is module-scoped; `school_admin` is the consolidated cross-cutting generalist (Sprint 33 — old `admin` retired, see KD #39). `registrar` and `p-file` were renamed to `academic_coordinator` and `p_file_officer` respectively — see KD #<N>. HFSE staff fall into one of: teacher (subject + form-class advisers), academic_coordinator (Joann — school-wide grading sheets, attendance workbooks, consolidated forms, report cards), school_admin (office administrative staff + executive/oversight viewers), superadmin (IT/technical lead + CEO — system config break-glass), p_file_officer (renewals officer), admissions (funnel team).
```

(This corrects two things at once: the role rename, and a stale description caught during this project — "IT-equivalent" belongs under `superadmin`, not `school_admin`.)

- [ ] **Step 3: Add the new KD entry**

Append to `platform.md`, after KD #150 (the file's current last entry), using `<N>` for the number chosen in Step 1:

```markdown
### KD #<N>

Role rename: `registrar` → `academic_coordinator`, `p-file` → `p_file_officer` (2026-07-23; migration 092). Pure rename, zero permission change — every `ROUTE_ACCESS` rule and RLS policy keeps its exact existing allowed-role set/predicate, spelled with the new strings. Motivation: `registrar` misdescribed the role — the person holding it (Joann) does school-wide academic-artifact work (grading sheets, attendance workbooks, consolidated forms, report cards), not enrollment/records-office work; `p-file` was internal jargon with no meaning outside this codebase. Also introduces a **display-only** 3-family grouping (not a schema/access concept) for UI presentation: **Academics** (`teacher`, `academic_coordinator`), **Admissions & Enrollment** (`admissions`, `p_file_officer`), **Admin** (`school_admin`, `superadmin`). `academic_coordinator` keeps every access `registrar` had, including the Admissions operational visibility (KD #74) and full Records access, unchanged by its "Academics" family placement. Precedent for the rename mechanics: KD #39 (`admin`→`school_admin`). The SQL helper `is_registrar_or_above()` keeps its exact function name through this rename (only its body's checked string changed) — same reasoning KD #39 used. Historical KD prose elsewhere that already says "registrar"/"p-file" (dozens of entries) is deliberately **not** rewritten — KD #2 above is the sole exception, being the living role-definition index rather than a historical decision narrative. Spec: `docs/superpowers/specs/2026-07-23-rbac-rename-and-staff-page-design.md`; plan: `docs/superpowers/plans/2026-07-23-rbac-role-rename.md`.
```

- [ ] **Step 4: Update the topic-file table and quick-lookup index in `key-decisions.md`**

In the `platform.md` row of the topic-file table, append `, <N>` to the KD list column, and append `· <N> platform` to the quick-lookup line (matching the existing comma/dot-separated format for that row).

- [ ] **Step 5: Commit**

```bash
git add .claude/rules/key-decisions/platform.md .claude/rules/key-decisions.md
git commit -m "docs: KD entry for the registrar/p-file role rename + KD #2 refresh"
```

---

### Task 7: Full verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: TypeScript**

```bash
npx tsc --noEmit
```

Expected: exit 0, no output.

- [ ] **Step 2: Full test suite**

```bash
npx vitest run
```

Expected: same pass count as the Task 1 Step 1 baseline (or higher, if unrelated work landed a new test in the meantime — the point is zero _failures_, not an exact count match if the baseline is stale). Zero failures either way.

- [ ] **Step 3: Production build**

```bash
npx next build
```

Expected: clean compile, no errors.

- [ ] **Step 4: Final repo-wide grep for remaining role-value strings**

```bash
grep -rln "'registrar'\|'p-file'" --include="*.ts" --include="*.tsx" . | grep -v node_modules
```

Expected: zero files, **except** `lib/sis/seeder/populated.ts` (which still legitimately contains the two seed-actor email strings `'registrar.seed@hfse.test'` and `'p-file.seed@hfse.test'` — confirm any remaining hit in that file is one of those two, not a role value that slipped through).

- [ ] **Step 5: Confirm SQL migrations were not edited**

```bash
git diff --stat main -- supabase/migrations/
```

Expected: only the new `092_rename_registrar_and_pfile_roles.sql` file shows as added; zero existing migration files show as modified.

- [ ] **Step 6: Report**

Summarize: tsc clean, vitest pass count vs. baseline, build clean, grep sweep clean (with the one documented exception), migrations untouched except the new file. This is the "won't break our code" confirmation the user asked for.

**Known gap this plan cannot close:** there is no browser or live-credentials access in this execution environment, so an actual end-to-end login as a real `academic_coordinator`/`p_file_officer` account cannot be exercised here. Task 5 Steps 3-4 verify the migration at the database-row level (the stored role string and the RLS function body are correct), which is the strongest verification available without a live session. Flag to the user that a real login smoke-test (one academic_coordinator account, one p_file_officer account, confirming they land on their normal dashboard with their normal nav) is worth doing once this ships to an environment they can access.

---

## Notes for Phase 2 (out of scope for this plan)

Once this plan's Task 7 verification is clean and the user has confirmed the rename is live and safe, the Staff page (`/sis/admin/staff`) enhancement — grouping the directory by the 3 families — is a separate follow-on effort requiring its own `frontend-design` mockup pass per this project's standing UI-work convention (spec §6). Do not start it as part of this plan.
