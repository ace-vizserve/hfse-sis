# Admissions Tables — Ownership and Integration

## Overview

Student data lives in admissions tables (`ay{YY}_enrolment_applications`, `ay{YY}_enrolment_status`, `ay{YY}_enrolment_documents`, `ay{YY}_discount_codes`) that the **parent portal owns** and the **SIS reads from**. Both codebases share a single Supabase project; see `10-parent-portal.md` for the full ownership split.

Every Records module consumes a different slice of these tables:

- **Admissions dashboard** — read-only analytics over applications + status.
- **Markbook module** — reads the student-roster sync source; never touches admissions directly at runtime.
- **P-Files module** — writes file URLs + `{slotKey}Expiry` to `ay{YY}_enrolment_documents` on staff upload; also mirrors passport number / pass type to `ay{YY}_enrolment_applications` (Key Decision #34).
- **Records module** — writes demographics/family/stage fields via narrow PATCH routes (Profile / Family / Stage), manages the discount-code catalogue, and owns `{slotKey}Status` on documents (approve / reject, Key Decision #37).

The Markbook's student-roster sync is a one-way pull into the SIS's own `students` table, triggered manually by the registrar. It is the only SIS → admissions touchpoint that produces a full DB cross-read.

## Admissions DB Tables

### `ay{YY}_enrolment_applications`
Contains full student personal and family info. The `applicationStatus` here is **parent-portal-side** — it tracks the application *form* submission state, not the enrollment pipeline. The only production value observed in our samples is `"Registered"` (set when the parent finishes the registration form); `"Draft"` is presumed for in-progress rows but unconfirmed. **Do not use this table's `applicationStatus` for enrollment filtering** — every drill, dashboard, and lifecycle widget reads from `ay{YY}_enrolment_status.applicationStatus` instead. See [§ The two `applicationStatus` columns](#the-two-applicationstatus-columns) for the full distinction.

Key fields:
| Field | Type | Notes |
|-------|------|-------|
| `id` | bigint | Auto-increment, AY-specific — not a stable ID |
| `enroleeNumber` | text | AY-specific (e.g., "E260001") — resets each AY |
| `studentNumber` | text | **Stable cross-year ID** — use this as the primary key |
| `lastName` | text | |
| `firstName` | text | |
| `middleName` | text | |
| `levelApplied` | text | |
| `category` | varchar | One of `New` / `Current` / `VizSchool New` / `VizSchool Current`. Mirrors `enrolment_status.enroleeType` for the same enroleeNumber. See [§ `category` ↔ `enroleeType` mirror](#category--enroleetype-mirror) |
| `stpApplicationType` | text | Gates 3 STP-conditional document slots (`icaPhoto`, `financialSupportDocs`, `vaccinationInformation`). HFSE is Edutrust Certified and can sponsor Singapore Student Pass applications via ICA on behalf of foreign students. See `21-stp-application.md` |

### `ay{YY}_enrolment_status`
Managed by the admissions team. Contains the actual enrollment pipeline status and class assignment.

Key fields:
| Field | Type | Notes |
|-------|------|-------|
| `enroleeNumber` | text | Join key to applications table |
| `applicationStatus` | varchar | See values below |
| `classStatus` | varchar | See values below |
| `classAY` | varchar | Academic year (e.g., "AY2026") |
| `classLevel` | varchar | Word form (post-migration 029), e.g., "Primary One", "Secondary Two", "Cambridge Secondary One (Year 8)", "Youngstarters \| Little Stars". Legacy digit form ("Primary 1") still tolerated by `lib/sync/level-normalizer.ts` as a defensive fallback. |
| `classSection` | varchar | e.g., "Patience", "Discipline 2" |

### `ay{YY}_enrolment_documents`
Document tracking. Read by the Records module's Documents tab and by P-Files dashboards; written by P-Files on staff upload (URL + status + expiry, Key Decision #34) and by the parent portal on parent self-serve upload. The `{slotKey}Status` column is the Records module's responsibility to set `Valid` / `Rejected` (Key Decision #37) — P-Files never sets `'Rejected'`.

## The two `applicationStatus` columns

There are **two columns named `applicationStatus`** in different tables, with completely different value spaces. Always specify which table you mean.

| Table | Owner | Value space | Meaning |
|---|---|---|---|
| `ay{YY}_enrolment_applications.applicationStatus` | Parent portal | `Draft` (presumed) / `Registered` (observed) | Application *form* submission state. Set when the parent finishes the registration form on `enrol.hfse.edu.sg`. |
| `ay{YY}_enrolment_status.applicationStatus` | SIS / admissions team | `Submitted` / `Ongoing Verification` / `Processing` / `Enrolled` / `Enrolled (Conditional)` / `Cancelled` / `Withdrawn` | SIS-side workflow pipeline. Canonical values listed in `lib/schemas/sis.ts:STAGE_STATUS_OPTIONS.application`. |

**Every drill, dashboard, lifecycle widget, sync filter, and roster builder reads from the SIS-side (status) column.** When code says `applicationStatus`, default to assuming the status table — the apps-table column is only useful for "did the parent finish the form yet?"

## `category` ↔ `enroleeType` mirror

Two columns track the same enrollee categorisation, one on each side of the join. They mirror each other for the same `enroleeNumber`.

| Column | Table | Value space |
|---|---|---|
| `category` | `ay{YY}_enrolment_applications` | `New` / `Current` / `VizSchool New` / `VizSchool Current` (4-value) |
| `enroleeType` | `ay{YY}_enrolment_status` | Same 4 values |
| `enroleeType` | `ay{YY}_discount_codes` | **Catalogue superset (6-value)** — adds `Both` and `VizSchool Both` for codes applicable to either New OR Current students of the respective track |

The 4-value student-side enum is exported as `ENROLEE_CATEGORIES` in `lib/schemas/sis.ts` for code reference. The 6-value discount-codes superset is the eligibility filter — a code with `enroleeType='Both'` matches either `category='New'` or `category='Current'`.

## Status Values

### `applicationStatus` (in `enrolment_status`)
| Value | Meaning for Grading App |
|-------|------------------------|
| Enrolled | Active student — include |
| Enrolled (Conditional) | Active student — include |
| Submitted | Usually means class not yet assigned — check `classSection` |
| Withdrawn | Withdrawn student — exclude from new sheets, grey out existing |
| Cancelled | Cancelled application — exclude |

> **Data quality note (AY2026):** The admissions team does not consistently update `applicationStatus` to "Enrolled." Many active students remain at "Submitted" but have `classSection` populated. The safest filter is `classSection IS NOT NULL AND applicationStatus NOT IN ('Cancelled', 'Withdrawn')`.

### `classStatus` (in `enrolment_status`)
| Value | Meaning |
|-------|---------|
| Finished | Class placement confirmed |
| Pending | Placement in progress |
| Incomplete | Missing info |
| Cancelled | Cancelled |

> **Data quality note (AY2026):** 378 of 471 registered students have `classStatus = NULL`. These students may still have `classSection` populated. Do not rely on `classStatus = 'Finished'` alone.

## Sync Query

```sql
SELECT
  a."studentNumber"   AS student_number,
  a."lastName"        AS last_name,
  a."firstName"       AS first_name,
  a."middleName"      AS middle_name,
  s."classLevel"      AS class_level,
  s."classSection"    AS class_section,
  s."classAY"         AS class_ay
FROM public.ay2026_enrolment_applications a
JOIN public.ay2026_enrolment_status s
  ON a."enroleeNumber" = s."enroleeNumber"
WHERE s."classSection" IS NOT NULL
  AND s."applicationStatus" NOT IN ('Cancelled', 'Withdrawn')
ORDER BY s."classLevel", s."classSection", a."lastName";
```

Update `ay2026` to `ay2027` etc. each AY.

## Statistics Query

To verify data quality before syncing:

```sql
SELECT COUNT(*) AS total_active_enrolled_students_with_section
FROM public.ay2026_enrolment_applications a
JOIN public.ay2026_enrolment_status s
  ON a."enroleeNumber" = s."enroleeNumber"
WHERE s."classSection" IS NOT NULL
  AND s."applicationStatus" NOT IN ('Cancelled', 'Withdrawn');
```

## Sync Process

1. Registrar clicks "Sync Students from Admissions" in the SIS admin panel
2. App runs the sync query against the admissions Supabase instance
3. For each returned row:
   - If `studentNumber` exists in `students` table → update name fields if changed
   - If `studentNumber` does not exist → insert new student record
   - Assign to correct `section` based on `classLevel` + `classSection` + `classAY`
   - If student already in section → skip
   - If student new to section → append with next available index number
4. Withdrawn students (status changed to 'Withdrawn' since last sync) → update `enrollment_status = 'withdrawn'` in `section_students`
5. Show registrar a summary: X added, Y updated, Z withdrawn

## Known Data Quality Issues

| Issue | Impact | Mitigation |
|-------|--------|-----------|
| `studentNumber` can be null | Cannot track student cross-year | Validate on sync — reject rows with null studentNumber |
| `classSection` has a typo: "Courageos" vs "Courageous" | Creates phantom section | Normalize section names on sync against a known sections list |
| `applicationStatus` not updated to "Enrolled" consistently | May miss students if filtering strictly | Use `classSection IS NOT NULL` as primary filter |
| Year-specific table names (`ay2026_*`) | Sync query needs manual update each AY | Store table prefix in app config |
| `availSchoolBus` / `availUniform` / `availStudentCare` real DB type | Production stores Yes/No **strings**, not booleans. `lib/schemas/sis.ts` currently treats them as `optionalBool` — schema-DB drift. | Future: align schema to the real text shape (or migrate the DB). Until then, do not rely on boolean parsing for these fields. |
| `postalCode` / `homePhone` / `contactPersonNumber` / `*Mobile` real DB type | Production stores **numbers** (`bigint`), schema treats as `optionalText`. Same drift class. | Future: align schema. The DDL in `10a-parent-portal-ddl.md` is the ground truth. |

## Connection Config

Admissions tables and SIS-owned tables share a single Supabase project, so one connection is enough. The SIS uses three client factories with strict separation (Key Decision #22): `createClient()` (cookie-scoped, RLS-enforced) for server-component reads, `createServiceClient()` (bypasses RLS) for mutating routes + cross-user aggregations, and the browser `createClient()` only where unavoidable (parent-portal SSO handoff). Environment variables:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...      # server-only
```

The original plan had separate `ADMISSIONS_SUPABASE_*` vars for a two-project setup; that was dropped once both halves converged on one project.
