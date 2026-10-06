import { unstable_cache } from 'next/cache';

import {
  getCurrentAcademicYear,
  getUpcomingAcademicYear,
} from '@/lib/academic-year';
import {
  describePlacementBlocker,
  type PlacementLookup,
} from '@/lib/sis/placement-blocker';
import { loadLevelLabelResolver, resolveChildLevel } from '@/lib/sis/levels';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { fetchAllPages } from '@/lib/supabase/paginate';
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
//                        failure; bulk-sync should pick it up — UNLESS the
//                        class was filled in outside the SIS (Directus, the
//                        old enrolment link) as something the SIS cannot
//                        place. Those rows carry a plain-English `blocker`,
//                        because the nightly sync fails on them every night.
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
  /** The parent-facing level name on the application, exactly as entered.
   *  Keys the section-options map (the picker resolves it itself). */
  levelApplied: string | null;
  /** The SIS level the child counts as — `classLevel` once set, else
   *  `levelApplied` resolved through `level_aliases`. The queue's Level
   *  column, facet and sort read this one. */
  level: string | null;
  /** What the parent picked on the form — feeds the section picker's
   *  "Matches their application" hint. Null when blank or unreadable. */
  classType: string | null;
  preferredSchedule: string | null;
  classLevel: string | null;
  classSection: string | null;
  applicationStatus: string;
  gapReason: UnsyncedGapReason;
  /** `not_synced` only: why the class filled in on the admissions row (by
   *  Directus or the old enrolment link) cannot be placed — a level the SIS
   *  does not have, or a class that does not exist for this year. Plain
   *  English, shown on the queue as-is. Null when nothing is known to be in
   *  the way (the sync should succeed), and always null for the other gap
   *  reasons. See `lib/sis/placement-blocker.ts`. */
  blocker: string | null;
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

  const [
    appsRes,
    statusRes,
    prefsRes,
    levelsRes,
    sectionsRes,
    resolveLevel,
    aliasRes,
  ] = await Promise.all([
    admissions
      .from(`${prefix}_enrolment_applications`)
      .select(
        'enroleeNumber, studentNumber, firstName, middleName, lastName, enroleeFullName, levelApplied'
      ),
    admissions
      .from(`${prefix}_enrolment_status`)
      .select('enroleeNumber, classLevel, classSection, applicationStatus')
      .in('applicationStatus', [...ENROLLED_STATUSES]),
    // Read apart from the main select, and allowed to fail: `classType` was
    // added to the portal later than the identity columns (see
    // MINIMAL_APP_COLUMNS in lib/sis/queries.ts), and a missing column must
    // cost only the section picker's hint, never the queue.
    admissions
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, classType, preferredSchedule'),
    // The SIS's levels and this year's classes, read ONCE and used twice: the
    // section ids scope the "already has a class" check below, and level +
    // name let `describePlacementBlocker` say why a `not_synced` row's class
    // cannot be placed. Same selects the sync itself runs.
    service.from('levels').select('id, label'),
    service
      .from('sections')
      .select('id, level_id, name, academic_year:academic_years!inner(ay_code)')
      .eq('academic_year.ay_code', ayCode),
    loadLevelLabelResolver(service),
    service.from('level_aliases').select('raw_label, level_id'),
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

  const prefsByEnrolee = new Map<
    string,
    { classType: string | null; preferredSchedule: string | null }
  >();
  if (prefsRes.error) {
    console.warn(
      '[sis/unsynced-students] class type / schedule fetch failed (section hint off):',
      prefsRes.error.message
    );
  } else {
    for (const r of (prefsRes.data ?? []) as Array<{
      enroleeNumber: string | null;
      classType: unknown;
      preferredSchedule: unknown;
    }>) {
      if (!r.enroleeNumber) continue;
      prefsByEnrolee.set(r.enroleeNumber, {
        classType: typeof r.classType === 'string' ? r.classType : null,
        preferredSchedule:
          typeof r.preferredSchedule === 'string' ? r.preferredSchedule : null,
      });
    }
  }

  // Collect all candidate studentNumbers so we can check sync state with
  // a single round-trip against public.students (rather than per-row).
  const studentNumbersToCheck: string[] = [];
  for (const s of statusRows) {
    const app = appsByEnrolee.get(s.enroleeNumber!);
    if (app?.studentNumber) studentNumbersToCheck.push(app.studentNumber);
  }
  // What counts as "in the grading schema" is an ENROLMENT in this year, not a
  // row in `public.students`.
  //
  // Those are different things, and reading the wrong one hid a student
  // completely on 2026-08-13. `syncOneStudent` writes the person row first and
  // the roster row second; when the roster insert failed on a duplicate
  // index_number, the person row stayed behind. The assign-section route rolls
  // back its admissions columns but not that insert, so the student ended up
  // with a `students` row, no class, and — because this check only asked
  // whether the person existed — no place in the queue whose entire purpose is
  // to list students with no class. The one screen that could have fixed them
  // is the one that stopped showing them.
  //
  // ANY enrolment counts, withdrawn included. A student withdrawn through
  // Records keeps `applicationStatus = 'Enrolled'` (KD #147), so testing for a
  // live enrolment would drag every withdrawn student back into this queue as
  // though they had never been given a class.
  const syncedSet = new Set<string>();
  if (studentNumbersToCheck.length > 0) {
    const { data: personRows, error: personErr } = await service
      .from('students')
      .select('id, student_number')
      .in('student_number', studentNumbersToCheck);
    if (personErr) {
      console.warn(
        '[sis/unsynced-students] students table check failed:',
        personErr.message
      );
      // Fail soft — without the sync set we'd wrongly mark everyone as
      // unsynced. Returning [] is safer than a flood of false positives.
      return [];
    }
    const people = (personRows ?? []) as Array<{
      id: string;
      student_number: string | null;
    }>;
    const numberById = new Map(people.map((p) => [p.id, p.student_number]));

    if (people.length > 0) {
      const { data: sectionRows, error: sectionErr } = sectionsRes;
      if (sectionErr) {
        // Deliberately NOT fail-soft. An empty section list would mark every
        // enrolled student as needing setup, which is a flood; an empty
        // ENROLMENT list marks none of them, which reads as "nothing to do"
        // and is the failure this whole comment is about.
        throw new Error(
          `[sis/unsynced-students] sections lookup failed: ${sectionErr.message}`
        );
      }
      const sectionIds = (sectionRows ?? []).map((s) => s.id as string);

      if (sectionIds.length > 0) {
        // Filtered by SECTION only — 21 ids — and intersected with our
        // candidates in memory. Naming the students instead would put ~400
        // UUIDs in a query string; PostgREST reads these as a GET, and the URL
        // simply fails to send.
        //
        // Paged: one row per student per section per year, so it grows with the
        // school, and a short read here would put already-placed students back
        // in the queue.
        const enrolments = await fetchAllPages<{ student_id: string }>(
          (from, to) =>
            service
              .from('section_students')
              .select('student_id')
              .in('section_id', sectionIds)
              .range(from, to)
        );
        for (const e of enrolments) {
          const number = numberById.get(e.student_id);
          if (number) syncedSet.add(number);
        }
      }
    }
  }

  // What the blocker check compares against. Null when either read failed:
  // an empty level or class list would make EVERY class look missing, and a
  // queue full of false "no such class" rows is worse than the old silence —
  // so on a failed read the rows simply carry no blocker, as before.
  let placementLookup: PlacementLookup | null = null;
  if (levelsRes.error || sectionsRes.error || aliasRes.error) {
    console.warn(
      '[sis/unsynced-students] levels / sections read failed (blockers off):',
      levelsRes.error?.message ??
        sectionsRes.error?.message ??
        aliasRes.error?.message
    );
  } else {
    placementLookup = {
      levels: (levelsRes.data ?? []) as Array<{ id: string; label: string }>,
      levelAliases: aliasRes.data ?? [],
      sections: (sectionsRes.data ?? []) as Array<{
        level_id: string;
        name: string;
      }>,
    };
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
      level: resolveChildLevel(
        resolveLevel,
        status.classLevel,
        app.levelApplied
      ),
      classType: prefsByEnrolee.get(enroleeNumber)?.classType ?? null,
      preferredSchedule:
        prefsByEnrolee.get(enroleeNumber)?.preferredSchedule ?? null,
      classLevel: status.classLevel ?? null,
      classSection: status.classSection ?? null,
      applicationStatus: status.applicationStatus ?? '',
    };

    // 1. Apps-side has no studentNumber — Directus hasn't issued one yet.
    if (!app.studentNumber) {
      out.push({ ...base, gapReason: 'no_student_number', blocker: null });
      continue;
    }

    // 2. Already synced into grading schema — not a gap.
    if (syncedSet.has(app.studentNumber)) continue;

    // 3. Not in grading schema. If classSection is missing the registrar
    //    can pick one via the assign-section dialog; otherwise it's an
    //    ordinary "needs a bulk sync" case — unless the class that was filled
    //    in cannot be placed at all, in which case the nightly sync will fail
    //    on it every night and the row has to say why.
    const hasClassSection =
      typeof status.classSection === 'string' &&
      status.classSection.trim().length > 0;
    if (!hasClassSection) {
      out.push({ ...base, gapReason: 'no_class_section', blocker: null });
      continue;
    }
    out.push({
      ...base,
      gapReason: 'not_synced',
      blocker: placementLookup
        ? describePlacementBlocker(base, placementLookup)
        : null,
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
    // v2: rows gained the resolved `level`.
    ['sis-unsynced-students', 'v2', ayCode],
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
 * The academic years the queue covers: the current AY plus the upcoming
 * accepting AY, oldest first, never duplicated. Exported so the nightly
 * auto-sync walks exactly the years the queue shows — a year the queue lists
 * but the sync skips is a year whose children wait forever (the sync ran for
 * the current AY only until 2026-09-28, while admissions were already placing
 * AY2027 children).
 */
export async function listUnsyncedScopeAyCodes(): Promise<string[]> {
  const [current, upcoming] = await Promise.all([
    getCurrentAcademicYear(),
    getUpcomingAcademicYear(),
  ]);
  return Array.from(
    new Set(
      [current?.ay_code, upcoming?.ay_code].filter((c): c is string => !!c)
    )
  ).sort();
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
  const ayCodes = await listUnsyncedScopeAyCodes();
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
