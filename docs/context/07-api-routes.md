# API Routes Reference

All API routes are Next.js App Router route handlers under `app/api/`. This doc covers the major route families at a glance — it is not an exhaustive per-route reference. When in doubt, the route file itself is the contract: enumerate with `find app/api -name route.ts`.

## Conventions

- **Auth.** Every staff route calls `requireRole([...])` from `lib/auth/require-role.ts` (Supabase session + `app_metadata.role`). Roles are `teacher | registrar | school_admin | superadmin | p-file | admissions` (KD #2; the old `admin` role was retired in favour of `school_admin`, KD #39). In the tables below, **registrar+** = `registrar, school_admin, superadmin`.
- **No login/logout API routes.** Staff sign in on `/login` via the Supabase browser client. The only route under `/api/auth/` is `GET /api/auth/callback` (Supabase auth code exchange).
- **Validation** is mixed by design (KD #23): manual checks for simple mutations, zod `safeParse` (schemas in `lib/schemas/`) for complex ones. Don't migrate routes for uniformity.
- **Audit.** Every mutating route logs via `lib/audit/log-action.ts` into the generic `audit_log` (KD #9).
- **Cache invalidation.** Mutations call `revalidateTag` (e.g. `sis:${ayCode}`) and/or `invalidateDrillTags(module, ayCode)` after the write (KD #80).
- **Errors** are JSON `{ error: string }` with an appropriate status; several routes also carry a machine-readable `code` (e.g. 422 `publish_blocked`, 422 `enrolled_frozen`).
- **Removed features return 410 Gone**, not 404 — e.g. the legacy Evaluation PTC routes (KD #114).

## Students & Sync

| Route                         | Method | Role              | Description                                               |
| ----------------------------- | ------ | ----------------- | --------------------------------------------------------- |
| `/api/students/sync`          | POST   | registrar+        | Sync enrolled students from the admissions tables         |
| `/api/students/sync/stats`    | GET    | registrar+        | Preview sync stats before committing                      |
| `/api/sis/students/auto-sync` | POST   | cron              | Cron-triggered sync (`Authorization: Bearer CRON_SECRET`) |
| `/api/sis/search`             | GET    | non-teacher staff | Cross-AY student lookup (`?q=`, capped at 50 rows)        |

There is no `/api/students` list route — student lists load in server components via `lib/sis/queries.ts`.

## Sections & Roster

| Route                                     | Method   | Role               | Description                                                       |
| ----------------------------------------- | -------- | ------------------ | ----------------------------------------------------------------- |
| `/api/sections`                           | GET/POST | staff / registrar+ | List sections for current AY / create a section                   |
| `/api/sections/:id`                       | PATCH    | registrar+         | Update section metadata                                           |
| `/api/sections/:id/students/:enrolmentId` | PATCH    | registrar+         | Edit one enrolment row (status, dates, withdrawal — KD #146/#150) |
| `/api/sections/:id/generate-index`        | POST     | registrar+         | Generate alphabetical class index numbers (KD #136)               |
| `/api/sections/:id/publish-readiness`     | GET      | registrar+         | Report-card publish readiness checklist (KD #139)                 |
| `/api/teacher-assignments`                | GET/POST | registrar+ (POST)  | List / create teacher↔section↔subject assignments (KD #3)         |
| `/api/teacher-assignments/:id`            | DELETE   | registrar+         | Remove an assignment                                              |
| `/api/teacher-assignments/by-teacher`     | GET      | registrar+         | Assignments grouped by teacher                                    |
| `/api/users/teachers`                     | GET      | registrar+         | Teacher account list (for pickers)                                |
| `/api/users/approvers`                    | GET      | staff              | Eligible change-request approver pool (KD #41)                    |

## Grading Sheets

| Route                              | Method   | Role                  | Description                                                    |
| ---------------------------------- | -------- | --------------------- | -------------------------------------------------------------- |
| `/api/grading-sheets`              | GET/POST | teacher+ / registrar+ | List sheets (teachers see their assignments) / create          |
| `/api/grading-sheets/:id`          | GET      | teacher+              | Get sheet with all entries                                     |
| `/api/grading-sheets/:id/lock`     | POST     | registrar+            | Lock a sheet                                                   |
| `/api/grading-sheets/:id/unlock`   | POST     | registrar+            | Unlock a sheet                                                 |
| `/api/grading-sheets/:id/totals`   | PATCH    | registrar+            | Update WW/PT/QA max totals                                     |
| `/api/grading-sheets/:id/labels`   | PATCH    | teacher+              | WW/PT slot metadata: label, date administered, page# (KD #105) |
| `/api/grading-sheets/bulk-create`  | POST     | registrar+            | Create sheets for many sections at once                        |
| `/api/grading-sheets/bulk-lock`    | POST     | registrar+            | Lock up to 200 unlocked sheets (KD #131)                       |
| `/api/grading-sheets/lock-overdue` | POST     | cron                  | Auto-lock past-due sheets (`Bearer CRON_SECRET`)               |

## Grade Entries

| Route                                                    | Method | Role       | Description                                     |
| -------------------------------------------------------- | ------ | ---------- | ----------------------------------------------- |
| `/api/grading-sheets/:id/entries/:entryId`               | PATCH  | teacher+   | Update scores for one entry                     |
| `/api/grading-sheets/:id/entries/:entryId/annual-letter` | PATCH  | registrar+ | T4 non-examinable annual letter grade (KD #100) |

### PATCH Entry Payload

```json
{
  "ww_scores": [10, 8, null, 9, null],
  "pt_scores": [9, 10, null, null, null],
  "qa_score": 25,
  "letter_grade": null,
  "is_na": false
}
```

Post-lock edits do **not** accept a free-text `approval_reference` (the route 400s if one is sent). The server derives it from either a `change_request_id` (an approved change request, KD #25/#88) or a `correction_reason` enum value; each applied field change appends a `grade_audit_log` row (Hard Rule #5/#6).

## Change Requests (locked-sheet edits)

| Route                      | Method   | Role                      | Description                                                    |
| -------------------------- | -------- | ------------------------- | -------------------------------------------------------------- |
| `/api/change-requests`     | GET/POST | staff / teacher+          | Inbox / file a request against a locked sheet (KD #25)         |
| `/api/change-requests/:id` | PATCH    | designated approvers      | Approve / reject / apply / undo-rejection (KD #88)             |
| `/api/change-requests/act` | POST     | signed token (no session) | One-click email approve/reject via HMAC action token (KD #123) |

## Grade Computation

All grade computation is server-side (Hard Rule #2); the single source of truth is `lib/compute/quarterly.ts`, invoked inline by the entries PATCH. The one standalone endpoint is a stateless preview:

| Route                    | Method | Role  | Description                                          |
| ------------------------ | ------ | ----- | ---------------------------------------------------- |
| `/api/compute/quarterly` | POST   | staff | Compute quarterly grade from raw scores (no persist) |

### Computation Payload

```json
{
  "ww_scores": [10, 8, 9],
  "ww_totals": [10, 10, 10],
  "pt_scores": [9, 10, 8],
  "pt_totals": [10, 10, 10],
  "qa_score": 25,
  "qa_total": 30,
  "ww_weight": 0.4,
  "pt_weight": 0.4,
  "qa_weight": 0.2
}
```

### Computation Response

```json
{
  "ww_ps": 90.0,
  "pt_ps": 90.0,
  "qa_ps": 83.33,
  "initial_grade": 88.67,
  "quarterly_grade": 93
}
```

Annual/GA computation (`lib/compute/annual.ts`, KD #6) has no API route — it runs inside server components and the report-card builder.

## Report Cards & Publications

| Route                               | Method   | Role       | Description                                                                                                              |
| ----------------------------------- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/api/report-card/:studentId`       | GET      | registrar+ | Aggregated report-card payload for one student                                                                           |
| `/api/report-card-publications`     | GET/POST | registrar+ | List / open a publication window per (section, term) — POST is hard-gated on comments + virtue theme (KD #129/#138/#139) |
| `/api/report-card-publications/:id` | DELETE   | registrar+ | Revoke a publication window                                                                                              |

**There is no PDF service and no PDF route** (KD #7). Report cards render in the browser and print via the browser Print dialog; section batch-print stacks every student at `/markbook/report-cards/section/[sectionId]/print`. The `PDF_SERVICE_URL` env var is reserved but unused.

## Attendance

The Attendance module is the sole writer of daily attendance (KD #47).

| Route                                         | Method            | Role                          | Description                                                            |
| --------------------------------------------- | ----------------- | ----------------------------- | ---------------------------------------------------------------------- |
| `/api/attendance/daily`                       | PATCH             | teacher+                      | Write daily marks (P/A/EX/L); 409s on non-encodable day-types (KD #50) |
| `/api/attendance/:sectionId/export`           | GET               | registrar+ / assigned teacher | `.xlsx` term-sheet export (KD #151)                                    |
| `/api/attendance/import`                      | POST              | registrar+                    | Bulk Excel import                                                      |
| `/api/attendance/student-summary`             | GET               | staff                         | Per-student attendance summary (lookup sheet)                          |
| `/api/attendance/calendar`                    | POST/DELETE       | registrar+                    | Day-type overrides on the school calendar (KD #50/#76)                 |
| `/api/attendance/calendar/events`             | POST/PATCH/DELETE | registrar+                    | Calendar events overlay                                                |
| `/api/attendance/calendar/copy-from-prior-ay` | POST              | registrar+                    | Year-shifted carry-forward of day-types + events                       |

## Evaluation (FCA write-ups)

| Route                          | Method | Role                     | Description                                           |
| ------------------------------ | ------ | ------------------------ | ----------------------------------------------------- |
| `/api/evaluation/writeups`     | PATCH  | form adviser, registrar+ | Save-as-draft / submit / resubmit a write-up (KD #49) |
| `/api/evaluation/virtue-theme` | PATCH  | registrar+               | Set a term's virtue theme (KD #137)                   |

The legacy PTC routes (`/api/evaluation/checklist-items`, `.../checklist-items/:id`, `.../checklist-responses`, `.../subject-comments`, `.../ptc-feedback`, `.../terms/:termId/config`) all return **410 Gone** — the PTC features were removed (KD #114) and the files kept as tombstones.

## P-Files (document renewals)

| Route                                   | Method | Role                             | Description                                                                               |
| --------------------------------------- | ------ | -------------------------------- | ----------------------------------------------------------------------------------------- |
| `/api/p-files/:enroleeNumber/upload`    | POST   | p-file, superadmin               | Upload + merge PDFs into a document slot (KD #34)                                         |
| `/api/p-files/:enroleeNumber/revisions` | GET    | p-file, school_admin, superadmin | Append-only revision history (KD #36)                                                     |
| `/api/p-files/:enroleeNumber/notify`    | POST   | officer roles                    | Email the parent a renewal reminder (KD #64)                                              |
| `/api/p-files/:enroleeNumber/promise`   | PATCH  | officer roles                    | Mark a document as promised-by-date (KD #64)                                              |
| `/api/p-files/notify/bulk`              | POST   | officer roles                    | Bulk reminder fan-out, cap 50 (shared with admissions chase via a `module` param, KD #70) |

## Records / Admissions applicant editors (`/api/sis/students/...`)

Field edits on the AY-prefixed admissions tables. Most are gated `admissions, registrar, superadmin`; write-locks per the module-ownership model (KD #147/#150) apply on top of the role gate.

| Route (under `/api/sis/students/:enroleeNumber/`) | Method | Description                                                                                |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `profile`                                         | PATCH  | Shared student profile (identity/contacts)                                                 |
| `family/:parent`                                  | PATCH  | Mother / father / guardian details                                                         |
| `stage/:stageKey`                                 | PATCH  | 9-stage pipeline status editor; frozen post-Enrolled except supplies/orientation (KD #147) |
| `document/:slotKey`                               | PATCH  | Approve/reject/set a document slot (admissions pre-enrolment, p-file post — KD #147)       |
| `stp-status`                                      | PATCH  | STP application type/status (KD #61)                                                       |
| `residence-history`                               | PATCH  | ICA 5-year residence history                                                               |
| `pre-course`                                      | PATCH  | Pre-course counselling fields                                                              |
| `allowance` / `vl-allowance`                      | PATCH  | registrar+ — compassionate / vacation leave allowances (KD #94)                            |
| `transfer-section`                                | POST   | registrar+ — atomic mid-year section transfer (KD #67)                                     |
| `assign-section`                                  | POST   | registrar+ — assign + sync an unsynced enrolled student (KD #90)                           |

Related reads: `GET /api/sis/today-term` (current-term resolver, KD #116), `GET /api/sis/cohorts/:cohort` (STP / medical / pass-expiry cohort lenses), `POST /api/sis/students/raw-columns` (export sheet's load-all-columns read).

## SIS Admin & AY Setup

| Route                                        | Method            | Role                              | Description                                                             |
| -------------------------------------------- | ----------------- | --------------------------------- | ----------------------------------------------------------------------- |
| `/api/sis/ay-setup`                          | POST/PATCH/DELETE | school_admin+ (DELETE superadmin) | Create AY / switch active AY / delete AY (KD #40)                       |
| `/api/sis/ay-setup/terms/:termId`            | PATCH             | registrar+                        | Term dates + grading-lock date                                          |
| `/api/sis/ay-setup/accepting-applications`   | PATCH             | school_admin+                     | Early-bird application window (KD #118)                                 |
| `/api/sis/ay-setup/seed-calendar`            | POST              | school_admin+                     | Seed school-calendar rows for a new AY                                  |
| `/api/sis/ay-setup/copy-teacher-assignments` | POST              | school_admin+                     | Copy assignments from a prior AY                                        |
| `/api/sis/admin/users` / `users/:id`         | POST / PATCH      | superadmin                        | Direct-create staff accounts (KD #87) / edit                            |
| `/api/sis/admin/approvers` (+ `/:id`)        | GET/POST / DELETE | superadmin                        | Change-request approver assignments (KD #41)                            |
| `/api/sis/admin/school-config`               | PATCH             | school_admin+                     | School config incl. letterhead + award thresholds (KD #95/#101)         |
| `/api/sis/admin/subjects/:configId`          | PATCH             | school_admin+                     | Per-AY subject weights/slots; syncs unlocked sheets via RPC (KD #99)    |
| `/api/sis/admin/subjects/catalog` (+ nested) | POST / DELETE     | school_admin+                     | Subject catalog + (subject × level) configs (KD #72)                    |
| `/api/sis/admin/template/**`                 | POST/PATCH/DELETE | school_admin+                     | Master class template sections + subject configs + apply-to-AY (KD #66) |
| `/api/sis/admin/environment` (+ `/topup`)    | POST/DELETE       | superadmin                        | Test-AY environment switcher + demo-data top-up (KD #52)                |
| `/api/sis/discount-codes` (+ `/:id`)         | POST / PATCH      | admissions, school_admin+         | Discount-code catalog (KD #133)                                         |

## Dashboard Drill Routes

Every module dashboard exposes one unified drill endpoint (KD #56):

```
GET /api/{admissions|attendance|evaluation|markbook|p-files|records|sis|sis-admin}/drill/[target]
```

Role-gated per module, returns JSON or CSV (`?format=csv`, UTF-8 BOM), 60s `unstable_cache` tagged `${module}-drill:${ayCode}`, and `Cache-Control: private, max-age=60, stale-while-revalidate=300` on JSON.

## Exports & Audit Log

| Route                             | Method | Role          | Description                                                   |
| --------------------------------- | ------ | ------------- | ------------------------------------------------------------- |
| `/api/audit-log`                  | GET    | registrar+    | Audit rows; `?sheet_id=` / `?entry_id=` filters               |
| `/api/audit-log/export`           | GET    | school_admin+ | Audit-log CSV                                                 |
| `/api/admissions/export`          | GET    | superadmin    | Admissions CSV                                                |
| `/api/markbook/masterfile/export` | GET    | registrar+    | Masterfile report-book `.xlsx` / `?format=csv` (KD #122/#134) |

## Parent Portal (external, stateless Bearer API)

The only parent-facing surface. Consumed cross-origin by the external admissions portal SPA — no in-SIS parent pages or cookies (see `key-decisions/parent.md`).

| Route                        | Method | Auth                                   | Description                                                              |
| ---------------------------- | ------ | -------------------------------------- | ------------------------------------------------------------------------ |
| `/api/parent/v2/students`    | GET    | `Authorization: Bearer <access_token>` | Parent's linked students + active publication windows                    |
| `/api/parent/v2/report-card` | GET    | same                                   | Full report-card payload, gated on an active publication window (KD #10) |

Tokens are verified via `service.auth.getUser(token)`; CORS allowlist in `lib/cors.ts` (`ADMISSIONS_PORTAL_ORIGIN`); IP + per-user rate limiting via `lib/rate-limit.ts`.
