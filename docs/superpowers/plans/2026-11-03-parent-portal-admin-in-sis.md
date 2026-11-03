# Parent Portal admin in SIS Admin — Implementation Plan

> **Superseded in part, 2026-11-03.** The four pages below became one page with two tables (Mr Ace). The spec and KD #236 are current; this plan is the record of the first build.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan phase by phase. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The portal's four admin tools live in SIS Admin; only a superadmin can act.

**Architecture:** SIS server routes use the service client directly on the shared Supabase project. No migration. Pages are server components that load their data and hand it to one client component per tool.

**Tech Stack:** Next.js 16 app router, Supabase, `<DataTable>`, TanStack Query, Resend, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-parent-portal-admin-in-sis-design.md`

**Portal source to port from** (read-only): `../app-online-admission/supabase/functions/{admin-set-password,move-student-ay,recovery-link}/index.ts`, `_shared/enrolment-payload.ts`, `_shared/recovery-email.ts`, `src/pages/admin/*.tsx`.

## Global Constraints

- Every write route starts with `requireRole(['superadmin'])` (`lib/auth/require-role.ts`). Not a capability, so `/sis/admin/roles` cannot widen it.
- Pages admit `academic_coordinator`, `school_admin`, `superadmin`. `canAct = role === 'superadmin'`; viewers get no action controls.
- Viewers never receive a recovery link URL or token: strip them on the server.
- Passwords never reach an audit row or a log.
- SIS design only: `PageShell`, `SisPageHeader`, `<DataTable>`, Sheets for multi-field forms, `AlertDialog` to confirm, outline secondary buttons (never ghost). Tokens only, no hardcoded colours. Plain-English copy, sentence case, no dev jargon. Copy a sibling such as `app/(sis)/sis/admin/discount-codes/page.tsx` and `components/sis/staff-accounts-client.tsx`. Read `docs/context/09-design-system.md` and `09a-design-patterns.md` before JSX.
- Every sortable `<DataTable>` column declares `meta: { label }` (KD #161).
- AY tables: `prefixFor(ayCode)` from `lib/admissions/_shared.ts`; validate a year with `listAyCodes`.
- Tests import vitest globals explicitly; run with `npx vitest run <path> --pool=threads`.
- **Do not commit, push or stash.** Another session shares this working tree. Touch only files named here. Edit with Edit/Write only, never via scripts.

## Review Focus

1. A superadmin (or a crafted request) targets a staff account's email on Reset Password: rejected, nothing changes. Task 1 test.
2. A school_admin posts directly to any write route: 403. Each task's route test.
3. A viewer's page payload contains no recovery URL or token. Task 2 test.
4. The from-year and to-year tables have different columns, so the insert fails: the student stays in the from-year only, and the error is shown. Task 3 test.
5. A student has no files or no documents/status row: the move still succeeds. Task 3 test.

---

## Phase 1: Accounts

### Task 1: Navigation, audit actions, Reset Password, Create Account

**Files:**

- Modify: `lib/auth/roles.ts` (SIS nav: new `Parent Portal` section with `Transfer records`, `Reset password`, `Create account`, `Recovery link`, each `requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin']`. The existing `/sis` `ROUTE_ACCESS` row already covers them.)
- Modify: `lib/audit/log-action.ts`, `lib/audit/humanize.ts`, `app/(sis)/sis/audit-log/page.tsx`
- Create: `lib/parent-portal/accounts.ts`, `lib/schemas/parent-portal.ts`
- Create: `app/api/sis/admin/parent-portal/accounts/password/route.ts`, `app/api/sis/admin/parent-portal/accounts/route.ts`
- Create: `app/(sis)/sis/admin/parent-portal/reset-password/page.tsx`, `app/(sis)/sis/admin/parent-portal/create-account/page.tsx`
- Create: `components/sis/parent-portal/reset-password-client.tsx`, `components/sis/parent-portal/create-account-client.tsx`
- Test: `__tests__/sis/parent-portal-accounts.test.ts`

**Interfaces:**

- Produces audit actions `parent_portal.password_reset`, `parent_portal.account_create`, `parent_portal.recovery_link_create`, `parent_portal.application_transfer`, entity type `parent_portal`, each with humanized wording and on the audit-log page's allowlist (`__tests__/audit/allowlist-coverage.test.ts`).
- Produces `listParentAccounts(service): Promise<ParentAccount[]>` where `ParentAccount = { id, email, fullName, relationship, emailConfirmed, lastSignInAt }`: `listAllAuthUsers`, keeping users whose `getUserRole(user) === null`, sorted by name.
- Produces `generateTemporaryPassword(): string`: 14 characters, same rule as the portal's `generatePassword` (`src/lib/utils.ts`), browser-safe.

- [ ] **Step 1: Write failing tests**, mocking the service client: `POST accounts/password` gives 403 for `school_admin` and `academic_coordinator`; 400 under 8 characters; 404 for an unknown email; **403 with "This is a staff account" for a target whose `getUserRole` is non-null, and `updateUserById` not called**; on success `updateUserById` receives `password`, `user_metadata` with existing keys kept plus `password_changed: false` and `temporary_password`; the audit context contains no password. `POST accounts` gives 403 for non-superadmins; 409 with `existing` details when the email exists (and `isStaff: true` for a staff email); success calls `createUser` with `email_confirm: true`, `user_metadata.fullName === 'Tan, Mei'`, `relationship`, the temporary-password keys and no `app_metadata.role`. `listParentAccounts` drops a user with a role.
- [ ] **Step 2: Run them; expect failure.**
- [ ] **Step 3: Implement** the lib, schemas (zod: password min 8, relationship `mother | father`, email lowercased), routes and audit wiring.
- [ ] **Step 4: Run them; expect pass.**
- [ ] **Step 5: Build the two pages.** Reset password: `<DataTable>` of parent accounts (name, email, relationship, email confirmed, last sign-in) with search; superadmin row action "Reset password" opens a Sheet with the generated password, Regenerate, Copy, then an `AlertDialog` confirm; the toast tells them to share it with the parent. Create account: superadmin form in a Card (first name, last name, relationship select, email, password, confirm password) showing existing-account details on 409 and the created account on success; viewers see a one-line note that only a superadmin can create accounts. Use `useWriteAction` for writes.
- [ ] **Step 6: Check:** `npx vitest run __tests__/sis/parent-portal-accounts.test.ts __tests__/audit __tests__/auth --pool=threads` and `npx tsc --noEmit`. Expected: pass; no new errors.

## Phase 2: Recovery Link

### Task 2: Check, generate, list

**Files:**

- Create: `lib/parent-portal/recovery.ts` (with the required-fields list copied verbatim from `_shared/enrolment-payload.ts:396-445`, commented as a copy the portal also holds), `lib/notifications/email-recovery-link.ts`
- Create: `app/api/sis/admin/parent-portal/recovery-link/route.ts`, `app/(sis)/sis/admin/parent-portal/recovery-link/page.tsx`, `components/sis/parent-portal/recovery-link-client.tsx`
- Test: `__tests__/sis/parent-portal-recovery.test.ts`

**Interfaces:**

- Consumes: `parent_portal.recovery_link_create`.
- Produces: `checkRecovery(service, enroleeNumber)`, `generateRecoveryLink(service, { enroleeNumber, sections?, recipientEmails?, createdBy })`, `listRecoveryLinks(service, { includeLink: boolean })`, same return shapes as the portal's `RecoveryCheckResult`, `RecoveryLinkResult`, `RecoveryTokenSummary` (`src/actions/admin.ts`). Year from the enrolee number, as the portal's `academicYearFromEnroleeNumber`, against `listAyCodes`.

- [ ] **Step 1: Write failing tests:** non-superadmin POST gives 403; `check` returns `complete: true` when all three rows exist and complete, and lists `missing` and `suggestedSections` otherwise; `generate` returns 409 when nothing is missing, forces all sections when no application row exists, inserts into `enrolment_recovery_tokens` with `created_by` and a 7-day `expires_at`; the URL is `${NEXT_PUBLIC_PARENT_PORTAL_URL ?? 'https://enrol.hfse.edu.sg'}/complete-enrolment/<token>`; a failed email still returns the link with `emailSent: false`; `listRecoveryLinks({ includeLink: false })` returns rows with no `token` and no `url` keys, and limits to 20.
- [ ] **Step 2: Run them; expect failure.**
- [ ] **Step 3: Implement.** Email: follow `lib/notifications/email-annual-letter.ts` (transport, non-production redirect) with `renderEmailFrame`; subject `Action Required: Complete Your Enrollment Information`; message from `_shared/recovery-email.ts`.
- [ ] **Step 4: Run them; expect pass.**
- [ ] **Step 5: Build the page.** Superadmin: enrolee number lookup, a result showing which of the three records exist, section checkboxes (only when the application exists), editable recipient emails prefilled, Generate, then the link with Copy and whether it was emailed. Everyone: Recent links `<DataTable>` (student, enrolee number, status Pending/Completed/Expired using §9.3 status recipes, created by, sent to, dates); Copy link for superadmins only.
- [ ] **Step 6: Check:** vitest on the file and `npx tsc --noEmit`.

## Phase 3: Transfer Records

### Task 3: List and move

**Files:**

- Create: `lib/parent-portal/transfer.ts`, `app/api/sis/admin/parent-portal/transfer/route.ts`, `app/(sis)/sis/admin/parent-portal/transfer/page.tsx`, `components/sis/parent-portal/transfer-client.tsx`
- Test: `__tests__/sis/parent-portal-transfer.test.ts`

**Interfaces:**

- Consumes: `parent_portal.application_transfer`.
- Produces: `listApplications(service, ayCode)`, `transferOne(service, { sourceAy, targetAy, enroleeNumber }): Promise<{ ok: true; newEnroleeNumber; newStudentNumber; warning?: string } | { ok: false; error: string }>`, `nextStudentNumber(category, currentStudentNumber, yy, nextId): string`. Constants `DOC_URL_FIELDS`, `APP_URL_FIELDS`, `STRIP_FIELDS` copied from `move-student-ay/index.ts`.

**Student number rule (spec):** category `Current` or `VizSchool Current` with a student number keeps it. Otherwise, the portal's default: first letter of the existing number or `H`, then `<yy><id padded to 4>`.

**Steps of `transferOne`:** read three rows (application required) → max `id` + 1 in the to-year, moving up while the enrolee number is already taken → insert the to-year rows with remapped links → copy files → delete status, documents, application from the from-year, checking each result → remove old files.

**Undo:** a failure before or during the source deletes removes the inserted to-year rows and copied files, re-inserts any source row already deleted, and returns `ok: false` with the reason. A failure removing old files does not undo: return `ok: true` with `warning` naming the files.

- [ ] **Step 1: Write failing tests:** non-superadmin POST gives 403; same from-year and to-year gives 400; an unknown year gives 400; `nextStudentNumber('Current', 'H260012', '27', 45) === 'H260012'`, `('VizSchool Current', 'V260012', '27', 45) === 'V260012'`, `('New', 'H260012', '27', 45) === 'H270045'`, `('VizSchool New', 'V260012', '27', 45) === 'V270045'`, `('Current', null, '27', 45) === 'H270045'`; generated `fts` is not in the insert; links are remapped; a failed documents insert leaves no to-year rows and no source delete; a failed source delete restores the source and removes the to-year rows and copies; a student with no documents or status row and no files succeeds; a failed old-file removal returns `ok: true` with `warning`; one bad student in a bulk request doesn't stop the others.
- [ ] **Step 2: Run them; expect failure.**
- [ ] **Step 3: Implement** the lib and route (`GET ?ay=` for the three page roles; `POST { sourceAy, targetAy, enroleeNumbers }` for superadmin, one at a time, one audit row per success).
- [ ] **Step 4: Run them; expect pass.**
- [ ] **Step 5: Build the page.** From-year and to-year selects; `<DataTable>` (name, level, enrolee number, student number, category) with search and level filter. Superadmin gets `selection` with a footer bulk bar, an `AlertDialog` confirm naming the count and years, and a results list of old and new numbers, warnings and failures. Viewers get the table with no ticks.
- [ ] **Step 6: Check:** vitest on the file and `npx tsc --noEmit`.

## Phase 4: Whole-build check (lead, not a subagent)

- [ ] **Step 1:** Independent review of all files above.
- [ ] **Step 2:** On the local Supabase stack, in a browser, as superadmin and as school_admin: open each page, reset and create a parent account, generate a link, transfer one Current and one New record. Screenshot and compare with sibling SIS pages.
- [ ] **Step 3:** Update `docs/context/` and the KD index (the KD row needs Mr Ace's approval: `.claude/rules/` is protected).
