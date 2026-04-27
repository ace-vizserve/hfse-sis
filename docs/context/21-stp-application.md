# Singapore ICA Student Pass (STP) Workflow

## What this doc is

HFSE's workflow for sponsoring foreign-student Singapore Student Pass (STP) applications with the Immigration & Checkpoints Authority of Singapore (ICA). This doc owns the **field gate** (`stpApplicationType`), the **3 STP-conditional document slots**, the **`residenceHistory`** column, and how the SIS surfaces (or will surface) the workflow today.

The pipeline is a parallel sub-flow that applies only to foreign-student personas — Singapore Citizens and PR holders skip it entirely. It piggybacks on the existing admissions tables and document-status flow rather than introducing a separate STP table.

## Background — Edutrust + ICA

HFSE is **Edutrust Certified** by SkillsFuture Singapore (formerly Council for Private Education / CPE). Edutrust is the quality-assurance scheme that enables a private education institution to sponsor international students for Singapore Student Passes. Without it, the school cannot lodge an STP application on a parent's behalf; with it, foreign-student admissions become a sponsored pipeline where the school is the named sponsor at ICA.

**ICA** — Immigration & Checkpoints Authority of Singapore — handles all immigration passes (Student Pass, Dependent Pass, S-Pass, Employment Pass, etc.), Citizenship + PR, and NRIC issuance. STP requirements that touch this SIS:

- **ICA-format passport-style photo** — 35mm × 45mm, white background, recent within 3 months, no glasses, plain expression. Strict format vs the school's general `idPicture`, which is why we keep them as separate slots.
- **Financial support proof** — typically 6 months of parent bank statements + recent salary slips, demonstrating the family can fund the student's stay.
- **Vaccination records** — childhood immunisation history (some are mandatory for student-pass holders entering Singapore schools).
- **Residence history** — ICA wants the past 5 years of residency to screen overstay risk and prior-country exposures.

ICA's actual pass-issuance system (eFORM16 / SOLAR / MyICA) lives outside this SIS — submission is a manual step the registrar does after the document package is complete.

## The data model

| Column | Table | Purpose |
|---|---|---|
| `stpApplicationType` | `ay{YY}_enrolment_applications` | The gate. Values seen: `"New Student Pass Application"` (typical). NULL = student doesn't need STP (Singapore Citizen / PR). |
| `residenceHistory` | `ay{YY}_enrolment_applications` | `jsonb`. Sample shape: `[{"toYear":"Present","country":"Singapore","fromYear":2020,"cityOrTown":"Singapore","purposeOfStay":"Schooling"}]`. Each entry: `{ toYear, country, fromYear, cityOrTown, purposeOfStay }`. ICA expects the past 5 years populated. |
| `icaPhoto` + `icaPhotoStatus` | `ay{YY}_enrolment_documents` | Passport-style ICA-format photo. Status flow: `null → 'Uploaded' → 'Valid'` (registrar validates) or `'Rejected'`. |
| `financialSupportDocs` + `financialSupportDocsStatus` | `ay{YY}_enrolment_documents` | Parent income proof bundle (bank statements + salary slips). Same status flow. |
| `vaccinationInformation` + `vaccinationInformationStatus` | `ay{YY}_enrolment_documents` | Childhood vaccination records. Same status flow. |

The 3 slot keys are exported as `STP_CONDITIONAL_SLOT_KEYS` from `lib/sis/queries.ts` (sibling of `DOCUMENT_SLOTS`). They live on every row in `ay{YY}_enrolment_documents` — the columns always exist; only display is gated. Consumers should hide them from the UI when the matching applications row's `stpApplicationType IS NULL`.

The non-expiring slot status flow (`null → 'Uploaded' → 'Valid'` or `'Rejected'`) matches the convention in `lib/sis/process.ts` for the rest of the non-expiring document family (idPicture, birthCert, educCert, medical, form12). `'Uploaded'` = parent self-served via the portal, registrar hasn't validated yet; `'Valid'` = registrar accepted; `'Rejected'` = registrar bounced with a reason and the parent has to re-upload.

## Workflow

1. **Parent registration.** Parent completes the registration form on the parent portal. If the student is a foreign-student persona needing an STP, the parent ticks the STP option which sets `stpApplicationType` (typical value: `"New Student Pass Application"`). Parent uploads `icaPhoto`, `financialSupportDocs`, `vaccinationInformation` — each lands with status `'Uploaded'` per the non-expiring flow. Parent also fills in `residenceHistory` (past 5 years).
2. **Registrar review.** Registrar opens the 3 STP slots in P-Files, validates each → flips status to `'Valid'`, or rejects with reason → `'Rejected'`. Rejected slots become re-upload targets for the parent (same parent-portal flow as the standard non-STP slots). Validation writes today come through the Records / SIS surface, not P-Files (KD #31 — P-Files is a repository, not a review queue).
3. **Submission to ICA (manual).** Once all 3 STP slots are `'Valid'`, `residenceHistory` is populated, and the standard non-STP slots are also `'Valid'`, the registrar packages the documents and submits the STP application to ICA through MyICA outside the SIS. When ICA approves, the issued pass populates `pass` + `passExpiry` on the documents row (the same columns the existing student-pass slot uses for non-STP students who already hold a pass).

Idempotency / reattempts: a `'Rejected'` STP slot returns to `'Uploaded'` when the parent re-uploads, then back to registrar review — same loop as any other rejected document.

## SIS surfaces touched

| Surface | Treatment |
|---|---|
| Lifecycle widget (`/sis`) | Today the lifecycle aggregate widget doesn't surface STP-specific buckets — the 3 STP slots' contributions roll into the existing "Awaiting document validation" / "Awaiting document revalidation" buckets alongside the rest of the document family. **Future work:** dedicated "STP application incomplete" bucket for foreign-student rows where `stpApplicationType IS NOT NULL` AND at least one of the 3 STP slots isn't `'Valid'`. |
| EditStageDialog | No STP-specific gate today. **Future work:** when the admin reviews an Enrolled-prereq stage for a foreign-student persona, surface a sub-checklist of the 3 STP slots' validation status before allowing the stage to flip to `'Complete'`. |
| Records detail page (`/records/students/[studentNumber]`) | Lifecycle section + cross-AY chip strip render unchanged. **Future work:** an STP-status badge near the level pill when `stpApplicationType` is set, so the registrar can see at a glance that a student is on the sponsored pipeline. |
| Admissions detail page (`/admissions/applications/[enroleeNumber]`) | Documents tab already lists all 16 slots; the 3 STP slots render normally (label suffix `(STP)` from `DOCUMENT_SLOTS`). No conditional hiding today. **Future work:** hide the 3 slots when `stpApplicationType IS NULL` to reduce visual clutter for non-STP applicants. |
| P-Files dashboard (`/p-files`) | Document-slot rollups (`getSlotStatusMix`) include the 3 STP slots, so STP-related Pending / Valid / Rejected counts contribute to the existing dashboard tiles. No STP filter today. **Future work:** filter by `stpApplicationType` so the P-Files officer can scope rollups to "foreign students only". |

## STP renewal cycle

Singapore Student Passes are typically issued for the duration of the academic year, then renewed annually. Renewal is initiated by the school 4–6 weeks before `passExpiry`. For a renewal cycle a fresh `icaPhoto` + updated `financialSupportDocs` + (sometimes) refreshed `vaccinationInformation` may be required, depending on what's changed since the last issuance.

The SIS today **does not model the renewal cycle separately** from the initial application — the same `stpApplicationType` field, the same 3 slots, the same status flow. A renewal effectively means re-running the workflow with replacement uploads on the existing slots. Whether to add a distinct renewal value to `stpApplicationType` (e.g. `"Student Pass Renewal"`) and/or split the slots into "current vs prior" is open — see future work below.

The renewal contract is between the parent + school + ICA. The SIS captures the data; actual submission to ICA happens outside the system (PDF packets uploaded to MyICA manually).

## Open questions / future work

- Do we model STP renewal as a separate workflow from the initial application? Today: same `stpApplicationType` field, same slots; not modeled.
- Do we add a dedicated `stp_pass_status` column tracking ICA's response (`Approved` / `Rejected` / `Pending Review` / `Issued`)? Today inferred from `pass` + `passExpiry` being populated on the documents row.
- Auto-trigger registrar action when a student's `passExpiry` is within 60 days? Cross-references the lifecycle widget's "expiring documents" bucket — natural place to surface a "STP renewal due" chip.
- STP-specific drill-target on the lifecycle aggregate widget (deferred from v1 — wait until the renewal cycle is also modeled, otherwise the bucket churns when a renewal kicks in).
- `residenceHistory` validation today is shape-only (`jsonb` with no constraint); ICA's "past 5 years" expectation isn't enforced server-side. Future: zod schema in `lib/schemas/` + a registrar-facing readiness chip on the Records detail page.

## See also

- `12-p-files-module.md` — document-slot conventions, status display model, the 16 canonical slots (which include the 3 STP slots).
- `13-sis-module.md` — Records module write surface and the per-field audit-diff pattern that document validations flow through.
- `14-modules-overview.md` — cross-module data contract over the admissions tables.
- `06-admissions-integration.md` — admissions tables read/write split + the `stpApplicationType` row in the `ay{YY}_enrolment_applications` schema.
- `10a-parent-portal-ddl.md` — frozen DDL for `ay{YY}_enrolment_applications` (`stpApplicationType`, `residenceHistory`) and `ay{YY}_enrolment_documents` (the 3 STP slots).
- `lib/sis/queries.ts` — `DOCUMENT_SLOTS` (all 16) + `STP_CONDITIONAL_SLOT_KEYS` (the 3 conditional ones).
- `lib/sis/process.ts` — the document-stage status semantics that the 3 STP slots fold into (non-expiring family, `null → 'Uploaded' → 'Valid'`).
- (KD #N — sibling agent will land an "STP-conditional document slots" KD in `.claude/rules/key-decisions.md`; reference it once it's in.)
