import { unstable_cache } from 'next/cache';

import {
  STAGE_COLUMN_MAP,
  STAGE_TERMINAL_STATUS,
  ENROLLED_PREREQ_STAGES,
} from '@/lib/schemas/sis';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import {
  fetchAllPages,
  fetchInChunks,
  type PageBuilder,
} from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';
import { parseLocalDate } from '@/lib/dashboard/range';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';
import { EXPIRING_SOON_THRESHOLD_DAYS } from '@/lib/sis/process';
import { resolveBacklogBucket } from '@/lib/sis/dashboard';
import {
  DOCUMENT_SLOTS as PFILES_DOCUMENT_SLOTS,
  resolveStatus,
} from '@/lib/p-files/document-config';

const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

function tags(ayCode: string): string[] {
  return ['records-drill', `records-drill:${ayCode}`];
}

// ─── Targets ────────────────────────────────────────────────────────────────

// NOTE: there is deliberately no 'students-by-pipeline-stage' target here.
// It was removed as dead code — section_students.enrollment_status can only
// ever be 'active' | 'late_enrollee' | 'withdrawn' | 'graduated', so it could
// never represent pre-enrolment funnel segments (Submitted / Ongoing
// Verification / Processing / Cancelled / Enrolled (Conditional)). Any chart
// wired to it would open an always-empty drill sheet. Funnel-stage
// segmentation lives on the ADMISSIONS module's own 'pipeline-stage' target
// (lib/admissions/drill.ts), which PipelineStageChart is actually wired to —
// use that instead of recreating this target here.
export type RecordsDrillTarget =
  | 'enrollments-range'
  | 'withdrawals-range'
  | 'active-enrolled'
  | 'expiring-docs'
  | 'backlog-by-document'
  | 'students-by-level'
  | 'class-assignment-readiness';

// ─── Row shape ──────────────────────────────────────────────────────────────

export type RecordsDrillRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  enrollmentStatus: string; // 'active' | 'late_enrollee' | 'withdrawn' | 'graduated'
  applicationStatus: string;
  level: string | null;
  sectionId: string | null;
  sectionName: string | null;
  pipelineStage: string;
  /**
   * Admissions application `created_at` (ISO). The anchor for the "new
   * enrollments" metric — mirrors how Admissions "Enrolled (range)" counts
   * applications by submission date filtered to currently-enrolled status
   * (lib/admissions/dashboard.ts::computeRangeKpis). NOT the class-start date.
   */
  applicationDate: string | null; // ISO
  enrollmentDate: string | null; // ISO — section_students.enrollment_date = class-start
  withdrawalDate: string | null; // ISO
  daysSinceUpdate: number | null;
  hasMissingDocs: boolean;
  expiringDocsCount: number; // number of docs expiring within 60 days
  documentsComplete: number;
  documentsTotal: number;
  /**
   * Per-slot backlog bucket (slot key → 'valid' | 'pending' | 'rejected' |
   * 'missing'), populated ONLY for the 'backlog-by-document' target by
   * `enrichWithDocSlotBuckets`. Slots resolving to 'na' (conditional gate
   * empty, e.g. no fatherEmail) are omitted rather than stored — mirrors
   * the chart aggregator, which excludes 'na' from every bucket count.
   * Drives the backlog-by-document segment-click filter (KD #82/#124
   * count==drill) — see `applyTargetFilter`.
   */
  docSlotBuckets?: Record<string, 'valid' | 'pending' | 'rejected' | 'missing'>;
};

const CORE_DOC_STATUS_COLUMNS = [
  'medicalStatus',
  'passportStatus',
  'birthCertStatus',
  'educCertStatus',
  'idPictureStatus',
] as const;

// Matches the card aggregator in `lib/sis/dashboard.ts::loadRecordsKpisForRange`
// (KD #68: late enrollees are real new enrollments). The earlier value
// 'conditional' wasn't a real `section_students.enrollment_status` — the
// only legal values today are 'active', 'late_enrollee', 'withdrawn',
// 'graduated'. Using 'conditional' here silently dropped every late
// enrollee from drill results, producing card-vs-drill mismatches.
const ENROLLED_STATUSES = new Set(['active', 'late_enrollee']);
const SOFT_CLOSED_APPLICATION_STATUSES = new Set(['Cancelled', 'Withdrawn']);

// A row whose ADMISSIONS applicationStatus is soft-closed (Cancelled/Withdrawn)
// should be excluded from "enrolled"/application analytics — an active
// section_students row whose admissions record says Cancelled shouldn't read as
// currently enrolled. Applied PER-TARGET (not globally at row build) so the
// withdrawals-range target can still see Records-withdrawn rows whose admissions
// status cascaded to 'Withdrawn'. (r.applicationStatus is `raw || pipelineStage`
// — `deriveStage` only yields 'Withdrawn'/'Cancelled' for already-withdrawn
// rows, never for an active row, so this check is safe on the stored field.)
const isSoftClosed = (r: RecordsDrillRow): boolean =>
  SOFT_CLOSED_APPLICATION_STATUSES.has(r.applicationStatus);

// backlog-by-document segment format = "{slotLabel}|{bucket}" (emitted by
// components/sis/document-backlog-chart.client.tsx, e.g. "Birth
// Certificate|missing"). Built once at module scope, not per filter call.
// Slot labels don't contain '|', so splitting on the LAST '|' is safe even
// though it's not strictly needed here.
const BACKLOG_SLOT_KEY_BY_LABEL = new Map(
  PFILES_DOCUMENT_SLOTS.map((s) => [s.label, s.key])
);
const BACKLOG_BUCKET_VALUES = [
  'valid',
  'pending',
  'rejected',
  'missing',
] as const;
type BacklogBucketValue = (typeof BACKLOG_BUCKET_VALUES)[number];
function isBacklogBucketValue(v: string): v is BacklogBucketValue {
  return (BACKLOG_BUCKET_VALUES as readonly string[]).includes(v);
}

// ─── Range input ────────────────────────────────────────────────────────────

export type DrillRangeInput = {
  ayCode: string;
  from?: string;
  to?: string;
};

// ─── Loader ─────────────────────────────────────────────────────────────────

type StudentLite = {
  id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  student_number: string;
};
type SectionStudentLite = {
  id: string;
  section_id: string;
  student_id: string;
  enrollment_status: string;
  enrollment_date: string | null;
  withdrawal_date: string | null;
  enrolee_number: string | null;
};
type SectionLite = { id: string; name: string; level_id: string };
type LevelLite = { id: string; code: string };

type ApplicationLite = {
  enroleeNumber: string | null;
  studentNumber: string | null;
  enroleeFullName: string | null;
  firstName: string | null;
  lastName: string | null;
  levelApplied: string | null;
  created_at: string | null;
};
type StatusLite = {
  enroleeNumber: string | null;
  applicationStatus: string | null;
  applicationUpdatedDate: string | null;
  classLevel: string | null;
  levelApplied: string | null;
};

function studentName(s: StudentLite): string {
  const parts = [s.first_name, s.middle_name, s.last_name].filter(Boolean);
  const name = parts.join(' ').trim();
  return name || s.student_number || s.id;
}

function deriveStage(
  applicationStatus: string | null,
  enrollmentStatus: string
): string {
  if (enrollmentStatus === 'active' || enrollmentStatus === 'late_enrollee')
    return 'Enrolled';
  if (enrollmentStatus === 'withdrawn') return 'Withdrawn';
  if (enrollmentStatus === 'graduated') return 'Graduated';
  return (applicationStatus ?? '').trim() || 'Not started';
}

async function loadRecordsRowsUncached(
  ayCode: string
): Promise<RecordsDrillRow[]> {
  const service = createServiceClient();
  const admissions = createAdmissionsClient();

  const prefix = prefixFor(ayCode);
  const appsTable = `${prefix}_enrolment_applications`;
  const statusTable = `${prefix}_enrolment_status`;

  // Resolve ayId for sections/section_students scoping
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ayRow?.id as string | undefined) ?? null;
  if (!ayId) return [];

  // Resolve section IDs first so we can scope section_students by them and
  // paginate the response (PostgREST caps responses at 1000 rows; HFSE
  // scale comfortably exceeds that across populated AYs).
  const sectionsForFilterRes = await service
    .from('sections')
    .select('id')
    .eq('academic_year_id', ayId);
  const sectionIdsForFilter = (sectionsForFilterRes.data ?? []).map(
    (r) => r.id as string
  );

  const [sectionsRes, levelsRes, ssRows] = await Promise.all([
    service
      .from('sections')
      .select('id, name, level_id')
      .eq('academic_year_id', ayId),
    service.from('levels').select('id, code'),
    sectionIdsForFilter.length > 0
      ? fetchAllPages<SectionStudentLite>((from, to) =>
          service
            .from('section_students')
            .select(
              'id, section_id, student_id, enrollment_status, enrollment_date, withdrawal_date, enrolee_number'
            )
            .in('section_id', sectionIdsForFilter)
            .range(from, to)
        )
      : Promise.resolve([] as SectionStudentLite[]),
  ]);

  const sections = (sectionsRes.data ?? []) as SectionLite[];
  const sectionById = new Map<string, SectionLite>();
  for (const s of sections) sectionById.set(s.id, s);

  const levels = new Map<string, string>();
  for (const l of (levelsRes.data ?? []) as LevelLite[])
    levels.set(l.id, l.code);

  const ss = ssRows as SectionStudentLite[];
  const studentIds = Array.from(new Set(ss.map((s) => s.student_id)));

  const studentMap = new Map<string, StudentLite>();
  if (studentIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < studentIds.length; i += 100)
      chunks.push(studentIds.slice(i, i + 100));
    for (const chunk of chunks) {
      const { data } = await service
        .from('students')
        .select('id, first_name, middle_name, last_name, student_number')
        .in('id', chunk);
      for (const s of (data ?? []) as StudentLite[]) studentMap.set(s.id, s);
    }
  }

  // Admissions tables — for application-side metadata + days-since-update.
  //
  // Per migration 041's stated intent, drill loaders fall back to
  // `students.student_number` as the join key when
  // `section_students.enrolee_number` is null (Hard Rule #4 — studentNumber
  // is the cross-year stable ID). The migration deliberately did not run a
  // backfill UPDATE; rows seeded by `lib/sis/seeder/students.ts` and any
  // pre-041 production rows have `enrolee_number = null`. Without the
  // fallback, every drill row's apps/status lookup misses, which silently
  // collapses `level` / `applicationStatus` / `daysSinceUpdate` to defaults
  // and breaks segment-click filters that depend on those fields.
  const enroleeNumbers = ss
    .map((r) => r.enrolee_number)
    .filter((v): v is string => v !== null);
  const enroleeByStudentNumber = new Map<string, string>();
  const studentsNeedingFallback = ss
    .filter((s) => !s.enrolee_number)
    .map((s) => studentMap.get(s.student_id)?.student_number)
    .filter((sn): sn is string => !!sn);
  if (studentsNeedingFallback.length > 0) {
    const { data: fallbackApps } = await admissions
      .from(appsTable)
      .select('studentNumber, enroleeNumber')
      .in('studentNumber', studentsNeedingFallback);
    for (const r of (fallbackApps ?? []) as Array<{
      studentNumber: string | null;
      enroleeNumber: string | null;
    }>) {
      if (r.studentNumber && r.enroleeNumber) {
        enroleeByStudentNumber.set(r.studentNumber, r.enroleeNumber);
        enroleeNumbers.push(r.enroleeNumber);
      }
    }
  }

  const appByEnrolee = new Map<string, ApplicationLite>();
  const statusByEnrolee = new Map<string, StatusLite>();
  if (enroleeNumbers.length > 0) {
    const [appsRes, statusRes] = await Promise.all([
      admissions
        .from(appsTable)
        .select(
          'enroleeNumber, studentNumber, enroleeFullName, firstName, lastName, levelApplied, created_at'
        )
        .in('enroleeNumber', enroleeNumbers),
      admissions
        .from(statusTable)
        .select(
          'enroleeNumber, applicationStatus, applicationUpdatedDate, classLevel, levelApplied'
        )
        .in('enroleeNumber', enroleeNumbers),
    ]);
    for (const a of (appsRes.data ?? []) as ApplicationLite[]) {
      if (a.enroleeNumber) appByEnrolee.set(a.enroleeNumber, a);
    }
    for (const s of (statusRes.data ?? []) as StatusLite[]) {
      if (s.enroleeNumber) statusByEnrolee.set(s.enroleeNumber, s);
    }
  }

  const today = Date.now();
  const out: RecordsDrillRow[] = [];
  for (const enrol of ss) {
    const student = studentMap.get(enrol.student_id);
    if (!student) continue;
    const section = sectionById.get(enrol.section_id);
    // Resolve enroleeNumber via the section_students column first; fall
    // back to the studentNumber → enroleeNumber map built above.
    const enroleeNumber =
      enrol.enrolee_number ??
      enroleeByStudentNumber.get(student.student_number) ??
      '';
    const app = enroleeNumber ? appByEnrolee.get(enroleeNumber) : undefined;
    const status = enroleeNumber
      ? statusByEnrolee.get(enroleeNumber)
      : undefined;

    const applicationStatus = (status?.applicationStatus ?? '').trim();
    // NOTE: soft-closed (Cancelled/Withdrawn) rows are NO LONGER dropped here.
    // The exclusion moved into applyTargetFilter per-target (isSoftClosed) so
    // the withdrawals-range target can see Records-withdrawn rows whose
    // admissions status cascaded to 'Withdrawn'. All enrolled/application
    // targets re-apply isSoftClosed, so their populations are unchanged.

    const updated = status?.applicationUpdatedDate ?? app?.created_at ?? null;
    const updatedMs = updated ? Date.parse(updated) : NaN;
    const daysSinceUpdate = !Number.isNaN(updatedMs)
      ? Math.floor((today - updatedMs) / 86_400_000)
      : null;

    const enrollmentStatus = enrol.enrollment_status;
    const pipelineStage = deriveStage(applicationStatus, enrollmentStatus);
    // Level resolver MUST mirror the chart's `loadLevelDistributionUncached`
    // resolver in lib/sis/dashboard.ts so segment clicks on the donut land
    // on rows whose `level` field matches the bucket label exactly. Chart
    // priority: `status.classLevel` → `app.levelApplied` → 'Unknown'.
    // The previous version preferred `levels.get(section.level_id)` (the
    // level CODE like "P1") and fell through to classLevel (the LABEL like
    // "Primary 1"); donut buckets keyed on labels then matched zero rows
    // when the section table resolved to a code. KD #82 lays out the
    // pattern — when a chart and drill diverge on row counts, check
    // shared scope anchor + segment-key vocabulary.
    const level =
      (status?.classLevel ?? app?.levelApplied ?? '').trim() || 'Unknown';

    out.push({
      enroleeNumber: enroleeNumber || student.student_number,
      studentNumber: student.student_number,
      fullName: studentName(student),
      enrollmentStatus,
      applicationStatus: applicationStatus || pipelineStage,
      level,
      sectionId: section?.id ?? null,
      sectionName: section?.name ?? null,
      pipelineStage,
      applicationDate: app?.created_at ?? null,
      enrollmentDate: enrol.enrollment_date,
      withdrawalDate: enrol.withdrawal_date,
      daysSinceUpdate,
      hasMissingDocs: true, // sentinel — enrichWithDocs upgrades for callers that need it
      expiringDocsCount: 0, // ditto
      documentsComplete: 0,
      documentsTotal: CORE_DOC_STATUS_COLUMNS.length,
    });
  }
  return out;
}

// Doc enrichment — opt-in per spec §6 (only certain targets surface doc fields).
async function enrichWithDocs(
  rows: RecordsDrillRow[],
  ayCode: string
): Promise<RecordsDrillRow[]> {
  if (rows.length === 0) return rows;
  const prefix = prefixFor(ayCode);
  const docsTable = `${prefix}_enrolment_documents`;
  const admissions = createAdmissionsClient();
  const enroleeNumbers = rows.map((r) => r.enroleeNumber);

  // Pull the same expiry columns the dashboard `expiringSoon` KPI uses,
  // alongside the core status columns. Without these the drill row's
  // `expiringDocsCount` stays at sentinel 0 and the `expiring-docs` target
  // filter (`r.expiringDocsCount > 0`) returns 0 rows even when the card
  // count is non-zero.
  const expiryColumns = DOCUMENT_SLOTS.filter((s) => s.expiryCol).map(
    (s) => s.expiryCol!
  );
  const selectColumns = [
    'enroleeNumber',
    ...CORE_DOC_STATUS_COLUMNS,
    ...expiryColumns,
  ].join(', ');

  const { data, error } = await admissions
    .from(docsTable)
    .select(selectColumns)
    .in('enroleeNumber', enroleeNumbers);
  if (error) return rows;
  type DocRow = Record<string, string | null>;
  const docsByEnrolee = new Map<string, DocRow>();
  for (const d of (data ?? []) as unknown as DocRow[]) {
    const en = d['enroleeNumber'];
    if (typeof en === 'string') docsByEnrolee.set(en, d);
  }

  // 60-day window matching `dashboard.ts::loadRecordsKpisRangeUncached` —
  // anchored to today since the drill is range-agnostic at row build
  // time (range-shaped filters happen at `applyTargetFilter`).
  const today = new Date();
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + 60);

  return rows.map((r) => {
    const d = docsByEnrolee.get(r.enroleeNumber);
    if (!d) return r;
    let documentsComplete = 0;
    for (const col of CORE_DOC_STATUS_COLUMNS) {
      const v = d[col];
      if (
        v &&
        String(v).trim() !== '' &&
        String(v).toLowerCase() !== 'missing'
      ) {
        documentsComplete += 1;
      }
    }
    let expiringDocsCount = 0;
    for (const slot of DOCUMENT_SLOTS) {
      if (!slot.expiryCol) continue;
      const exp = d[slot.expiryCol];
      if (!exp) continue;
      // Slice to the date portion first so a full-ISO timestamp still yields its
      // date (parseLocalDate is strict ^\d{4}-\d{2}-\d{2}$); bare dates are
      // unaffected. Mirrors lib/sis/dashboard.ts expiring-soon count so the
      // card count == drill rows.
      const dt = parseLocalDate(String(exp).slice(0, 10));
      if (dt && dt >= today && dt <= windowEnd) expiringDocsCount += 1;
    }
    return {
      ...r,
      documentsComplete,
      hasMissingDocs: documentsComplete < r.documentsTotal,
      expiringDocsCount,
    };
  });
}

// Backlog-by-document enrichment — sibling to enrichWithDocs above, invoked
// ONLY for the 'backlog-by-document' target (never touches enrichWithDocs or
// its callers). Computes each row's per-slot bucket via the SAME
// resolveStatus() → resolveBacklogBucket() pipeline the backlog chart's
// dashboard aggregator uses (lib/sis/dashboard.ts::loadDocumentValidationBacklogUncached),
// including its exact conditional-slot gating (fatherEmail / guardianEmail /
// stpApplicationType empty ⇒ skip the slot entirely) — so a segment click
// ("{slotLabel}|{bucket}") in applyTargetFilter always resolves to exactly
// the rows the chart counted into that segment (KD #82/#124 count==drill).
//
// Uses the p-files DOCUMENT_SLOTS list (PFILES_DOCUMENT_SLOTS — key/label/
// conditional shape), NOT the differently-shaped lib/sis/queries.ts
// DOCUMENT_SLOTS (statusCol/expiryCol shape) that enrichWithDocs uses — the
// chart/dashboard backlog logic is built on the p-files one because it
// carries the `conditional` gate + the label the chart groups bars by.
async function enrichWithDocSlotBuckets(
  rows: RecordsDrillRow[],
  ayCode: string
): Promise<RecordsDrillRow[]> {
  if (rows.length === 0) return rows;
  const prefix = prefixFor(ayCode);
  const docsTable = `${prefix}_enrolment_documents`;
  const appsTable = `${prefix}_enrolment_applications`;
  const admissions = createAdmissionsClient();
  const enroleeNumbers = rows.map((r) => r.enroleeNumber);

  // resolveStatus() never reads its `_url` param, so we only fetch the
  // status (+ expiry, for expiring slots) columns here — no need for the
  // raw url columns the dashboard aggregator also selects.
  const docSelectColumns = [
    'enroleeNumber',
    ...PFILES_DOCUMENT_SLOTS.flatMap((s) =>
      s.expires ? [`${s.key}Status`, `${s.key}Expiry`] : [`${s.key}Status`]
    ),
  ].join(', ');

  type DocRow = Record<string, string | null>;
  type GateRow = {
    enroleeNumber: string | null;
    fatherEmail: string | null;
    guardianEmail: string | null;
    stpApplicationType: string | null;
  };

  // .in('enroleeNumber', [...]) chunked — a full-AY enrolled roster
  // combined with ~20 selected columns can overflow the PostgREST URL-length
  // cap, which comes back as a bare HTTP 400 before any JSON error.
  const [docsRows, gateRows] = await Promise.all([
    fetchInChunks<DocRow>(enroleeNumbers, async (slice) => {
      const { data, error } = await admissions
        .from(docsTable)
        .select(docSelectColumns)
        .in('enroleeNumber', slice);
      if (error) return [];
      return (data ?? []) as unknown as DocRow[];
    }),
    fetchInChunks<GateRow>(enroleeNumbers, async (slice) => {
      const { data, error } = await admissions
        .from(appsTable)
        .select('enroleeNumber, fatherEmail, guardianEmail, stpApplicationType')
        .in('enroleeNumber', slice);
      if (error) return [];
      return (data ?? []) as unknown as GateRow[];
    }),
  ]);

  const docsByEnrolee = new Map<string, DocRow>();
  for (const d of docsRows) {
    const en = d['enroleeNumber'];
    if (typeof en === 'string') docsByEnrolee.set(en, d);
  }
  const gatesByEnrolee = new Map<string, GateRow>();
  for (const g of gateRows) {
    if (g.enroleeNumber) gatesByEnrolee.set(g.enroleeNumber, g);
  }

  return rows.map((r) => {
    const d = docsByEnrolee.get(r.enroleeNumber);
    if (!d) return r;
    const gate = gatesByEnrolee.get(r.enroleeNumber);
    const docSlotBuckets: Record<
      string,
      'valid' | 'pending' | 'rejected' | 'missing'
    > = {};

    for (const slot of PFILES_DOCUMENT_SLOTS) {
      if (slot.conditional) {
        const gateValue =
          gate?.[
            slot.conditional as
              | 'fatherEmail'
              | 'guardianEmail'
              | 'stpApplicationType'
          ] ?? null;
        if (!gateValue || gateValue.trim() === '') continue; // 'na' — skip
      }
      const rawStatus = d[`${slot.key}Status`] ?? null;
      const expiry = slot.expires ? (d[`${slot.key}Expiry`] ?? null) : null;
      const status = resolveStatus(null, rawStatus, expiry, slot.expires);
      const bucket = resolveBacklogBucket(status);
      if (bucket === 'na') continue;
      docSlotBuckets[slot.key] = bucket;
    }

    return { ...r, docSlotBuckets };
  });
}

// ─── Unsynced readiness rows ────────────────────────────────────────────────

// Enrolled students not yet assigned to a section_students row — the KD #90
// unsynced cohort. These rows are absent from buildRecordsDrillRows (which
// starts from section_students). Cached separately; the drill route merges
// them in when target='class-assignment-readiness' (H3).
//
// Mirrors the "enrolled NOT in section_students" logic from
// loadClassAssignmentReadinessUncached so the drill count matches the
// dashboard card count (M13).
async function loadUnsyncedReadinessDrillRowsUncached(
  ayCode: string
): Promise<RecordsDrillRow[]> {
  const prefix = prefixFor(ayCode);
  const service = createServiceClient();
  const admissions = createAdmissionsClient();

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ayRow?.id as string | undefined) ?? null;
  if (!ayId) return [];

  const { data: sectionsData } = await service
    .from('sections')
    .select('id')
    .eq('academic_year_id', ayId);
  const sectionIds = ((sectionsData ?? []) as { id: string }[]).map(
    (r) => r.id
  );

  type StatusRow = {
    enroleeNumber: string | null;
    applicationStatus: string | null;
    applicationUpdatedDate: string | null;
    classLevel: string | null;
  };
  type AppsRow = {
    enroleeNumber: string | null;
    studentNumber: string | null;
    enroleeFullName: string | null;
    firstName: string | null;
    lastName: string | null;
    levelApplied: string | null;
    created_at: string | null;
  };

  // Paginated — PostgREST caps a single response at 1000 rows; these tables
  // can exceed that as an AY grows. fetchAllPages throws on a query error
  // (rather than returning it in an `.error` field), so it propagates up
  // instead of the previous silent-empty-array fallback.
  const [statusRows, appsRows, ssRows] = await Promise.all([
    fetchAllPages<StatusRow>((from, to) =>
      admissions
        .from(`${prefix}_enrolment_status`)
        .select(
          'enroleeNumber, applicationStatus, applicationUpdatedDate, classLevel'
        )
        .in('applicationStatus', ['Enrolled', 'Enrolled (Conditional)'])
        .range(from, to)
    ),
    fetchAllPages<AppsRow>((from, to) =>
      admissions
        .from(`${prefix}_enrolment_applications`)
        .select(
          'enroleeNumber, studentNumber, enroleeFullName, firstName, lastName, levelApplied, created_at'
        )
        .range(from, to)
    ),
    sectionIds.length > 0
      ? fetchAllPages<{ enrolee_number: string | null }>((from, to) =>
          service
            .from('section_students')
            .select('enrolee_number')
            .in('section_id', sectionIds)
            .range(from, to)
        )
      : Promise.resolve([] as { enrolee_number: string | null }[]),
  ]);

  // Build the set of already-assigned enroleeNumbers from section_students
  // so we can exclude them (mirrors loadClassAssignmentReadinessUncached's
  // logic for M13 count alignment).
  const assignedEnrolees = new Set(
    ssRows.map((r) => r.enrolee_number).filter((v): v is string => v !== null)
  );

  const appsByEnrolee = new Map<string, AppsRow>();
  for (const a of appsRows) {
    if (a.enroleeNumber) appsByEnrolee.set(a.enroleeNumber, a);
  }

  const today = Date.now();
  const out: RecordsDrillRow[] = [];

  for (const status of statusRows) {
    if (!status.enroleeNumber) continue;
    // Skip if already present in section_students.
    if (assignedEnrolees.has(status.enroleeNumber)) continue;

    const app = appsByEnrolee.get(status.enroleeNumber);
    const nameParts = [app?.firstName, app?.lastName].filter(Boolean);
    const fullName =
      (app?.enroleeFullName ?? nameParts.join(' ')) || status.enroleeNumber;
    const level =
      (status.classLevel ?? app?.levelApplied ?? '').trim() || 'Unknown';
    const applicationStatus = (status.applicationStatus ?? '').trim();
    const updated = status.applicationUpdatedDate ?? app?.created_at ?? null;
    const updatedMs = updated ? Date.parse(updated) : NaN;
    const daysSinceUpdate = !Number.isNaN(updatedMs)
      ? Math.floor((today - updatedMs) / 86_400_000)
      : null;

    out.push({
      enroleeNumber: status.enroleeNumber,
      studentNumber: app?.studentNumber ?? null,
      fullName,
      enrollmentStatus: 'active', // virtual — passes ENROLLED_STATUSES check in applyTargetFilter
      applicationStatus,
      level,
      sectionId: null, // null signals "no section"; used as routing discriminator in drill sheet (KD #81)
      sectionName: null,
      pipelineStage: 'Enrolled',
      // Unsynced rows belong to the class-assignment-readiness target, never
      // enrollments-range — applicationDate is set for completeness only.
      applicationDate: app?.created_at ?? null,
      enrollmentDate: null,
      withdrawalDate: null,
      daysSinceUpdate,
      hasMissingDocs: false,
      expiringDocsCount: 0,
      documentsComplete: 0,
      documentsTotal: CORE_DOC_STATUS_COLUMNS.length,
    });
  }

  return out;
}

export async function buildUnsyncedReadinessDrillRows(
  ayCode: string
): Promise<RecordsDrillRow[]> {
  return unstable_cache(
    () => loadUnsyncedReadinessDrillRowsUncached(ayCode),
    ['records-unsynced-readiness-drill', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(ayCode) }
  )();
}

// ─── Public builder ─────────────────────────────────────────────────────────

export async function buildRecordsDrillRows(
  input: DrillRangeInput,
  options?: { withDocs?: boolean; withDocSlotBuckets?: boolean }
): Promise<RecordsDrillRow[]> {
  // AY-scoped cache; scope/range filtering applied post-cache (per KD #56).
  const cached = await unstable_cache(
    () => loadRecordsRowsUncached(input.ayCode),
    ['records-drill', 'rows', input.ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(input.ayCode) }
  )();
  let rows = cached;
  if (options?.withDocs) rows = await enrichWithDocs(rows, input.ayCode);
  if (options?.withDocSlotBuckets)
    rows = await enrichWithDocSlotBuckets(rows, input.ayCode);
  return rows;
}

// ─── Per-target filter ──────────────────────────────────────────────────────

export function applyTargetFilter(
  rows: RecordsDrillRow[],
  target: RecordsDrillTarget,
  segment: string | null,
  range?: { from: string; to: string }
): RecordsDrillRow[] {
  switch (target) {
    case 'enrollments-range': {
      // "New enrollments" anchors on the admissions APPLICATION date
      // (applicationDate = app.created_at), filtered to the currently-enrolled
      // roster — mirroring Admissions "Enrolled (range)"
      // (lib/admissions/dashboard.ts::computeRangeKpis). NOT
      // section_students.enrollment_date, which is the class-start date and
      // would mis-bucket late enrollees at their joining term (KD #68/#117).
      // The KPI count + velocity chart re-use THIS filter so count == chart ==
      // drill (KD #82/#124).
      if (!range)
        return rows.filter(
          (r) => ENROLLED_STATUSES.has(r.enrollmentStatus) && !isSoftClosed(r)
        );
      return rows.filter((r) => {
        if (!ENROLLED_STATUSES.has(r.enrollmentStatus)) return false;
        if (isSoftClosed(r)) return false;
        if (!r.applicationDate) return false;
        const d = r.applicationDate.slice(0, 10);
        return d >= range.from && d <= range.to;
      });
    }
    case 'withdrawals-range': {
      // Records "Withdrawals" = genuine LEAVERS only (Records signal:
      // section_students.enrollment_status='withdrawn' + withdrawal_date). A
      // mid-year section TRANSFER withdraws the source row but the student stays
      // active in the destination — that is NOT a withdrawal (matches the
      // movements feed's transfer-vs-withdrawal split, KD #83). So exclude a
      // withdrawn row when the same student still has an active/late enrolment
      // in the AY, and dedup per student (a transfer-then-leave leaves multiple
      // withdrawn rows) keeping the latest withdrawal_date. Admissions
      // applicationStatus plays NO part here.
      const stillEnrolled = new Set(
        rows
          .filter((r) => ENROLLED_STATUSES.has(r.enrollmentStatus))
          .map((r) => r.studentNumber)
          .filter((sn): sn is string => !!sn)
      );
      const byStudent = new Map<string, RecordsDrillRow>();
      const orphans: RecordsDrillRow[] = [];
      for (const r of rows) {
        if (r.enrollmentStatus !== 'withdrawn') continue;
        if (r.studentNumber && stillEnrolled.has(r.studentNumber)) continue; // transfer artifact
        if (!r.studentNumber) {
          orphans.push(r);
          continue;
        }
        const prev = byStudent.get(r.studentNumber);
        if (!prev || (r.withdrawalDate ?? '') > (prev.withdrawalDate ?? '')) {
          byStudent.set(r.studentNumber, r);
        }
      }
      const leavers = [...byStudent.values(), ...orphans];
      if (!range) return leavers;
      return leavers.filter((r) => {
        if (!r.withdrawalDate) return false;
        const d = r.withdrawalDate.slice(0, 10);
        return d >= range.from && d <= range.to;
      });
    }
    case 'active-enrolled':
      return rows.filter(
        (r) => ENROLLED_STATUSES.has(r.enrollmentStatus) && !isSoftClosed(r)
      );
    case 'expiring-docs':
      return rows.filter((r) => r.expiringDocsCount > 0 && !isSoftClosed(r));
    case 'students-by-level':
      if (!segment) return rows.filter((r) => !isSoftClosed(r));
      return rows.filter(
        (r) => (r.level ?? 'Unknown') === segment && !isSoftClosed(r)
      );
    case 'backlog-by-document': {
      // No-segment path — "view all backlog" (also the CSV-export scope) —
      // is unchanged: every row with any incomplete core doc.
      if (!segment)
        return rows.filter((r) => r.hasMissingDocs && !isSoftClosed(r));

      // segment format = "{slotLabel}|{bucket}" e.g. "Birth Certificate|missing"
      // (components/sis/document-backlog-chart.client.tsx). Split on the LAST
      // '|' — slot labels never contain '|'.
      const sepIdx = segment.lastIndexOf('|');
      if (sepIdx === -1) return [];
      const slotLabel = segment.slice(0, sepIdx);
      const bucketName = segment.slice(sepIdx + 1);

      const slotKey = BACKLOG_SLOT_KEY_BY_LABEL.get(slotLabel);
      if (!slotKey || !isBacklogBucketValue(bucketName)) return [];

      return rows.filter(
        (r) => !isSoftClosed(r) && r.docSlotBuckets?.[slotKey] === bucketName
      );
    }
    case 'class-assignment-readiness':
      return rows.filter(
        (r) =>
          ENROLLED_STATUSES.has(r.enrollmentStatus) &&
          r.sectionId === null &&
          !isSoftClosed(r)
      );
    default: {
      const _exhaustive: never = target;
      throw new Error(`unreachable target: ${String(_exhaustive)}`);
    }
  }
}

// ─── Per-target columns ─────────────────────────────────────────────────────

export type DrillColumnKey =
  | 'fullName'
  | 'studentNumber'
  | 'enroleeNumber'
  | 'enrollmentStatus'
  | 'applicationStatus'
  | 'level'
  | 'sectionName'
  | 'pipelineStage'
  | 'applicationDate'
  | 'enrollmentDate'
  | 'withdrawalDate'
  | 'daysSinceUpdate'
  | 'documentsComplete';

export const ALL_DRILL_COLUMNS: DrillColumnKey[] = [
  'fullName',
  'studentNumber',
  'enroleeNumber',
  'enrollmentStatus',
  'applicationStatus',
  'level',
  'sectionName',
  'pipelineStage',
  'applicationDate',
  'enrollmentDate',
  'withdrawalDate',
  'daysSinceUpdate',
  'documentsComplete',
];

export const DRILL_COLUMN_LABELS: Record<DrillColumnKey, string> = {
  fullName: 'Student',
  studentNumber: 'Student ID',
  enroleeNumber: 'Applicant Number',
  enrollmentStatus: 'Enrollment',
  applicationStatus: 'App status',
  level: 'Level',
  sectionName: 'Section',
  pipelineStage: 'Stage',
  applicationDate: 'Applied on',
  // section_students.enrollment_date is the class-start date, NOT the enrolment
  // event — label it honestly so late enrollees don't read as "Enrolled on T3".
  enrollmentDate: 'Starts class on',
  withdrawalDate: 'Withdrawn on',
  daysSinceUpdate: 'Days since update',
  documentsComplete: 'Documents',
};

export function defaultColumnsForTarget(
  target: RecordsDrillTarget
): DrillColumnKey[] {
  switch (target) {
    case 'enrollments-range':
      return [
        'fullName',
        'level',
        'sectionName',
        'applicationDate',
        'enrollmentStatus',
      ];
    case 'withdrawals-range':
      return [
        'fullName',
        'level',
        'sectionName',
        'withdrawalDate',
        'daysSinceUpdate',
      ];
    case 'active-enrolled':
      return [
        'fullName',
        'level',
        'sectionName',
        'enrollmentDate',
        'documentsComplete',
      ];
    case 'expiring-docs':
      return [
        'fullName',
        'level',
        'sectionName',
        'documentsComplete',
        'daysSinceUpdate',
      ];
    case 'students-by-level':
      return [
        'fullName',
        'level',
        'sectionName',
        'enrollmentStatus',
        'enrollmentDate',
      ];
    case 'backlog-by-document':
      return ['fullName', 'level', 'documentsComplete', 'daysSinceUpdate'];
    case 'class-assignment-readiness':
      return ['fullName', 'level', 'enrollmentDate', 'daysSinceUpdate'];
  }
}

export function drillHeaderForTarget(
  target: RecordsDrillTarget,
  segment: string | null
): { eyebrow: string; title: string } {
  switch (target) {
    case 'enrollments-range':
      return { eyebrow: 'Drill · Enrollments', title: 'Enrolled in range' };
    case 'withdrawals-range':
      return { eyebrow: 'Drill · Withdrawals', title: 'Withdrawn in range' };
    case 'active-enrolled':
      return { eyebrow: 'Drill · Active', title: 'Currently enrolled' };
    case 'expiring-docs':
      return { eyebrow: 'Drill · Expiring', title: 'Documents expiring soon' };
    case 'students-by-level':
      return {
        eyebrow: 'Drill · Level',
        title: segment ? `Level: ${segment}` : 'By level',
      };
    case 'backlog-by-document':
      return {
        eyebrow: 'Drill · Document backlog',
        title: segment ? `Backlog: ${segment}` : 'Document backlog',
      };
    case 'class-assignment-readiness':
      return {
        eyebrow: 'Drill · Class assignment',
        title: 'Active without section',
      };
  }
}

// ─── SIS Admin drill types ──────────────────────────────────────────────────

export type SisAdminDrillTarget =
  | 'audit-events'
  | 'approver-coverage'
  | 'academic-years'
  | 'activity-by-actor';

export type AuditDrillRow = {
  id: string;
  action: string;
  actorEmail: string | null;
  entityType: string;
  entityId: string;
  context: Record<string, unknown> | null;
  createdAt: string;
};

export type ApproverAssignmentDrillRow = {
  id: string;
  flow: string;
  userId: string;
  email: string | null;
  role: string;
  assignedAt: string | null;
};

export type AcademicYearDrillRow = {
  id: string;
  ayCode: string;
  label: string | null;
  isCurrent: boolean;
  termsCount: number;
  studentsCount: number;
};

export type ActorActivityDrillRow = {
  userId: string;
  email: string | null;
  count: number;
  lastEventAt: string | null;
};

const MODULE_ACTION_PREFIXES: Record<string, string> = {
  markbook: 'sheet.',
  entry: 'entry.',
  pfile: 'pfile.',
  sis: 'sis.',
  attendance: 'attendance.',
  evaluation: 'evaluation.',
};

export async function loadAuditEventsUncached(
  modulePrefix: string,
  range?: { from: string; to: string }
): Promise<AuditDrillRow[]> {
  const service = createServiceClient();
  type AuditRow = {
    id: string;
    action: string;
    actor_email: string | null;
    entity_type: string;
    entity_id: string;
    context: Record<string, unknown> | null;
    created_at: string;
  };
  // Paginated — PostgREST caps a single response at 1000 rows; audit_log
  // already exceeds that in production, so a plain .limit() silently
  // truncates the drill sheet.
  const rows = await fetchAllPages<AuditRow>((from, to) => {
    let q = service
      .from('audit_log')
      .select(
        'id, action, actor_email, entity_type, entity_id, context, created_at'
      )
      .like('action', `${modulePrefix}%`)
      .order('created_at', { ascending: false });
    if (range?.from && range?.to) {
      q = q
        .gte('created_at', range.from)
        .lte('created_at', `${range.to}T23:59:59.999Z`);
    }
    return q.range(from, to);
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorEmail: r.actor_email,
    entityType: r.entity_type,
    entityId: r.entity_id,
    context: r.context,
    createdAt: r.created_at,
  }));
}

export async function loadApproverAssignments(): Promise<
  ApproverAssignmentDrillRow[]
> {
  const service = createServiceClient();
  const { data } = await service
    .from('approver_assignments')
    .select('id, flow, user_id, role, created_at');
  type Row = {
    id: string;
    flow: string;
    user_id: string;
    role: string;
    created_at: string | null;
  };
  const rows = (data ?? []) as Row[];

  // Resolve emails via auth admin
  const emailMap = new Map<string, string>();
  try {
    const { data: userList } = await service.auth.admin.listUsers({
      perPage: 1000,
    });
    if (userList?.users) {
      for (const u of userList.users) if (u.email) emailMap.set(u.id, u.email);
    }
  } catch {
    /* email is best-effort */
  }
  return rows.map((r) => ({
    id: r.id,
    flow: r.flow,
    userId: r.user_id,
    email: emailMap.get(r.user_id) ?? null,
    role: r.role,
    assignedAt: r.created_at,
  }));
}

export async function loadAcademicYearsList(): Promise<AcademicYearDrillRow[]> {
  const service = createServiceClient();
  const { data } = await service
    .from('academic_years')
    .select('id, ay_code, label, is_current')
    .order('ay_code', { ascending: false });
  type Row = {
    id: string;
    ay_code: string;
    label: string | null;
    is_current: boolean;
  };
  const ays = (data ?? []) as Row[];
  if (ays.length === 0) return [];

  const ayIds = ays.map((a) => a.id);
  const [termsCountByAy, studentsCountByAy] = await Promise.all([
    service
      .from('terms')
      .select('academic_year_id', { count: 'exact' })
      .in('academic_year_id', ayIds)
      .then(({ data }) => {
        const m = new Map<string, number>();
        for (const r of (data ?? []) as { academic_year_id: string }[]) {
          m.set(r.academic_year_id, (m.get(r.academic_year_id) ?? 0) + 1);
        }
        return m;
      }),
    service
      .from('sections')
      .select('id, academic_year_id')
      .in('academic_year_id', ayIds)
      .then(async ({ data: sections }) => {
        const sectionRows = (sections ?? []) as {
          id: string;
          academic_year_id: string;
        }[];
        if (sectionRows.length === 0) return new Map<string, number>();
        const sectionIds = sectionRows.map((s) => s.id);
        // Paginated — PostgREST caps a single response at 1000 rows, and
        // this sums section_students across every AY at once (comfortably
        // past 1000 once a few AYs are populated).
        const ssRows = await fetchAllPages<{ section_id: string }>((from, to) =>
          service
            .from('section_students')
            .select('section_id')
            .in('section_id', sectionIds)
            .range(from, to)
        );
        const sectionToAy = new Map<string, string>();
        for (const s of sectionRows) sectionToAy.set(s.id, s.academic_year_id);
        const out = new Map<string, number>();
        for (const r of ssRows) {
          const ay = sectionToAy.get(r.section_id);
          if (!ay) continue;
          out.set(ay, (out.get(ay) ?? 0) + 1);
        }
        return out;
      }),
  ]);

  return ays.map((a) => ({
    id: a.id,
    ayCode: a.ay_code,
    label: a.label,
    isCurrent: a.is_current,
    termsCount: termsCountByAy.get(a.id) ?? 0,
    studentsCount: studentsCountByAy.get(a.id) ?? 0,
  }));
}

// NOTE: this fetches every audit_log row in range to compute per-actor
// counts in JS. Paginated (below) to survive the 1000-row PostgREST cap,
// but as audit_log grows into the tens of thousands of rows this should be
// replaced with a server-side aggregate (a Postgres RPC grouping by
// actor_id) instead of a full-table JS aggregation.
export async function loadActorActivity(range?: {
  from: string;
  to: string;
}): Promise<ActorActivityDrillRow[]> {
  const service = createServiceClient();
  type Row = {
    actor_id: string | null;
    actor_email: string | null;
    created_at: string;
  };
  const data = await fetchAllPages<Row>((from, to) => {
    let q = service
      .from('audit_log')
      .select('actor_id, actor_email, created_at')
      .order('created_at', { ascending: false });
    if (range?.from && range?.to) {
      q = q
        .gte('created_at', range.from)
        .lte('created_at', `${range.to}T23:59:59.999Z`);
    }
    return q.range(from, to);
  });
  const map = new Map<
    string,
    { email: string | null; count: number; lastAt: string }
  >();
  for (const r of data) {
    const userId = r.actor_id ?? '__anon';
    const acc = map.get(userId);
    if (acc) {
      acc.count += 1;
      if (r.created_at > acc.lastAt) acc.lastAt = r.created_at;
    } else {
      map.set(userId, { email: r.actor_email, count: 1, lastAt: r.created_at });
    }
  }
  const out: ActorActivityDrillRow[] = [];
  for (const [userId, acc] of map.entries()) {
    out.push({
      userId,
      email: acc.email,
      count: acc.count,
      lastEventAt: acc.lastAt,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

export function modulePrefixFor(slug: string): string {
  return MODULE_ACTION_PREFIXES[slug] ?? slug;
}

// ─── Lifecycle aggregate drill ──────────────────────────────────────────────
// Originally fed the LifecycleAggregateCard's 8 buckets (SIS hub). That card
// + its feeding aggregate (`lib/sis/process.ts::getLifecycleAggregate` /
// `loadLifecycleAggregateUncached`) were deleted as dead code during the SIS
// Admin IA final review (KD #154) — zero consumers.
//
// 4 targets are still UI-reachable via `<DocumentChaseQueueStrip>`
// (components/sis/document-chase-queue-strip.tsx): 'awaiting-document-revalidation',
// 'awaiting-document-validation', 'awaiting-promised-documents',
// 'awaiting-expiring-documents'.
//
// The other 6 — 'awaiting-fee-payment', 'awaiting-assessment-schedule',
// 'awaiting-contract-signature', 'missing-class-assignment',
// 'ungated-to-enroll', 'new-applications' — have no UI trigger left. Kept in
// the union + `app/api/sis/drill/[target]/route.ts` for API back-compat
// (KD #56's unified drill-route contract) and because a future admissions
// funnel widget is a plausible re-consumer; delete only alongside a
// deliberate audit confirming no external/bookmarked callers hit
// `/api/sis/drill/<target>` for these.

export type LifecycleDrillTarget =
  | 'awaiting-fee-payment'
  | 'awaiting-document-revalidation'
  | 'awaiting-document-validation'
  | 'awaiting-promised-documents'
  | 'awaiting-expiring-documents'
  | 'awaiting-assessment-schedule'
  | 'awaiting-contract-signature'
  | 'missing-class-assignment'
  | 'ungated-to-enroll'
  | 'new-applications';

const LIFECYCLE_DRILL_TARGETS: LifecycleDrillTarget[] = [
  'awaiting-fee-payment',
  'awaiting-document-revalidation',
  'awaiting-document-validation',
  'awaiting-promised-documents',
  'awaiting-expiring-documents',
  'awaiting-assessment-schedule',
  'awaiting-contract-signature',
  'missing-class-assignment',
  'ungated-to-enroll',
  'new-applications',
];

export type LifecycleDrillRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  enroleeFullName: string | null;
  levelApplied: string | null;
  applicationStatus: string | null;
  applicationUpdatedDate: string | null;
  daysSinceUpdate: number | null;
  // Per-bucket extras — only populated for the bucket that needs them.
  feeStatus?: string | null;
  feeInvoice?: string | null;
  feePaymentDate?: string | null;
  documentStatus?: string | null;
  rejectedSlots?: string[];
  expiredSlots?: string[];
  uploadedSlots?: string[];
  promisedSlots?: string[];
  expiringSlots?: string[];
  daysLeft?: number | null;
  assessmentStatus?: string | null;
  assessmentSchedule?: string | null;
  contractStatus?: string | null;
  classSection?: string | null;
};

// Snapshot tuple holding the three table reads that every lifecycle predicate
// needs. Cached per-AY so all 8 targets share one fetch.
type LifecycleSnapshot = {
  apps: Map<string, LifecycleAppLite>;
  status: Map<string, LifecycleStatusRow>;
  docs: Map<string, LifecycleDocRow>;
};

type LifecycleAppLite = {
  enroleeNumber: string;
  studentNumber: string | null;
  enroleeFullName: string | null;
  firstName: string | null;
  lastName: string | null;
  levelApplied: string | null;
};

// Use Record<string, ...> so we can address dynamic stage status columns by
// name (registrationStatus, contractStatus, etc) without exhaustively typing
// every column.
type LifecycleStatusRow = Record<string, string | null> & {
  enroleeNumber: string;
};
type LifecycleDocRow = Record<string, string | null> & {
  enroleeNumber: string;
};

async function loadLifecycleSnapshotUncached(
  ayCode: string
): Promise<LifecycleSnapshot> {
  const prefix = prefixFor(ayCode);
  const admissions = createAdmissionsClient();

  // Status select list — all stage status cols + the bucket-specific extras.
  const statusColumns = [
    'enroleeNumber',
    'applicationStatus',
    'applicationUpdatedDate',
    'feeStatus',
    'feeInvoice',
    'feePaymentDate',
    'documentStatus',
    'assessmentStatus',
    'assessmentSchedule',
    'contractStatus',
    'classSection',
    ...ENROLLED_PREREQ_STAGES.map((s) => STAGE_COLUMN_MAP[s].statusCol),
  ];
  const uniqStatusColumns = Array.from(new Set(statusColumns));

  // Include both status and expiry columns so the drill can detect expiring-soon slots
  const docColumns = [
    'enroleeNumber',
    ...DOCUMENT_SLOTS.map((s) => s.statusCol),
    ...DOCUMENT_SLOTS.filter((s) => s.expiryCol).map((s) => s.expiryCol!),
  ];

  // Paginated — PostgREST caps a single response at 1000 rows; these are
  // full-table scans of the per-AY admissions tables with no filter.
  const [appsRows, statusRows, docsRows] = await Promise.all([
    fetchAllPages<LifecycleAppLite>((from, to) =>
      admissions
        .from(`${prefix}_enrolment_applications`)
        .select(
          'enroleeNumber, studentNumber, enroleeFullName, firstName, lastName, levelApplied'
        )
        .range(from, to)
    ),
    fetchAllPages<LifecycleStatusRow>((from, to) => {
      // Dynamic column-list .select() loses PostgREST's literal-string type
      // inference (falls back to a GenericStringError marker type) — same
      // reason the pre-pagination code cast via `as unknown as X[]`.
      const q = admissions
        .from(`${prefix}_enrolment_status`)
        .select(uniqStatusColumns.join(', '))
        .range(from, to);
      return q as unknown as ReturnType<PageBuilder<LifecycleStatusRow>>;
    }),
    fetchAllPages<LifecycleDocRow>((from, to) => {
      const q = admissions
        .from(`${prefix}_enrolment_documents`)
        .select(docColumns.join(', '))
        .range(from, to);
      return q as unknown as ReturnType<PageBuilder<LifecycleDocRow>>;
    }),
  ]);

  const apps = new Map<string, LifecycleAppLite>();
  for (const a of appsRows) {
    if (a.enroleeNumber) apps.set(a.enroleeNumber, a);
  }

  const status = new Map<string, LifecycleStatusRow>();
  for (const r of statusRows) {
    if (r.enroleeNumber) status.set(r.enroleeNumber, r);
  }

  const docs = new Map<string, LifecycleDocRow>();
  for (const r of docsRows) {
    if (r.enroleeNumber) docs.set(r.enroleeNumber, r);
  }

  return { apps, status, docs };
}

async function getLifecycleSnapshot(
  ayCode: string
): Promise<LifecycleSnapshot> {
  // Map values can't round-trip through JSON; the Sprint 23 lesson taught us
  // `unstable_cache` calls JSON.stringify under the hood. So we cache the raw
  // arrays then rebuild Maps inside the wrapper. Same idea as
  // `lib/auth/teacher-emails.ts::getTeacherEmailMap`.
  type Cached = {
    apps: LifecycleAppLite[];
    status: LifecycleStatusRow[];
    docs: LifecycleDocRow[];
  };
  const cached = await unstable_cache(
    async (): Promise<Cached> => {
      const snap = await loadLifecycleSnapshotUncached(ayCode);
      return {
        apps: Array.from(snap.apps.values()),
        status: Array.from(snap.status.values()),
        docs: Array.from(snap.docs.values()),
      };
    },
    ['sis', 'lifecycle-drill', 'snapshot', ayCode],
    {
      tags: [...tags(ayCode), 'sis', `sis:${ayCode}`],
      revalidate: CACHE_TTL_SECONDS,
    }
  )();

  const apps = new Map<string, LifecycleAppLite>();
  for (const a of cached.apps) apps.set(a.enroleeNumber, a);
  const status = new Map<string, LifecycleStatusRow>();
  for (const r of cached.status) status.set(r.enroleeNumber, r);
  const docs = new Map<string, LifecycleDocRow>();
  for (const r of cached.docs) docs.set(r.enroleeNumber, r);
  return { apps, status, docs };
}

function nameOf(app: LifecycleAppLite | undefined): string | null {
  if (!app) return null;
  if (app.enroleeFullName && app.enroleeFullName.trim())
    return app.enroleeFullName.trim();
  const parts = [app.firstName, app.lastName].filter(
    (p): p is string => !!p && p.trim().length > 0
  );
  return parts.length > 0 ? parts.join(' ') : null;
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function baseRow(
  enroleeNumber: string,
  app: LifecycleAppLite | undefined,
  status: LifecycleStatusRow
): LifecycleDrillRow {
  const updated = status.applicationUpdatedDate ?? null;
  return {
    enroleeNumber,
    studentNumber: app?.studentNumber ?? null,
    enroleeFullName: nameOf(app),
    levelApplied: app?.levelApplied ?? null,
    applicationStatus: status.applicationStatus ?? null,
    applicationUpdatedDate: updated,
    daysSinceUpdate: daysSince(updated),
  };
}

const ACTIVE_FUNNEL = new Set([
  'Submitted',
  'Ongoing Verification',
  'Processing',
]);

const ENROLLED_APP_STATUSES = new Set(['Enrolled', 'Enrolled (Conditional)']);

// The four document-chase targets are mounted on two surfaces with opposite
// populations: /admissions chases NON-enrolled funnel applicants, /records +
// /p-files chase ENROLLED students. The `lens` mirrors getDocumentChaseQueueCounts
// exactly so the drill matches the card it was opened from (KD #124 count==drill).
// No lens → no scope (back-compat for any lens-less caller).
type ChaseDrillLens = 'admissions' | 'p-files';

function inChaseLensScope(
  lens: ChaseDrillLens | undefined,
  appStatus: string,
  classSection: string | null | undefined
): boolean {
  if (!lens) return true;
  if (lens === 'admissions') return ACTIVE_FUNNEL.has(appStatus);
  // p-files: enrolled + has a class section (KD #31/#71).
  return (
    ENROLLED_APP_STATUSES.has(appStatus) &&
    (classSection ?? '').toString().trim().length > 0
  );
}

export async function buildLifecycleDrillRows(
  ayCode: string,
  target: LifecycleDrillTarget,
  lens?: ChaseDrillLens
): Promise<LifecycleDrillRow[]> {
  const snap = await getLifecycleSnapshot(ayCode);
  const out: LifecycleDrillRow[] = [];

  for (const [enroleeNumber, status] of snap.status) {
    const appStatus = (status.applicationStatus ?? '').trim();
    const app = snap.apps.get(enroleeNumber);
    const docs = snap.docs.get(enroleeNumber);
    // Scope the document-chase targets to the lens's enrollment population so
    // the drill can't show students the card's count excluded.
    const lensOk = inChaseLensScope(lens, appStatus, status.classSection);

    switch (target) {
      case 'awaiting-fee-payment': {
        if (status.feeStatus !== 'Paid' && ACTIVE_FUNNEL.has(appStatus)) {
          out.push({
            ...baseRow(enroleeNumber, app, status),
            feeStatus: status.feeStatus ?? null,
            feeInvoice: status.feeInvoice ?? null,
            feePaymentDate: status.feePaymentDate ?? null,
          });
        }
        break;
      }
      case 'awaiting-document-revalidation': {
        if (!docs || !lensOk) break;
        const rejectedSlots: string[] = [];
        const expiredSlots: string[] = [];
        for (const slot of DOCUMENT_SLOTS) {
          const v = (docs[slot.statusCol] ?? '').toString().trim();
          if (v === 'Rejected') rejectedSlots.push(slot.label);
          else if (v === 'Expired') expiredSlots.push(slot.label);
        }
        if (rejectedSlots.length > 0 || expiredSlots.length > 0) {
          out.push({
            ...baseRow(enroleeNumber, app, status),
            documentStatus: status.documentStatus ?? null,
            rejectedSlots,
            expiredSlots,
          });
        }
        break;
      }
      case 'awaiting-document-validation': {
        if (!docs || !lensOk) break;
        const uploadedSlots: string[] = [];
        for (const slot of DOCUMENT_SLOTS) {
          const v = (docs[slot.statusCol] ?? '').toString().trim();
          if (v === 'Uploaded') uploadedSlots.push(slot.label);
        }
        if (uploadedSlots.length > 0) {
          out.push({
            ...baseRow(enroleeNumber, app, status),
            documentStatus: status.documentStatus ?? null,
            uploadedSlots,
          });
        }
        break;
      }
      case 'awaiting-promised-documents': {
        if (!docs || !lensOk) break;
        const promisedSlots: string[] = [];
        for (const slot of DOCUMENT_SLOTS) {
          const v = (docs[slot.statusCol] ?? '').toString().trim();
          if (v === 'To follow') promisedSlots.push(slot.label);
        }
        if (promisedSlots.length > 0) {
          out.push({
            ...baseRow(enroleeNumber, app, status),
            documentStatus: status.documentStatus ?? null,
            promisedSlots,
          });
        }
        break;
      }
      case 'awaiting-expiring-documents': {
        if (!docs || !lensOk) break;
        const expiringSlots: string[] = [];
        let soonestDays: number | null = null;
        const now = Date.now();
        for (const slot of DOCUMENT_SLOTS) {
          if (!slot.expiryCol) continue;
          const statusVal = (docs[slot.statusCol] ?? '').toString().trim();
          if (statusVal !== 'Valid') continue;
          const raw = docs[slot.expiryCol];
          if (!raw) continue;
          const ms = Date.parse(raw.toString());
          if (Number.isNaN(ms)) continue;
          const days = Math.floor((ms - now) / 86_400_000);
          if (days >= 0 && days <= EXPIRING_SOON_THRESHOLD_DAYS) {
            expiringSlots.push(slot.label);
            if (soonestDays === null || days < soonestDays) soonestDays = days;
          }
        }
        if (expiringSlots.length > 0) {
          out.push({
            ...baseRow(enroleeNumber, app, status),
            documentStatus: status.documentStatus ?? null,
            expiringSlots,
            daysLeft: soonestDays,
          });
        }
        break;
      }
      case 'awaiting-assessment-schedule': {
        if (
          status.assessmentStatus === 'Pending' &&
          !status.assessmentSchedule
        ) {
          out.push({
            ...baseRow(enroleeNumber, app, status),
            assessmentStatus: status.assessmentStatus ?? null,
            assessmentSchedule: status.assessmentSchedule ?? null,
          });
        }
        break;
      }
      case 'awaiting-contract-signature': {
        if (
          status.contractStatus === 'Generated' ||
          status.contractStatus === 'Sent'
        ) {
          out.push({
            ...baseRow(enroleeNumber, app, status),
            contractStatus: status.contractStatus ?? null,
          });
        }
        break;
      }
      case 'missing-class-assignment': {
        const cls = (status.classSection ?? '').trim();
        if (
          (appStatus === 'Enrolled' ||
            appStatus === 'Enrolled (Conditional)') &&
          cls.length === 0
        ) {
          out.push({
            ...baseRow(enroleeNumber, app, status),
            classSection: status.classSection ?? null,
          });
        }
        break;
      }
      case 'ungated-to-enroll': {
        const allPrereqsTerminal = ENROLLED_PREREQ_STAGES.every((s) => {
          const col = STAGE_COLUMN_MAP[s].statusCol;
          const terminal = STAGE_TERMINAL_STATUS[s];
          return terminal && (status[col] ?? '').toString().trim() === terminal;
        });
        if (
          allPrereqsTerminal &&
          appStatus !== 'Enrolled' &&
          appStatus !== 'Enrolled (Conditional)' &&
          appStatus !== 'Cancelled' &&
          appStatus !== 'Withdrawn'
        ) {
          out.push(baseRow(enroleeNumber, app, status));
        }
        break;
      }
      case 'new-applications': {
        if (appStatus === 'Submitted') {
          out.push(baseRow(enroleeNumber, app, status));
        }
        break;
      }
      default: {
        const _exhaustive: never = target;
        throw new Error(
          `unreachable lifecycle drill target: ${String(_exhaustive)}`
        );
      }
    }
  }

  // Stable secondary sort: oldest-first by daysSinceUpdate (most-stale at top).
  out.sort((a, b) => {
    const av = a.daysSinceUpdate ?? -1;
    const bv = b.daysSinceUpdate ?? -1;
    return bv - av;
  });
  return out;
}

// ─── Per-target columns ─────────────────────────────────────────────────────

export type LifecycleDrillColumnKey =
  | 'enroleeNumber'
  | 'studentNumber'
  | 'enroleeFullName'
  | 'levelApplied'
  | 'applicationStatus'
  | 'applicationUpdatedDate'
  | 'daysSinceUpdate'
  | 'feeStatus'
  | 'feeInvoice'
  | 'feePaymentDate'
  | 'documentStatus'
  | 'rejectedSlots'
  | 'expiredSlots'
  | 'uploadedSlots'
  | 'promisedSlots'
  | 'expiringSlots'
  | 'daysLeft'
  | 'assessmentStatus'
  | 'assessmentSchedule'
  | 'contractStatus'
  | 'classSection';

export const ALL_LIFECYCLE_DRILL_COLUMNS: LifecycleDrillColumnKey[] = [
  'enroleeFullName',
  'enroleeNumber',
  'studentNumber',
  'levelApplied',
  'applicationStatus',
  'applicationUpdatedDate',
  'daysSinceUpdate',
  'feeStatus',
  'feeInvoice',
  'feePaymentDate',
  'documentStatus',
  'rejectedSlots',
  'expiredSlots',
  'uploadedSlots',
  'promisedSlots',
  'expiringSlots',
  'daysLeft',
  'assessmentStatus',
  'assessmentSchedule',
  'contractStatus',
  'classSection',
];

export const LIFECYCLE_DRILL_COLUMN_LABELS: Record<
  LifecycleDrillColumnKey,
  string
> = {
  enroleeFullName: 'Student',
  enroleeNumber: 'Applicant Number',
  studentNumber: 'Student ID',
  levelApplied: 'Level',
  applicationStatus: 'App status',
  applicationUpdatedDate: 'Last updated',
  daysSinceUpdate: 'Days since update',
  feeStatus: 'Fee status',
  feeInvoice: 'Invoice',
  feePaymentDate: 'Paid on',
  documentStatus: 'Doc status',
  rejectedSlots: 'Rejected slots',
  expiredSlots: 'Expired slots',
  uploadedSlots: 'Uploaded slots',
  promisedSlots: 'Promised slots',
  expiringSlots: 'Expiring slots',
  daysLeft: 'Days left',
  assessmentStatus: 'Assessment',
  assessmentSchedule: 'Schedule',
  contractStatus: 'Contract',
  classSection: 'Class section',
};

export function defaultColumnsForLifecycleTarget(
  target: LifecycleDrillTarget
): LifecycleDrillColumnKey[] {
  switch (target) {
    case 'awaiting-fee-payment':
      return [
        'enroleeFullName',
        'levelApplied',
        'applicationStatus',
        'feeStatus',
        'feeInvoice',
        'daysSinceUpdate',
      ];
    case 'awaiting-document-revalidation':
      return [
        'enroleeFullName',
        'levelApplied',
        'rejectedSlots',
        'expiredSlots',
        'applicationStatus',
        'daysSinceUpdate',
      ];
    case 'awaiting-document-validation':
      return [
        'enroleeFullName',
        'levelApplied',
        'uploadedSlots',
        'applicationStatus',
        'daysSinceUpdate',
      ];
    case 'awaiting-promised-documents':
      return [
        'enroleeFullName',
        'levelApplied',
        'promisedSlots',
        'applicationStatus',
        'daysSinceUpdate',
      ];
    case 'awaiting-expiring-documents':
      return [
        'enroleeFullName',
        'levelApplied',
        'expiringSlots',
        'daysLeft',
        'applicationStatus',
        'daysSinceUpdate',
      ];
    case 'awaiting-assessment-schedule':
      return [
        'enroleeFullName',
        'levelApplied',
        'assessmentStatus',
        'assessmentSchedule',
        'applicationStatus',
        'daysSinceUpdate',
      ];
    case 'awaiting-contract-signature':
      return [
        'enroleeFullName',
        'levelApplied',
        'contractStatus',
        'applicationStatus',
        'daysSinceUpdate',
      ];
    case 'missing-class-assignment':
      return [
        'enroleeFullName',
        'levelApplied',
        'applicationStatus',
        'classSection',
        'daysSinceUpdate',
      ];
    case 'ungated-to-enroll':
      return [
        'enroleeFullName',
        'levelApplied',
        'applicationStatus',
        'applicationUpdatedDate',
        'daysSinceUpdate',
      ];
    case 'new-applications':
      return [
        'enroleeFullName',
        'levelApplied',
        'applicationStatus',
        'applicationUpdatedDate',
        'daysSinceUpdate',
      ];
  }
}

export function lifecycleDrillHeaderForTarget(target: LifecycleDrillTarget): {
  eyebrow: string;
  title: string;
} {
  switch (target) {
    case 'awaiting-fee-payment':
      return { eyebrow: 'Drill · Lifecycle', title: 'Awaiting fee payment' };
    case 'awaiting-document-revalidation':
      return {
        eyebrow: 'Drill · Lifecycle',
        title: 'Awaiting document revalidation',
      };
    case 'awaiting-document-validation':
      return {
        eyebrow: 'Drill · Lifecycle',
        title: 'Awaiting document validation',
      };
    case 'awaiting-promised-documents':
      return {
        eyebrow: 'Drill · Lifecycle',
        title: 'Awaiting promised documents',
      };
    case 'awaiting-expiring-documents':
      return { eyebrow: 'Drill · Lifecycle', title: 'Expiring within 30 days' };
    case 'awaiting-assessment-schedule':
      return {
        eyebrow: 'Drill · Lifecycle',
        title: 'Awaiting assessment schedule',
      };
    case 'awaiting-contract-signature':
      return {
        eyebrow: 'Drill · Lifecycle',
        title: 'Awaiting contract signature',
      };
    case 'missing-class-assignment':
      return {
        eyebrow: 'Drill · Lifecycle',
        title: 'Missing class assignment',
      };
    case 'ungated-to-enroll':
      return { eyebrow: 'Drill · Lifecycle', title: 'Ungated to enroll' };
    case 'new-applications':
      return { eyebrow: 'Drill · Lifecycle', title: 'New applications' };
  }
}

export function isLifecycleDrillTarget(s: string): s is LifecycleDrillTarget {
  return (LIFECYCLE_DRILL_TARGETS as readonly string[]).includes(s);
}
