<!-- Topic file for `.claude/rules/key-decisions.md`. Numbering is global; do not renumber. -->

## P-Files — documents repository, expiry, renewals, scope

### KD #31

P-Files is a repository, not a review queue. `p-file`+`superadmin` write, `school_admin`+`admin` read. Never sets `'Rejected'` (KD #37). Enrolled-students-only scope enforced by KD #71. `12-p-files-module.md`.

### KD #34

P-Files upload = dual-table write + multi-PDF merge (`pdf-merger-js`) + archive-on-replace snapshot. 10MB/file, 30MB/request. `12-p-files-module.md`.

### KD #36

P-Files revision history is append-only (migration 011). `GET /api/p-files/[enroleeNumber]/revisions`. Hard Rule #6 applies. Captures parent-portal re-uploads via the migration-033 trigger (KD #63).

### KD #60

Document status workflow distinguishes expiring vs non-expiring slots. **Non-expiring** (5 always-applicable: idPicture, birthCert, educCert, medical, form12): `null → 'Uploaded' → 'Valid'` (or `'Rejected'`); P-Files officer manually flips Uploaded→Valid via the document-validation queue. **Expiring** (8 always-applicable: passport, pass, motherPassport, motherPass, fatherPassport, fatherPass, guardianPassport, guardianPass): `null → 'Valid' → 'Expired'` (auto-flip when expiry passes); the expiry date IS the validation evidence, no `'Uploaded'` intermediate. `'To follow'` is an admissions-phase-only status (KD #96); enrolled slots never go back to `'To follow'` — parent must re-upload (→ `'Uploaded'` for non-expiring, `'Valid'` + new expiry for expiring). `'Rejected'` + `'Expired'` both signal parent re-upload needed. Lifecycle aggregate has separate buckets: "Awaiting document validation" (Uploaded) vs "Awaiting document revalidation" (Rejected + Expired). `DOCUMENT_SLOTS` in `lib/sis/queries.ts` (13 entries post–migration 050; the `expiryCol?:` field is the type discriminator). The 3 STP-conditional slots (icaPhoto, financialSupportDocs, vaccinationInformation) were removed from DOCUMENT_SLOTS in migration 050 — see KD #96.

### KD #63

Parent-portal re-upload tracking via AFTER UPDATE trigger (migration 033). New `capture_doc_revision()` PL/pgSQL trigger fires AFTER UPDATE OF the 16 slot URL columns on each AY's docs table, gated on enrolled status (KD #31 scope rule). Inserts one `p_file_revisions` row per changed slot; `source` discriminator ∈ `{'pfile-upload', 'parent-portal', 'sis-direct'}` derives from `auth.jwt()` presence. Partial unique index on `(ay_code, enrolee_number, slot_key, previous_url)` lets the route's explicit insert + the trigger's deferred insert dedupe via ON CONFLICT DO NOTHING. `attach_doc_revision_trigger(p_docs_table)` introspects `information_schema.columns` and skips slot URLs that don't exist (handles AY2025 missing the 3 STP columns). Schema: `p_file_revisions.archived_url` + `archived_path` → nullable; new `previous_url` + `source` columns. Metadata-only — file-content preservation out of scope.

### KD #64

P-Files renewal lifecycle (migration 034). Append-only `p_file_outreach` table (`kind ∈ {'reminder', 'promise'}`) backs two registrar actions on actionable `DocumentCard`s: **Notify parent** (`POST /api/p-files/[enroleeNumber]/notify`, Resend per recipient, 24h cooldown) and **Mark as promised by `<date>`** (`PATCH .../promise` flips `<slot>Status='To follow'` per KD #60, surfaces in chase-strip "promised" bucket). Bulk fan-out via `POST /api/p-files/notify/bulk` (cap 50). Recipient resolution by slot prefix: `mother*`/`father*`/`guardian*` → matching email; student slots → mother + father (CC), fallback guardian. Email template at `lib/notifications/email-pfile-reminder.ts` (RESEND_API_KEY no-op fallback per KD #16, dev-redirect per KD #29). Sidebar quicklinks `?expiring=30|60|90` + `?status=expired` flip the `CompletenessTable` into bulk-select mode.

### KD #71

P-Files renewal-only scope guard. Enforces KD #31's enrolled-students-only scope. **Enrollment gate** on `/p-files/[enroleeNumber]` via `lib/p-files/queries.ts::isStudentEnrolled` (whitelist: `applicationStatus IN ('Enrolled', 'Enrolled (Conditional)') AND classSection IS NOT NULL`) — pre-Enrolled applicants 404 instead of leaking through. **Sidebar prune**: only `?status=expired` + `?expiring=30|60|90` quicklinks survive; `?status=missing|uploaded|complete` removed (admissions-territory per KD #70). **Dashboard prune**: drops Pending Review KPI (replaced with Expiring ≤30d), drops `<TopMissingDrillCard>`, simplifies `SlotStatusDrillCard` donut to 2 slices (On file + Expired), removes `pfilesInsights` `pendingReview` branch, replaces "Has Missing" summary card with "Expiring ≤90d". `<DocumentChaseQueueStrip>` mounts with `module="p-files"` so it surfaces only revalidation (Expired) + expiringSoon. Companion: `'to-follow'` promoted to first-class `DocumentStatus` member; `resolveStatus` rewritten so `<slot>Status` column is the single source of truth (null rawStatus → 'missing' regardless of URL).

### KD #96

STP-related document tracking removed (migration 050 — no migration needed; columns retained). HFSE parents upload ICA-required documents (icaPhoto, financialSupportDocs, vaccinationInformation) directly on the Singapore ICA website — the school never receives these files. Tracking statuses for them in the SIS was meaningless. Decision: erase these 3 slots from `DOCUMENT_SLOTS` + empty `STP_CONDITIONAL_SLOT_KEYS = [] as const` (kept exported for import back-compat). DB columns stay in place (same legacy-tolerance pattern as `report_card_comments` post-migration 018) — all surfaces stop reading/writing them. **What is still tracked**: `stpApplicationType` + `stpApplicationStatus` + `residenceHistory` on the `ay{YY}_enrolment_applications` row (the application workflow itself remains a SIS concern). Admissions validation page collapses to 13 always-applicable slots (no STP tab). P-Files validation page never had an STP tab. Future callers must not add new STP doc slots back without a proper migration.

### KD #91

P-Files detail gate relaxation + tabbed document groups + sticky-header refactor. Amends KD #71 in two ways: (1) `isStudentEnrolled` no longer requires `classSection IS NOT NULL` — the gate is now status-only (`applicationStatus IN ('Enrolled', 'Enrolled (Conditional)')`). Reason: P-Files is about renewal documents (passports / medical / pass / vaccination), which aren't section-scoped. Legacy / Directus-imported rows that land in Enrolled without classSection (the chronic gap behind KD #90) used to 404 the P-Files page; now they render and surface an amber `<Alert variant="warning">` near the top of the page ("This student has no class section assigned… Assign one from the enrolment record"). The alert deep-links to `/admissions/applications/[enroleeNumber]?ay=…&tab=enrollment`. (2) The detail page's previous long vertical stack (hero → operational row → 4 stacked document group sections) is replaced by a tabbed surface — new `<DocumentGroupTabs>` client wrapper around the shadcn `Tabs` primitive collapses **three** document groups (Student-expiring / Parent / Student) into one interactive surface — the STP tab was present at original shipping but was removed when migration 050 emptied `STP_CONDITIONAL_SLOT_KEYS` per KD #96. Per-trigger badge surfaces the "need action" count so the registrar sees pending work without flipping every tab. Defaults to the first group with actionable work; otherwise the first group overall. Reduces typical scroll depth ~70%. Cross-AY links from records (KD #4) now pass `?ay=${ayCode}` to the P-Files quicklink (records is cross-year but P-Files is AY-scoped — the prior omission caused 404s for students whose enrolment was in a non-current AY).

**Update (2026-08-05) — the chase counts finally caught up (KD #180).** Point (1) above relaxed the roster and the detail page, but `lib/sis/document-chase-queue.ts` and its drill kept filtering on `classSection IS NOT NULL`, so an enrolled-but-unplaced student rendered fine yet appeared in **no** chase count — nobody followed up their expiring or rejected documents. Harmless while unplaced students were a Directus-drift accident; not harmless once class assignment became a normal separate step (step 11 of the admission process). Both now delegate to one shared pure predicate, `lib/sis/chase-lens.ts::inChaseLensScope`, which is status-only for the p-files lens — the same rule this KD set for the roster. Expect the chase tiles to step up by the count of unplaced students.

**Update (2026-07-30) — one document, one place.** Every actionable document rendered **twice** on this page: once in the action queue and again as a card below, with different button labels for the same three dialogs — "Notify" up top and "Notify parent" beneath, "Promise" / "Mark as promised", "Upload" / "Replace". Five actionable documents produced ten rows, and the duplicate labels read as different features. Resolved by giving each half one job: **the queue is where you work, the cards are the record.** The tabbed group structure above is unchanged; only the duplication and the label drift are gone. Companion to KD #168, which fixed the same "can't read it at a glance" complaint on the completeness table.

### KD #204

**P-Files holds everyone in the year, and document validation is a filter rather than a page (2026-09-01).** Mr Ace: _"just list them all in p-files thats fine they are sharing same documents anyways regardless if theyre enrolled or not."_

**This relaxes the enrolled-only scope KD #31 set and KD #91 narrowed to status-only.** The justification is in the schema, not in preference: both audiences already share **one** `ay{YY}_enrolment_documents` row and **one** 21-slot `DOCUMENT_SLOTS` list, and several of those slots are pre-enrolment by nature — `assessmentResult` ("Assessment Result and Interview"), `birthCert`, `lastSchoolRecommendation`. The two validation queues read the _same three tables_ through two loaders that differed only by an `applicationStatus` filter; `createAdmissionsClient()` is literally `return createServiceClient()`. Nothing was ever duplicated or moved between files — the split was drawn in the UI over one table.

**What changed.**

1. `getDocumentDashboardData` no longer filters to enrolled; it keeps anyone with an `_enrolment_status` row. A **Type** column tags each row `Enrolled` / `Applicant` and is facet-filterable. Deliberately two values, not the `applicationStatus` vocabulary — Cancelled / Withdrawn / Rejected read as `Applicant` (enrolments that did not complete); the exact stage lives on the student's own file.
2. `PFilesStatusFilter` gains `'uploaded'`, surfaced as **Needs review** (`/p-files?status=uploaded`). The option, the predicate and the `uploaded` count all already existed — only the P-Files type narrowing withheld them.
3. `/p-files/document-validation` **deleted** (both tabs, layout, loading, `awaiting-queue`, `triage-pane`). Its badge moved to the Needs review link, which it already counted (it summed both audiences).
4. The folder gate moved from `isStudentEnrolled` to a new **`studentExistsInAy`**.

⚠ **Point 4 is load-bearing and was nearly missed.** Relaxing the list without the folder would have left every applicant row 404ing — the list and the detail page had two different gates. Caught while checking whether docs needed updating, not by a test.

⚠ **`isStudentEnrolled` is NOT dead.** The document PATCH still uses it to choose between `documents_pre_enrolment.validate` and `documents_post_enrolment.validate`, and staff upload still requires it. Do not delete it as newly-unused.

🔴 **STILL OPEN: staff cannot upload pre-enrolment documents.** `documents_pre_enrolment` has no `upload` action at all (`read`/`chase`/`validate` only), and the single upload route requires `documents_post_enrolment.upload` **plus** `isStudentEnrolled`. So `assessmentResult` — a document **the school produces** — has no staff path into an applicant's folder; either the office sends it to the parent to upload, or the slot waits for enrolment. Raised, not decided.

⚠ **Triage mode went with the page.** It was the one thing the queue did that the list does not: sequential review without opening each folder. The pane still exists on the admissions side (`components/admissions/document-validation/triage-pane.tsx`) if it needs restoring onto the filtered list.

⚠ **Every P-Files number now counts applicants too.** "N students" on the trust strip, the completeness percentages, the KPI tiles. That is the intended behaviour, not drift.

The completeness table was also removed from the `/p-files` dashboard body — it is the entire content of the focused views, one click away, and rendering it in both places made the dashboard a second copy of a page that already exists.

Guarded by `__tests__/p-files/needs-review-filter.test.tsx` (demonstrated red before green). `12-p-files-module.md`.
