# RBAC Role Rename + Regrouping, then Staff Page Enhancement

**Date:** 2026-07-23
**Status:** Draft for review
**Scope:** Phase 1 — rename 2 role values, reorganize all 6 roles into 3 conceptual families (zero permission change). Phase 2 (sequenced after Phase 1) — enhance `/sis/admin/staff` to present roles grouped by those families.

---

## 1. Problem & motivation

The current `Role` union (`teacher | registrar | school_admin | superadmin | p-file | admissions`) reads as a flat, unlabeled list of 6 similarly-weighted values. Two problems surfaced in review:

1. **`registrar` is the wrong name for what that role actually does.** The person holding it (Miss Joan) doesn't do enrollment/records-office work — she produces school-wide academic artifacts: grading sheets, attendance workbooks, consolidated forms, report cards. The name implies an admissions/records function she doesn't perform, and has misled this codebase's own documentation before (KD #2 describes her as "registrar," which reads as an enrollment-office title).
2. **`p-file` is internal jargon** ("permanent file") that doesn't read as a job description to someone unfamiliar with the system.
3. **The 6 roles have no visible structure.** They actually cluster into 3 real job families at HFSE — academic staff, admissions/enrollment staff, and system/executive admin — but nothing in the code or UI reflects that grouping today.

## 2. Goal

**Phase 1:** Rename `registrar` → `academic_coordinator` and `p-file` → `p_file_officer`, and present all 6 roles grouped under 3 families, with **zero change to who can do what** — every `ROUTE_ACCESS` rule and RLS policy keeps its exact existing logic, just spelled with the new role strings.

**Phase 2:** Once the rename ships, redesign `/sis/admin/staff` to display and manage staff grouped by those 3 families instead of a flat list.

## 3. Locked role model

| Family                      | Role (new value)       | Renamed from  | Who / what they do                                                                                                                                                                                                                                                           |
| --------------------------- | ---------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Academics**               | `teacher`              | _(unchanged)_ | Subject + form-class advisers. Modules: Attendance, Markbook, Evaluation.                                                                                                                                                                                                    |
| **Academics**               | `academic_coordinator` | `registrar`   | Miss Joan — school-wide grading sheets, attendance workbooks, consolidated forms, report cards. Keeps her full current access (Markbook, Attendance, Evaluation, Records, and the Admissions operational visibility KD #74 already grants her) — **unchanged**, not trimmed. |
| **Admissions & Enrollment** | `admissions`           | _(unchanged)_ | Funnel/enrollment team.                                                                                                                                                                                                                                                      |
| **Admissions & Enrollment** | `p_file_officer`       | `p-file`      | Renewals/documents officer.                                                                                                                                                                                                                                                  |
| **Admin**                   | `school_admin`         | _(unchanged)_ | Office administrative staff, executive/oversight viewers.                                                                                                                                                                                                                    |
| **Admin**                   | `superadmin`           | _(unchanged)_ | IT/technical lead, CEO — break-glass system config.                                                                                                                                                                                                                          |

**Explicitly decided, not left ambiguous:**

- This is a **rename + regroup**, not a permission redesign. No `ROUTE_ACCESS` rule's allowed-role set changes in meaning — only the literal strings `'registrar'` and `'p-file'` are replaced everywhere they appear, 1:1, with `'academic_coordinator'` and `'p_file_officer'`.
- `academic_coordinator` keeps every module/data access `registrar` has today, including the Admissions operational visibility (KD #74) and full Records access — even though she's filed under "Academics" for display purposes. The family grouping is a presentation concept; it does not imply a module-access boundary.
- No new role values beyond these two renames. No role is deleted. No role's `ROUTE_ACCESS` entries are added or removed.

## 4. Real scope (grounded, not estimated)

Confirmed via repository search before writing this spec:

- **~144 `.ts`/`.tsx` files** contain the literal string `'registrar'` — spanning `lib/auth/roles.ts` (the `Role` type, `ROUTE_ACCESS`, `NAV_BY_MODULE`), every route-group `layout.tsx` guard, dozens of API route `requireRole([...])` calls, page-level inline role checks, the seeder, sidebar/nav config, and test files.
- **~29 files** contain `'p-file'` — smaller footprint (p-file is a single-module role: the P-Files module, plus a handful of cross-module notify/drill routes).
- **36 `supabase/migrations/*.sql` files** mention "registrar" or "p-file" — these are historical record and **must not be edited in place** (this codebase's standing convention, e.g. KD #40's "never destroy real history" for `delete_academic_year`). Any RLS policy whose **currently-live** definition checks `role = 'registrar'` or `role = 'p-file'` needs a **new** migration that replaces that policy (`DROP POLICY` + `CREATE POLICY`, or `CREATE OR REPLACE FUNCTION` for any helper like `is_registrar_or_above()` if such a function name itself needs to change) — not a rewrite of the old file that first introduced it.
- **Existing users' stored role** — any `auth.users` row with `raw_app_meta_data->>'role' = 'registrar'` or `'p-file'` needs a one-time `UPDATE` in that same new migration, so real staff logins don't break the moment this ships.

This confirms the earlier framing: mechanically large (many files touch the literal string), but logically simple (every touch point is the same find-and-replace, not a case-by-case redesign).

## 5. What does NOT change

- No `ROUTE_ACCESS` rule's allowed-role set.
- No RLS policy's actual logic/predicate — only which literal role string it matches.
- No module a role can reach, no data a role can read/write.
- No new `ROUTE_ACCESS` entries, no route reshuffling.
- Historical `supabase/migrations/*.sql` files stay untouched — they remain accurate record of what the schema looked like when written.
- Historical KD entries in `.claude/rules/key-decisions/*.md` that already say "registrar" or "p-file" (dozens of them, e.g. KD #41, #55, #74, #89, #109, #124, #136, #144, #149, #151, #154) are **not rewritten**. This codebase's established convention for a role rename is to add a **new** KD entry documenting the rename + mapping (the exact pattern KD #39 used when `admin` was retired into `school_admin` — it didn't rewrite the dozens of earlier KDs that said "admin"). A new KD will be added in the same style, and `CLAUDE.md`'s live "Session context" section gets updated to reflect current terminology going forward.

## 6. Phase 2 — Staff page enhancement (principles only; visual design comes next)

Once Phase 1 ships (new role names live, real data migrated), `/sis/admin/staff` gets redesigned to:

- Group the staff list/management UI by the 3 families (Academics / Admissions & Enrollment / Admin) instead of a flat role-filtered list.
- Use the new role display names (`Academic Coordinator`, `P-File Officer`, etc.) everywhere a role badge/label currently renders — the staff page itself, the user-creation dropdown, audit-log actor context, and anywhere else a role string surfaces as UI copy.

**Deliberately deferred to its own design pass:** the exact visual layout (card grid vs. grouped table vs. tabs) is not decided here — per this project's standing practice, that gets a `frontend-design` pass + a mockup for review before implementation, once Phase 1's rename is locked in (the mockup needs the final role names to be accurate).

## 7. Non-goals

- No functional RBAC redesign — this is explicitly not the "merge admissions+p-file" or "merge school_admin+superadmin" path that was considered and rejected during brainstorming (those pairs are deliberately separated on purpose — KD #31/#37 for the P-Files no-reject-authority boundary, KD #39 for the superadmin break-glass separation).
- No new roles, no role deletions.
- No change to any module's own internal permission logic beyond the literal string swap.
- No rewriting of historical migrations or historical KD prose.

## 8. Verification approach (detailed further in the implementation plan)

- `npx tsc --noEmit` clean after the rename sweep.
- `npx vitest run` — no count regression; any test asserting the literal string `'registrar'`/`'p-file'` as an expected role value needs updating to the new strings (not a logic change, just literal-value updates).
- `npx next build` clean.
- A repo-wide grep confirming zero remaining references to `'registrar'` or `'p-file'` as role-check strings in `.ts`/`.tsx` (excluding historical `.sql` migrations and any deliberately-preserved historical KD prose).
- A live-database check (or a dry-run against the test AY9999 environment) confirming the new migration's `UPDATE` correctly flips existing users' stored role and that login/session role resolution still works end-to-end for a real `academic_coordinator`/`p_file_officer` account.
