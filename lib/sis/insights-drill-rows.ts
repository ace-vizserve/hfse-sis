import 'server-only';

import { unstable_cache } from 'next/cache';

import {
  canonicaliseNationality,
  computeNationalityByLevel,
} from '@/lib/admissions/insights-funnel';
import {
  buildRecordsDrillRows,
  type RecordsDrillRow,
  type RecordsDrillTarget,
} from '@/lib/sis/drill';
import {
  controllabilityOf,
  enrolledCategoryBucket,
  levelLabelOf,
  movementLevelOf,
  withdrawalReasonLabelOf,
} from '@/lib/sis/insights-shared';
import { getMovementEvents, type MovementEvent } from '@/lib/sis/movements';
import {
  computeEnrolledNationalityMix,
  enrolledStudentDataFrom,
  fetchEnroleeValueMap,
  fetchOnRollRows,
  loadEnrolledStudentData,
  nationalityByLevelInputs,
  resolveAyId,
  retentionCohortFrom,
  sectionOf,
  type OnRollRow,
} from '@/lib/sis/records-insights';
import { createServiceClient } from '@/lib/supabase/service';

// Row builders for the Records Insights drills (KD #229). Each one reads the
// SAME population through the SAME function its Insights loader counts with,
// so a list's row count is the number on the card (KD #82/#124). The pure
// `…From` functions carry the logic and are what the parity tests pin; the
// cached loaders at the bottom only fetch.

const CACHE_TTL_SECONDS = 60;

function drillTags(...ayCodes: string[]): string[] {
  return [
    'records-drill',
    ...ayCodes.flatMap((ay) => [`records-drill:${ay}`, `sis:${ay}`]),
  ];
}

type StudentEmbed = {
  student_number: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
};

export type OnRollDrillSourceRow = OnRollRow & {
  id: string;
  enrolee_number: string | null;
  enrollment_status: string;
  enrollment_date: string | null;
  student: StudentEmbed | StudentEmbed[] | null;
};

/** The on-roll predicate's rows, with what a drill row needs to show them. */
export const ON_ROLL_DRILL_SELECT =
  'id, enrolee_number, enrollment_status, enrollment_date, student:students(student_number, first_name, middle_name, last_name), section:sections!inner(id, name, academic_year_id, levels!inner(label, code))';

function studentOf(r: OnRollDrillSourceRow): StudentEmbed | null {
  return Array.isArray(r.student) ? (r.student[0] ?? null) : r.student;
}

function nameOf(s: StudentEmbed | null, fallback: string): string {
  const name = [s?.first_name, s?.middle_name, s?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || s?.student_number || fallback;
}

function blankRow(): Omit<
  RecordsDrillRow,
  'enroleeNumber' | 'studentNumber' | 'fullName' | 'enrollmentStatus' | 'level'
> {
  return {
    applicationStatus: '',
    sectionId: null,
    sectionName: null,
    pipelineStage: '',
    applicationDate: null,
    enrollmentDate: null,
    withdrawalDate: null,
    daysSinceUpdate: null,
    hasMissingDocs: false,
    expiringDocsCount: 0,
    documentsComplete: 0,
    documentsTotal: 0,
  };
}

function onRollBase(r: OnRollDrillSourceRow): RecordsDrillRow | null {
  const sec = sectionOf(r);
  if (!sec) return null; // the headcount skips it too
  const s = studentOf(r);
  return {
    ...blankRow(),
    enroleeNumber: r.enrolee_number?.trim() || s?.student_number || r.id,
    studentNumber: s?.student_number ?? null,
    fullName: nameOf(s, r.id),
    enrollmentStatus: r.enrollment_status,
    level: levelLabelOf(sec.levels),
    // sectionId is always set here: a null sectionId routes the name link to
    // the unsynced queue (KD #81), which these students are not in.
    sectionId: sec.id ?? r.id,
    sectionName: sec.name ?? null,
    pipelineStage:
      r.enrollment_status === 'graduated' ? 'Graduated' : 'Enrolled',
    enrollmentDate: r.enrollment_date,
  };
}

/** The named slices of a folded mix — everything that is not 'Other'/'Unspecified'. */
function namedNationalities(names: string[]): Set<string> {
  return new Set(names.filter((n) => n !== 'Other' && n !== 'Unspecified'));
}

function nationalityBucket(canon: string | null, named: Set<string>): string {
  if (!canon) return 'Unspecified';
  return named.has(canon) ? canon : 'Other';
}

/**
 * Enrolled headcount / category / nationality rows. The two nationality
 * buckets come from running the loaders' own folding functions over the same
 * inputs, so 'Other' opens exactly the rows the chart folded (Review Focus #3).
 */
export function onRollDrillRowsFrom(
  rows: OnRollDrillSourceRow[],
  categoryByEnroleeNumber: Map<string, string>,
  nationalityByEnroleeNumber: Map<string, string>
): RecordsDrillRow[] {
  const mixNamed = namedNationalities(
    computeEnrolledNationalityMix(
      rows.map((r) => ({ enroleeNumber: r.enrolee_number })),
      nationalityByEnroleeNumber
    ).map((m) => m.nationality)
  );
  const levelNamed = namedNationalities(
    computeNationalityByLevel(
      nationalityByLevelInputs(rows, nationalityByEnroleeNumber)
    ).legend
  );

  const out: RecordsDrillRow[] = [];
  for (const r of rows) {
    const base = onRollBase(r);
    if (!base) continue;
    const en = r.enrolee_number?.trim();
    const canon = canonicaliseNationality(
      (en && nationalityByEnroleeNumber.get(en)) || null
    );
    out.push({
      ...base,
      category: enrolledCategoryBucket(
        r.enrolee_number,
        categoryByEnroleeNumber
      ),
      nationality: canon,
      nationalityMixBucket: nationalityBucket(canon, mixNamed),
      nationalityLevelBucket: nationalityBucket(canon, levelNamed),
    });
  }
  return out;
}

/**
 * The retention cohort as rows: the comparison year's students (one per
 * student number, S4 dropped), each with whether they are on roll now.
 */
export function retentionDrillRowsFrom(
  priorRows: OnRollDrillSourceRow[],
  currentNumbers: ReadonlySet<string>
): RecordsDrillRow[] {
  const data = enrolledStudentDataFrom(priorRows);
  const firstRowBySn = new Map<string, OnRollDrillSourceRow>();
  for (const r of priorRows) {
    const sn = studentOf(r)?.student_number;
    if (sn && !firstRowBySn.has(sn)) firstRowBySn.set(sn, r);
  }
  const out: RecordsDrillRow[] = [];
  for (const m of retentionCohortFrom(data, currentNumbers)) {
    const r = firstRowBySn.get(m.studentNumber);
    const base = r ? onRollBase(r) : null;
    out.push({
      ...(base ?? {
        ...blankRow(),
        enroleeNumber: m.studentNumber,
        studentNumber: m.studentNumber,
        fullName: m.studentNumber,
        enrollmentStatus: '',
        level: 'Unknown',
      }),
      studentNumber: m.studentNumber,
      level: m.level ?? 'Unknown',
      returned: m.returned,
    });
  }
  return out;
}

/**
 * One row per movement event (transfers excluded — they move nobody). Level,
 * reason, term and date are the EVENT's, as the rollup counts them; section
 * and status come from the student's class row this year when there is one
 * (a live row preferred over a withdrawn one).
 */
export function movementDrillRowsFrom(
  events: MovementEvent[],
  roster: RecordsDrillRow[]
): RecordsDrillRow[] {
  const rosterBySn = new Map<string, RecordsDrillRow>();
  for (const r of roster) {
    if (!r.studentNumber) continue;
    const prev = rosterBySn.get(r.studentNumber);
    if (
      !prev ||
      (prev.enrollmentStatus === 'withdrawn' &&
        r.enrollmentStatus !== 'withdrawn')
    ) {
      rosterBySn.set(r.studentNumber, r);
    }
  }
  const out: RecordsDrillRow[] = [];
  for (const e of events) {
    if (e.kind === 'section-transfer') continue;
    const ros = e.studentNumber ? rosterBySn.get(e.studentNumber) : undefined;
    const withdrawn = e.kind === 'withdrawn';
    out.push({
      ...blankRow(),
      enroleeNumber: e.enroleeNumber || e.studentNumber || e.id,
      studentNumber: e.studentNumber,
      fullName: e.studentName,
      enrollmentStatus: ros?.enrollmentStatus ?? '',
      applicationStatus: ros?.applicationStatus ?? '',
      level: movementLevelOf(e),
      sectionId: ros?.sectionId ?? null,
      sectionName: ros?.sectionName ?? null,
      pipelineStage: ros?.pipelineStage ?? '',
      enrollmentDate: ros?.enrollmentDate ?? null,
      withdrawalDate: withdrawn ? e.date : (ros?.withdrawalDate ?? null),
      movementKind: e.kind,
      movementDate: e.date,
      joinedTerm:
        e.kind === 'late-enrolled' && typeof e.termNumber === 'number'
          ? e.termNumber
          : null,
      // F2: `e.kind === 'withdrawn'` is tested INLINE here (not through the
      // `withdrawn` boolean above) — only that narrows the MovementEvent
      // union so `e.reason` and `e.reasonLabel` (via withdrawalReasonLabelOf)
      // are legal to read.
      withdrawalReason:
        e.kind === 'withdrawn' ? withdrawalReasonLabelOf(e) : null,
      controllable: e.kind === 'withdrawn' ? controllabilityOf(e.reason) : null,
    });
  }
  return out;
}

// ── Cached loaders (fetch only) ─────────────────────────────────────────────

async function loadOnRollDrillRowsUncached(
  ayCode: string
): Promise<RecordsDrillRow[]> {
  const service = createServiceClient();
  const ayId = await resolveAyId(service, ayCode);
  if (!ayId) return [];
  const [rows, categoryMap, nationalityMap] = await Promise.all([
    fetchOnRollRows<OnRollDrillSourceRow>(service, ayId, ON_ROLL_DRILL_SELECT),
    fetchEnroleeValueMap(service, ayCode, 'category'),
    fetchEnroleeValueMap(service, ayCode, 'nationality'),
  ]);
  return onRollDrillRowsFrom(rows, categoryMap, nationalityMap);
}

async function loadRetentionDrillRowsUncached(
  currentAy: string,
  priorAy: string
): Promise<RecordsDrillRow[]> {
  const service = createServiceClient();
  const priorAyId = await resolveAyId(service, priorAy);
  if (!priorAyId) return [];
  const [priorRows, current] = await Promise.all([
    fetchOnRollRows<OnRollDrillSourceRow>(
      service,
      priorAyId,
      ON_ROLL_DRILL_SELECT
    ),
    loadEnrolledStudentData(currentAy),
  ]);
  return retentionDrillRowsFrom(priorRows, current.studentNumbers);
}

async function loadMovementDrillRowsUncached(
  ayCode: string
): Promise<RecordsDrillRow[]> {
  const [events, roster] = await Promise.all([
    getMovementEvents(ayCode),
    buildRecordsDrillRows({ ayCode }),
  ]);
  return movementDrillRowsFrom(events, roster);
}

/**
 * The row set behind an Insights target, before its segment is applied
 * (`applyTargetFilter` does that). `compareAy` is required for 'retention'
 * (the cohort is that year's students); every other target ignores it.
 */
export async function buildInsightsDrillRows(
  target: RecordsDrillTarget,
  ayCode: string,
  compareAy: string | null
): Promise<RecordsDrillRow[]> {
  switch (target) {
    case 'enrolled-headcount':
    case 'category':
    case 'nationality':
      return unstable_cache(
        () => loadOnRollDrillRowsUncached(ayCode),
        ['records-drill', 'insights-on-roll', ayCode],
        { revalidate: CACHE_TTL_SECONDS, tags: drillTags(ayCode) }
      )();
    case 'retention':
      if (!compareAy) return [];
      return unstable_cache(
        () => loadRetentionDrillRowsUncached(ayCode, compareAy),
        ['records-drill', 'insights-retention', ayCode, compareAy],
        { revalidate: CACHE_TTL_SECONDS, tags: drillTags(ayCode, compareAy) }
      )();
    case 'late-enrollees':
    case 'withdrawals':
    case 'movement-month':
      return unstable_cache(
        () => loadMovementDrillRowsUncached(ayCode),
        ['records-drill', 'insights-movement', ayCode],
        { revalidate: CACHE_TTL_SECONDS, tags: drillTags(ayCode) }
      )();
    default:
      return [];
  }
}
