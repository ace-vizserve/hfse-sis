<!-- Topic file for `.claude/rules/key-decisions.md`. Numbering is global; do not renumber. -->

## P-Files — documents repository, expiry, renewals, scope

### KD #31

⚠ **EVERY CLAUSE OF THIS KD HAS SINCE BEEN REVERSED. It is kept only so a "KD #31" cite resolves.** (1) P-Files **is** a review queue now — review is a filter on the one list, `/p-files?status=uploaded` (KD #204). (2) The scope is **everyone in the academic year**, applicants included — KD #204 reversed KD #71's enrolled-only rule. (3) The write roster is **`admissions` + `school_admin` + `superadmin`, all three with full write**: `p_file_officer` was retired 2026-09-10 (KD #207) and school_admin stopped being read-only on 2026-07-31 (migration 106, KD #166 update). (4) Writes are gated on **capabilities, not role names**, with the pre-/post-enrolment side chosen from the student's enrolment state. The one clause still true is that this module never sets `'Rejected'` itself (KD #37).

_Original text:_ P-Files is a repository, not a review queue. `p-file`+`superadmin` write, `school_admin`+`admin` read. Never sets `'Rejected'` (KD #37). Enrolled-students-only scope enforced by KD #71. `12-p-files-module.md`.

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

⚠ **`isStudentEnrolled` is NOT dead.** The document PATCH uses it to choose between `documents_pre_enrolment.validate` and `documents_post_enrolment.validate`, and the upload route now uses it the same way for the two `upload`s. What it stopped being is a gate that refuses applicants outright — it selects a capability, it does not turn anyone away. Do not delete it as newly-unused.

**Update (2026-09-01) — staff can upload for applicants. The open item below is CLOSED; migration 139 APPLIED and verified 3/3 against production (`scripts/verify-pre-enrolment-upload-migration.ts`).**

Mr Ace, asked whether staff should reach every slot for an applicant or only the eight school-produced forms: _"yes let them upload everthing"_. So there is deliberately **no per-slot narrowing** — one rule on both sides of enrolment.

1. **`documents_pre_enrolment` gains an `upload` action**, mirroring the post-enrolment one. The route now gates on holding **either** and narrows by enrolment state, exactly as the document PATCH does with the two `validate`s. The 422 (_"P-Files uploads are only available for enrolled students"_) is gone; refusal is now a 403 that means "you don't hold this side", not "this student is the wrong kind".
2. **Migration 139 grants it to `p_file_officer`, `school_admin`, `superadmin`** — precisely the three that already hold `documents_post_enrolment.upload`. **Nobody new can upload anything.** What widened is which STUDENTS, not who. ⚠ **The verify script reads `role_permissions` directly rather than asking the app**, because `getCapabilitiesForRole` falls back to `DEFAULT_ROLE_CAPABILITIES` on any failure (missing table, query error, empty table). That fallback is what makes the code safe to deploy ahead of the migration — and it is also what would let a half-applied migration look correct.
3. ⚠ **`admissions` is deliberately NOT granted, though it owns the applicant side.** There is nowhere for them to use it: the only upload surface is the P-Files student page, `/p-files` excludes them at ROUTE_ACCESS, and the applicant file's `DocumentsViewer` takes `canValidate`/`canChase` and has no upload path. A grant would be a ticked box wired to no gate. Build the control first — then it is a data edit at `/sis/admin/roles`, no migration.
   - ✅ **DONE 2026-09-10 (KD #207, migration 143).** The prediction held exactly: `/p-files` was opened to `admissions` when `p_file_officer` was retired, and `documents_pre_enrolment.upload` was granted in the same change — so the grant is wired to a real gate rather than being a ticked box. Point 2's holder list is now `admissions`, `school_admin`, `superadmin`.
4. ⚠ **The student page now picks its capability side per student too**, for all three buttons, not just upload. It hard-coded `documents_post_enrolment.*` from when it served enrolled students only; on an applicant's folder that renders buttons gated on a capability their routes never consult. Derived from the status row already in hand — no extra read.
5. ⚠ **The enrolment string test now has ONE definition**, `isEnrolledStatus` in `lib/p-files/_shared.ts`; `isStudentEnrolled` is the I/O wrapper over it. Three surfaces ask the question and they must not drift.
6. ⚠ **A new failure mode the old 422 made unreachable, guarded:** the documents row is created by the parent portal **when a family submits**, so an enrolee who reached these tables another way can have a status row and no documents row. PostgREST reports an UPDATE matching nothing as success, so the file would land in storage, the record would never change, and the screen would say it worked. The update now `.select()`s and returns a 409 (`no_document_row`) instead.

⚠ **Accepted knowingly: a staff upload writes `Valid` and so skips the admissions review queue.** A staff member has already looked at the file, which is what that queue is for — and this is what has always happened after enrolment. Raised with Mr Ace as part of the "everything vs school forms only" question; he chose everything.

Guarded by `__tests__/p-files/pre-enrolment-upload.test.ts` (all 10 assertions demonstrated red against the pre-change tree before being accepted).

⚠ **Triage mode went with the page.** It was the one thing the queue did that the list does not: sequential review without opening each folder. The pane still exists on the admissions side (`components/admissions/document-validation/triage-pane.tsx`) if it needs restoring onto the filtered list.

⚠ **Every P-Files number now counts applicants too.** "N students" on the trust strip, the completeness percentages, the KPI tiles. That is the intended behaviour, not drift.

The completeness table was also removed from the `/p-files` dashboard body — it is the entire content of the focused views, one click away, and rendering it in both places made the dashboard a second copy of a page that already exists.

Guarded by `__tests__/p-files/needs-review-filter.test.tsx` (demonstrated red before green). `12-p-files-module.md`.

## KD #219 — a document slot knows which kind of student it is for

**2026-09-16.** Mr Ace supplied the school's two real document lists: a long one for **New Students** ("Additional: Last School Recommendation and Good Moral, Assessment Result and Interview, Form-12, Signed Student Contract, New Student Checksheet, Student P-files Checklist, Pre-Counselling Acknowledgement Form, Conditional Enrolment (if applicable), Late Enrolment Form (if applicable)") and a short one for **Current Student** (latest pass/passport copies "if previous copy are expired", a medical report "if there's new medical condition to declare", Form 12, Signed Student Contract).

`isSlotApplicable` gains a fourth condition kind, `category`, and five school forms now carry it: Last School Recommendation, Assessment Result and Interview, New Student Checksheet, Student P-Files Checklist, Pre-Counselling Acknowledgement. Form 12 and the Signed Student Contract are on BOTH lists and stay unconditional. `NEW_CATEGORIES` / `CURRENT_CATEGORIES` split the four `ENROLEE_CATEGORIES` in two — Mr Ace on whether the VizSchool pair follow their namesakes: _"#1 yes, for now"_.

🔴 **THE SAME FACT IS STORED TWICE AND THE COPIES DISAGREE.** `lib/schemas/sis.ts` says the status row's `enroleeType` and the applications row's `category` "always agree". Measured against production: they differ on **241 of 828 AY2025 rows, 4 of 495 AY2026 rows and 3 of 290 AY2027 rows**, and `category` is **blank for 232 AY2025 students** where `enroleeType` is filled. `resolveCategory` reads **`category` first**, falling back to `enroleeType`.

⚠ **The first version of this had the precedence the other way round, and it was wrong.** Reading `enroleeType` first looked right by analogy with the enrolment-stage rule in CLAUDE.md (the status row is maintained; the applications row goes stale). But **the Category field on the Records profile sheet writes `category`, and NO screen in this app writes `enroleeType`** — so a registrar correcting a mis-tagged child would have seen the five forms stay wrong with nowhere in the product to fix them. A gate the office cannot correct is worse than one keyed on the slightly-staler column; the fallback still covers the 232 blank AY2025 rows. Caught in code review.

⚠ **The four AY2026 children the two columns disagree about are named, not averaged away:** `E260342` and `E260385` (`category='New'`, `enroleeType='Current'`), `E260339` and `E260515` (the reverse). The gate follows `category`. Which is correct is a question for the office; `scripts/verify-category-document-gate.ts` lists them on every run.

⚠ **THE GATE IS DELIBERATELY NOT APPLIED TO THE FAMILY DOCUMENTS.** The Current list names neither the ID picture nor the birth certificate, and gating them on category was the obvious reading — but that list says what the office **re-collects**, not what the file should hold. Measured first: a returning student's row already carries them (**367 of 381 an ID picture, 379 a birth certificate, 242 an education certificate**). Marking them "not applicable" would have hidden real, uploaded documents from the repository whose whole job is keeping them. Guarded by a test asserting no non-`school` slot ever carries a `category` condition.

⚠ **"If previous copy are expired" needed no code at all.** `resolveStatus` already returns `expired` off the stored expiry date; **246 of 501 AY2026 students carry at least one expired pass or passport today**, and the module was already showing that backlog. The rule was the behaviour it had.

⚠ **"If there's new medical condition to declare" is not computable and no toggle was invented.** It is a parent's disclosure with no column behind it. Mr Ace, asked: _"its the medical exam/certificate"_ — i.e. it maps to the existing Medical Exam slot, which stays unconditional.

🔴 **THE LATE ENROLMENT FORM HAD NEVER BEEN VISIBLE TO ANYONE.** Shipped conditional on `section_students.enrollment_status = 'late_enrollee'` (KD, migration 135), but **no caller ever supplied the fact** — all six left `isLateEnrollee` undefined, which the evaluator reads as "cannot tell" and hides. **21 AY2026 children are marked `late_enrollee`** and none could be asked for the form. `getStudentDocumentDetail` now joins the roster row, scoped through `sections → academic_years` because `enrolee_number` is re-issued each year (Hard Rule #4) and matching on it alone can pick up another year's child.

🔴 **A SECOND DEAD GATE IN THE SAME CLASS, FIXED:** `lib/p-files/drill.ts` declared `appStatusByEnrolee` with a comment saying it gates Conditional Enrolment, then never populated or read it — so that sheet has never applied the gate either. Populated and passed through.

⚠ **Gate columns are hand-listed per query, and that is the trap.** Six call sites each name the columns they read; a condition keyed on a column missing from one of those lists reads blank and silently hides the slot on that surface only. Both bugs above are that failure. `enroleeType` was added to all six, and the Records drill took a **third query** rather than reading the applications row's `category`, so a segment click cannot disagree with the card above it (KD #124).

⚠ **A blank category hides rather than requires** — the same safe direction as every other condition. 9 AY2025 students have no `enroleeType` and see no New-only forms.

Verified on production across all three years: every New student sees 5 of 5, every Current student 0 of 5 (`scripts/verify-category-document-gate.ts`, which imports the real evaluator rather than re-implementing it). Survey of the underlying data: `scripts/audit-document-needs-by-category.ts`. Guarded by `__tests__/p-files/document-slots.test.ts`.

⏳ **Open, and separate: Form 12 has stopped being collected.** AY2025 holds 515 uploads (145 New, 370 Current); **AY2026 and AY2027 hold zero**. It is on both of the school's lists. Nothing in this change addresses it.

⚠ **A GATED SLOT THAT ALREADY HOLDS A FILE IS STILL SHOWN.** `computeForStudent`'s applicable list is what the student page can render at all, so a slot dropped by the gate becomes unreachable — a New Student Checksheet uploaded before a child was re-tagged `Current` would sit in `ay{YY}_enrolment_documents` with no screen able to show it. This is the same reasoning that spares the family documents the category gate, applied to the gated slots too. Nothing is stranded today: all eight school forms hold **zero uploads across AY2025-27**.

⚠ **`getSlotStatusMix` (the donut) never gated at all** — a divergence that predates this change (it counted father/guardian slots for households with neither). Gating five more slots per returning student would have widened it to roughly **5 × every Current student, ~1,900 slots on AY2026**, all landing in the "Missing" slice beside a table that excludes them. It now gates through the same evaluator.

⚠ **THE LATE-ENROLLEE FACT IS LOADED ONCE, FOR THE WHOLE AY** (`lib/p-files/late-enrollees.ts`), and both the student page and the list read it. Supplying it only on the detail page would have made one child's file read "x of 22" on their own page and "x of 21" in the list beside it — KD #216's divergence reintroduced through a gate instead of a predicate. It is a separate module, not part of `_shared.ts`, because it creates a service-role client and `_shared.ts` reaches client bundles.

⚠ **`.maybeSingle()` IS WRONG FOR A ROSTER ROW.** A mid-year transfer (KD #67) keeps the old row as `withdrawn` and inserts a new one with the same `enrolee_number` in the same AY — **`E260532` has exactly two AY2026 rows**. `.maybeSingle()` answers two rows with PGRST116 in `error` and `null` in `data`, so the first version read "not a late enrollee" silently, for precisely the transferred children the transfer RPC preserves late-enrollee status for. Caught in code review. `withdrawn` rows are now dropped and any surviving row decides.

⚠ **`section_students.enrolee_number` is nullable and was never backfilled** (migration 041). 3 of 410 AY2026 roster rows carry NULL — none of them late enrollees, so nothing is missed today, but a NULL row can never appear in the late-enrollee set.

**Verified after the review fixes:** every New student sees 5 of 5 and every Current student 0 of 5 across all three years; the Late Enrolment Form reaches **21 of 21** AY2026 late enrollees and **0** others (13 of 13 on AY2025); 34 of 34 card/drill pairs still agree.

**Update (2026-09-16) — Form 12 is a school form.** Mr Ace, confirming the zero-upload measurement: _"yes form 12 is not being collected on the parent portal thats correct"_. AY2025 holds **515**; AY2026 and AY2027 hold **zero**. It was `group: 'student'`, i.e. chaseable, so every one of ~1,300 students carried a permanent "Remind parent about Form 12" row in the Action Queue that no parent could ever clear — the identical failure the `school` group was introduced to stop when the other eight were briefly misfiled. Moved to `group: 'school'`. It stays **unconditional**: it is on both of the school's lists, so only who supplies it changed, not who needs it. School forms are now **nine**, and the "student's own" non-expiring group is **four**.

**Update (2026-09-16) — where the two category columns disagree, the rule decides.** Asked whether the office should arbitrate the four AY2026 children, Mr Ace: _"i mean just follow the rules"_. `category` wins, full stop; there is no escalation path and none should be built. `scripts/verify-category-document-gate.ts` still prints them each run so the number stays visible.

### KD #223

**A document file is Complete at 100% and Nearly complete at 80%, on both P-Files and Admissions** (2026-09-25, `3cf7b970`, no migration). Mr Ace asked for a way to pull up students and applicants whose files are complete or almost complete — _"a tracker/monitoring for them to see which students/applicants has complete documents"_, and _"it can be also a chase list"_.

**The rule lives once, in `lib/p-files/completion-band.ts`**, and reads the `total` / `complete` pair every completeness row already carries, so the band means exactly what the percentage beside it means:

- `total` counts only the slots that **apply** to the child (KD #219) — a Current student is not held to the New-student school forms.
- `complete` counts only `valid` slots — approved and in date. **Uploaded but not yet reviewed does not count.**
- **The threshold is a fraction, not a count.** A New student with more slots can be two or three documents short and still read as nearly complete. Accepted: this is a monitoring lens.
- **The fraction is compared raw, not rounded.** 31 of 39 is 79.5%, which the table's rounded percentage shows as 80 — it is still Incomplete.
- **`total === 0` has no band**, so an empty row cannot pass as a finished file.

**Where it shows.** Two status tabs on the shared completeness table, and two sidebar links per module (`?status=complete`, `?status=nearly-complete`).

- **P-Files already loaded every student into its focused views** and only preselected a tab, so a sort on the Documents column in the All tab could answer this before. The change there is a convenience: an actual filter, a count, a direct link.
- **Admissions could not show a complete applicant at all.** `getAdmissionsCompletenessForChase` pre-filters to the requested status, and every earlier status meant "something outstanding". This is the part that was missing.
- **The P-Files Nearly complete view carries the Remind action**, but P-Files can only remind about **expired** slots (`pfilesBulkTargets`), so a student short only a missing document gets no Remind button there. Admissions reminds about every outstanding state. Widening the P-Files reminder is its own decision, not a side effect of this one.
