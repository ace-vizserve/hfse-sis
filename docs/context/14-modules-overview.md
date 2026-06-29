# Modules Overview — How the SIS Hangs Together

## What this doc is

The hub for cross-module concerns. The HFSE SIS is one Next.js deployable with **seven modules** on top of one Supabase project and one `auth.users` table. Read this doc before touching anything that spans modules — the module map, the shared student identity, what's allowed to read/write what, the access matrix, and where to add new per-student data all live here.

For the detailed scope of each module, see its own doc: `15-markbook-module.md`, `16-attendance-module.md`, `19-evaluation-module.md`, `12-p-files-module.md`, `08-admission-dashboard.md`, `13-sis-module.md`, `18-ay-setup.md`. This doc deliberately does not duplicate their contents.

## Module map

The SIS has **seven modules**. Each renders under its own Next.js route group, has its own sidebar (via `lib/auth/roles.ts::NAV_BY_MODULE`), and is gated by `ROUTE_ACCESS` + `proxy.ts`. **Academic Summary** is a cross-subject grade view under Records (not a standalone module). The **Parent Portal** is an external Vite SPA consuming a read-only Bearer API — there are no in-SIS parent pages.

### Markbook — academic records (`/markbook/*`)

Grades, report cards, adviser comments, change-request workflow. The original module and the heaviest in workflow complexity (lock/unlock, formula compute, quarterly→annual aggregation, parent publication windows). Academic Summary relocated here to Records; Masterfile export at `GET /api/markbook/masterfile/export`. Audience: teachers (own sheets), registrar (full), school_admin (full reads + CR approvals), superadmin.

### Attendance — daily register + term rollup (`/attendance/*`)

Per-student daily attendance (P / A / EX / L) across the term grid. Owns all attendance writes (`attendance_daily`); writes the `attendance_records` term-summary rollup consumed by Markbook for report cards (KD #47). Term sheet mirrors HFSE's paper register (KD #151), including xlsx export. Analytics dashboard (registrar+), Daily view (teachers), per-student detail, Attendance Insights (`/attendance/insights`, KD #142). See `16-attendance-module.md`.

### Evaluation — form-class-adviser write-ups (`/evaluation/*`)

Owns the "Form Class Adviser's Comments" on T1–T3 report cards. FCA write-ups per student per term, virtue-theme editor at `/evaluation/virtue-themes` (KD #137), FCA chase metrics on the registrar dashboard (KD #126). **PTC/checklists were removed (KD #114)** — routes 410 Gone. Audience: form advisers (own sections), registrar/school_admin/superadmin (all sections). See `19-evaluation-module.md`.

### P-Files — document repository (`/p-files/*`)

Per-student document storage with revision history. Stores file URLs + metadata + expiries; archives prior versions on replace; never sets `'Rejected'` (that's the document-validation route's job). Three-tier access: `p-file` officers and superadmin have full write, school_admin is read-only. Enrolled-students-only scope (KD #71). See `12-p-files-module.md`.

### Admissions — pre-enrolment pipeline (`/admissions/*`)

The full pre-enrolment funnel (Inquiry → Applied → Interviewed → Offered → Accepted → Enrolled). Profile / family / stage pipeline editing, document validation (approve/reject), discount-code catalogue CRUD, STP application tracking, application feedback, staleness filter. Analytics dashboard + Enrollment Health Insights (`/admissions/insights`, KD #140). **Frozen post-enrolment** for most axes (KD #147) — Records owns the academic lifecycle once the student is Enrolled. Audience: admissions role, registrar, school_admin, superadmin. See `08-admission-dashboard.md`.

### Records — enrolled-student system of record (`/records/*`)

The post-enrolment operational hub. Enrolled-student directory, cross-year academic history (via `studentNumber`, KD #4), section transfers, movements feed, unsynced-students queue, Academic Summary hub (`/records/academic-summary`, KD #127/#134), Report-book export. Shares the **Shared Student Profile** (`ay{YY}_enrolment_applications` identity row) with Admissions — both modules can edit Profile + Family (KD #147). Audience: registrar, school_admin, superadmin. See `13-sis-module.md`.

### SIS Admin — configuration surface (`/sis/*`)

AY setup + rollover, school calendar, sections, teacher assignments, approvers, discount codes (accessible also to admissions role, KD #133), school config, users, template. The Year Setup Workbench at `/sis/ay-setup` (school_admin + superadmin) manages AY creation, early-bird toggle (KD #118), and the 4-step AY Readiness Pill (KD #109). **Operational modules consume config from here; they do not define it (KD #48).** Audience: school_admin, superadmin (registrar read-only for AY list).

### Academic Summary (under Records)

At `/records/academic-summary`. Cross-subject grade view per level/class with hub + child routes (`/awards`, `/attendance`, `/comments`). Registrar/school_admin/superadmin only. Masterfile export (`.xlsx` + `.csv`) via `GET /api/markbook/masterfile/export`. Award tier computation from `lib/compute/awards.ts` using thresholds on `school_config`. See KD #127/#134/#95.

### Parent Portal (external — not an in-SIS module)

An external Vite SPA (`enrol.hfse.edu.sg` / staging) that authenticates parents against the shared Supabase project. Sends `Authorization: Bearer <access_token>` to `/api/parent/v2/*`; there are **no in-SIS parent pages**. Shows published report cards gated by per-section publication windows (KD #10). CORS via `lib/cors.ts` (`ADMISSIONS_PORTAL_ORIGIN` env var). See `10-parent-portal.md`.

## Planned / future modules

| Module         | Status             | Notes                                                                                                                                                                                              |
| -------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduling     | Not yet built      | Timetable + period definitions. Prerequisite for period-level attendance (`period_id` hook reserved in schema). `teacher_assignments` is the stub today ("who teaches what" but not "when/where"). |
| Health/Medical | Not yet scoped     | Allergies, immunisation, clinic log. Needs a sub-role (nurse/counsellor) for sensitive fields.                                                                                                     |
| Communications | Not yet scoped     | Per-student record of parent calls/emails/meetings + follow-up.                                                                                                                                    |
| PTC Surface    | Deferred (KD #114) | DB tables ready (`evaluation_ptc_feedback`, `evaluation_checklist_items`, etc.); build when HFSE requests; zero coupling to write-up flow.                                                         |

Explicitly out of scope until asked: library, transport routes, alumni, field trips, room booking.

## Shared student identity

Every module keys per-student data off one of two IDs:

- **`studentNumber`** — the **stable cross-year identifier** (Hard Rule #4). Use this whenever crossing a module boundary or an AY boundary. `students.student_number` in SIS-owned tables, `"studentNumber"` in admissions applications.
- **`enroleeNumber`** — an **AY-scoped** identifier (e.g. `E260001` for AY2026). Resets each AY. Used only for joining within a single AY's admissions tables (applications ↔ status ↔ documents).

**Why this matters:** Markbook ↔ Records ↔ P-Files cross-links must resolve through `studentNumber`, never `enroleeNumber`. A returning student has one `studentNumber` but a new `enroleeNumber` each AY.

## Module-ownership model (KD #147 + #150)

Full model in `docs/context/22-module-ownership-truth-model.md`. Summary:

- **Historical truth is append-only** (Hard Rule #6) — never overwritten.
- **Current truth is owned by exactly one module post-enrolment**; other modules display a read-only mirror.
- **Status moves forward only** — an Enrolled student is never pushed back into the Admissions funnel.

**Four participants in one shared student record:**

1. **Admissions** owns the application record + pre-enrolment doc validation — **historical/read-only once Enrolled** (except `supplies` + `orientation` stages, which happen post-enrolment, KD #147).
2. **Shared Student Profile** = the `ay{YY}_enrolment_applications` identity row (name/DOB/gender/nationality/address/passport/pass/parents/contacts) — **editable from Admissions OR Records** (one record; both modules write the same row).
3. **Records** owns the post-enrolment **academic lifecycle** on `section_students` (status/date/section/level/attendance/grades/evaluation/withdrawal/re-enrol).
4. **P-Files** owns the post-enrolment **document lifecycle** (`{slot}Status/Url/Expiry` + append-only `p_file_revisions`/`p_file_outreach`), reads enrollment/profile only.

## Cross-module data contract

Every admissions-owned table has one **primary writer**. Other modules may have narrow write responsibilities for specific columns — those are called out explicitly.

| Table (or column)                                               | Records / Admissions                                                                                             | P-Files                                                              | Markbook                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------- |
| `ay{YY}_enrolment_applications` (demographics, parent emails)   | **Write** — Profile/Family PATCH routes (both modules per KD #147)                                               | Write — passport# / pass type via upload dialog (KD #34)             | Read (parent→student lookup) |
| `ay{YY}_enrolment_status` (stage pipeline)                      | **Write** — Stage PATCH route (Admissions pre-enrolment; Records post-enrolment for `supplies`/`orientation`)    | Read                                                                 | Read (filter enrolled)       |
| `ay{YY}_enrolment_documents.{slotKey}` (URL)                    | Read                                                                                                             | **Write** (canonical file URL + archive prior to `p_file_revisions`) | —                            |
| `ay{YY}_enrolment_documents.{slotKey}Status`                    | **Write** (Valid / Rejected via document-validation route)                                                       | Write on staff upload (sets `'Valid'` only, KD #37)                  | —                            |
| `ay{YY}_enrolment_documents.{slotKey}Expiry`                    | Read                                                                                                             | **Write** (from upload dialog metadata)                              | —                            |
| `p_file_revisions`                                              | Read (historical context)                                                                                        | **Write** (append on replace, KD #36)                                | —                            |
| `ay{YY}_discount_codes` (catalogue)                             | **Write** (exclusive, catalogue CRUD + soft-delete)                                                              | —                                                                    | —                            |
| `public.section_students` (enrollment_status / dates / section) | **Write** — Records module only (via section-students PATCH route, transfer route, withdrawal/re-enrol cascades) | —                                                                    | Read (roster gate)           |

**Per-student discount grants** are written by the external enrolment portal directly into the `discount{1,2,3}` slot columns — Records only manages the code catalogue and edits the slot strings on the student's application row.

### The two `applicationStatus` columns (KD #59 + #150)

Two columns in the admissions schema are both named `applicationStatus`, in different tables, with completely different meanings:

| Table                                             | Owner         | Value space                                                                                                             | Meaning                                                                                                      |
| ------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ay{YY}_enrolment_applications.applicationStatus` | Parent portal | `Draft` (presumed) / `Registered` (observed)                                                                            | Application form submission state.                                                                           |
| `ay{YY}_enrolment_status.applicationStatus`       | SIS           | `Submitted` / `Ongoing Verification` / `Processing` / `Enrolled` / `Enrolled (Conditional)` / `Cancelled` / `Withdrawn` | The application **outcome** — the furthest-forward status reached (KD #150). **Append-only post-enrolment.** |

**Critical (KD #150):** `applicationStatus` is now the application **OUTCOME**, not the current state. A student who enrolled then withdrew keeps `applicationStatus='Enrolled'`. Their **current state** lives on `section_students.enrollment_status` (`active` / `withdrawn` / `late_enrollee`). Code detecting "currently withdrawn" must read `enrollment_status`, not `applicationStatus`. The post-enrolment withdrawal route no longer overwrites `applicationStatus`. The `fetchAdmissionsRoster` sync filter excludes currently-withdrawn rows via `filterWithdrawnFromRoster` — without this, a bulk sync would reactivate a withdrawn student.

**Every drill, dashboard, lifecycle widget, and sync filter reads from the SIS-side (status) column.** Default to assuming the **status table** when code says `applicationStatus`.

### `category` ↔ `enroleeType` mirror

`ay{YY}_enrolment_applications.category` and `ay{YY}_enrolment_status.enroleeType` mirror each other — both are the same 4-value enum (`New` / `Current` / `VizSchool New` / `VizSchool Current`, exported as `ENROLEE_CATEGORIES` in `lib/schemas/sis.ts`). The discount-codes catalogue's `enroleeType` is a **6-value superset** that adds `Both` and `VizSchool Both`. See `06-admissions-integration.md`.

### Coordination rules (KD #147)

- **Admissions stage editors freeze once Enrolled** — the stage PATCH route 422s `enrolled_frozen` for most stages once `applicationStatus==='Enrolled'`; exceptions: `supplies` + `orientation` remain editable until finalized.
- **Document validation: role gate splits by enrolment state** — the document-validation PATCH 403s the `admissions` role on enrolled students (docs are P-Files') and `p-file` on un-enrolled (validation is Admissions'). Registrar/superadmin act either side.
- **`classSection` is the Markbook liveness signal.** `lib/sync/students.ts` treats `enrolment_status.classSection IS NOT NULL` as "this student is live in Markbook." Do not null it silently — use the withdrawal/transfer routes.
- **The Records module must not re-implement document upload.** The Documents tab deep-links to P-Files. `DocumentCard` adds `scroll-mt-20 target:` styling so the linked slot scrolls into view.
- **Section transfer is single-source via SIS Admin** (KD #67). `POST /api/sis/students/[enroleeNumber]/transfer-section` is the only path for moving an enrolled student mid-year.

## Cross-module navigation

Deep-links and module-to-module routes in place:

- **Module switcher** (`components/module-sidebar/sidebar-header.tsx`) — `Popover` switcher in every module sidebar; visible when `allowedModules.length > 1`. Single-module roles (p-file → P-Files only, admissions → Admissions only) see a non-interactive brand tile. See KD #33/#58.
- **Records → P-Files** — Records student detail Documents tab deep-links each slot to `/p-files/[enroleeNumber]?ay=…`.
- **Markbook → Records** — Academic Summary drill sheets link to `/records/students/[studentNumber]`; drill rows always use `studentNumber` per KD #81.
- **Admissions → Records** — enrolled applicants deep-link to `/records/students/by-enrolee/[enroleeNumber]`.
- **Records "Sync from Admissions"** — `/records/students` sidebar entry; runs `lib/sync/students.ts` to pull from `ay{YY}_enrolment_*` into `public.students` + `public.section_students`.
- **Records → SIS Admin "Section setup"** — sidebar cross-link to `/sis/sections` (registrar has no SIS module tile; KD #136 discoverability gap fix).
- **Parent portal** — external SPA sends `Authorization: Bearer <access_token>` to `/api/parent/v2/*`. No in-SIS parent pages. CORS via `lib/cors.ts`.

## Access matrix

Reflects current `ROUTE_ACCESS` in `lib/auth/roles.ts`. `—` means the role cannot reach that surface. The `admin` role was **retired in KD #39** — `school_admin` is the consolidated cross-cutting generalist.

| Module / surface                                | teacher                      | p-file            | admissions                | registrar      | school_admin             | superadmin          |
| ----------------------------------------------- | ---------------------------- | ----------------- | ------------------------- | -------------- | ------------------------ | ------------------- |
| Markbook `/markbook/*` (own sheets)             | ✓ own sheets                 | —                 | —                         | ✓ full         | ✓ full                   | ✓ full              |
| Markbook change-request approval                | — (view own)                 | —                 | —                         | ✓ apply only   | ✓ approve/reject         | ✓ full              |
| Attendance `/attendance/*`                      | ✓ own sections               | —                 | —                         | ✓ full         | ✓ full                   | ✓ full              |
| Evaluation `/evaluation/*`                      | ✓ form adviser               | —                 | —                         | ✓ full         | ✓ full                   | ✓ full              |
| P-Files `/p-files/*`                            | —                            | ✓ full            | —                         | —              | ✓ read                   | ✓ full              |
| Admissions `/admissions/*`                      | —                            | —                 | ✓ full (excl. AY config)  | ✓ full         | ✓ full                   | ✓ full              |
| Discount codes `/sis/admin/discount-codes`      | —                            | —                 | ✓ (KD #133)               | —              | ✓ full                   | ✓ full              |
| Records `/records/*`                            | —                            | —                 | —                         | ✓ full         | ✓ full                   | ✓ full              |
| Academic Summary `/records/academic-summary`    | —                            | —                 | —                         | ✓ full         | ✓ full                   | ✓ full              |
| SIS Admin `/sis/*`                              | —                            | —                 | — (except discount codes) | ✓ read AY list | ✓ full config            | ✓ full incl. delete |
| AY Setup `/sis/ay-setup`                        | —                            | —                 | —                         | ✓ read only    | ✓ create + switch-active | ✓ full incl. delete |
| Approver management `/sis/admin/approvers`      | —                            | —                 | —                         | —              | ✓                        | ✓                   |
| Module switcher visible                         | ✓ (markbook/attendance/eval) | locked to P-Files | locked to admissions      | —              | ✓                        | ✓                   |
| Parent portal (external SPA `/api/parent/v2/*`) | —                            | —                 | —                         | —              | —                        | —                   |

Parents authenticate against the shared Supabase project from the external SPA and call `/api/parent/v2/*` directly — they are not SIS users and never appear in this matrix.

## Where to add new per-student data

When a new domain arrives, the decision goes through these questions:

1. **Is it grade-card-visible academic data?** → Markbook. Examples: new grading factor, new subject type. Lives under `grade_entries` / `grading_sheets`.
2. **Is it a document / file the parent uploads or the school archives?** → P-Files. Examples: new document slot on the `ay{YY}_enrolment_documents` DDL. Coordinate with the parent portal team — they own that schema.
3. **Is it a demographic / family / pipeline-stage attribute of the applicant?** → Records/Admissions (Shared Student Profile). Examples: new intake question, new assessment outcome column.
4. **Is it a post-enrolment operational state** (attendance, write-ups, virtue themes)? → the module that owns that domain (Attendance, Evaluation, etc.).
5. **Is it a new domain that doesn't fit any of the above?** → a **new module**. Spec a new `docs/context/NN-{module}.md`, add a route group, register nav in `NAV_BY_MODULE`, add access in `ROUTE_ACCESS`, and put tables in SIS-owned schema unless there's a specific reason to co-locate with admissions.

**Heuristic:** per-student data belongs on the shared profile surface, not in a silo. If the only thing linking it to the rest of the system is a `student_number` FK, the module that displays it should cross-link to Records rather than standing alone.

## See also

- `01-project-overview.md` — product framing, people, organisation context.
- `04-database-schema.md` — SIS-owned table DDLs.
- `06-admissions-integration.md` — admissions tables owned by the parent portal; read/write split.
- `10-parent-portal.md` — parent-portal integration + external SPA + admissions DDL reference.
- `12-p-files-module.md`, `13-sis-module.md`, `15-markbook-module.md`, `16-attendance-module.md`, `18-ay-setup.md`, `19-evaluation-module.md` — per-module scope docs.
- `docs/context/22-module-ownership-truth-model.md` — full KD #147 ownership model.
- `CLAUDE.md` Hard Rule #4 and Key Decisions #2, #22, #31, #33, #34, #36, #37, #38, #47, #147, #150 — authoritative rules for anything this doc summarises.
