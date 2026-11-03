# Parent Portal admin in SIS Admin — design

Date: 2026-11-03. Status: awaiting Mr Ace's approval.

## Why

The parent portal (`../app-online-admission`, deployed at enrol.hfse.edu.sg) has an admin area at `/admin/*` with four tools. Everyone shares one login, `admin@parent.portal.com`, and nothing records who did what. Mr Ace wants these tools in SIS Admin, where only a superadmin can act.

## Goals

- All four tools in SIS Admin, in the SIS design: Transfer Records, Reset Password, Create Account, Recovery Link.
- Only a superadmin can act. The server enforces this; hiding a button is not the protection.
- Every action is logged under the superadmin's own name.
- A transfer either completes or changes nothing.

## Non-goals

- Changing the parent-facing form at `/complete-enrolment/:token`. It stays on the portal.
- Removing the portal's admin pages. They stay live until the SIS version is proven; Mr Ace decides when to switch them off, and that is separate work in the portal repo.
- Changing how the portal uses `temporary_password` and `password_changed` (see Reset Password).
- New features the portal page does not have.

## Anti-goals

- A parents' tool that can change a staff login.
- A transfer that reports success when it failed.
- A portal look carried into SIS.

## Decided by Mr Ace

- The tools move to SIS Admin; only a superadmin can act.
- SIS design throughout.
- Transfer student number: **Current and VizSchool Current keep their student number. New and VizSchool New get a new one, the way the portal does today.** The VizSchool half is the author's reading of "current" and "new".

## Access (author's call)

- Other SIS Admin roles (`academic_coordinator`, `school_admin`) can open the page and read it. They get no action controls.
- Viewers never see a recovery link's URL or token: the link gives access to a family's form without a login. The rest of the row is fine; they can already read parents' emails on Reset Password.
- Every write route checks for the `superadmin` role directly, so ticking a checkbox on `/sis/admin/roles` cannot widen it. `lib/auth/require-role.ts` is the existing helper. Read routes follow the existing capability or role pattern; the builder picks the closest fit.
- A row in `ROUTE_ACCESS` and the nav entries in `lib/auth/roles.ts`, kept in step (`link-capability-consistency.test.ts`).

## Where it lives (author's call)

Reshaped 2026-11-03 at Mr Ace's choice: one page with two tables, not four pages. "Parent Portal" is one row in the "Organisation" group of the SIS Admin sidebar, at `/sis/admin/parent-portal`, with the tab in the URL so a refresh or a link keeps it:

- `?tab=applications` (the default): one row per student in the chosen year. Transfer Records is its tick boxes and bulk action; Recovery Link is its row action and link status column.
- `?tab=accounts`: the parent logins. Reset Password is the row action; Create Account is a button that opens a dialog.

API routes under `/api/sis/admin/parent-portal/`.

SIS does the work in its own server routes with the service client. It cannot call the portal's edge functions, because they only accept the `admin@parent.portal.com` login. Both apps share one Supabase project, so tables, storage and logins are the same ones.

## The tools

### Reset Password

Source: `supabase/functions/admin-set-password/index.ts` and `src/pages/admin/reset-password.tsx` in the portal.

- Lists **parent accounts only**: logins with no staff role (role resolves to `null`, KD #11; see `lib/auth/staff-list.ts`). The portal lists everyone, which here would include staff.
- The server re-checks the target is not a staff account. This is the protection; the list filter is only convenience.
- Columns: name, email, relationship, email confirmed, last sign-in. Search by name or email. Use `listAllAuthUsers`.
- A generated password (14 characters, same rule as the portal's `generatePassword`, at least 8 if typed), with regenerate and copy, and a confirm step.
- Saves the same metadata as the portal: `password_changed: false`, `temporary_password: <password>`. The portal reads these to prompt the parent to change it. This does keep the password readable on the account; that weakness is known and left for later because changing it needs a portal release.
- The audit row never contains the password.

### Create Account

Source: same edge function, `src/pages/admin/create-parent.tsx`.

- Fields: first name, last name, relationship (mother or father), email, password, confirm password.
- Creates with `email_confirm: true`; `fullName` as `Last, First`; `relationship`; same temporary-password metadata. No `app_metadata.role`, so the account stays a parent.
- If the email exists, show that account's details rather than a bare error. If it is a staff account, say so plainly.

### Recovery Link

Source: `supabase/functions/recovery-link/index.ts`, `_shared/enrolment-payload.ts`, `_shared/recovery-email.ts`, `src/pages/admin/recovery-link.tsx`.

- Tick one student and "Send link" appears in the bar under the table; with several ticked it goes away and "Move to another year" stays (Mr Ace: actions show when a row is checked, no buttons on the rows). It opens a dialog that checks the record: nothing typed. Show which of the three records exist, what is missing, and the suggested sections. A complete record says nothing is missing.
- Choose sections (only when the application row exists; otherwise all), confirm the recipient emails (prefilled from the application, then from other years by student number), generate.
- Writes to the existing `enrolment_recovery_tokens` with `created_by` set to the superadmin's email, 7-day expiry. No new table.
- The link points at the portal's `/complete-enrolment/:token`, built from the configured portal URL.
- Email goes through SIS's existing Resend setup with `renderEmailFrame`, same subject and message as the portal. A failed send does not lose the link: show it so it can be copied and sent by hand.
- No separate list of links. The Applications table has a column with each student's latest link (Pending, Completed, Expired or none), including records with no application: those need a link most, and are marked "Application missing". A superadmin can copy a pending link from the row.
- The completeness rules are a copy of the portal's (`isApplicationIncomplete`, `incompleteApplicationSections`). The portal stays the one that consumes the token, so both copies must agree; a test should pin the rule against the portal's list of required fields.

### Transfer Records

Source: `supabase/functions/move-student-ay/index.ts`, `src/pages/admin/move-student.tsx`.

**The screen.** Choose the from-year above the Applications table and tick students (search, level filter, sorting), using `<DataTable>`. "Move to another year" opens one dialog with the to-year and the count, and confirms. A record marked "Application missing" has nothing to move and cannot be ticked. Results list each student's old and new numbers, and any failures with their reason. Students move one at a time, and one failure does not stop the others.

**New numbers.** Same as the portal: `E<yy><id padded to 4>`, using the highest `id` in the to-year's applications plus 1. New and VizSchool New get `<H or V><yy><same>`. Current and VizSchool Current keep their student number.

**What it is for.** Correcting an application where the parent picked the wrong academic year in the portal (Mr Ace, 2026-11-03). These are fresh applications, so it stays a port of the portal's steps: no re-pointing of other SIS records and no extra blocks.

**Steps for one student**, same as the portal's `moveOne`: copy the three rows to the to-year with file links remapped, copy the files, delete the old rows and files, then write the audit row (who, from-year, to-year, old and new numbers). Skip the generated `id`, `idx`, `created_at`, `fts` columns as the portal does.

**The one fix to the steps:** if a step fails, undo what that move already did and show the error, and check the deletes rather than assuming they worked. The builder picks the simplest way to do this.

## Audit

New actions in `ALL_AUDIT_ACTIONS`, visible on the SIS Admin audit log (`__tests__/audit/allowlist-coverage.test.ts`): password reset, account created, recovery link created, student transferred. Passwords never appear.

## Design

SIS Admin page conventions: page header, `<DataTable>`, a Sheet for multi-field forms, outline secondary buttons (never ghost), plain-English copy. Read `docs/context/09-design-system.md` and `09a-design-patterns.md` and run the frontend-design skill before writing JSX. Nothing is copied from the portal's look.

## Testing

- Write routes reject everyone except a superadmin (school_admin and academic_coordinator included).
- Reset Password rejects a staff target even when sent directly.
- Transfer on the local Supabase stack: Current keeps its number, New gets a new one; a forced failure leaves the student in the from-year only.
- Screens checked with a browser against the SIS look.

## Go-live

- The old portal pages keep working meanwhile.

## Left to the builder

File layout inside the route, the exact read-route guard, table columns beyond those listed, and the phase breakdown for the plan.
