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

### 3.1 Records (9 targets + 1 NEW card)

| # | Surface | Drill content | Slug |
|---|---|---|---|
| 1 | KPI: New enrollments (range) | Students with `enrollment_status='active'` enrolled in range | `enrollments-range` |
| 2 | KPI: Withdrawals (range) | Students with `enrollment_status='withdrawn'`, withdrawal_date in range | `withdrawals-range` |
| 3 | KPI: Active enrolled (AY) | All `enrollment_status IN ('active','conditional')` for current AY | `active-enrolled` |
| 4 | KPI: Docs expiring ≤60d | Applicants with at least one expiring doc | `expiring-docs` |
| 5 | Pipeline Stage Sankey (rebuilt) | Applicants flowing through clicked stage | `students-by-pipeline-stage` |
| 6 | Document Backlog Chart | Applicants with that doc-slot in that status | `backlog-by-document` |
| 7 | Level Distribution Chart | Students at clicked level | `students-by-level` |
| 8 | Expiring Documents Panel | Already drills via row link; **adopt CSV button only** | `expiring-docs` (CSV) |
| 9 | **NEW** — Class-assignment readiness card | Active students without a `section_id` | `class-assignment-readiness` |

### 3.2 P-Files (8 targets + 1 NEW card)

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
| 9 | **NEW** — Revisions activity heatmap | Click a calendar cell → revisions on that day | `revisions-on-day` |

### 3.3 SIS Admin (4 targets + 1 NEW card)

| # | Surface | Drill content | Slug |
|---|---|---|---|
| 1 | Audit by Module bar chart | Audit events with that module prefix; **range-aware** (from/to threaded through API) | `audit-events` |
| 2 | System health: Approver coverage panel | List of approver assignments per flow + gaps | `approver-coverage` |
| 3 | System health: Current AY indicator | List of all AYs (current + historical) with status | `academic-years` |
| 4 | **NEW** — Activity by actor card | Top users by audit-event count over range; click row → audit events for that actor | `activity-by-actor` |

**Total: 23 drill targets across 3 modules + 3 new cards.**

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

## 5. Chart polish — Pipeline Stage Sankey rebuild

Current `components/sis/pipeline-stage-chart.tsx` is a horizontal bar of stage counts. Survey rated it WEAK because:
- 10 categories (not_started + 9 canonical stages) is too many for horizontal bars to feel proportional
- The data has implicit temporal ordering (Inquiry → Submitted → … → Enrolled) that bars don't preserve
- Bars don't show drop-off between stages

**Rebuild as Sankey diagram** using recharts' built-in `Sankey` component:
- Nodes = pipeline stages
- Links = quantity flowing from earlier stage to next stage
- Width-encoded ribbons make drop-off visceral (a thick ribbon thinning between stages = where applicants stall)
- Click any node → drills into applicants currently at that stage
- Recharts ships Sankey natively — no new dep

Hover state shows the count + drop-off % from previous stage (like the existing FunnelStage type). Stages with no applicants are rendered as zero-width nodes (preserving the temporal axis).

The drill target slug stays `students-by-pipeline-stage`; only the visualization changes. The chart card lives at `components/sis/pipeline-stage-sankey-card.tsx` (new); the old `pipeline-stage-chart.tsx` gets retired.

## 5b. New cards (3 — one per module)

### 5b.1 Records — Class-assignment readiness card

Surfaces students with `enrollment_status='active'` (or `'conditional'`) but `section_id IS NULL` — the gap between "enrolled" and "fully placed in a class". Actionable for registrars during the section-assignment workflow.

Layout: list-style card matching `SheetReadinessCard` craft. Severity strip up top (N students unassigned · M sections fully assigned). Per-student row: name + level + days-since-enrollment + "Assign class" link (to `/sis/sections/[id]`).

Drill click → `class-assignment-readiness` target → full unassigned-students list with toolkit. CSV export from drill.

Lib: aggregator helper `getClassAssignmentReadiness(ayCode)` in `lib/sis/dashboard.ts` (returns `{enroleeNumber, fullName, level, enrollmentDate, daysSinceEnrollment}[]`). Re-uses Records' student/section data.

### 5b.2 P-Files — Revisions activity heatmap

Calendar grid (12 weeks × 7 days = 84 cells) of revision counts per day. Cells colored by intensity — empty = subtle muted, high-activity = brand-indigo gradient. Visualizes which weeks see uploads (e.g. enrollment season spikes).

Layout: heatmap card with day-of-week rows + week columns. Hover shows day + count. Click cell → `revisions-on-day` drill scoped to that date's revisions.

Lib: aggregator helper `getRevisionsHeatmap(ayCode, weeks=12)` in `lib/p-files/dashboard.ts` (returns `{date: ISO, count: number}[]` for the visible window).

### 5b.3 SIS Admin — Activity by actor card

Top users by audit-event count over the dashboard range. Horizontal bar (matching audit-by-module pattern) sorted desc. Each row = `{actorEmail, count, lastEventAt}`.

Click bar → `activity-by-actor` drill scoped to that actor's audit events.

Lib: aggregator helper `getActivityByActor(rangeInput)` in `lib/sis/dashboard.ts` (returns `{userId, email, count, lastAt}[]`).

Privacy gate: `school_admin`/`admin`/`superadmin` only — same as audit-by-module.

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

### New (~17 files)
- `lib/sis/drill.ts` — RecordsDrillRow + AuditDrillRow + AcademicYearDrillRow + ApproverAssignmentDrillRow + ActivityActorDrillRow, builders, filters
- `lib/p-files/drill.ts` — PFilesDrillRow + RevisionDrillRow, builders, filters
- `app/api/records/drill/[target]/route.ts`
- `app/api/p-files/drill/[target]/route.ts`
- `app/api/sis-admin/drill/[target]/route.ts` (audit-events, approver-coverage, academic-years, activity-by-actor)
- `components/sis/drills/records-drill-sheet.tsx`
- `components/sis/drills/sis-admin-drill-sheet.tsx` (audit + approver + AY + actor)
- `components/sis/drills/chart-drill-cards.tsx` (Records chart wrappers)
- `components/sis/drills/sis-admin-chart-drill-cards.tsx` (audit + activity-by-actor wrappers)
- `components/sis/pipeline-stage-sankey-card.tsx` — Sankey rebuild (NEW chart)
- `components/sis/class-assignment-readiness-card.tsx` — NEW Records card
- `components/sis/system-health-strip.tsx` — extend existing strip with click-to-drill on approver + AY panels
- `components/sis/activity-by-actor-card.tsx` — NEW SIS Admin card
- `components/p-files/drills/pfiles-drill-sheet.tsx`
- `components/p-files/drills/chart-drill-cards.tsx`
- `components/p-files/revisions-heatmap-card.tsx` — NEW P-Files card

### Extended (~6 files)
- `app/(records)/records/page.tsx` — wire 8 drill slots + new class-assignment card; replace pipeline-stage-chart with sankey
- `app/(p-files)/p-files/page.tsx` — wire 8 drill slots + new revisions-heatmap card
- `app/(sis)/sis/page.tsx` — wire audit + activity-by-actor drills + system-health click-throughs
- `lib/sis/dashboard.ts` — add `getClassAssignmentReadiness`, `getActivityByActor` helpers
- `lib/p-files/dashboard.ts` — add `getRevisionsHeatmap` helper
- Various existing chart cards — `onSegmentClick` pass-through where missing

## 10. Build sequence

7 bites. Each independently shippable.

1. **Records drill foundation** — `lib/sis/drill.ts` + API route + drill sheet + chart drill cards. Wire 4 KPI drills + Document Backlog + Level Distribution drills + Expiring CSV button.
2. **Records Pipeline Stage Sankey rebuild** — `components/sis/pipeline-stage-sankey-card.tsx` using recharts `Sankey`. Replaces `pipeline-stage-chart.tsx` usage on `/records`. Wire `students-by-pipeline-stage` drill on node click.
3. **Records new card: Class-assignment readiness** — `components/sis/class-assignment-readiness-card.tsx` + `lib/sis/dashboard.ts::getClassAssignmentReadiness` helper. Wire `class-assignment-readiness` drill.
4. **P-Files drill foundation + new heatmap card** — `lib/p-files/drill.ts` + API route + drill sheet + chart drill cards. Wire 4 summary drills + Slot Status + Top Missing + Level Completion + Completeness CSV. Then add `components/p-files/revisions-heatmap-card.tsx` + `lib/p-files/dashboard.ts::getRevisionsHeatmap` + `revisions-on-day` drill.
5. **SIS Admin drills (4 targets) + activity-by-actor card** — `audit-events` (range-aware), `approver-coverage`, `academic-years`, `activity-by-actor` targets in `lib/sis/drill.ts` + dedicated API route + drill sheet. Wire onto the audit-by-module chart + system-health strip panels. Add `components/sis/activity-by-actor-card.tsx` + `lib/sis/dashboard.ts::getActivityByActor` helper.
6. **System-health strip click-through** — extend `components/sis/system-health-strip.tsx` so the approver-coverage + current-AY panels become clickable drill triggers.
7. **Final verification + KD update + docs sync** — `npx next build`, capture before/after sizes, update KD #56 wording, add 30th-pass row to dev-plan.

## 11. Out of scope

- React Query / SWR (KD #24)
- URL-persistent drill state
- XLSX export

## 12. Success criteria

- All 23 drill targets return rows + render correctly in browser smoke test
- CSV export works on at least one drill per module (UTF-8 BOM intact)
- `npx next build` zero errors / zero warnings
- Records page payload < 1 MB at 1000 students (full pre-fetch); P-Files < 500 KB (lazy); SIS Admin < 200 KB (lazy)
- Pipeline Stage Sankey reads as flow + drop-off (not bars); recharts `Sankey` renders cleanly with the 9-stage progression
- Three new cards (class-assignment readiness · revisions heatmap · activity-by-actor) ship with their own drill targets and visual identity (not a generic bar chart)
