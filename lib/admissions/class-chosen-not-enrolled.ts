import { unstable_cache } from 'next/cache';

import {
  PREREQ_STATUS_COLUMNS,
  compareClassChosenRows,
  describeEnrolmentReadiness,
  isClassChosenAwaitingEnrolment,
  type ClassChosenRow,
} from '@/lib/admissions/class-chosen';
import { listUnsyncedScopeAyCodes } from '@/lib/sis/unsynced-students';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { fetchAllPages, fetchInChunks } from '@/lib/supabase/paginate';

// ──────────────────────────────────────────────────────────────────────────
// Loader for /admissions/cohorts/class-chosen — children whose class has been
// chosen but whose application is not Enrolled yet. Who belongs on the list
// and what they still need is decided in ./class-chosen.ts (pure, tested);
// this file only reads.
//
// Three reads per AY, whatever the size of the year:
//   1. status rows naming a class (paged — the table grows with the year),
//   2. the identity columns of just those rows (chunked `.in`),
//   3. which of their student numbers already sit on a class list THIS AY
//      (chunked `.in`, joined to the year). A child already in a class is not
//      waiting for one — that is the in-class-but-Submitted legacy group
//      (CLAUDE.md, 2026-09-28 plan) — so they are left off. Same shape as
//      `loadChosenClassRows` in lib/sis/class-assignment.ts, which answers the
//      neighbouring question (which of these rows hold a seat).
//
// Cached per AY under `sis:${ayCode}`, which every admissions stage write and
// the assign-section route already invalidate.
// ──────────────────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

type StatusRow = {
  enroleeNumber: string;
  classLevel: string | null;
  classSection: string | null;
  applicationStatus: string | null;
  classUpdatedDate: string | null;
  classUpdatedBy: string | null;
} & Record<string, unknown>;

type AppsRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  enroleeFullName: string | null;
  levelApplied: string | null;
};

type RosterRow = {
  student: { student_number: string } | { student_number: string }[] | null;
};

function rosterStudentNumber(row: RosterRow): string | null {
  const s = Array.isArray(row.student) ? row.student[0] : row.student;
  return s?.student_number?.trim() || null;
}

/** Uncached per-AY read. Exported for read-only probes; pages use the cached
 *  wrapper below. */
export async function loadClassChosenNotEnrolledUncached(
  ayCode: string
): Promise<ClassChosenRow[]> {
  const prefix = prefixFor(ayCode);
  const client = createAdmissionsClient();

  const statusRows = await fetchAllPages<StatusRow>(
    (from, to) =>
      client
        .from(`${prefix}_enrolment_status`)
        .select(
          [
            'enroleeNumber',
            'classLevel',
            'classSection',
            'applicationStatus',
            'classUpdatedDate',
            // The real column is lower-case b (see STAGE_COLUMN_MAP.class).
            'classUpdatedBy:classUpdatedby',
            ...PREREQ_STATUS_COLUMNS,
          ].join(', ')
        )
        .not('classSection', 'is', null)
        .range(from, to) as unknown as PromiseLike<{
        data: StatusRow[] | null;
        error: { message: string } | null;
      }>,
    1000,
    { tieBreak: 'enroleeNumber' }
  );

  const waiting = statusRows.filter(
    (r) => !!r.enroleeNumber && isClassChosenAwaitingEnrolment(r)
  );
  if (waiting.length === 0) return [];

  const apps = await fetchInChunks(
    waiting.map((r) => r.enroleeNumber),
    async (slice) => {
      const { data, error } = await client
        .from(`${prefix}_enrolment_applications`)
        .select(
          'enroleeNumber, studentNumber, firstName, lastName, enroleeFullName, levelApplied'
        )
        .in('enroleeNumber', slice);
      if (error) throw new Error(error.message);
      return (data ?? []) as AppsRow[];
    }
  );
  const appByEnrolee = new Map(apps.map((a) => [a.enroleeNumber, a]));

  // Trimmed on both sides — at least one roster student number carries a
  // trailing space (see lib/sis/class-assignment.ts).
  const numbers = Array.from(
    new Set(
      apps.map((a) => a.studentNumber?.trim()).filter((n): n is string => !!n)
    )
  );
  const placedRows =
    numbers.length === 0
      ? []
      : await fetchInChunks(numbers, async (slice) => {
          const { data, error } = await client
            .from('section_students')
            .select(
              'student:students!inner(student_number), section:sections!inner(academic_years!inner(ay_code))'
            )
            .in('student.student_number', slice)
            .eq('section.academic_years.ay_code', ayCode);
          if (error) throw new Error(error.message);
          return (data ?? []) as unknown as RosterRow[];
        });
  const placedThisAy = new Set(
    placedRows.map(rosterStudentNumber).filter((n): n is string => !!n)
  );

  const out: ClassChosenRow[] = [];
  for (const status of waiting) {
    const app = appByEnrolee.get(status.enroleeNumber);
    const studentNumber = app?.studentNumber?.trim() || null;
    if (studentNumber && placedThisAy.has(studentNumber)) continue;

    const readiness = describeEnrolmentReadiness(status);
    const fullName =
      app?.enroleeFullName?.trim() ||
      [app?.firstName, app?.lastName].filter(Boolean).join(' ').trim() ||
      status.enroleeNumber;

    out.push({
      ayCode,
      enroleeNumber: status.enroleeNumber,
      studentNumber,
      fullName,
      levelApplied: app?.levelApplied ?? null,
      classLevel: status.classLevel?.trim() || null,
      classSection: (status.classSection ?? '').trim(),
      applicationStatus: status.applicationStatus?.trim() || null,
      ready: readiness.ready,
      outstanding: readiness.outstanding,
      classChosenAt: status.classUpdatedDate || null,
      classChosenBy: status.classUpdatedBy?.trim() || null,
    });
  }

  return out.sort(compareClassChosenRows);
}

export async function loadClassChosenNotEnrolled(
  ayCode: string
): Promise<ClassChosenRow[]> {
  return unstable_cache(
    () => loadClassChosenNotEnrolledUncached(ayCode),
    ['admissions-class-chosen-not-enrolled', ayCode],
    { tags: [`sis:${ayCode}`], revalidate: CACHE_TTL_SECONDS }
  )();
}

/**
 * Every child waiting, across the current AY and the upcoming AY taking
 * applications — the same window as the Records "students needing setup"
 * queue (`listUnsyncedScopeAyCodes`), so the two lists agree on what "now"
 * means. Rows carry their own `ayCode`; the combined list keeps the per-row
 * order (ready first, then longest waiting) across both years.
 */
export async function loadClassChosenInScope(): Promise<{
  ayCodes: string[];
  rows: ClassChosenRow[];
}> {
  const ayCodes = await listUnsyncedScopeAyCodes();
  if (ayCodes.length === 0) return { ayCodes, rows: [] };
  const perAy = await Promise.all(ayCodes.map(loadClassChosenNotEnrolled));
  return { ayCodes, rows: perAy.flat().sort(compareClassChosenRows) };
}
