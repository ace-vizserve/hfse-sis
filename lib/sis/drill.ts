import { unstable_cache } from 'next/cache';

import {
  STAGE_COLUMN_MAP,
  STAGE_TERMINAL_STATUS,
  ENROLLED_PREREQ_STAGES,
} from '@/lib/schemas/sis';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';
import { parseLocalDate } from '@/lib/dashboard/range';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';
import { EXPIRING_SOON_THRESHOLD_DAYS } from '@/lib/sis/process';

const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

function tags(ayCode: string): string[] {
  return ['records-drill', `records-drill:${ayCode}`];
}

// ─── Targets ────────────────────────────────────────────────────────────────

export type RecordsDrillTarget =
  | 'enrollments-range'
  | 'withdrawals-range'
  | 'active-enrolled'
  | 'expiring-docs'
  | 'students-by-pipeline-stage'
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
  enrollmentDate: string | null; // ISO
  withdrawalDate: string | null; // ISO
  daysSinceUpdate: number | null;
  hasMissingDocs: boolean;
  expiringDocsCount: number; // number of docs expiring within 60 days
  documentsComplete: number;
  documentsTotal: number;
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
    for (let i = 0; i < studentIds.length; i += 500)
      chunks.push(studentIds.slice(i, i + 500));
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
    if (SOFT_CLOSED_APPLICATION_STATUSES.has(applicationStatus)) continue;

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

  const [statusRes, appsRes, ssRes] = await Promise.all([
    admissions
      .from(`${prefix}_enrolment_status`)
      .select(
        'enroleeNumber, applicationStatus, applicationUpdatedDate, classLevel'
      )
      .in('applicationStatus', ['Enrolled', 'Enrolled (Conditional)']),
    admissions
      .from(`${prefix}_enrolment_applications`)
      .select(
        'enroleeNumber, studentNumber, enroleeFullName, firstName, lastName, levelApplied, created_at'
      ),
    sectionIds.length > 0
      ? service
          .from('section_students')
          .select('enrolee_number')
          .in('section_id', sectionIds)
      : Promise.resolve({ data: [] as { enrolee_number: string | null }[] }),
  ]);

  if (statusRes.error || appsRes.error) return [];

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

  // Build the set of already-assigned enroleeNumbers from section_students
  // so we can exclude them (mirrors loadClassAssignmentReadinessUncached's
  // logic for M13 count alignment).
  const assignedEnrolees = new Set(
    ((ssRes.data ?? []) as { enrolee_number: string | null }[])
      .map((r) => r.enrolee_number)
      .filter((v): v is string => v !== null)
  );

  const appsByEnrolee = new Map<string, AppsRow>();
  for (const a of (appsRes.data ?? []) as AppsRow[]) {
    if (a.enroleeNumber) appsByEnrolee.set(a.enroleeNumber, a);
  }

  const today = Date.now();
  const out: RecordsDrillRow[] = [];

  for (const status of (statusRes.data ?? []) as StatusRow[]) {
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
  options?: { withDocs?: boolean }
): Promise<RecordsDrillRow[]> {
  // AY-scoped cache; scope/range filtering applied post-cache (per KD #56).
  const cached = await unstable_cache(
    () => loadRecordsRowsUncached(input.ayCode),
    ['records-drill', 'rows', input.ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(input.ayCode) }
  )();
  return options?.withDocs ? enrichWithDocs(cached, input.ayCode) : cached;
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
      // KD #82 scope-anchor: enrolment-velocity chart anchors on
      // section_students.enrollment_date; drill must match (M12).
      if (!range)
        return rows.filter((r) => ENROLLED_STATUSES.has(r.enrollmentStatus));
      return rows.filter((r) => {
        if (!ENROLLED_STATUSES.has(r.enrollmentStatus)) return false;
        if (!r.enrollmentDate) return false;
        const d = r.enrollmentDate.slice(0, 10);
        return d >= range.from && d <= range.to;
      });
    }
    case 'withdrawals-range': {
      if (!range) return rows.filter((r) => r.enrollmentStatus === 'withdrawn');
      return rows.filter((r) => {
        if (r.enrollmentStatus !== 'withdrawn') return false;
        if (!r.withdrawalDate) return false;
        const d = r.withdrawalDate.slice(0, 10);
        return d >= range.from && d <= range.to;
      });
    }
    case 'active-enrolled':
      return rows.filter((r) => ENROLLED_STATUSES.has(r.enrollmentStatus));
    case 'expiring-docs':
      return rows.filter((r) => r.expiringDocsCount > 0);
    case 'students-by-pipeline-stage':
      if (!segment) return rows;
      return rows.filter((r) => r.pipelineStage === segment);
    case 'students-by-level':
      if (!segment) return rows;
      return rows.filter((r) => (r.level ?? 'Unknown') === segment);
    case 'backlog-by-document': {
      // segment format = "{slotKey}|{statusBucket}" e.g. "medical|missing"
      if (!segment) return rows.filter((r) => r.hasMissingDocs);
      // Without per-slot enrichment in the row we filter by hasMissingDocs as
      // a proxy. The drill API can pass a richer segment if needed later.
      return rows.filter((r) => r.hasMissingDocs);
    }
    case 'class-assignment-readiness':
      return rows.filter(
        (r) => ENROLLED_STATUSES.has(r.enrollmentStatus) && r.sectionId === null
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
  enrollmentDate: 'Enrolled on',
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
        'enrollmentDate',
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
    case 'students-by-pipeline-stage':
      return [
        'fullName',
        'level',
        'pipelineStage',
        'enrollmentStatus',
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
    case 'students-by-pipeline-stage':
      return {
        eyebrow: 'Drill · Stage',
        title: segment ? `Stage: ${segment}` : 'By pipeline stage',
      };
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
  let q = service
    .from('audit_log')
    .select(
      'id, action, actor_email, entity_type, entity_id, context, created_at'
    )
    .like('action', `${modulePrefix}%`)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (range?.from && range?.to) {
    q = q
      .gte('created_at', range.from)
      .lte('created_at', `${range.to}T23:59:59.999Z`);
  }
  const { data } = await q;
  type AuditRow = {
    id: string;
    action: string;
    actor_email: string | null;
    entity_type: string;
    entity_id: string;
    context: Record<string, unknown> | null;
    created_at: string;
  };
  return ((data ?? []) as AuditRow[]).map((r) => ({
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
        const { data: ssRows } = await service
          .from('section_students')
          .select('section_id')
          .in('section_id', sectionIds);
        const sectionToAy = new Map<string, string>();
        for (const s of sectionRows) sectionToAy.set(s.id, s.academic_year_id);
        const out = new Map<string, number>();
        for (const r of (ssRows ?? []) as { section_id: string }[]) {
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

export async function loadActorActivity(range?: {
  from: string;
  to: string;
}): Promise<ActorActivityDrillRow[]> {
  const service = createServiceClient();
  let q = service
    .from('audit_log')
    .select('actor_id, actor_email, created_at')
    .order('created_at', { ascending: false })
    .limit(5000);
  if (range?.from && range?.to) {
    q = q
      .gte('created_at', range.from)
      .lte('created_at', `${range.to}T23:59:59.999Z`);
  }
  const { data } = await q;
  type Row = {
    actor_id: string | null;
    actor_email: string | null;
    created_at: string;
  };
  const map = new Map<
    string,
    { email: string | null; count: number; lastAt: string }
  >();
  for (const r of (data ?? []) as Row[]) {
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
// Drives the LifecycleAggregateCard's 8 buckets. Predicates mirror
// `lib/sis/process.ts::loadLifecycleAggregateUncached` exactly — each target's
// loader applies the same filter that increments that bucket's count.

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

  const [appsRes, statusRes, docsRes] = await Promise.all([
    admissions
      .from(`${prefix}_enrolment_applications`)
      .select(
        'enroleeNumber, studentNumber, enroleeFullName, firstName, lastName, levelApplied'
      ),
    admissions
      .from(`${prefix}_enrolment_status`)
      .select(uniqStatusColumns.join(', ')),
    admissions
      .from(`${prefix}_enrolment_documents`)
      .select(docColumns.join(', ')),
  ]);

  const apps = new Map<string, LifecycleAppLite>();
  for (const a of (appsRes.data ?? []) as LifecycleAppLite[]) {
    if (a.enroleeNumber) apps.set(a.enroleeNumber, a);
  }

  const status = new Map<string, LifecycleStatusRow>();
  for (const r of (statusRes.data ?? []) as unknown as LifecycleStatusRow[]) {
    if (r.enroleeNumber) status.set(r.enroleeNumber, r);
  }

  const docs = new Map<string, LifecycleDocRow>();
  for (const r of (docsRes.data ?? []) as unknown as LifecycleDocRow[]) {
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
