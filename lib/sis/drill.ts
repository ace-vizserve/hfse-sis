import { unstable_cache } from 'next/cache';

import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

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

export type DrillScope = 'range' | 'ay' | 'all';

// ─── Row shape ──────────────────────────────────────────────────────────────

export type RecordsDrillRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  enrollmentStatus: string; // 'active' | 'conditional' | 'withdrawn' | etc
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

const ENROLLED_STATUSES = new Set(['active', 'conditional']);
const SOFT_CLOSED_APPLICATION_STATUSES = new Set(['Cancelled', 'Withdrawn']);

// ─── Range input ────────────────────────────────────────────────────────────

export type DrillRangeInput = {
  ayCode: string;
  scope: DrillScope;
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

function deriveStage(applicationStatus: string | null, enrollmentStatus: string): string {
  if (enrollmentStatus === 'active' || enrollmentStatus === 'conditional') return 'Enrolled';
  if (enrollmentStatus === 'withdrawn') return 'Withdrawn';
  if (enrollmentStatus === 'graduated') return 'Graduated';
  return (applicationStatus ?? '').trim() || 'Not started';
}

async function loadRecordsRowsUncached(ayCode: string): Promise<RecordsDrillRow[]> {
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

  const [sectionsRes, levelsRes, ssRes] = await Promise.all([
    service.from('sections').select('id, name, level_id').eq('academic_year_id', ayId),
    service.from('levels').select('id, code'),
    service
      .from('section_students')
      .select('id, section_id, student_id, enrollment_status, enrollment_date, withdrawal_date, enrolee_number')
      .in(
        'section_id',
        (
          (await service.from('sections').select('id').eq('academic_year_id', ayId)).data ?? []
        ).map((r) => r.id as string),
      ),
  ]);

  const sections = (sectionsRes.data ?? []) as SectionLite[];
  const sectionById = new Map<string, SectionLite>();
  for (const s of sections) sectionById.set(s.id, s);

  const levels = new Map<string, string>();
  for (const l of (levelsRes.data ?? []) as LevelLite[]) levels.set(l.id, l.code);

  const ss = (ssRes.data ?? []) as SectionStudentLite[];
  const studentIds = Array.from(new Set(ss.map((s) => s.student_id)));

  const studentMap = new Map<string, StudentLite>();
  if (studentIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < studentIds.length; i += 500) chunks.push(studentIds.slice(i, i + 500));
    for (const chunk of chunks) {
      const { data } = await service
        .from('students')
        .select('id, first_name, middle_name, last_name, student_number')
        .in('id', chunk);
      for (const s of (data ?? []) as StudentLite[]) studentMap.set(s.id, s);
    }
  }

  // Admissions tables — for application-side metadata + days-since-update.
  const enroleeNumbers = ss
    .map((r) => r.enrolee_number)
    .filter((v): v is string => v !== null);
  let appByEnrolee = new Map<string, ApplicationLite>();
  let statusByEnrolee = new Map<string, StatusLite>();
  if (enroleeNumbers.length > 0) {
    const [appsRes, statusRes] = await Promise.all([
      admissions
        .from(appsTable)
        .select('enroleeNumber, studentNumber, enroleeFullName, firstName, lastName, levelApplied, created_at')
        .in('enroleeNumber', enroleeNumbers),
      admissions
        .from(statusTable)
        .select('enroleeNumber, applicationStatus, applicationUpdatedDate, classLevel, levelApplied')
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
    const enroleeNumber = enrol.enrolee_number ?? '';
    const app = enroleeNumber ? appByEnrolee.get(enroleeNumber) : undefined;
    const status = enroleeNumber ? statusByEnrolee.get(enroleeNumber) : undefined;

    const applicationStatus = (status?.applicationStatus ?? '').trim();
    if (SOFT_CLOSED_APPLICATION_STATUSES.has(applicationStatus)) continue;

    const updated = status?.applicationUpdatedDate ?? app?.created_at ?? null;
    const updatedMs = updated ? Date.parse(updated) : NaN;
    const daysSinceUpdate = !Number.isNaN(updatedMs)
      ? Math.floor((today - updatedMs) / 86_400_000)
      : null;

    const enrollmentStatus = enrol.enrollment_status;
    const pipelineStage = deriveStage(applicationStatus, enrollmentStatus);
    const level = section ? levels.get(section.level_id) ?? null : status?.classLevel ?? app?.levelApplied ?? null;

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
async function enrichWithDocs(rows: RecordsDrillRow[], ayCode: string): Promise<RecordsDrillRow[]> {
  if (rows.length === 0) return rows;
  const prefix = prefixFor(ayCode);
  const docsTable = `${prefix}_enrolment_documents`;
  const admissions = createAdmissionsClient();
  const enroleeNumbers = rows.map((r) => r.enroleeNumber);
  const { data, error } = await admissions
    .from(docsTable)
    .select(`enroleeNumber, ${CORE_DOC_STATUS_COLUMNS.join(', ')}`)
    .in('enroleeNumber', enroleeNumbers);
  if (error) return rows;
  type DocRow = Record<(typeof CORE_DOC_STATUS_COLUMNS)[number] | 'enroleeNumber', string | null>;
  const docsByEnrolee = new Map<string, DocRow>();
  for (const d of (data ?? []) as unknown as DocRow[]) {
    if (d.enroleeNumber) docsByEnrolee.set(d.enroleeNumber, d);
  }
  return rows.map((r) => {
    const d = docsByEnrolee.get(r.enroleeNumber);
    if (!d) return r;
    let documentsComplete = 0;
    for (const col of CORE_DOC_STATUS_COLUMNS) {
      const v = d[col];
      if (v && String(v).trim() !== '' && String(v).toLowerCase() !== 'missing') {
        documentsComplete += 1;
      }
    }
    return {
      ...r,
      documentsComplete,
      hasMissingDocs: documentsComplete < r.documentsTotal,
    };
  });
}

// ─── Public builder ─────────────────────────────────────────────────────────

export async function buildRecordsDrillRows(
  input: DrillRangeInput,
  options?: { withDocs?: boolean },
): Promise<RecordsDrillRow[]> {
  // AY-scoped cache; scope/range filtering applied post-cache (per KD #56).
  const cached = await unstable_cache(
    () => loadRecordsRowsUncached(input.ayCode),
    ['records-drill', 'rows', input.ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(input.ayCode) },
  )();
  return options?.withDocs ? enrichWithDocs(cached, input.ayCode) : cached;
}

// ─── Per-target filter ──────────────────────────────────────────────────────

export function applyTargetFilter(
  rows: RecordsDrillRow[],
  target: RecordsDrillTarget,
  segment: string | null,
  range?: { from: string; to: string },
): RecordsDrillRow[] {
  switch (target) {
    case 'enrollments-range': {
      if (!range) return rows.filter((r) => ENROLLED_STATUSES.has(r.enrollmentStatus));
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
        (r) => ENROLLED_STATUSES.has(r.enrollmentStatus) && r.sectionId === null,
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
  studentNumber: 'Student #',
  enroleeNumber: 'Enrolee #',
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

export function defaultColumnsForTarget(target: RecordsDrillTarget): DrillColumnKey[] {
  switch (target) {
    case 'enrollments-range':
      return ['fullName', 'level', 'sectionName', 'enrollmentDate', 'enrollmentStatus'];
    case 'withdrawals-range':
      return ['fullName', 'level', 'sectionName', 'withdrawalDate', 'daysSinceUpdate'];
    case 'active-enrolled':
      return ['fullName', 'level', 'sectionName', 'enrollmentDate', 'documentsComplete'];
    case 'expiring-docs':
      return ['fullName', 'level', 'sectionName', 'documentsComplete', 'daysSinceUpdate'];
    case 'students-by-pipeline-stage':
      return ['fullName', 'level', 'pipelineStage', 'enrollmentStatus', 'daysSinceUpdate'];
    case 'students-by-level':
      return ['fullName', 'level', 'sectionName', 'enrollmentStatus', 'enrollmentDate'];
    case 'backlog-by-document':
      return ['fullName', 'level', 'documentsComplete', 'daysSinceUpdate'];
    case 'class-assignment-readiness':
      return ['fullName', 'level', 'enrollmentDate', 'daysSinceUpdate'];
  }
}

export function drillHeaderForTarget(
  target: RecordsDrillTarget,
  segment: string | null,
): { eyebrow: string; title: string } {
  switch (target) {
    case 'enrollments-range': return { eyebrow: 'Drill · Enrollments', title: 'Enrolled in range' };
    case 'withdrawals-range': return { eyebrow: 'Drill · Withdrawals', title: 'Withdrawn in range' };
    case 'active-enrolled': return { eyebrow: 'Drill · Active', title: 'Currently enrolled' };
    case 'expiring-docs': return { eyebrow: 'Drill · Expiring', title: 'Documents expiring soon' };
    case 'students-by-pipeline-stage':
      return { eyebrow: 'Drill · Stage', title: segment ? `Stage: ${segment}` : 'By pipeline stage' };
    case 'students-by-level':
      return { eyebrow: 'Drill · Level', title: segment ? `Level: ${segment}` : 'By level' };
    case 'backlog-by-document':
      return { eyebrow: 'Drill · Document backlog', title: segment ? `Backlog: ${segment}` : 'Document backlog' };
    case 'class-assignment-readiness':
      return { eyebrow: 'Drill · Class assignment', title: 'Active without section' };
  }
}
