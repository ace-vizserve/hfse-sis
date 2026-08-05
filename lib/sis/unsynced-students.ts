import { unstable_cache } from 'next/cache';

import {
  getCurrentAcademicYear,
  getUpcomingAcademicYear,
} from '@/lib/academic-year';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

// ──────────────────────────────────────────────────────────────────────────
// Unsynced enrolled students — admissions rows that say a student is
// Enrolled / Enrolled (Conditional) but never made it into the grading
// schema (`public.students`). `lib/sync/students.ts::syncOneStudent` gates
// on BOTH a non-null `studentNumber` (apps-side) AND a non-null
// `classSection` (status-side) at lines 355–361; whenever either is
// missing the per-row sync silently skips and the student is stranded
// outside grading — they can't be picked in section rosters, their grades
// don't get sheets, attendance can't be encoded.
//
// This loader fans out across the two AY-prefixed admissions tables +
// one SELECT against `public.students` to identify the gap, classifying
// each missing row by its root cause so the UI can route to the right
// remediation:
//
//   no_student_number  — apps row has no studentNumber. Sync can't run.
//                        Needs a fresh pull from Directus.
//   no_class_section   — apps row has a studentNumber but status row's
//                        classSection is NULL. Assign-section dialog
//                        unblocks this (writes classSection then
//                        re-runs syncOneStudent).
//   not_synced         — apps + status both look valid (studentNumber
//                        set, classSection set) but the student row is
//                        still missing. Most likely a transient sync
//                        failure; bulk-sync should pick it up.
//
// Cached per-AY with the existing `sis:${ayCode}` tag — already
// invalidated by every admissions mutation, so this loader stays in
// lockstep with Records + cohorts surfaces without needing its own tag.
// ──────────────────────────────────────────────────────────────────────────

export type UnsyncedGapReason =
  | 'no_student_number'
  | 'no_class_section'
  | 'not_synced';

export type UnsyncedStudentRow = {
  /** Which academic year this student is enrolled into. Carried per row
   *  because the queue spans more than one — see `loadUnsyncedInScope`. */
  ayCode: string;
  enroleeNumber: string;
  studentNumber: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  enroleeFullName: string | null;
  levelApplied: string | null;
  classLevel: string | null;
  classSection: string | null;
  applicationStatus: string;
  gapReason: UnsyncedGapReason;
};

const ENROLLED_STATUSES = ['Enrolled', 'Enrolled (Conditional)'] as const;
const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

async function loadUnsyncedUncached(
  ayCode: string
): Promise<UnsyncedStudentRow[]> {
  const prefix = prefixFor(ayCode);
  const admissions = createAdmissionsClient();
  const service = createServiceClient();

  const [appsRes, statusRes] = await Promise.all([
    admissions
      .from(`${prefix}_enrolment_applications`)
      .select(
        'enroleeNumber, studentNumber, firstName, middleName, lastName, enroleeFullName, levelApplied'
      ),
    admissions
      .from(`${prefix}_enrolment_status`)
      .select('enroleeNumber, classLevel, classSection, applicationStatus')
      .in('applicationStatus', [...ENROLLED_STATUSES]),
  ]);

  if (appsRes.error) {
    console.warn(
      '[sis/unsynced-students] apps fetch failed:',
      appsRes.error.message
    );
    return [];
  }
  if (statusRes.error) {
    console.warn(
      '[sis/unsynced-students] status fetch failed:',
      statusRes.error.message
    );
    return [];
  }

  type AppsRow = {
    enroleeNumber: string | null;
    studentNumber: string | null;
    firstName: string | null;
    middleName: string | null;
    lastName: string | null;
    enroleeFullName: string | null;
    levelApplied: string | null;
  };
  type StatusRow = {
    enroleeNumber: string | null;
    classLevel: string | null;
    classSection: string | null;
    applicationStatus: string | null;
  };

  const appsRows = ((appsRes.data ?? []) as AppsRow[]).filter(
    (r) => !!r.enroleeNumber
  );
  const statusRows = ((statusRes.data ?? []) as StatusRow[]).filter(
    (r) => !!r.enroleeNumber
  );

  const appsByEnrolee = new Map<string, AppsRow>();
  for (const r of appsRows) {
    if (r.enroleeNumber) appsByEnrolee.set(r.enroleeNumber, r);
  }

  // Collect all candidate studentNumbers so we can check sync state with
  // a single round-trip against public.students (rather than per-row).
  const studentNumbersToCheck: string[] = [];
  for (const s of statusRows) {
    const app = appsByEnrolee.get(s.enroleeNumber!);
    if (app?.studentNumber) studentNumbersToCheck.push(app.studentNumber);
  }
  const syncedSet = new Set<string>();
  if (studentNumbersToCheck.length > 0) {
    const { data: syncedRows, error: syncedErr } = await service
      .from('students')
      .select('student_number')
      .in('student_number', studentNumbersToCheck);
    if (syncedErr) {
      console.warn(
        '[sis/unsynced-students] students table check failed:',
        syncedErr.message
      );
      // Fail soft — without the sync set we'd wrongly mark everyone as
      // unsynced. Returning [] is safer than a flood of false positives.
      return [];
    }
    for (const row of (syncedRows ?? []) as Array<{
      student_number: string | null;
    }>) {
      if (row.student_number) syncedSet.add(row.student_number);
    }
  }

  const out: UnsyncedStudentRow[] = [];
  for (const status of statusRows) {
    const enroleeNumber = status.enroleeNumber!;
    const app = appsByEnrolee.get(enroleeNumber);
    if (!app) continue; // status without an apps row — corrupt; skip

    const base = {
      ayCode,
      enroleeNumber,
      studentNumber: app.studentNumber ?? null,
      firstName: app.firstName ?? null,
      middleName: app.middleName ?? null,
      lastName: app.lastName ?? null,
      enroleeFullName: app.enroleeFullName ?? null,
      levelApplied: app.levelApplied ?? null,
      classLevel: status.classLevel ?? null,
      classSection: status.classSection ?? null,
      applicationStatus: status.applicationStatus ?? '',
    };

    // 1. Apps-side has no studentNumber — Directus hasn't issued one yet.
    if (!app.studentNumber) {
      out.push({ ...base, gapReason: 'no_student_number' });
      continue;
    }

    // 2. Already synced into grading schema — not a gap.
    if (syncedSet.has(app.studentNumber)) continue;

    // 3. Not in grading schema. If classSection is missing the registrar
    //    can pick one via the assign-section dialog; otherwise it's an
    //    ordinary "needs a bulk sync" case.
    const hasClassSection =
      typeof status.classSection === 'string' &&
      status.classSection.trim().length > 0;
    out.push({
      ...base,
      gapReason: hasClassSection ? 'not_synced' : 'no_class_section',
    });
  }

  // Stable ordering — group by gap reason (most-actionable first), then
  // by full name so the table renders deterministically across reloads.
  const reasonRank: Record<UnsyncedGapReason, number> = {
    no_class_section: 0,
    not_synced: 1,
    no_student_number: 2,
  };
  out.sort((a, b) => {
    const rd = reasonRank[a.gapReason] - reasonRank[b.gapReason];
    if (rd !== 0) return rd;
    return (a.enroleeFullName ?? '').localeCompare(b.enroleeFullName ?? '');
  });

  return out;
}

export async function loadUnsyncedEnrolledStudents(
  ayCode: string
): Promise<UnsyncedStudentRow[]> {
  return unstable_cache(
    () => loadUnsyncedUncached(ayCode),
    ['sis-unsynced-students', ayCode],
    { tags: [`sis:${ayCode}`], revalidate: CACHE_TTL_SECONDS }
  )();
}

export async function countUnsyncedEnrolledStudents(
  ayCode: string
): Promise<number> {
  const rows = await loadUnsyncedEnrolledStudents(ayCode);
  return rows.length;
}

/**
 * Every student waiting for setup, in EVERY academic year that can currently
 * have one — the current AY plus the upcoming accepting AY.
 *
 * The per-AY loader above answers "what's outstanding in this year", which is
 * what a page showing one selected year wants. This answers "what's
 * outstanding, full stop", which is what an operational queue wants — because
 * admissions run a year ahead during the early-bird window (KD #118), so
 * asking a registrar to know which year to go looking in is asking them to
 * find work they don't know exists. Same in-scope window as
 * `lib/sis/level-review.ts` and `lib/sis/levels-awaiting-sections.ts`, so all
 * three Records queues agree on what "now" means.
 *
 * Rows carry their own `ayCode`; sorted by AY first so a year's worth of work
 * reads together.
 */
export async function loadUnsyncedInScope(): Promise<UnsyncedStudentRow[]> {
  const [current, upcoming] = await Promise.all([
    getCurrentAcademicYear(),
    getUpcomingAcademicYear(),
  ]);

  const ayCodes = Array.from(
    new Set(
      [current?.ay_code, upcoming?.ay_code].filter((c): c is string => !!c)
    )
  );
  if (ayCodes.length === 0) return [];

  const perAy = await Promise.all(ayCodes.map(loadUnsyncedEnrolledStudents));
  return perAy.flat().sort((a, b) => {
    const byAy = a.ayCode.localeCompare(b.ayCode);
    if (byAy !== 0) return byAy;
    // Preserve the per-AY ordering the loader already applied (gap reason,
    // then name) by leaving same-AY rows alone.
    return 0;
  });
}

export async function countUnsyncedInScope(): Promise<number> {
  const rows = await loadUnsyncedInScope();
  return rows.length;
}
