# Records Module (formerly "SIS Module")

> **Note on naming + routing.** This module was originally called "SIS module" because it replaces Directus's Student Information System view. After the SIS-first framing (2026-04-20) the display name became **Records** to avoid collision with the product name. On the same date the Records module moved from `/sis/*` to `/records/*` to free up `/sis/*` as the SIS admin hub (AY Setup, Approvers, superadmin landing). Internal type value is now `"records"` in the `Module` union; `"sis"` identifies the admin hub. API paths (`/api/sis/*`), cache tags (`sis:${ay}`), audit prefix (`sis.*`), and this filename stay as-is for stability — renaming them would invalidate historical audit rows + cache entries.

> **Status:** 🔶 Phases 1–2 shipped (2026-04-17). Phase 3 spec finalized 2026-04-18 — see `docs/sprints/development-plan.md` §Sprint 10 Phase 3. The sections below describe the module's intent and cross-module contract; for up-to-date shipped scope read the sprint plan.

## Why this doc exists

HFSE currently uses **Directus** (a headless CMS / admin dashboard) as the admin UI for the admissions database. The plan is to replace it with a custom-built Records module inside this app, reading and writing the same Supabase tables that Directus touches today.

This context file captures the rough shape of the module, the decisions that have already been made (module boundary, P-Files relationship), and the open questions that need HFSE input before a sprint can be opened.

## What the SIS is for

A comprehensive records surface for admissions and registrar staff. Primary jobs-to-be-done:

- **Find a student.** Search by name, student number, enrolee number, section, level.
- **View the full record.** Demographics, family contacts, siblings, enrollment status, documents, discounts, medical/allergy flags.
- **Edit the record.** Update demographics, parent emails, class assignment, withdrawal status, etc.
- **Manage the discount code catalogue.** Create / edit / expire codes on `ay{YY}_discount_codes`. Per-student *grants* are handled by the enrolment portal, which writes the `discount1` / `discount2` / `discount3` slot columns on `ay{YY}_enrolment_applications` directly — SIS only edits those slot strings via the Phase 2 profile sheet; there is no separate grants ledger.
- **Replace Directus** as the day-to-day admissions tool. No data migration — the tables are already in Supabase.

## Access

- **Primary audience:** admissions staff, registrar
- **Admin + superadmin:** full access
- **Teachers, parents, `p-file` officer:** no access (not their workflow)

Role strategy — two options, TBD:
- (a) grant SIS to existing `registrar` / `admin` / `superadmin` roles (simpler, no new role)
- (b) add a new `sis` role for admissions staff who should see SIS but not grading (stricter, needs role-assignment UX)

## Module boundary decision

The app already has two modules: **Markbook** (grading) and **P-Files** (document verification). Two decisions have been made about where SIS fits:

### 1. SIS is a third module, not a folder in Markbook

Separate route group `/(sis)/sis/*` with its own sidebar and layout, parallel to the existing `/(p-files)/`.

**Why:**
- Different audience (admissions records vs. academic workflow) — putting SIS under `/admin/*` would crowd the Markbook sidebar with unrelated concerns.
- Directus was already standalone, so users think of "the SIS" as its own tool; preserve the mental model.
- Scope grows fast — demographics, discounts, medical, scholarships, outreach logs. `/admin/admissions` can't absorb that.

### 2. P-Files stays separate — it does NOT fold into SIS

**Why:**
- The `p-file` officer has a distinct job (document verification) and shouldn't see discounts / demographics / medical records. Noise and unnecessary access surface.
- Just shipped as Sprint 8 (2026-04-17) — breaking the module boundary immediately would reset user muscle memory.
- Specialization is fine when the tasks are genuinely distinct. P-Files asks "does this student have a valid birth cert?"; SIS asks "what is this student's complete record?"

## Cross-module data contract

Three modules share the admissions tables. The rule: **each table has one primary writer.**

| Table | SIS | P-Files | Markbook |
|---|---|---|---|
| `ay{YY}_enrolment_applications` | **Write** (demographics, parent emails) | Write (passport# / pass type via upload dialog — Key Decision #34) | Read (parent→student lookup) |
| `ay{YY}_enrolment_status` | **Write** (class assignment, withdrawal, etc.) | Read | Read (filter enrolled) |
| `ay{YY}_enrolment_documents.{slotKey}` (URL) | Read | **Write** (canonical file URL) | — |
| `ay{YY}_enrolment_documents.{slotKey}Status` | **Write** (approve / reject — validation call) | Write on staff upload (sets to `'Valid'`) | — |
| `ay{YY}_enrolment_documents.{slotKey}Expiry` | Read / edit | **Write** (from upload dialog metadata) | — |
| `p_file_revisions` | Read (historical context per student) | **Write** (appended on replace, Key Decision #36) | — |
| `ay{YY}_discount_codes` | **Write** (exclusive — Phase 3 catalogue CRUD) | — | — |
| `ay{YY}_enrolment_applications.discount{1,2,3}` | Write (via Phase 2 profile sheet) | — | Read |

*Per-student discount grants are written by the external enrolment portal, not by SIS. SIS only manages the code catalogue and edits the 3 slot strings on the student's application row.*

Coordination notes:
- **Document validation (approve/reject) is SIS's job, not P-Files's.** P-Files is a repository — it shows files, archives prior versions, and never mutates a status to `Rejected`. SIS is the sole writer of "rejected" and is the intended surface to send a document back to the parent for re-upload.
- SIS must NOT re-implement document upload — it links out to P-Files for that. An "Upload / Replace" button in SIS's Documents tab should open the P-Files student detail page.
- The P-Files upload route already co-writes passport number / pass type to `enrolment_applications` (Key Decision #34). SIS write forms on the same fields need to respect that shared surface — use zod schemas in `lib/schemas/` if this ever becomes contentious.
- `enrolment_status.classSection` is the liveness signal used by Markbook's roster sync (`lib/sync/students-planner.ts`). SIS should never null this out silently — withdrawal should go through a dedicated flow that updates `applicationStatus='Withdrawn'` and flags the student clearly.

## Open questions for HFSE discussion

These need answers before a sprint opens:

- [ ] **Directus feature parity** — what exactly does the admissions team do in Directus today? List every workflow so the MVP scope is grounded, not invented. (Student edit? Discount grant? Bulk status update? Reports?)
- [x] ~~**`enrolment_discounts` schema**~~ — **Resolved 2026-04-18:** no new table. Per-student grants are written by the enrolment portal into `ay{YY}_enrolment_applications.discount{1,2,3}` (text slots referencing catalogue `discountCode`). SIS manages the `ay{YY}_discount_codes` catalogue only. The discount-codes `enroleeType` is a **6-value eligibility superset** (`New` / `Current` / `Both` / `VizSchool New` / `VizSchool Current` / `VizSchool Both`) over the **4-value student-side `category` / `enroleeType` enum** on the apps + status tables (`New` / `Current` / `VizSchool New` / `VizSchool Current` — exported as `ENROLEE_CATEGORIES` in `lib/schemas/sis.ts`). The `Both` variants exist only on the catalogue side, for codes applicable to either New OR Current of the matching track. See `06-admissions-integration.md` § `category` ↔ `enroleeType` mirror.
- [ ] **Role model** — option (a) reuse existing roles, or option (b) add a new `sis` role? If (b), who assigns it and via what UI?
- [ ] **Student lifecycle edits** — who can change `applicationStatus`? `classSection`? Should section reassignment trigger a grade-entry migration, or is that a manual process?
- [ ] **Write safety** — some admissions columns (e.g. `studentNumber`, `enroleeNumber`) are stable IDs referenced by other tables. Should SIS allow edits, prevent them, or require an audit-logged override?
- [ ] **Medical / allergy / sensitive fields** — do all admissions staff see these, or is there a sub-role (nurse? counsellor?) with extra access?
- [ ] **Parent account link** — SIS surfaces parent emails, but parent auth lives in Supabase. Should SIS also manage parent invite / re-invite? Magic-link password reset?
- [ ] **Bulk operations** — Directus probably supports bulk edit/export. Does SIS need that on day one, or can it ship single-row-first?
- [ ] **Reporting** — beyond the existing admissions dashboard (Sprint 7 Part A), does SIS need its own reports? Enrollment counts by grade? Discount totals? Demographic breakdowns?
- [ ] **Migration path from Directus** — cutover date? Dual-run period? Any Directus-created data that isn't in the admissions tables (e.g. Directus user accounts, permissions)?
- [ ] **Admissions dashboard (`/admin/admissions`) fate** — keep as-is, move into SIS as a tab, or leave for admin/superadmin oversight while SIS serves operational staff?

## Out of scope (until explicitly pulled in)

- Parent-facing SIS surface (parents see their own child's record) — separate feature, not in the first cut
- SMS / email sequences / outreach automation — later-phase CRM scope if that lane ever opens
- Timetable / scheduling
- Fee billing and payment processing (distinct from discounts — "discount" is a record on the student; "billing" is a transactional system)

## Practical build sketch (when ready)

Just to anchor the discussion — not a commitment:

1. Add `sis` route group: `app/(sis)/sis/*` with own layout + sidebar. Pattern-match `(p-files)`.
2. Module switcher (`components/module-switcher.tsx`) extends to 3 options. Already a shadcn `Select` — 3 items is fine.
3. Hero page: `/sis` = student list with search, AY switcher, level/section filters, `@tanstack/react-table` (reuse the existing patterns).
4. Detail page: `/records/students/[enroleeNumber]` with tabs — Profile / Family / Enrollment / Documents (with approve/reject in Phase 3; links to P-Files for the file viewer). No separate Discounts tab — the catalogue lives at `/sis/admin/discount-codes` (moved to SIS Admin 2026-04-22; Records sidebar keeps a cross-module link), grants live in the Profile sheet's Discount slots section.
5. Write forms: RHF + zod + shadcn `Form` per existing convention (Key Decision #20). Schemas in `lib/schemas/`.
6. Audit log: new actions (`sis.profile.update`, `sis.family.update`, `sis.stage.update`, `sis.discount_code.*`, `sis.document.{approve,reject}`), new entity types (`enrolment_application`, `enrolment_status`, `discount_code`, `enrolment_document`), written via existing `logAction()`. Route `/records/audit-log` with a module-scoped view (same split pattern as `/p-files/audit-log`).
7. No schema changes for Phases 1–3 — everything writes existing admissions tables.

## STP application tracker

HFSE is now Edutrust Certified, so the school can sponsor Singapore Student Pass applications via ICA on behalf of foreign students. `ay{YY}_enrolment_applications.stpApplicationType` gates 3 STP-conditional document slots in `enrolment_documents` — `icaPhoto`, `financialSupportDocs`, `vaccinationInformation` — plus the `residenceHistory` jsonb column on the apps row holds the 5-year residence history ICA requires.

Full workflow + UI placement + the per-student STP tracker view: see `21-stp-application.md`.

## Schema-DB drift to flag

The Profile sheet's `ProfileUpdateSchema` in `lib/schemas/sis.ts` does **not** cover all real columns on `ay{YY}_enrolment_applications` yet. Sibling fields (`siblingFullName1..5`, `siblingBirthDay1..5`, `siblingReligion1..5`, `siblingEducationOccupation1..5`, `siblingSchoolCompany1..5`), structured medical flags (`allergies` / `allergyDetails` / `asthma` / `foodAllergies` / `foodAllergyDetails` / `heartConditions` / `epilepsy` / `diabetes` / `eczema` / `otherMedicalConditions` / `paracetamolConsent` / `dietaryRestrictions`), consent flags (`socialMediaConsent` / `feedbackConsent` / `motherWhatsappTeamsConsent` / `fatherWhatsappTeamsConsent` / `guardianWhatsappTeamsConsent`), `vizSchoolProgram`, and the feedback workflow (`feedbackRating` / `feedbackComments` / `feedbackSubmittedAt` / `preCourseAnswer` / `preCourseDate` / `preCourseAcknowledgedAt`) are all real production columns but **not editable via the SIS Profile sheet today**. P2 future work — extend the schema + add the corresponding form fields.

Type-mismatch drift to flag separately:
- `availSchoolBus` / `availUniform` / `availStudentCare` — real DB stores Yes/No **strings**, schema treats as `optionalBool`.
- `postalCode` / `homePhone` / `contactPersonNumber` / `*Mobile` — real DB stores **numbers (bigint)**, schema treats as `optionalText`.

These don't break runtime today (tolerant parsers), but the schema and DB should be aligned before the SIS lands a write surface that exercises them.

## References

- Existing admissions reference: `docs/context/06-admissions-integration.md`
- Admissions dashboard (Sprint 7 Part A): `docs/context/08-admission-dashboard.md`
- Parent portal DDL + admissions table shapes: `docs/context/10-parent-portal.md`
- P-Files module (sibling architecture): `docs/context/12-p-files-module.md`
- STP application tracker: `docs/context/21-stp-application.md`
- Performance patterns (apply to SIS): `docs/context/11-performance-patterns.md`
- Module switcher implementation: `components/module-switcher.tsx`
