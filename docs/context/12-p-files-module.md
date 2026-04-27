# P-Files Module (Student Document Repository)

## Overview

The P-Files module is the **document repository** for enrolled students' validated records. Admissions staff come here to retrieve the current passport, birth certificate, medical exam, parent/guardian passes, etc., for any student. It is **not** a review queue — document validation (approve/reject) lives in the future Records module, where admissions staff manage the full student record.

P-Files lives alongside the other Records modules as a separate route group (`/(p-files)/`) in the same Next.js app, sharing auth and Supabase infrastructure.

**Current manual process:** Parents upload documents during enrollment via the admissions portal (`enrol.hfse.edu.sg`). Ms. Gael (admissions) collects them, forwards to the P-files person, who manually uploads to SharePoint folders organized by student name/number. No centralized tracking of what's complete vs missing.

**Goal:** Replace the manual SharePoint workflow with an in-app cabinet that reads from `ay{YYYY}_enrolment_documents` (already populated by parent uploads), lets staff upload replacements on behalf of parents, preserves every previous version in a revision history, and flags expired documents.

## Access

Three-tier access:

| Role | Browse / view / history | Upload / replace |
|---|---|---|
| `p-file` officer | ✅ | ✅ |
| `superadmin` | ✅ | ✅ |
| `admin` | ✅ (via module switcher) | ❌ |
| `teacher`, `registrar`, parents | ❌ | ❌ |

`proxy.ts::ROUTE_ACCESS` allows `p-file + admin + superadmin` to reach `/p-files/*`; the layouts re-assert this. Write gates live at the API layer — `POST /api/p-files/[enroleeNumber]/upload` requires `['p-file', 'superadmin']`, so even if an admin bypasses UI their request is rejected. `DocumentCard` takes a `canWrite` prop (server-rendered from the session role) that hides the Upload / Replace button for admin viewers.

## Required Documents Per Student

Sixteen total slots, split by expiry behavior. The canonical list lives at `lib/sis/queries.ts:DOCUMENT_SLOTS` (16 entries; `STP_CONDITIONAL_SLOT_KEYS` exports the 3 STP-gated slot keys separately).

### Non-expiring documents (8 slots)

| Document | DB column (URL) | DB column (status) | STP-conditional? |
|----------|----------------|-------------------|------------------|
| ID Picture | `idPicture` | `idPictureStatus` | — |
| Birth Certificate | `birthCert` | `birthCertStatus` | — |
| Educational Certificate | `educCert` | `educCertStatus` | — |
| Medical Exam | `medical` | `medicalStatus` | — |
| Form 12 | `form12` | `form12Status` | — |
| ICA Photo | `icaPhoto` | `icaPhotoStatus` | ✅ STP only |
| Financial Support Docs | `financialSupportDocs` | `financialSupportDocsStatus` | ✅ STP only |
| Vaccination Information | `vaccinationInformation` | `vaccinationInformationStatus` | ✅ STP only |

### Expiring documents (8 slots)

| Document | DB column (URL) | DB column (status) | Expiry column |
|----------|----------------|-------------------|---------------|
| Passport | `passport` | `passportStatus` | `passportExpiry` |
| Student Pass | `pass` | `passStatus` | `passExpiry` |
| Mother's Passport | `motherPassport` | `motherPassportStatus` | `motherPassportExpiry` |
| Mother's Pass | `motherPass` | `motherPassStatus` | `motherPassExpiry` |
| Father's Passport | `fatherPassport` | `fatherPassportStatus` | `fatherPassportExpiry` |
| Father's Pass | `fatherPass` | `fatherPassStatus` | `fatherPassExpiry` |
| Guardian's Passport | `guardianPassport` | `guardianPassportStatus` | `guardianPassportExpiry` |
| Guardian's Pass | `guardianPass` | `guardianPassStatus` | `guardianPassExpiry` |

### Conditional logic

- Father documents required only if `fatherEmail` is present in `ay{YYYY}_enrolment_applications`
- Guardian documents required only if `guardianEmail` is present in `ay{YYYY}_enrolment_applications`
- Mother documents always required (assumption — validate with stakeholder)
- The 3 STP-conditional slots required only if `ay{YYYY}_enrolment_applications.stpApplicationType` indicates an active STP application. See `21-stp-application.md` for the full STP workflow (Edutrust Certified school sponsoring Singapore Student Passes via ICA).

## Document status workflow (canonical reference)

The `*Status` raw column has two distinct state machines, depending on whether the slot has an expiry date. This is the canonical reference for the value spaces — every other doc points back here.

### Non-expiring slots (`null → 'Uploaded' → 'Valid'`)

```
       (parent uploads)         (registrar validates)
null ───────────────► Uploaded ─────────────────────► Valid
                          │
                          └──── (registrar rejects) ──► Rejected
```

- `null` — slot has no upload yet.
- `'Uploaded'` — parent uploaded but registrar hasn't validated yet. **Registrar action needed.**
- `'Valid'` — registrar accepted.
- `'Rejected'` — registrar rejected; parent must re-upload.
- `'To follow'` — parent acknowledged the requirement but is not ready to upload yet.

### Expiring slots (`null → 'Valid' → 'Expired'`)

```
       (parent uploads + expiry date)        (expiry date passes)
null ─────────────────────────────────► Valid ──────────────────► Expired
```

- `null` — slot has no upload yet.
- `'Valid'` — parent uploaded with an expiry date in the future. **No `'Uploaded'` intermediate** — the expiry date itself is the validation evidence.
- `'Expired'` — auto-flipped when the `*Expiry` column passes today's date. Parent must re-upload.
- `'To follow'` — parent acknowledged the requirement but is not ready to upload yet.

### Re-upload-required terminal states

`'Rejected'` (non-expiring) and `'Expired'` (expiring) both mean the parent must re-upload. The lifecycle aggregate "Awaiting document revalidation" bucket on `/sis` counts both (see `20-dashboards.md`).

### Status model in P-Files

P-Files collapses the raw `{slotKey}Status` column to five display states. **It does not mutate the status column** — that's SIS's job.

| Display       | When                                                                       |
|---------------|----------------------------------------------------------------------------|
| On file       | URL present and raw status is not `Uploaded` (incl. `Valid` / `Approved`)  |
| Pending review| URL present and raw status is `Uploaded` (parent self-serve, not yet SIS-validated) |
| Expired       | Expiring slot whose expiry date is before today — overrides other states   |
| Missing       | No URL and no status                                                       |
| N/A           | Conditional slot that doesn't apply (e.g. no `fatherEmail`)                |

There is **no `Rejected` state in P-Files** — rejection is a validation call and lives in SIS. Resolution happens in `lib/p-files/document-config.ts::resolveStatus`.

## Data Source

All document data lives in the admissions table `ay{YYYY}_enrolment_documents`, keyed by `studentNumber`. This table is **already populated** by parent uploads through the admissions portal. The SIS has read access via `createServiceClient()` (service-role, bypasses RLS).

### Document URL format

The `text` columns (e.g. `passport`, `birthCert`) store Supabase Storage URLs or paths. The exact format depends on how the admissions portal writes them — inspect a few rows to determine whether they're full URLs (`https://xxx.supabase.co/storage/v1/object/...`) or relative paths.

### Linking to student roster

Join path: `enrolment_documents.studentNumber` → `enrolment_applications.studentNumber` → markbook `students.student_number`. The `studentNumber` is the stable cross-year ID (CLAUDE.md Hard Rule #4).

## Module capabilities

### 1. Dashboard (read-only overview)

- Per-student completeness matrix: which documents on file, which missing, which pending review (parent self-serve, awaiting SIS validation), which expired
- Section/level filter + status filter (Complete / Has missing / Has expired / Pending review)
- Summary stats: total students, fully complete, students with expired docs, students with missing docs
- AY switcher (same pattern as admissions dashboard)

### 2. Student detail view

- All 16 document slots (8 non-expiring + 8 expiring; 3 of the non-expiring are STP-conditional and only show when `stpApplicationType` is set) with current status, file preview/download link, expiry date, **History button** for any slot with a file
- Visual indicators: mint (on file), amber (pending review), red (expired), dashed (missing), muted (N/A)

### 3. Upload / Replace on behalf

- Staff upload a document on behalf of a parent (e.g. parent emailed it, or brought a physical copy)
- The button labels switch based on slot state: **Upload** when missing, **Replace** when a file is already on record
- Staff uploads always set the DB status column to `'Valid'` so the repository view reflects that the staff member accepted the file. Validation semantics still belong to SIS.
- Multipart: one or more files. Single file → stored as-is; multiple PDFs → merged server-side via `pdf-merger-js`. Limits: 10 MB per file, 30 MB per request
- Expiring slots require structured metadata (passport number *or* pass type + expiry date) which is mirrored into `ay{YYYY}_enrolment_applications`

### 4. Revision history

- Every **Replace** on a slot that already has a file archives the previous file to `parent-portal/<prefix>/<enroleeNumber>/<slotKey>/revisions/<iso>.<ext>` and inserts one row into `p_file_revisions` (migration `011_p_file_revisions.sql`)
- The row snapshots pre-replacement state: archived URL + path, raw status, expiry, passport number or pass type, optional staff-entered note, actor (`replaced_by_user_id` + `replaced_by_email`), `replaced_at`
- Readable via `GET /api/p-files/[enroleeNumber]/revisions?slotKey=...` — surfaced in the UI through `components/p-files/history-dialog.tsx` (triggered from the History button on each document card)
- Append-only per Hard Rule #6 — rows are never updated or deleted, even when the corresponding slot is replaced again later

## Architecture

### Route structure

```
app/
├── (p-files)/p-files/
│   ├── page.tsx              ← dashboard: completeness matrix
│   ├── [enroleeNumber]/
│   │   └── page.tsx          ← student detail: all documents + history
│   ├── audit-log/            ← module-scoped audit log (pfile.* actions)
│   └── layout.tsx            ← p-files shell with own sidebar

app/api/p-files/[enroleeNumber]/
├── upload/route.ts           ← POST — merge + archive-on-replace
└── revisions/route.ts        ← GET ?slotKey=… — revision list for History dialog
```

### Module switcher

After login, the root `/` page (or sidebar) shows a module picker: Markbook vs P-Files. The `proxy.ts` middleware gates access by role — a `p-file` role user who tries to access `/grading` gets redirected, and vice versa for a `teacher` trying `/p-files`.

### Shared infrastructure

- Same Supabase project, same auth, same `createServiceClient()`
- Same design system (Aurora Vault tokens, shadcn components)
- Same `lib/academic-year.ts` for AY resolution
- Same `lib/supabase/admissions.ts` patterns for querying admissions tables

### Code map

- `lib/p-files/document-config.ts` — slot definitions + `resolveStatus` + `PASS_TYPES`
- `lib/p-files/queries.ts` — `getDocumentDashboardData` (cached), `getStudentDocumentDetail`, `getDocumentRevisions`
- `lib/p-files/mutations.ts` — `createRevision` (service-role insert into `p_file_revisions`)
- `components/p-files/` — `summary-cards`, `completeness-table`, `document-card`, `upload-dialog`, `history-dialog`
- `app/api/p-files/[enroleeNumber]/upload` — POST: merge + archive-on-replace + dual-table write + audit
- `app/api/p-files/[enroleeNumber]/revisions` — GET: list archived versions for one slot

## Not in scope (for now)

- **Approve / reject of documents** — moves to the Records module (see `docs/context/13-sis-module.md`). P-Files only writes `Status='Valid'` on staff uploads; the Records module becomes the primary writer of the `{slotKey}Status` column.
- Bulk operations (bulk upload, export missing list)
- Integration with SharePoint (the goal is to replace SharePoint, not sync with it)
- Revision rollback UI — the History dialog is read-only. Restoring a prior version means re-uploading it via the Replace flow, which will itself create a new revision.
- Revision cleanup / retention policy — revisions are append-only. If storage cost becomes a concern, a scheduled purge job against `p_file_revisions` + `storage.objects` would go here.
