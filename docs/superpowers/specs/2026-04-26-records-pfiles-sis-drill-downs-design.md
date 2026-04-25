# Records · P-Files · SIS Admin drill-downs — design

**Date:** 2026-04-26
**Branch:** `feat/dashboard-drilldowns` (or follow-up branch)
**Status:** Spec — implementation pending
**Predecessor:** Sprint 22 (drill-down framework), Sprint 23 (perf audit). KD #56 codifies the contract.

## 1. Goal

Replicate the drill-down pattern from Sprints 22+23 to the three remaining operational dashboards. Plus one targeted chart rebuild where the existing visualization is weak.

This is the final dashboard sprint of the cycle. After this, every aggregating surface across all 7 module dashboards drills.

## 2. Survey findings

Three parallel Explore-agent surveys identified:
- **Records** (`/records`): 12 surfaces. 4 KPI MetricCards (HIGH/MEDIUM drill value), 3 chart cards (HIGH drill value), 1 panel that already drills via row link, 4 link/quick-link cards (skip).
- **P-Files** (`/p-files`): 10 surfaces. 4 KPI MetricCards + 4 Range MetricCards (HIGH drill on summary cards), 5 chart/panel cards (HIGH drill on Slot Status Donut, Top Missing, Completeness Table; row-link drill on Expiring Docs).
- **SIS Admin** (`/sis`): 1 chart + 4 MetricCards + system-health strip. Per user direction: only the audit-by-module chart drills.

One chart-quality issue worth fixing this pass: **Pipeline Stage Chart on `/records`** is rated WEAK (horizontal bar already exists but is generic; underlying data — 10 stages of applicant progression — would read better as a progress-row card or stepped-flow visualization).

## 3. Drill targets

### 3.1 Records (8 targets)

| # | Surface | Drill content | Slug |
|---|---|---|---|
| 1 | KPI: New enrollments (range) | Students with `enrollment_status='active'` enrolled in range | `enrollments-range` |
| 2 | KPI: Withdrawals (range) | Students with `enrollment_status='withdrawn'`, withdrawal_date in range | `withdrawals-range` |
| 3 | KPI: Active enrolled (AY) | All `enrollment_status IN ('active','conditional')` for current AY | `active-enrolled` |
| 4 | KPI: Docs expiring ≤60d | Applicants with at least one expiring doc | `expiring-docs` |
| 5 | Pipeline Stage Chart | Applicants currently at clicked stage | `students-by-pipeline-stage` |
| 6 | Document Backlog Chart | Applicants with that doc-slot in that status | `backlog-by-document` |
| 7 | Level Distribution Chart | Students at clicked level | `students-by-level` |
| 8 | Expiring Documents Panel | Already drills via row link; **adopt CSV button only** | `expiring-docs` (CSV) |

### 3.2 P-Files (8 targets)

| # | Surface | Drill content | Slug |
|---|---|---|---|
| 1 | Summary Card: Total docs | All applicant × slot rows | `all-docs` |
| 2 | Summary Card: Complete | Slots in `On file` status | `complete-docs` |
| 3 | Summary Card: Expired | Slots in `Expired` status | `expired-docs` |
| 4 | Summary Card: Missing | Slots in `Missing` status | `missing-docs` |
| 5 | Slot Status Donut | Slots in clicked status | `slot-by-status` |
| 6 | Top Missing Panel | Slots of clicked slot-key, status=Missing | `missing-by-slot` |
| 7 | Completion by Level Chart | Applicants at clicked level | `level-applicants` |
| 8 | Completeness Table | Already drills via row link; **adopt CSV button** | `completeness` (CSV) |

### 3.3 SIS Admin (1 target)

| # | Surface | Drill content | Slug |
|---|---|---|---|
| 1 | Audit by Module bar chart | Audit events with that module prefix | `audit-events` |

**Total: 17 drill targets across 3 modules.**

## 4. Per-module row shapes

### 4.1 Records — `RecordsDrillRow`

Records data is mostly applicant-centric (mirrors Admissions but enrolled-only) with a level + doc-completeness extension. Single shape:

```ts
type RecordsDrillRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  enrollmentStatus: string; // 'active' | 'conditional' | 'withdrawn' | 'graduated' | etc
  applicationStatus: string; // from ay{YYYY}_enrolment_status
  level: string | null;
  sectionName: string | null;
  pipelineStage: string | null; // 9 canonical stages + 'not_started'
  enrollmentDate: string | null; // ISO
  withdrawalDate: string | null; // ISO
  daysSinceUpdate: number | null;
  hasMissingDocs: boolean;
  expiringDocsCount: number; // number of docs expiring ≤60d
};
```

Cross-table joins: `students` × `section_students` × AY-prefixed `enrolment_applications` + `enrolment_status` + `enrolment_documents`. Use the same `getTeacherEmailMap` pattern? **No** — Records doesn't surface teachers. The existing `lib/admissions/drill.ts::buildDrillRows` query pattern is the closest reference.

### 4.2 P-Files — `PFilesDrillRow`

Document-centric — one row per (applicant × slot):

```ts
type PFilesDrillRow = {
  enroleeNumber: string;
  fullName: string;
  level: string | null;
  slotKey: string; // medical | passport | birth-cert | educ-cert | id-picture | ...
  slotLabel: string;
  status: 'On file' | 'Pending review' | 'Expired' | 'Missing' | 'N/A';
  fileUrl: string | null;
  expiryDate: string | null; // ISO, only for expiring slots
  daysToExpiry: number | null;
  revisionCount: number;
  lastRevisionAt: string | null; // ISO
};
```

Cross-table joins: AY-prefixed `enrolment_documents` × `enrolment_applications` (level) + `p_file_revisions` count.

### 4.3 SIS Admin — `AuditDrillRow`

Reuses existing `audit_log` shape. Single row = one audit event:

```ts
type AuditDrillRow = {
  id: string;
  action: string; // 'sheet.lock', 'pfile.upload', etc — 6 module prefixes
  actorEmail: string | null;
  entityType: string;
  entityId: string;
  context: Record<string, unknown> | null;
  createdAt: string; // ISO
};
```

Single shape. The audit table is already structured cleanly.

## 5. Chart polish — Pipeline Stage Chart rebuild

Current `components/sis/pipeline-stage-chart.tsx` is a horizontal bar of stage counts. Survey rated it WEAK because:
- 10 categories (not_started + 9 canonical stages) is too many for horizontal bars to feel proportional
- The data has implicit temporal ordering (Inquiry → Submitted → … → Enrolled) that bars don't preserve
- Bars don't show drop-off between stages

**Rebuild as funnel-style progress rows**: each stage = one row with a horizontal proportion bar (filled to current cohort %), stage label + count + drop-off-from-previous %. Mirrors the cohort-progression mental model. Click any row → drills into applicants at that stage.

This pattern matches `SheetReadinessCard` (Sprint 23 Markbook rebuild) — proven aesthetic.

## 6. Architecture

Reuses the Sprint 22 + 23 infrastructure:
- `components/dashboard/drill-down-sheet.tsx` — universal toolkit
- `components/dashboard/drill-sheet-skeleton.tsx` — placeholder
- `MetricCard.drillSheet` slot
- `ComparisonBarChart` + `DonutChart` `onSegmentClick` props
- `lib/auth/teacher-emails.ts::getTeacherEmailMap` (not used here — none of these modules surface teachers)

### 6.1 Per-module file shape

For each module:
- `lib/<module>/drill.ts` — row shape + `buildDrillRows` (or per-row-kind loaders) + `applyTargetFilter` + `defaultColumnsForTarget` + `drillHeaderForTarget`
- `app/api/<module>/drill/[target]/route.ts` — unified GET, JSON+CSV with UTF-8 BOM
- `components/<module>/drills/<module>-drill-sheet.tsx` — target-aware sheet
- `components/<module>/drills/chart-drill-cards.tsx` — per-target `'use client'` wrappers

Directory placement:
- Records: `lib/sis/drill.ts` (Records lives at `lib/sis/*` per KD #42)
- P-Files: `lib/p-files/drill.ts`
- SIS Admin: append to `lib/sis/drill.ts` — the audit-events drill is small, doesn't need its own module. The `audit-events` target lives alongside Records targets in the SIS drill module.

### 6.2 Pre-fetch contract (per KD #56 update from Sprint 23)

Per-module pre-fetch strategy:
- **Records**: ~500-1000 enrolled students (bounded). KEEP full pre-fetch — payload modest. `buildAllRowSets()` returns `{ records: RecordsDrillRow[] }`.
- **P-Files**: ~1000 applicants × ~10 slots = ~10,000 doc rows. Threshold case. **Lazy-fetch** like Markbook — return rolled-up shapes (slot status counts, level rollups) from `buildAllRowSets()`; raw doc rows lazy-fetch on drill open.
- **SIS Admin**: audit_log can be enormous (every mutation logged). **Lazy-fetch** — audit drill always fetches on first open via API, never pre-fetched at page level.

### 6.3 API routes

Three new routes:
- `app/api/records/drill/[target]/route.ts`
- `app/api/p-files/drill/[target]/route.ts`
- `app/api/sis-admin/drill/[target]/route.ts` (just for audit-events to keep concerns separate from Records, even though both consume `lib/sis/drill.ts`)

## 7. Auth + role gating

| Module | Allowed roles | Notes |
|---|---|---|
| Records | `registrar`, `school_admin`, `admin`, `superadmin` | Records is registrar+ surface (KD #42) |
| P-Files | `p-file`, `school_admin`, `admin`, `superadmin` | Same as P-Files page access (KD #31) |
| SIS Admin audit | `school_admin`, `admin`, `superadmin` | Matches `/sis` access |

No teacher row-scoping for any of these (Records + P-Files + SIS Admin are not teacher-facing dashboards). Simpler than Markbook + Evaluation.

## 8. Cache strategy

Same as Sprints 22+23:
- `unstable_cache` per call with module-scoped tag
- 60s revalidate for drill rows
- AY-scoped cache keys (scope/range filtering applied post-cache, per KD #56)
- Audit drill: 30s revalidate (data churns more often)

## 9. Files to create/touch

### New (~12 files)
- `lib/sis/drill.ts` — RecordsDrillRow + AuditDrillRow, builders, filters
- `lib/p-files/drill.ts` — PFilesDrillRow, builders, filters
- `app/api/records/drill/[target]/route.ts`
- `app/api/p-files/drill/[target]/route.ts`
- `app/api/sis-admin/drill/[target]/route.ts`
- `components/sis/drills/records-drill-sheet.tsx`
- `components/sis/drills/audit-drill-sheet.tsx`
- `components/sis/drills/chart-drill-cards.tsx` (Records + Audit chart wrappers)
- `components/sis/pipeline-stage-progress-card.tsx` (rebuild of pipeline-stage-chart)
- `components/p-files/drills/pfiles-drill-sheet.tsx`
- `components/p-files/drills/chart-drill-cards.tsx`

### Extended (~6 files)
- `app/(records)/records/page.tsx` — wire 8 drill slots
- `app/(p-files)/p-files/page.tsx` — wire 8 drill slots
- `app/(sis)/sis/page.tsx` — wire audit drill on the audit chart card
- `components/sis/pipeline-stage-chart.tsx` — replace usage with new progress-card OR keep both
- `components/admin/audit-by-module-card.tsx` (or wherever it lives) — add `onSegmentClick`
- Various module chart cards — `onSegmentClick` pass-through

## 10. Build sequence

5 bites. Each independently shippable.

1. **Records drill foundation** — `lib/sis/drill.ts` + API route + drill sheet + chart drill cards. Wire 4 KPI drills + 3 chart drills + Expiring CSV button.
2. **Records Pipeline Stage rebuild** — replace `pipeline-stage-chart.tsx` usage with new `pipeline-stage-progress-card.tsx` (similar pattern to `SheetReadinessCard`).
3. **P-Files drill foundation** — `lib/p-files/drill.ts` + API route + drill sheet + chart drill cards. Wire 4 summary drills + Slot Status + Top Missing + Level Completion + Completeness CSV.
4. **SIS Admin audit drill** — `audit-events` target appended to `lib/sis/drill.ts` + dedicated API route + audit drill sheet wrapper. Wire onto the audit-by-module bar chart.
5. **Final verification + KD update + docs sync** — `npx next build`, capture before/after sizes, update KD #56 wording, add 30th-pass row to dev-plan.

## 11. Out of scope

- React Query / SWR (KD #24)
- URL-persistent drill state
- XLSX export
- New cards or features (this is replication only)
- Drill-down on the system-health strip (status indicators, no rows)
- Range-aware audit drill (audit is event-stream-by-time; range filter applied post-cache)
- Pipeline-stage rebuild → flow diagram (overkill; progress-row matches existing patterns)

## 12. Success criteria

- All 17 drill targets return rows + render correctly in browser smoke test
- CSV export works on at least one drill per module (UTF-8 BOM intact)
- `npx next build` zero errors / zero warnings
- Records page payload < 1 MB at 1000 students (full pre-fetch); P-Files < 500 KB (lazy); SIS Admin < 200 KB (lazy)
- Pipeline Stage rebuild visually distinguishable from Markbook's SheetReadiness rebuild (different domain, similar craft)
