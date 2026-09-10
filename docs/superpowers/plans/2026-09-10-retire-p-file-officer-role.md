# Retire the P-Files Officer role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `p_file_officer` into `admissions`, give `admissions` the Records and P-Files modules, and delete the KD #147 post-enrolment stage freeze so an enrolled student's admission record stays editable.

**Architecture:** Three independent changes that share one theme — fewer gates. (A) `admissions` inherits every capability and route `p_file_officer` held, plus Records; (B) `p_file_officer` is removed from the `Role` union, which makes TypeScript name every Role-keyed map that must lose its key; (C) `isAdmissionsStageFrozen` is deleted along with its two call sites, so the funnel stays editable after enrolment. Capability grants are DATA (`role_permissions` table) mirrored by code defaults (`DEFAULT_ROLE_CAPABILITIES`), so every permission move is a migration **and** a code edit, in that order.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres + RLS), Vitest, Tailwind v4.

**Spec:** This plan's spec is the conversation of 2026-09-10 plus the audit findings recorded in §Background below. There is no separate spec doc.

## Global Constraints

- **Migrations are numbered sequentially and never renumbered.** Next free number is **143** (142 is the highest applied). One migration per task that changes grants.
- **Migrations are applied BY MR ACE, never by an agent.** A task that adds a migration ends by printing the SQL and saying it needs applying — it does not attempt to run it.
- **`p_file_officer` must NOT be deleted from historical data.** `audit_log.actor_role` holds it on past rows. Retire the role from the app; leave every stored string alone.
- ✅ **The deployment-ordering hazard is CLEARED.** Mr Ace moved Louilyn to `admissions` on 2026-09-10 and a direct query confirms **zero accounts hold `p_file_officer`** (admissions now: Apple Grace, Charlene, Louilyn). Task 4 is safe to deploy. The hazard is recorded here anyway because it is the one way this change could have broken production: if the code stops recognising a role while an account still holds it, `getRoleFromClaims` returns a non-role and the app reads that account as a PARENT.
- **Hard Rule #7** — tokens only from `app/globals.css`. No raw hex / `slate-*` / `zinc-*` / `gray-*` in `app/` or `components/`.
- **Tests import vitest globals explicitly** (`import { describe, it, expect } from 'vitest'`) — tsc type-checks test files.
- **Run vitest with `--pool=threads`.** The forks pool times out on this machine. Re-run any failing file isolated with `--testTimeout=30000` before calling it a regression.
- **`git add <pathspec> && git commit` as ONE command.** Parallel agents share one git index; a bare `git add` sweeps up another agent's staged files.

## Background — the audit this plan rests on

Established 2026-09-10 by direct query and grep:

- **Exactly one account holds `p_file_officer`:** `louilyn.gutierrez@vizserve.hfse.edu.sg`. (admissions: 2, school_admin: 14, academic_coordinator: 2, superadmin: 5, teacher: 28.)
- **68 code files** reference `p_file_officer` or the legacy `'p-file'` string; **5 migrations** do (034, 092, 101, 106, 139).
- **No RLS policy names the role.** Policies go through `current_user_role()` and the `role_permissions` table, so there is no policy sweep in this plan.
- `p_file_officer` holds 8 capabilities: `documents_post_enrolment.{read,chase,upload,validate}` and `documents_pre_enrolment.{read,chase,validate,upload}`.
- `admissions` holds 3: `documents_pre_enrolment.{read,chase,validate}`. It is deliberately missing `documents_pre_enrolment.upload` — see the comment in `lib/auth/capabilities.ts`, which says the grant was withheld only because there is no upload surface admissions can reach. This plan gives them the surface, so the grant becomes correct.
- **The freeze is not role-based.** `isAdmissionsStageFrozen` (`lib/schemas/sis.ts:952`) refuses the edit for _every_ role, superadmin included, once `applicationStatus === 'Enrolled'`. `Enrolled (Conditional)` is already fully editable; `supplies` and `orientation` stay editable until finalized.
- **Three application fields change document requirements** when edited: `fatherEmail` (father's passport + pass), `guardianEmail` (guardian's passport + pass), and `applicationStatus === 'Enrolled (Conditional)'` (the Conditional Enrolment slot). Nothing is deleted when a gate closes — the slot is hidden and the stored file stays in its column.

## File Structure

| File                                                             | Responsibility after this plan                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/143_admissions_absorbs_p_file_officer.sql`  | **new** — moves the 8 document capabilities onto `admissions`, deletes `p_file_officer`'s grants               |
| `lib/auth/capabilities.ts`                                       | `DEFAULT_ROLE_CAPABILITIES` — `admissions` gains 5, the `p_file_officer` key is deleted                        |
| `lib/auth/roles.ts`                                              | `Role` union, `ROLES`, `ROUTE_ACCESS` — `p_file_officer` gone, `admissions` added to `/p-files` and `/records` |
| `lib/auth/student-record.ts`                                     | `ENROLMENT_PLACEMENT_WRITERS` gains `admissions`                                                               |
| `lib/auth/role-labels.ts`                                        | drops the `p_file_officer` label                                                                               |
| `lib/copy/data-table.ts`                                         | drops the `p_file_officer` label (the second, deliberate copy)                                                 |
| `lib/schemas/sis.ts`                                             | `isAdmissionsStageFrozen`, `POST_ENROLMENT_EDITABLE_STAGES`, `STAGE_FINALIZED_STATUSES` all deleted            |
| `app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route.ts` | freeze check removed                                                                                           |
| `components/sis/enrollment-tab.tsx`                              | frozen-state UI removed                                                                                        |
| `__tests__/sis/admissions-stage-freeze.test.ts`                  | **deleted** — the rule it guards is gone                                                                       |
| `__tests__/auth/admissions-absorbs-p-files.test.ts`              | **new** — pins the merged permission set                                                                       |

---

### Task 1: Admissions inherits the document capabilities

The permission move, in both places it lives. Nothing user-visible changes yet — `admissions` cannot reach `/p-files` until Task 2 — but the capability layer is correct first, so Task 2's routes open onto rights that already exist rather than the other way round.

**Files:**

- Create: `supabase/migrations/143_admissions_absorbs_p_file_officer.sql`
- Modify: `lib/auth/capabilities.ts` (the `admissions:` block)
- Test: `__tests__/auth/admissions-absorbs-p-files.test.ts` (create)

**Interfaces:**

- Consumes: `DEFAULT_ROLE_CAPABILITIES` and `Capability` from `lib/auth/capabilities.ts`; `ROLES` from `lib/auth/roles.ts`.
- Produces: `admissions` holding all 8 document capabilities. Task 2 and Task 3 both assume this.

- [ ] **Step 1: Write the failing test**

Create `__tests__/auth/admissions-absorbs-p-files.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { DEFAULT_ROLE_CAPABILITIES } from '@/lib/auth/capabilities';

/**
 * 2026-09-10 — the P-Files Officer role was retired and `admissions` took the
 * whole document lifecycle. These are the eight capabilities that role held.
 * If one goes missing, somebody's daily job silently stops working: the
 * officer's queue, staff upload, or the chase emails.
 */
const DOCUMENT_CAPABILITIES = [
  'documents_pre_enrolment.read',
  'documents_pre_enrolment.chase',
  'documents_pre_enrolment.upload',
  'documents_pre_enrolment.validate',
  'documents_post_enrolment.read',
  'documents_post_enrolment.chase',
  'documents_post_enrolment.upload',
  'documents_post_enrolment.validate',
] as const;

describe('admissions absorbs the P-Files officer', () => {
  it('holds every document capability, both sides of enrolment', () => {
    const held = DEFAULT_ROLE_CAPABILITIES.admissions;
    for (const capability of DOCUMENT_CAPABILITIES) {
      expect(held, `admissions must hold ${capability}`).toContain(capability);
    }
  });

  it('does not gain anything outside the document lifecycle', () => {
    // The merge moves documents, not the whole officer's keyring. Anything
    // else appearing here is a widened grant nobody asked for.
    const extra = DEFAULT_ROLE_CAPABILITIES.admissions.filter(
      (c) => !(DOCUMENT_CAPABILITIES as readonly string[]).includes(c)
    );
    expect(extra).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/auth/admissions-absorbs-p-files.test.ts --pool=threads`
Expected: FAIL — `admissions must hold documents_pre_enrolment.upload` (it holds only 3 of the 8).

- [ ] **Step 3: Grant the five missing capabilities in code**

In `lib/auth/capabilities.ts`, replace the whole `admissions:` block (the one whose trailing comment explains why `documents_pre_enrolment.upload` was withheld) with:

```ts
  admissions: [
    // THE WHOLE DOCUMENT LIFECYCLE, BOTH SIDES OF ENROLMENT (2026-09-10).
    // `p_file_officer` was retired and admissions absorbed it — one person
    // already did both jobs, and the role held exactly these eight grants.
    //
    // The note that used to sit here predicted the upload grant exactly: it
    // said the case for `documents_pre_enrolment.upload` was real and was
    // withheld only because "there is nowhere for them to use it — the only
    // upload surface is the P-Files student page, and `/p-files` excludes
    // them at ROUTE_ACCESS". Task 2 of this change opens that route, so the
    // grant is now wired to a real gate rather than being a ticked box.
    'documents_pre_enrolment.read',
    'documents_pre_enrolment.chase',
    'documents_pre_enrolment.upload',
    'documents_pre_enrolment.validate',
    'documents_post_enrolment.read',
    'documents_post_enrolment.chase',
    'documents_post_enrolment.upload',
    'documents_post_enrolment.validate',
  ],
```

⚠ Leave the `p_file_officer:` block exactly where it is. It is removed in Task 4, and removing it here would break `DEFAULT_ROLE_CAPABILITIES`'s `Record<Role, …>` exhaustiveness while `Role` still lists the role.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/auth/admissions-absorbs-p-files.test.ts --pool=threads`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/143_admissions_absorbs_p_file_officer.sql`:

```sql
-- 143_admissions_absorbs_p_file_officer.sql
--
-- Retires the P-Files Officer role by moving its permissions onto admissions.
--
-- WHY. Exactly one account held `p_file_officer` (louilyn.gutierrez@), and the
-- job it describes — chase a parent for a passport, approve what arrives,
-- upload a replacement — is the same job admissions already does on the
-- applicant side. Two roles for one lifecycle meant every document rule had to
-- be written twice and kept in step; migration 106 is the record of them
-- drifting apart and being pushed back together.
--
-- WHAT MOVES
--
--   admissions      GAINS  documents_pre_enrolment.upload
--                          documents_post_enrolment.read / chase / upload / validate
--                          (it already held pre_enrolment read / chase / validate)
--
--   p_file_officer  LOSES  all eight. The role keeps existing as a STRING in
--                          audit_log.actor_role on historical rows — this
--                          migration does not touch those and must not.
--
-- ⚠ ORDER OF OPERATIONS. Every account holding `p_file_officer` must be moved
-- to `admissions` BEFORE the application code drops the role (the commit that
-- edits lib/auth/roles.ts). An account whose role no longer resolves is read by
-- this app as a PARENT. Running this migration alone is safe and reversible —
-- it only changes what the role MAY do, not who holds it.
--
-- Idempotent: inserts skip conflicts, the delete is unconditional on absence.

-- ── Grants added ────────────────────────────────────────────────────────────
insert into public.role_permissions (role, capability) values
  ('admissions', 'documents_pre_enrolment.upload'),
  ('admissions', 'documents_post_enrolment.read'),
  ('admissions', 'documents_post_enrolment.chase'),
  ('admissions', 'documents_post_enrolment.upload'),
  ('admissions', 'documents_post_enrolment.validate')
on conflict (role, capability) do nothing;

-- ── Grants removed ──────────────────────────────────────────────────────────
delete from public.role_permissions where role = 'p_file_officer';
```

- [ ] **Step 6: Verify the migration is well-formed and report it as pending**

Run: `npx tsc --noEmit`
Expected: PASS (no project-source errors; `.next/dev/types/*` noise from a running dev server is not yours).

Then run the full auth suite:

Run: `npx vitest run __tests__/auth --pool=threads`
Expected: PASS.

⚠ **Do not attempt to apply the migration.** Report to Mr Ace that `143` is written and pending, and that applying it alone is safe.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/capabilities.ts __tests__/auth/admissions-absorbs-p-files.test.ts supabase/migrations/143_admissions_absorbs_p_file_officer.sql && git commit -m "feat(auth): admissions absorbs the P-Files officer's document capabilities

Migration 143 pending — apply before deploying Task 4.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Admissions reaches P-Files and Records

Opens the two module routes. `ROUTE_ACCESS` is the proxy's table and each module layout re-asserts the same rule, so both move together or the module renders and then bounces.

**Files:**

- Modify: `lib/auth/roles.ts` — the `/p-files` row (~line 1092) and the `/records` + `/records/academic-summary` rows (~lines 1149-1156)
- Modify: `app/(p-files)/layout.tsx`, `app/(records)/layout.tsx`
- Modify: `lib/sidebar/registry.ts` — module visibility for `admissions`
- Test: `__tests__/auth/route-access-exact.test.ts`, `__tests__/auth/nav-route-consistency-all-modules.test.ts`

**Interfaces:**

- Consumes: `admissions` holding the 8 document capabilities (Task 1).
- Produces: `isRouteAllowed('/p-files', 'admissions') === true` and the same for `/records`. Task 3 assumes admissions can reach `/records`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/auth/admissions-absorbs-p-files.test.ts`:

```ts
import { isRouteAllowed } from '@/lib/auth/roles';

describe('admissions reaches the modules it absorbed', () => {
  it('may open P-Files', () => {
    expect(isRouteAllowed('/p-files', 'admissions')).toBe(true);
    expect(isRouteAllowed('/p-files/2026-0001', 'admissions')).toBe(true);
  });

  it('may open Records', () => {
    expect(isRouteAllowed('/records', 'admissions')).toBe(true);
    expect(isRouteAllowed('/records/academic-summary', 'admissions')).toBe(
      true
    );
  });

  it('still does not reach SIS Admin or the approvers editor', () => {
    // The merge is about student documents and records, not about handing
    // admissions the configuration surfaces.
    expect(isRouteAllowed('/sis/admin/roles', 'admissions')).toBe(false);
    expect(isRouteAllowed('/sis/admin/approvers', 'admissions')).toBe(false);
  });
});
```

⚠ Check `isRouteAllowed`'s exact exported name and signature in `lib/auth/roles.ts` before running — it takes a clean pathname (no query string) and defaults to ALLOW for an unmatched prefix, which is why the negative assertions above target prefixes that DO have rows.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/auth/admissions-absorbs-p-files.test.ts --pool=threads`
Expected: FAIL on the P-Files and Records assertions.

- [ ] **Step 3: Add admissions to the three ROUTE_ACCESS rows**

In `lib/auth/roles.ts`:

```ts
  {
    // `admissions` joined 2026-09-10 when the P-Files officer role was
    // retired and admissions absorbed the whole document lifecycle. They
    // hold every documents_* capability, so the module they reach here is
    // fully theirs rather than a read-only courtesy.
    prefix: '/p-files',
    allowed: ['admissions', 'school_admin', 'superadmin'],
  },
```

```ts
  {
    prefix: '/records/academic-summary',
    allowed: [
      'admissions',
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ],
  },
  {
    prefix: '/records',
    allowed: [
      'admissions',
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ],
  },
```

⚠ The three `/admissions/applications*` rows exist ONLY to let `p_file_officer` open an applicant file without the whole funnel (KD #173). Leave them alone in this task — Task 4 collapses them, and doing it here would make this task's diff span two concerns.

- [ ] **Step 4: Match the layouts to the table**

`app/(p-files)/layout.tsx` and `app/(records)/layout.tsx` each re-assert the route rule. Add `'admissions'` to the allowed list in both, matching the shape already in the file. Read each file first — one uses a role array, and the exact call differs between modules.

- [ ] **Step 5: Make the modules appear in the switcher**

In `lib/sidebar/registry.ts`, `admissions` must now see the `p-files` and `records` modules. The module switcher shows a module iff `isRouteAllowed(primaryHref)`, so Step 3 may already be sufficient — but `lib/sidebar/module-visibility.ts` carries a `hiddenModules` filter that can override it.

Run: `npx vitest run __tests__/auth/module-visibility.test.ts --pool=threads`

If it fails, remove `p-files` / `records` from the `admissions` entry in whichever of those two files declares the hidden set. If it passes, change nothing.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run __tests__/auth --pool=threads`
Expected: PASS. `route-access-exact.test.ts` and `nav-route-consistency-all-modules.test.ts` both enumerate roles against routes and will catch a half-applied change.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/roles.ts "app/(p-files)/layout.tsx" "app/(records)/layout.tsx" lib/sidebar/registry.ts lib/sidebar/module-visibility.ts __tests__/auth/admissions-absorbs-p-files.test.ts && git commit -m "feat(auth): admissions reaches P-Files and Records

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Admissions may place and withdraw students

⚠ **THE ONE TASK WITH A REAL POWER CHANGE IN IT — flag it to Mr Ace before starting.** `lib/auth/student-record.ts:73` documents that `STUDENT_RECORD_WRITERS` and `ENROLMENT_PLACEMENT_WRITERS` "differ by exactly `admissions`, and that difference is the point": admissions may move an applicant through the funnel but may not put a child in a class or withdraw them. Mr Ace asked for admissions to have Records, and Records is where placement lives — so this task closes that gap deliberately. If he wants Records read-only instead, **skip this task entirely**; Task 2 alone gives them the module without the writes.

**Files:**

- Modify: `lib/auth/student-record.ts` — `ENROLMENT_PLACEMENT_WRITERS`
- Modify: `app/api/sections/[id]/students/[enrolmentId]/route.ts:87-91` — the inline `requireRole` list
- Test: `__tests__/auth/admissions-absorbs-p-files.test.ts`

**Interfaces:**

- Consumes: nothing from Tasks 1-2 beyond admissions reaching `/records`.
- Produces: `canPlaceEnrolment('admissions') === true`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/auth/admissions-absorbs-p-files.test.ts`:

```ts
import {
  ENROLMENT_PLACEMENT_WRITERS,
  STUDENT_RECORD_WRITERS,
} from '@/lib/auth/student-record';

describe('admissions may place and withdraw students', () => {
  it('is an enrolment placement writer', () => {
    // The two lists used to differ by exactly this role. They no longer do:
    // admissions owns the child end to end now that Records is theirs.
    expect(ENROLMENT_PLACEMENT_WRITERS).toContain('admissions');
  });

  it('leaves the two writer lists in agreement', () => {
    expect([...ENROLMENT_PLACEMENT_WRITERS].sort()).toEqual(
      [...STUDENT_RECORD_WRITERS].sort()
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/auth/admissions-absorbs-p-files.test.ts --pool=threads`
Expected: FAIL — `ENROLMENT_PLACEMENT_WRITERS` does not contain `admissions`.

- [ ] **Step 3: Add admissions to the placement writers**

In `lib/auth/student-record.ts`:

```ts
// ⚠ THESE TWO LISTS ARE NOW IDENTICAL, and the comment that used to explain
// why they differed is gone on purpose. Until 2026-09-10 admissions could move
// an applicant through the funnel but not put them in a class — the funnel was
// theirs, the placement was Records'. Records is theirs too now (the P-Files
// officer role was retired into it), so the split has nothing left to protect.
// Kept as two names because ~14 call sites read one or the other, and
// collapsing them is a rename, not a permissions change.
export const ENROLMENT_PLACEMENT_WRITERS = [
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
] as const satisfies readonly Role[];
```

- [ ] **Step 4: Match the one route that inlines its own list**

`app/api/sections/[id]/students/[enrolmentId]/route.ts:87` hard-codes the three roles rather than importing the union. Add `'admissions'`:

```ts
const auth = await requireRole([
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
]);
```

⚠ Then grep for any other inlined copy before finishing this step — an inlined list that disagrees with the union is exactly the drift this repo has been bitten by:

```bash
grep -rn "academic_coordinator',$" --include=*.ts app/api/ | head -30
```

Classify every hit: does it guard placement/withdrawal (add `admissions`) or something else (leave it)? Report the full list, including the ones you left, in the task summary.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run __tests__/auth __tests__/sis --pool=threads`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/auth/student-record.ts "app/api/sections/[id]/students/[enrolmentId]/route.ts" __tests__/auth/admissions-absorbs-p-files.test.ts && git commit -m "feat(auth): admissions may place and withdraw students

Records is theirs now, and placement lives in Records.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Remove `p_file_officer` from the Role union

✅ **Cleared to deploy** — Louilyn was moved to `admissions` on 2026-09-10 and zero accounts now hold `p_file_officer`. If you are executing this plan later than that date, re-verify before shipping: an account holding a role the code no longer knows is read by this app as a PARENT.

The union is the lever: `DEFAULT_ROLE_CAPABILITIES` is a `Record<Role, Capability[]>`, `ROLE_LABELS` is a `Record<Role, string>`, and several more Role-keyed maps exist across `lib/sis/` and `components/sis/`. Delete the union member first and **let `tsc` enumerate the rest** — that is a complete list by construction, which a grep is not.

**Files:**

- Modify: `lib/auth/roles.ts` (`Role`, `ROLES`, and the three `/admissions/applications*` ROUTE_ACCESS rows)
- Modify: `lib/auth/capabilities.ts`, `lib/auth/role-labels.ts`, `lib/copy/data-table.ts`
- Modify: whatever else `tsc` names — expect `lib/sis/staff.ts`, `lib/sis/staff-families.ts`, `lib/sis/user-deletion.ts`, `lib/sis/provisioning/credential-workbook.ts`, `components/sis/staff-visuals.tsx`, `lib/schemas/user-admin.ts`, `lib/home/quick-actions.ts`, `lib/account/*`, `scripts/provision-staff-accounts.ts`
- Modify: the ~20 test files that enumerate roles

**Interfaces:**

- Consumes: Tasks 1-3 complete (admissions holds everything the role held).
- Produces: `ROLES.length === 5`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/auth/admissions-absorbs-p-files.test.ts`:

```ts
import { ROLES } from '@/lib/auth/roles';

describe('the P-Files officer role is retired', () => {
  it('is gone from the role list', () => {
    expect(ROLES).not.toContain('p_file_officer');
    expect(ROLES).toHaveLength(5);
  });

  it('left no capability grants behind', () => {
    expect(
      Object.keys(DEFAULT_ROLE_CAPABILITIES),
      'a Role-keyed map still carries the retired role'
    ).not.toContain('p_file_officer');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/auth/admissions-absorbs-p-files.test.ts --pool=threads`
Expected: FAIL — `ROLES` has 6 entries and still contains `p_file_officer`.

- [ ] **Step 3: Delete the union member**

In `lib/auth/roles.ts`, remove `| 'p_file_officer'` from `Role` and `'p_file_officer',` from `ROLES`. Add above the union:

```ts
// ⚠ `p_file_officer` WAS HERE AND IS NOT COMING BACK (retired 2026-09-10).
// Admissions absorbed the whole document lifecycle — the role had exactly one
// holder and described a job admissions already did on the applicant side.
//
// The STRING still exists in the world: `audit_log.actor_role` carries it on
// every row that role ever wrote, and `lib/audit/humanize.ts` must go on
// rendering it. Retired from the app, not deleted from history.
export type Role =
```

- [ ] **Step 4: Let the compiler enumerate the damage**

Run: `npx tsc --noEmit 2>&1 | grep -v '.next/dev/types'`

Every error is a Role-keyed map or exhaustive switch that must lose its `p_file_officer` arm. Work through them one at a time. For the two label maps, delete the whole line:

- `lib/auth/role-labels.ts` — remove the `p_file_officer: 'P-File Officer',` entry AND the paragraph of its docstring that explains the name (it documents a role that no longer exists).
- `lib/copy/data-table.ts` — remove its `p_file_officer` entry from `ROLE_LABELS`. ⚠ That file's docstring says there are two deliberate six-role maps and names the one difference (`school_admin` sentence vs title case). Update the count to five; leave the casing note alone.

⚠ `lib/audit/humanize.ts` is the exception. It renders historical audit rows, whose `actor_role` still reads `p_file_officer`. If `tsc` names it, the fix is to widen its input type to `string`, **not** to delete the case. Check `__tests__/audit/humanize.test.ts` still covers the retired string; if it does not, add a case that pins it.

- [ ] **Step 5: Collapse the three ROUTE_ACCESS carve-outs**

The `/admissions/applications/closed`, `/admissions/applications` (exact) and `/admissions/applications` (detail) rows exist only to let `p_file_officer` open an applicant file without the funnel (KD #173). With the role gone, all three carry the same four roles, so the `exact` split has nothing left to separate. Replace all three with one row:

```ts
  {
    // Was three rows with an `exact` carve-out, which existed only to let the
    // P-Files officer open an applicant FILE without being handed the funnel
    // (KD #173). That role was retired 2026-09-10 and the three rows collapsed
    // to one identical audience, so the carve-out is gone with it.
    prefix: '/admissions/applications',
    allowed: [
      'admissions',
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ],
  },
```

⚠ Verify `__tests__/auth/route-access-exact.test.ts` still passes — it exists to pin the `exact` mechanism, and may assert on these very rows. If it does, update its fixtures to a different `exact` row rather than deleting the test; the mechanism is still used elsewhere.

- [ ] **Step 6: Sweep the tests**

Run: `npx vitest run --pool=threads`

Expected: several role-enumerating suites fail on a missing sixth role. Fix each by deleting the `p_file_officer` case — these are fixtures, not assertions about behaviour. Expect hits in `__tests__/auth/`, `__tests__/sis/user-deletion.test.ts`, `__tests__/sis/credential-workbook.test.ts`, `__tests__/account/`, `__tests__/home/quick-actions.test.ts`, `__tests__/ui/module-sidebar-group-label.test.tsx`.

Re-run any failure isolated with `--testTimeout=30000` before treating it as real.

- [ ] **Step 7: Verify and commit**

Run: `npm run format && npx tsc --noEmit 2>&1 | grep -v '.next/dev/types' && npx vitest run --pool=threads && npm run build`
Expected: all four clean.

```bash
git add -A && git commit -m "refactor(auth): retire the p_file_officer role

Admissions absorbed it. The string survives in audit history.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

⚠ This is the one task where `git add -A` is acceptable, because the change genuinely spans ~60 files. Confirm `git status` first and abort if it shows anything you did not touch.

---

### Task 5: Remove the post-enrolment stage freeze

Independent of Tasks 1-4 — can be done first, last, or in parallel. This is the one Mr Ace said actually bites day to day.

**Files:**

- Modify: `lib/schemas/sis.ts:925-962` — delete `POST_ENROLMENT_EDITABLE_STAGES`, `STAGE_FINALIZED_STATUSES`, `isAdmissionsStageFrozen`
- Modify: `app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route.ts:172-210`
- Modify: `components/sis/enrollment-tab.tsx:1130-1140`
- Modify: `scripts/probe-stage-completion-gate.ts:336-341`
- Delete: `__tests__/sis/admissions-stage-freeze.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: the stage PATCH route no longer 422s on an enrolled student.

- [ ] **Step 1: Write the failing test**

Create `__tests__/sis/enrolled-record-stays-editable.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import * as sis from '@/lib/schemas/sis';

/**
 * KD #147's post-enrolment freeze was removed on 2026-09-10.
 *
 * Mr Ace: *"regarding the prevention of updating admission record in
 * admissions if student is already enrolled we should just enable that its all
 * audit logged anyways"*.
 *
 * The rule froze every funnel stage once `applicationStatus === 'Enrolled'`,
 * for EVERY role including superadmin — it was module ownership, not
 * permissions. A typo in an enrolled child's record was uncorrectable by the
 * people who own that record.
 *
 * ⚠ Every stage edit still writes an audit row. That is what makes removing
 * the freeze safe, and it is the only thing that does.
 */
describe('an enrolled student stays editable', () => {
  it('no longer exports a freeze rule at all', () => {
    expect(
      'isAdmissionsStageFrozen' in sis,
      'the freeze must be deleted, not merely bypassed — a dormant export ' +
        'invites a caller to reintroduce the rule'
    ).toBe(false);
    expect('POST_ENROLMENT_EDITABLE_STAGES' in sis).toBe(false);
    expect('STAGE_FINALIZED_STATUSES' in sis).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/sis/enrolled-record-stays-editable.test.ts --pool=threads`
Expected: FAIL — all three are still exported.

- [ ] **Step 3: Delete the rule**

In `lib/schemas/sis.ts`, delete `POST_ENROLMENT_EDITABLE_STAGES`, `STAGE_FINALIZED_STATUSES` and `isAdmissionsStageFrozen` entirely, along with the KD #147 comment block above them. Leave `ENROLLED_PREREQ_STAGES` and `STAGE_TERMINAL_STATUS` — those gate the Enrolled _flip_, which is a different rule and still wanted.

- [ ] **Step 4: Remove the server check**

In `app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route.ts`, delete the `isAdmissionsStageFrozen` import, the `POST_ENROLMENT_EDITABLE_STAGES` import, the `currentStageStatus` / `currentAppStatus` lookups that exist only to feed it, and the whole `if (isAdmissionsStageFrozen(...)) { … }` block at ~line 200.

⚠ Read the surrounding code before cutting: `currentAppStatus` may be read again further down by the Enrolled-flip logic. If it is, keep the lookup and delete only the `if` block.

Replace the deleted comment block with:

```ts
// ⚠ THERE IS NO POST-ENROLMENT FREEZE ANY MORE (removed 2026-09-10; it was
// KD #147's module-ownership rule). Every funnel stage stays editable after
// a student enrols, for every role that could edit it before.
//
// What makes that safe is the audit row this route already writes on every
// field change — a wrong edit is attributable and reversible, which is what
// the freeze was really buying at the cost of making honest corrections
// impossible.
//
// ⚠ THREE FIELDS STILL HAVE TEETH, and they are worth knowing before anyone
// adds a bulk editor here: `fatherEmail` and `guardianEmail` each gate two
// document slots, and `applicationStatus === 'Enrolled (Conditional)'` gates
// one. Clearing a gate HIDES a slot that may already hold an approved file.
// Nothing is deleted — the column keeps the file and restoring the gate
// brings it back — but no screen shows it while the gate is shut.
```

- [ ] **Step 5: Remove the frozen state from the UI**

In `components/sis/enrollment-tab.tsx` (~line 1134), delete the `frozen` computation and its import, then remove every branch that reads it — the disabled control, any lock icon, and any "frozen" helper text. Read the whole surrounding component before cutting; `frozen` may feed a `disabled` prop that also has other reasons to be true, in which case remove only the `frozen` term from the expression.

⚠ Design-system check before you finish: if removing a lock badge leaves an empty flex row or a dangling separator, fix the layout rather than leaving a gap. See `docs/context/09-design-system.md` §7 craft checklist.

- [ ] **Step 6: Fix the probe script**

`scripts/probe-stage-completion-gate.ts:336` calls the deleted function, and its header (lines 25-27) explains that a blocked-and-frozen row is harmless. Delete the `frozen` computation and the import, and replace the header paragraph with a note that the freeze no longer exists so every blocked row is now reachable and therefore worth reporting.

- [ ] **Step 7: Delete the obsolete test**

```bash
git rm __tests__/sis/admissions-stage-freeze.test.ts
```

- [ ] **Step 8: Run everything**

Run: `npx vitest run --pool=threads && npx tsc --noEmit 2>&1 | grep -v '.next/dev/types'`
Expected: PASS. `__tests__/sis/stage-completion-gate.test.ts` should be unaffected — it guards a different rule.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(sis): an enrolled student's admission record stays editable

Removes KD #147's post-enrolment stage freeze. Every edit is audit logged.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Update the docs and key decisions

The KDs are the project's memory. Leaving them claiming a retired role and a deleted rule is how the next session reintroduces both.

**Files:**

- Modify: `.claude/rules/key-decisions.md` (the KD index)
- Modify: `docs/key-decisions/platform.md` (KD #147, #166, #173)
- Modify: `docs/key-decisions/pfiles.md` (KD #31, #74, #204)
- Modify: `docs/context/12-p-files-module.md` (the Access table)
- Modify: `docs/context/03-workflow-and-roles.md`, `docs/context/14-modules-overview.md`
- Modify: `CLAUDE.md` session context

- [ ] **Step 1: Re-head KD #147 rather than deleting it**

Add at the top of KD #147 in `docs/key-decisions/platform.md`:

> ⚠ **LOCK #1 (the post-enrolment stage freeze) WAS REMOVED 2026-09-10.** Mr Ace: _"we should just enable that its all audit logged anyways"_. The rule froze every funnel stage once a student was fully `Enrolled`, **for every role including superadmin** — it was module ownership, not permissions, and it made an honest correction to an enrolled child's record impossible for the people who own that record. What replaces it is the audit row every stage edit already wrote. ⚠ **The document-ownership half of this KD (Lock #2) still stands** — the document route still picks its capability from the student's enrolment state. Only the stage freeze is gone.

- [ ] **Step 2: Write the new KD**

Append **KD #207** to `docs/key-decisions/platform.md` recording the role retirement: one holder, admissions absorbed all 8 document capabilities plus Records, the string survives in `audit_log.actor_role`, and the ordering hazard (move the account before deploying the code, or the account reads as a parent). Add the row `207 platform` to the quick-lookup in `.claude/rules/key-decisions.md`.

- [ ] **Step 3: Fix the P-Files access table**

`docs/context/12-p-files-module.md`'s "Access" table lists `p-file officer` and a stale `registrar`. Rewrite it for the five surviving roles. ⚠ While in there, fix a second staleness this plan's audit found: the doc lists 3 STP-conditional slots as live, but they were **removed in KD #96** — parents upload those to ICA directly. The doc also says "Sixteen total slots" in one place and "21-slot list" in another. Reconcile against `lib/p-files/document-config.ts`, which is the source of truth.

- [ ] **Step 4: Update CLAUDE.md**

Replace the session-context block with one describing this change. Keep it to the shape the file already uses: what changed, what will bite, what is still open.

- [ ] **Step 5: Commit**

```bash
git add docs/ CLAUDE.md .claude/rules/key-decisions.md && git commit -m "docs: record the p_file_officer retirement and the freeze removal

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes

- **Coverage.** Phase 2 (retire the role) = Tasks 1, 2, 4. Phase 3 (Records access) = Tasks 2 + 3. Phase 4 (drop the freeze) = Task 5. Task 6 covers the documentation debt none of the three phases would otherwise pay.
- **The one open decision** is Task 3. Mr Ace said "let admissions have access to records", which reads as full access, but placement and withdrawal are a real power increase and the code comments call the current exclusion deliberate. Task 3 is written to be skippable without touching any other task.
- **Ordering hazard: resolved 2026-09-10.** Louilyn is on `admissions`; zero accounts hold `p_file_officer`. Verified by direct query, not assumed.
- **Migration 143 is written but not applied.** Applying it early is safe — it changes what the role may do, not who holds it.
