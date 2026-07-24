# Superadmin User-Account Deletion

**Date:** 2026-07-24
**Status:** Draft for review
**Scope:** Add a real (hard) delete action to `/sis/admin/staff?view=accounts`, gated so it only ever succeeds against an account with zero recorded activity. Departed-staff offboarding with real history stays on the existing Disable mechanism — this feature does not attempt to delete a historied account.

---

## 1. Problem & motivation

`/sis/admin/staff`'s Accounts view (KD #154) supports create, role change, and disable/enable — there is no delete. The immediate trigger: a superadmin tried to provision `amier.ordonez@hfse.edu.sg` and hit a 409 because the email already existed from an earlier mistake, and there was no way to remove the stale account and start clean.

**Primary driver:** cleanup of mistakes — duplicate/misconfigured accounts created moments ago with no real activity yet. **Secondary, longer-term interest:** offboarding departed staff. This spec deliberately scopes to the first driver only. A brand-new mistake account is, by construction, activity-free, so a delete that's gated on "zero footprint" fully solves it with no tension against Hard Rule #6 (audit logs and grade entries are append-only — there's nothing append-only being destroyed if nothing was ever appended). Deleting an account that has real history (grade-change approvals, evaluation write-ups, attendance records, etc.) would either get blocked by real Postgres foreign keys on ~15 tables, or — if those constraints were loosened — would erase who-did-what history the rest of this system treats as permanent. That's a materially bigger, riskier project (schema migration across every historied table, deciding SET NULL vs. block per table, adding snapshot columns where missing) and is explicitly **out of scope** here. Offboarding-with-history keeps using Disable, which already fully satisfies the actual operational need ("this person can no longer log in").

## 2. Goals

- A superadmin can permanently delete a user account, but **only** when that account has never done anything the system tracks.
- The check is scoped to the account's **current role** — only the tables that role's routes can actually write to are queried, both for correctness (a `p_file_officer` account was never going to have a `school_calendar` row) and for the resulting error message to be meaningful.
- Self-delete and deleting the last remaining `superadmin` are always blocked, independent of the footprint check.
- The action is audit-logged like every other mutation in this system (KD #9).

## 3. Non-goals

- Deleting an account that has real recorded activity. That path stays firmly on Disable.
- Any schema change (no migration, no new columns, no FK changes to any of the ~20 tables mapped during research).
- Anonymization / "right to be forgotten" for historied accounts — a real, distinct feature, deliberately not designed here. If offboarding-with-history becomes a live need later, it gets its own spec.
- Retroactively including a role's _historical_ table set if that role changed over time (see the known limitation below).

## 4. Footprint model

A new pure-ish helper, `lib/sis/user-deletion.ts::getUserFootprint(service, userId, role)`, queries only the tables the account's **current role** can realistically have a row in (each `.select('id').eq(column, userId).limit(1)`, run in parallel), and returns the list of table names that matched (empty array = clean).

The role→table mapping was grounded by tracing every writer route's `requireRole` gate (and, where the route's gate is broader than the actual writer logic, the narrower in-code check — e.g. `lib/change-requests/decide.ts` only ever lets a `school_admin` land in `reviewed_by`/`primary_reviewed_by`/`secondary_reviewed_by`, regardless of that route's 4-role gate):

| Role                   | Tables/columns checked                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `teacher`              | `teacher_assignments.teacher_user_id`, `grade_change_requests.requested_by`, `attendance_daily.recorded_by`, `evaluation_writeups.created_by`                                                                                                                                                                                                                                                                                     |
| `academic_coordinator` | `grade_change_requests.requested_by`, `grade_change_requests.applied_by`, `p_file_outreach.created_by_user_id`, `attendance_daily.recorded_by`, `school_calendar.created_by`, `calendar_events.created_by`, `evaluation_writeups.created_by`, `level_aliases.created_by`                                                                                                                                                          |
| `school_admin`         | `grade_change_requests` (`requested_by`, `reviewed_by`, `applied_by`, `primary_approver_id`, `secondary_approver_id`, `primary_reviewed_by`, `secondary_reviewed_by`), `approver_assignments.user_id`, `p_file_outreach.created_by_user_id`, `school_config.updated_by`, `attendance_daily.recorded_by`, `school_calendar.created_by`, `calendar_events.created_by`, `evaluation_writeups.created_by`, `level_aliases.created_by` |
| `superadmin`           | `approver_assignments.created_by`, `grade_change_requests.applied_by`, `grade_change_requests.requested_by`, `p_file_revisions.replaced_by_user_id`, `p_file_outreach.created_by_user_id`, `school_config.updated_by`, `attendance_daily.recorded_by`, `school_calendar.created_by`, `calendar_events.created_by`, `evaluation_writeups.created_by`, `level_aliases.created_by`                                                   |
| `p_file_officer`       | `p_file_revisions.replaced_by_user_id`, `p_file_outreach.created_by_user_id`                                                                                                                                                                                                                                                                                                                                                      |
| `admissions`           | `p_file_outreach.created_by_user_id`                                                                                                                                                                                                                                                                                                                                                                                              |

**Deliberately excluded: `audit_log`.** A brand-new mistake account will almost always have at least one `user.login` or `user.create` row there — blocking on that would defeat the feature's actual purpose. `audit_log.actor_email` is a plain text column with no real FK to `auth.users`, so a dangling `actor_id` after deletion is harmless and the log stays fully readable (KD #121's humanizer never joins back to `auth.users`).

**Also excluded — confirmed dead, not oversights:** `evaluation_terms.opened_by`, `evaluation_subject_comments.created_by`, `evaluation_checklist_items.created_by`, `evaluation_checklist_responses.created_by`, `evaluation_ptc_feedback.created_by` (all RLS-blocked from any insert, zero writer routes — KD #114's PTC-feature removal left these columns permanently unreachable), and `academic_years.structure_confirmed_by` (column no longer exists — added and dropped again within the same later migration pair).

**Known, accepted limitation:** the check is scoped to current role, not role history. If an account's role was ever downgraded (rare — role changes at HFSE have so far only escalated, e.g. KD #39's admin→school_admin consolidation), activity recorded under a former broader role could be missed. An account old enough to have had multiple roles is arguably not the fresh-mistake case this feature targets anyway; Disable remains correct for it. Accepted as-is; revisit only if it causes a real incident.

## 5. API contract

New `DELETE /api/sis/admin/users/[id]`, added to the existing route file alongside its `PATCH`:

1. `requireRole(['superadmin'])`.
2. `id === auth.user.id` → `403` "You cannot delete your own account."
3. `service.auth.admin.getUserById(id)` → `404` if missing. Resolve `role` the same way the existing PATCH handler does — `app_metadata.role ?? user_metadata.role ?? null` — so the two routes can never disagree on what a user's role is.
4. If `role === 'superadmin'`: count other `superadmin` accounts (via `listUsers`, filtering resolved role, excluding this id). Zero remaining → `409` "This is the last superadmin account — promote another account first."
5. `getUserFootprint(service, id, role)`. Non-empty → `409 { error: 'has_activity', tables: [...] }`. If `role` resolved to `null` (shouldn't happen in practice, but the PATCH route treats it as a real possibility) → treat as "check every table" rather than skip the check entirely, so an unusual account never gets a free pass.
6. `service.auth.admin.deleteUser(id)`, then `logAction({ action: 'user.delete', entityType: 'user_account', entityId: id, context: { email: before.email, role } })`.
7. Success → `200 { ok: true }`.

**Audit plumbing additions:** a new `'user.delete'` member on the `AuditAction` union (`lib/audit/log-action.ts`), a label in `lib/audit/humanize.ts`, and an entry in the SIS/staff audit-log page's allowlist (KD #9's "explicit allowlist, never a wildcard" convention) so deletions are visible there.

## 6. UI

`components/sis/staff-accounts-client.tsx`: a "Delete" item in the existing per-row action menu — superadmin-only, hidden on the viewer's own row (same gating pattern already used for role-change/disable). Confirms via an `AlertDialog` (`variant="destructive"`, matching the design system's destructive-confirm recipe) that states this is permanent. On confirm, calls `DELETE` through the existing `apiFetch`/`useMutation` plumbing (KD #24):

- `has_activity` 409 → toast surfaces the specific blocking tables, e.g. "Can't delete — this account has activity in: evaluation_writeups, attendance_daily. Use Disable instead."
- last-superadmin / self-delete 403/409 → toast surfaces that message verbatim.
- success → `router.refresh()` + success toast, matching every other mutation in this file.

## 7. Testing

- `getUserFootprint` unit-tested with a mocked Supabase client (pattern: `__tests__/admissions/parent-email-ilike-escape.test.ts`) — per-role table subset is exactly what's queried (no more, no less), any single match blocks, zero matches across the role's full table set passes clean.
- Route-level guard tests: self-delete blocked, last-superadmin blocked, 404 on unknown id.
- `npx next build` clean compile + a manual pass in the Staff Accounts UI (create a throwaway zero-activity account, delete it; confirm a real teacher/coordinator account's delete option is correctly blocked with the right table names) before calling this done, per the project's standard workflow.

## 8. Verification approach

- `npx vitest run` — new tests pass, no regression in existing `staff-accounts-client`/audit-log tests.
- `npx next build` clean.
- Manual: the exact scenario that triggered this — recreate a duplicate/misconfigured account, delete it, then successfully create the intended account with that email.
