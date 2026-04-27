# Modules Overview — How the SIS Hangs Together

## What this doc is

The hub for cross-module concerns. The HFSE SIS is one Next.js deployable with four modules on top of one Supabase project and one `auth.users` table. Read this doc before touching anything that spans modules — the module map, the shared student identity, what's allowed to read/write what, the access matrix, and where to add new per-student data all live here.

For the detailed scope of each module, see its own doc: `15-markbook-module.md`, `12-p-files-module.md`, `13-sis-module.md`, `08-admission-dashboard.md`. This doc deliberately does not duplicate their contents.

## Module map

The SIS has four modules. Each renders under its own Next.js route group, has its own sidebar (via `lib/auth/roles.ts::NAV_BY_MODULE`), and is gated by `ROUTE_ACCESS` + `proxy.ts`.

### Markbook — academic records (`/grading`, `/report-cards`, `/admin/sections/*`)

Grades, report cards, attendance summaries, adviser comments, change-request workflow. The original module and the heaviest in workflow complexity (lock/unlock, formula compute, quarterly→annual aggregation, parent publication windows). Audience: teachers, registrar, admin, superadmin.

### P-Files — document repository (`/p-files/*`)

Per-student document storage with revision history. Stores file URLs + metadata + expiries; archives prior versions on replace; never sets `'Rejected'` (that's the Records module's job). Three-tier access: `p-file` officers and superadmin have full write, admin is read-only, nobody else sees it.

### Admissions — pipeline analytics (`/admin/admissions`)

Read-only analytics over the admissions applications + status tables. Pipeline cards, conversion funnel, time-to-enrolment, applications by level, outdated applications, document completion, assessment outcomes, referral sources. Audience: registrar, admin, superadmin.

### Records module — records management (`/sis/*`)

Replaces Directus as the day-to-day admin UI for admissions data. Profile / family / stage pipeline editing, discount-code catalogue CRUD, document validation (approve/reject). Audience: registrar, admin, superadmin.

## Planned modules (not yet built)

Listed here so the module inventory is complete and future sprints have an obvious home. Each will get its own `NN-{module}.md` context doc when scoping starts.

### Attendance — daily attendance monitoring

Per-student, per-day presence / absence / tardy / excused. The Markbook module today only records **term-summary** counts (used for report cards); a proper Attendance module owns the daily ledger that those summaries roll up from. **Agreed shape (Phase 1):** daily-only with a `period_id` hook for Phase 2 (blocked on Scheduling); **hybrid placement** — entry surface at `/attendance/*`, per-student read tab on Records student detail; existing `attendance_records` term-summary table **stays** as the report-card rollup target (Attendance feeds it). Schema details + exact workflow pending HFSE's attendance Excel reference. See `16-attendance-module.md` for the full agreed frame and open questions.

### Scheduling — timetable, class schedules, room allocations

Class period definitions, subject-per-period assignments, room allocations, substitute teacher coverage. Today the SIS only has `teacher_assignments` (subject × section × role gate) — which answers "who teaches what" but not "when and where." A full Scheduling module is the prerequisite for period-level attendance, conflict detection, and substitute workflows. Likely grows in phases: periods per level → teacher schedule view → room allocations → substitutions.

### Process-flow enhancements (not a module — cross-cutting design)

Lifecycle visibility (new 5th tab on Records student detail + dashboard aggregate widget on `/sis`), soft gates on the Stage edit dialog (advisory checklist of prerequisites), and opt-in auto-completions on objectively-derivable stages (documents all-Valid → auto-finish `documents` stage, payment date populated → auto-finish `fees` stage). **Zero schema changes for v1.** Full design sketch: `17-process-flow.md`.

### AY Setup Wizard (new superadmin feature)

A `/sis/ay-setup` surface that turns "creating a new AY" from a developer-gated compound migration into a multi-step admin wizard. Copy-forward sections + `subject_configs` from the prior AY, optional curriculum edit, and — critically — **creates the 4 AY-prefixed admissions tables (`ay{YY}_enrolment_*` + `ay{YY}_discount_codes`) via a parameterised DDL template** sourced from the frozen reference DDL in `10-parent-portal.md`. All compound ops land in one transaction. **Role split:** create + switch-active-AY are admin + superadmin (KD #32's "admin = full operator"); **delete is superadmin-only** and is guarded to empty AYs with a destructive-confirm dialog. The only thing the wizard can't automate is the `SUPPORTED_AYS` constant edit (compiled into the app, needs a code deploy). Full design sketch: `18-ay-setup.md`. Unblocking prerequisite: coordination agreement with the parent-portal team that the SIS is the source-of-truth for new-AY DDL going forward.

### Future candidates (under discussion, not scoped)

- **Health / Medical** — allergies, conditions, immunisation, emergency medical contacts, clinic log. Likely needs a sub-role (nurse / counsellor) for sensitive fields.
- **Communications log** — per-student record of parent calls / emails / meetings + follow-up actions. Structured replacement for ad-hoc email tracking.
- **Behaviour / Incidents** — disciplinary + commendations log.
- **CCA / Clubs** — enrolment per club, attendance, achievements.

Explicitly out of scope until asked: library, transport routes, alumni, field trips, room booking. These don't pay off at HFSE's current scale.

## Shared student identity

Every module keys per-student data off one of two IDs:

- **`studentNumber`** — the **stable cross-year identifier** (Hard Rule #4). Use this whenever crossing a module boundary or an academic-year boundary. `students.student_number` in SIS-owned tables, `"studentNumber"` in admissions applications.
- **`enroleeNumber`** — an **AY-scoped** identifier (e.g. `E260001` for AY2026). Resets each AY. Used only for joining within a single AY's admissions tables (applications ↔ status ↔ documents).

**Why this matters:** Markbook ↔ Records module ↔ P-Files cross-links must resolve through `studentNumber`, never `enroleeNumber`. A returning student has one `studentNumber` but a new `enroleeNumber` each AY. The P-Files history chip strip on the SIS student detail page, for instance, groups by `studentNumber` to show every AY a student has appeared in (see `getEnrollmentHistory()` in `lib/sis/queries.ts`).

Cross-module examples today:

- SIS Documents tab → P-Files student detail: deep-link `/p-files/[enroleeNumber]#slot-{key}` (same-AY scope, so enrolee-number is fine; link resolves via matching students table row).
- Grading sheet → student profile: `students.student_number` → admissions applications join for demographics.
- Parent portal → parent module: admissions `motherEmail`/`fatherEmail` matched case-insensitively against `auth.users.email`, then resolved to every `studentNumber` linked to that email.

## Cross-module data contract

Every admissions-owned table has one **primary writer**. Other modules may have narrow write responsibilities for specific columns — those are called out explicitly. The rule: if you're adding a write to one of these tables from a new surface, either register that column as a new owned responsibility or go through the existing owner's API.

| Table (or column) | Records module | P-Files | Markbook | Admissions dashboard |
|---|---|---|---|---|
| `ay{YY}_enrolment_applications` (demographics, parent emails) | **Write** (Profile / Family PATCH routes) | Write — passport# / pass type via upload dialog (KD #34) | Read (parent→student lookup) | Read |
| `ay{YY}_enrolment_status` (stage pipeline) | **Write** (Stage PATCH route) | Read | Read (filter enrolled) | Read |
| `ay{YY}_enrolment_documents.{slotKey}` (URL) | Read | **Write** (canonical file URL + archive prior to `p_file_revisions`) | — | Read (completeness) |
| `ay{YY}_enrolment_documents.{slotKey}Status` | **Write** (Valid / Rejected) | Write on staff upload (sets `'Valid'` only, KD #37) | — | Read |
| `ay{YY}_enrolment_documents.{slotKey}Expiry` | Read / edit | **Write** (from upload dialog metadata) | — | — |
| `p_file_revisions` | Read (historical context) | **Write** (append on replace, KD #36) | — | — |
| `ay{YY}_discount_codes` (catalogue) | **Write** (exclusive, catalogue CRUD + soft-delete) | — | — | — |
| `ay{YY}_enrolment_applications.discount{1,2,3}` | Write (via Profile sheet) | — | Read | — |

**Per-student discount grants** are written by the external enrolment portal directly into the `discount{1,2,3}` slot columns — the Records module only manages the code catalogue and edits the slot strings on the student's application row. There is no separate per-student grant ledger.

### The two `applicationStatus` columns

Two columns in the admissions schema are both named `applicationStatus`, in different tables, with completely different value spaces. This is the most common source of confusion when reading admissions code, so it lives here in the cross-module contract:

| Table | Owner | Value space | Meaning |
|---|---|---|---|
| `ay{YY}_enrolment_applications.applicationStatus` | Parent portal | `Draft` (presumed) / `Registered` (observed) | Application *form* submission state — set when the parent finishes the form on `enrol.hfse.edu.sg`. |
| `ay{YY}_enrolment_status.applicationStatus` | SIS / admissions team | `Submitted` / `Ongoing Verification` / `Processing` / `Enrolled` / `Enrolled (Conditional)` / `Cancelled` / `Withdrawn` | SIS-side workflow pipeline. Canonical list in `lib/schemas/sis.ts:STAGE_STATUS_OPTIONS.application`. |

**Every drill, dashboard, lifecycle widget, sync filter, and roster builder reads from the SIS-side (status) column.** Default to assuming the **status table** when code says `applicationStatus`; the apps-table column is only useful for "did the parent finish the form yet?" Full discussion: `06-admissions-integration.md` § The two `applicationStatus` columns.

### `category` ↔ `enroleeType` mirror

`ay{YY}_enrolment_applications.category` and `ay{YY}_enrolment_status.enroleeType` mirror each other for the same `enroleeNumber` — both are the same 4-value enum (`New` / `Current` / `VizSchool New` / `VizSchool Current`, exported as `ENROLEE_CATEGORIES` in `lib/schemas/sis.ts`). The discount-codes catalogue's `enroleeType` is a **6-value superset** that adds `Both` and `VizSchool Both` for codes applicable to either New OR Current students. See `06-admissions-integration.md` for the full eligibility-matching rules.

### Coordination rules

- **Document validation lives in the Records module, not P-Files.** P-Files is a repository — files, history, metadata. It never sets `'Rejected'`. The Records module's Documents tab is where staff send a document back for re-upload with a reason.
- **The Records module must not re-implement document upload.** The Documents tab deep-links out to P-Files; the `DocumentCard` adds `scroll-mt-20 target:` styling so the linked-to slot scrolls into view (see `docs/context/12-p-files-module.md`).
- **Passport number / pass type coexist on applications and documents.** P-Files's upload dialog writes both. The Records module's Profile sheet also edits these. When adding a third writer — don't; route through one of the existing two via their zod schemas in `lib/schemas/`.
- **`classSection` is the Markbook liveness signal.** `lib/sync/students.ts` treats `enrolment_status.classSection IS NOT NULL` as "this student is live in Markbook." The Records module must never null it silently on withdrawal — the Stage PATCH route routes through `applicationStatus='Withdrawn'` instead.

## Cross-module navigation

Deep-links, SSO handoffs, and module-to-module routes currently in place:

- **Module switcher** (`components/module-switcher.tsx`) — sticky-header shadcn `Select` for school_admin + admin + superadmin; pivots between `/`, `/p-files`, `/sis`. `p-file` officers stay locked to P-Files. Teachers + registrar stay in Markbook (registrar reaches `/sis` via the sidebar, not the switcher).
- **SIS Documents tab → P-Files** — `/records/students/[enroleeNumber]` Documents tab deep-links each slot card to `/p-files/[enroleeNumber]#slot-{key}`.
- **P-Files revision history → (no return link)** — file archives live on `p_file_revisions` with `replaced_by_user_id` stamping the actor; the history dialog is a terminal view.
- **Parent portal → SIS SSO** — `enrol.hfse.edu.sg` clicks land at `/parent/enter#access_token=&refresh_token=&next=`; client-side `supabase.auth.setSession()` establishes the SIS's session without a second login. Full details: `10-parent-portal.md`.
- **Admissions dashboard → (no deep-links)** — read-only; registrar exports CSV via `/api/admissions/export` if they need row-level follow-through, then reaches each student via `/records/students/[enroleeNumber]`.
- **Markbook → (no deep-links to SIS yet)** — teachers don't need demographic access today. A grading-sheet row → SIS student detail link is a candidate for a future module-connection pass.
- **Root `/` dashboard** — a single landing page for everyone; teachers see school stats + grading/report-card links; registrar/admin/superadmin additionally see the admissions pipeline snapshot, stale-applications table, and admin tool grid.

## Access matrix

Reflects current `ROUTE_ACCESS` in `lib/auth/roles.ts`. `—` means the role cannot reach that surface. Note the `admin` vs `school_admin` split per KD #39: admins are the grade-change approval pool; school_admins handle operations.

| Module / surface | teacher | parent | p-file | registrar | school_admin | admin | superadmin |
|---|---|---|---|---|---|---|---|
| Markbook `/grading` (own sheets) | ✓ read/write | — | — | ✓ full | ✓ full | ✓ full | ✓ full |
| Markbook `/report-cards` | — | — | — | ✓ full | ✓ full | ✓ full | ✓ full |
| Markbook `/admin/sections/*` | — | — | — | ✓ full | ✓ full | ✓ full | ✓ full |
| Markbook `/admin/change-requests` (approve/reject) | — | — | — | — (view only) | — | ✓ (if designated) | — (observes) |
| Parent `/parent/*` | — | ✓ read own | — | — | — | — | — |
| P-Files `/p-files/*` | — | — | ✓ full | — | ✓ read | ✓ read | ✓ full |
| Admissions dashboard `/admin/admissions` | — | — | — | ✓ read | ✓ read + export | ✓ read + export | ✓ read + export |
| Records module `/sis/*` | — | — | — | ✓ full | ✓ full | ✓ full | ✓ full |
| AY Setup `/sis/ay-setup` | — | — | — | — | ✓ create + switch-active | ✓ create + switch-active | ✓ full incl. delete |
| Approver management `/sis/admin/approvers` | — | — | — | — | — | — | ✓ |
| Module switcher visible | — | — | locked to P-Files | — | ✓ | ✓ | ✓ |

Some further nuance: within Markbook the `teacher` role is scoped to their own `teacher_assignments` rows; within P-Files both `school_admin` and `admin` can view files + history but cannot upload or replace (only `p-file` + `superadmin` write).

## Where to add new per-student data

When a new domain (attendance daily, medical, communications, incidents, CCA, etc.) arrives, the decision goes through these questions:

1. **Is it grade-card-visible academic data?** → Markbook. Examples: new subject categories, new grading factor. Lives under `grade_entries` / `grading_sheets` or adjacent SIS-owned tables.
2. **Is it a document / file the parent uploads or the school archives?** → P-Files. Examples: new document slot on the `ay{YY}_enrolment_documents` DDL. Coordinate with the parent portal team since they own that schema.
3. **Is it a demographic / family / pipeline-stage attribute of the applicant?** → Records module. Examples: new intake question, new assessment outcome column. Usually already on the admissions applications row; if not, the parent portal team adds the column, then the Records module adds a field to the Profile sheet.
4. **Is it a new domain that doesn't fit any of the above?** → a **new module**. Spec a new `docs/context/NN-{module}.md` (parity with 12, 13, 15), add a route group, register nav in `NAV_BY_MODULE`, add access in `ROUTE_ACCESS`, and put the tables in SIS-owned schema unless there's a specific reason to co-locate with admissions.

**Heuristic:** per-student data belongs on the shared profile surface, not in a silo. If the only thing linking it to the rest of the system is a `student_number` FK, then the module that displays it (usually via the Records module's student detail page) should consider itself part of the same record — cross-link in, not stand alone.

## See also

- `01-project-overview.md` — product framing, people, organisation context.
- `04-database-schema.md` — SIS-owned table DDLs.
- `06-admissions-integration.md` — admissions tables owned by the parent portal; read/write split.
- `10-parent-portal.md` — parent-portal integration + SSO handoff + admissions DDL reference.
- `12-p-files-module.md`, `13-sis-module.md`, `15-markbook-module.md`, `08-admission-dashboard.md` — per-module scope docs.
- `CLAUDE.md` Hard Rule #4 and Key Decisions #2, #22, #31, #33, #34, #36, #37, #38 — authoritative, terse rules for anything this doc summarises.
