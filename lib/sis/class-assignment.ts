import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveLevelId } from '@/lib/sis/levels';
import { ENROLLED_STATUSES } from '@/lib/schemas/enrolment';
import { APPLICATION_TERMINAL_STATUSES } from '@/lib/schemas/sis';
import { fetchAllPages, fetchInChunks } from '@/lib/supabase/paginate';
import { normalizeLevelLabel } from '@/lib/sync/level-normalizer';
import { normalizeSectionName } from '@/lib/sync/section-normalizer';

// Section-assignment support — level/section lookups shared by every place
// a section gets assigned to a student. Per
// docs/superpowers/specs/2026-07-20-manual-section-assignment-design.md,
// there is deliberately no auto-pick anywhere in the system: this module
// only surfaces state (which sections exist, how full each is); a
// registrar always makes the actual choice. Consolidates what used to be
// three independent implementations (this file's old auto-pick,
// records-lite-page.tsx's private loadAvailableSections, and three
// separate hardcoded copies of the 50-student cap).
//
// ⚠ A CHOSEN CLASS HOLDS A SEAT (2026-09-28,
// docs/superpowers/plans/2026-09-28-class-assignment-any-stage.md). A class
// can now be chosen before the application is Enrolled; the child only joins
// the roster at Enrolled. Between the two they are on nobody's roster, so a
// headcount of the roster alone would let a class be promised to 55 children
// and refuse the last five on enrolment day. Both the picker's numbers and the
// cap below therefore add `countChosenSeats` — ONE count, so the picker and
// the write path cannot disagree about what "full" means.

export const MAX_ACTIVE_PER_SECTION = 50;

export type AssignableSection = {
  id: string;
  name: string;
  /** On the class list now — active + late enrollees. */
  activeCount: number;
  /**
   * Children who chose this class (in the SIS, Directus or the old enrolment
   * link) but are not on its class list yet — usually because their
   * application is not Enrolled. They hold a seat. See `countChosenSeats`.
   */
  chosenCount: number;
  /** `activeCount + chosenCount >= 50` — the same test the write path applies. */
  isAtCapacity: boolean;
  /** `sections.class_type` — 'Global' / 'Standard', or null when never set. */
  classType: string | null;
  /** `sections.schedule` — 'morning' / 'afternoon' / 'whole_day', or null. */
  schedule: string | null;
};

export type AssignableLevel = {
  id: string;
  code: string;
  label: string;
  levelType: 'primary' | 'secondary';
};

/** One admissions status row that names a class, joined to its student number. */
export type ChosenClassRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  classLevel: string | null;
  classSection: string | null;
  applicationStatus: string | null;
};

function isTerminalApplicationStatus(status: string | null): boolean {
  return (APPLICATION_TERMINAL_STATUSES as readonly string[]).includes(
    (status ?? '').trim()
  );
}

/**
 * Seats held by a chosen class, per section — pure, so it is tested without a
 * database.
 *
 * A row holds a seat in a section when its class resolves to that section the
 * way the sync resolves it (`buildSyncPlan` in lib/sync/students.ts: the same
 * two normalizers, then an EXACT match on `levels.label` and section name), so
 * "Discipline-1" holds a seat in "Discipline 1" exactly when the sync would
 * put the child there, and "Year 8" holds none because the sync would place
 * them nowhere.
 *
 * Not counted:
 *  - Cancelled / Withdrawn applications — they are not coming.
 *  - A child already on that section's class list — the roster count has them.
 *  - `excludeEnroleeNumber` — the child being placed, whose own chosen seat
 *    must not stand between them and the class they chose.
 */
export function countChosenSeats(
  rows: readonly ChosenClassRow[],
  levelLabel: string,
  sections: ReadonlyArray<{ id: string; name: string }>,
  rosterStudentNumbersBySection: ReadonlyMap<string, ReadonlySet<string>>,
  excludeEnroleeNumber?: string | null
): Map<string, number> {
  const sectionIdByName = new Map(sections.map((s) => [s.name, s.id]));
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (excludeEnroleeNumber && row.enroleeNumber === excludeEnroleeNumber) {
      continue;
    }
    if (isTerminalApplicationStatus(row.applicationStatus)) continue;
    if (normalizeLevelLabel(row.classLevel) !== levelLabel) continue;
    const name = normalizeSectionName(row.classSection);
    if (!name) continue;
    const sectionId = sectionIdByName.get(name);
    if (!sectionId) continue;
    const number = row.studentNumber?.trim();
    if (number && rosterStudentNumbersBySection.get(sectionId)?.has(number)) {
      continue;
    }
    counts.set(sectionId, (counts.get(sectionId) ?? 0) + 1);
  }
  return counts;
}

function admissionsPrefix(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

/**
 * Every live admissions row of the AY whose chosen class sits at `levelLabel`.
 * Two reads, whatever the number of sections: the status rows naming a class
 * (filtered to the level here, in code, because the level is matched after
 * normalizing and a SQL filter would miss the legacy spellings), then the
 * student numbers of just those rows.
 *
 * The admissions tables live in the same Supabase project as the SIS
 * (`createAdmissionsClient` returns the service client), so the caller's
 * client reads them.
 */
async function loadChosenClassRows(
  client: SupabaseClient,
  ayCode: string,
  levelLabel: string
): Promise<{ rows: ChosenClassRow[] } | { error: string }> {
  const prefix = admissionsPrefix(ayCode);
  try {
    const statusRows = await fetchAllPages<{
      enroleeNumber: string;
      classLevel: string | null;
      classSection: string | null;
      applicationStatus: string | null;
    }>(
      (from, to) =>
        client
          .from(`${prefix}_enrolment_status`)
          .select('enroleeNumber, classLevel, classSection, applicationStatus')
          .not('classSection', 'is', null)
          .range(from, to),
      1000,
      { tieBreak: 'enroleeNumber' }
    );
    const atLevel = statusRows.filter(
      (r) =>
        !isTerminalApplicationStatus(r.applicationStatus) &&
        normalizeLevelLabel(r.classLevel) === levelLabel &&
        normalizeSectionName(r.classSection) !== null
    );
    if (atLevel.length === 0) return { rows: [] };

    const apps = await fetchInChunks(
      atLevel.map((r) => r.enroleeNumber),
      async (slice) => {
        const { data, error } = await client
          .from(`${prefix}_enrolment_applications`)
          .select('enroleeNumber, studentNumber')
          .in('enroleeNumber', slice);
        if (error) throw new Error(error.message);
        return (data ?? []) as Array<{
          enroleeNumber: string;
          studentNumber: string | null;
        }>;
      }
    );
    const numberByEnrolee = new Map(
      apps.map((a) => [a.enroleeNumber, a.studentNumber?.trim() || null])
    );

    // A child who already holds ANY class row this AY is not waiting for a
    // seat — they have one, or had one. That includes a child withdrawn after
    // enrolling: they keep `applicationStatus = 'Enrolled'` and their class
    // columns (KD #147), so without this they would hold a phantom seat in
    // their old class for the rest of the year. `fetchAdmissionsRoster` strips
    // the same children for the same reason. Trimmed on both sides — at least
    // one roster student number carries a trailing space.
    const numbers = Array.from(
      new Set(
        Array.from(numberByEnrolee.values()).filter((n): n is string => !!n)
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
      placedRows
        .map((r) => rosterStudentNumber(r))
        .filter((n): n is string => !!n)
    );

    return {
      rows: atLevel
        .map((r) => ({
          ...r,
          studentNumber: numberByEnrolee.get(r.enroleeNumber) ?? null,
        }))
        .filter((r) => !r.studentNumber || !placedThisAy.has(r.studentNumber)),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

type RosterRow = {
  section_id: string;
  student: { student_number: string } | { student_number: string }[] | null;
};

function rosterStudentNumber(row: RosterRow): string | null {
  const s = Array.isArray(row.student) ? row.student[0] : row.student;
  return s?.student_number?.trim() || null;
}

/**
 * Every section at the applicant's level, with live headcounts: who is on the
 * class list, and who has chosen the class but is not on it yet.
 * Returns every section regardless of capacity — callers (the picker UI)
 * show full sections as disabled rather than hiding them, so the registrar
 * has full visibility into state before deciding. `level` is null when the
 * raw label doesn't resolve (canonical, legacy digit-form, or alias) —
 * callers should point the registrar at /records/level-mismatches in that
 * case rather than showing an empty section list.
 *
 * `excludeEnroleeNumber` leaves that child's own chosen seat out of the
 * counts, so a child is never shown their own class as full because of
 * themselves.
 */
export async function listAssignableSections(
  service: SupabaseClient,
  ayCode: string,
  levelApplied: string | null,
  options: { excludeEnroleeNumber?: string | null } = {}
): Promise<{ level: AssignableLevel | null; sections: AssignableSection[] }> {
  if (!levelApplied) return { level: null, sections: [] };

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ayRow) return { level: null, sections: [] };
  const ayId = (ayRow as { id: string }).id;

  const levelId = await resolveLevelId(service, levelApplied);
  if (!levelId) return { level: null, sections: [] };

  const { data: levelRow } = await service
    .from('levels')
    .select('id, code, label, level_type')
    .eq('id', levelId)
    .maybeSingle();
  if (!levelRow) return { level: null, sections: [] };
  const level: AssignableLevel = {
    id: (levelRow as { id: string }).id,
    code: (levelRow as { code: string }).code,
    label: (levelRow as { label: string }).label,
    levelType: (levelRow as { level_type: 'primary' | 'secondary' }).level_type,
  };

  const { data: sectionRows } = await service
    .from('sections')
    .select('id, name, class_type, schedule')
    .eq('academic_year_id', ayId)
    .eq('level_id', levelId);
  const sections = (sectionRows ?? []) as Array<{
    id: string;
    name: string;
    class_type: string | null;
    schedule: string | null;
  }>;
  if (sections.length === 0) return { level, sections: [] };

  const sectionIds = sections.map((s) => s.id);
  // Includes late enrollees — see the capacity check below for why. The number
  // shown in the picker must be the same number the cap enforces, or the
  // registrar sees "27 students" on a section the write path considers full.
  // The student number rides along so a child already on the list is not
  // counted a second time as a chosen seat. Runs beside the admissions read.
  const [{ data: activeRows }, chosen] = await Promise.all([
    service
      .from('section_students')
      .select('section_id, student:students(student_number)')
      .in('enrollment_status', ENROLLED_STATUSES)
      .in('section_id', sectionIds),
    loadChosenClassRows(service, ayCode, level.label),
  ]);
  const activeCountById = new Map<string, number>();
  const rosterNumbersById = new Map<string, Set<string>>();
  for (const r of (activeRows ?? []) as unknown as RosterRow[]) {
    activeCountById.set(
      r.section_id,
      (activeCountById.get(r.section_id) ?? 0) + 1
    );
    const number = rosterStudentNumber(r);
    if (number) {
      const set = rosterNumbersById.get(r.section_id) ?? new Set<string>();
      set.add(number);
      rosterNumbersById.set(r.section_id, set);
    }
  }

  // A failed admissions read costs the chosen counts, never the picker: the
  // write path re-checks at save time and refuses there if the read fails.
  if ('error' in chosen) {
    console.warn('[class-assignment] chosen-seat read failed:', chosen.error);
  }
  const chosenCountById =
    'error' in chosen
      ? new Map<string, number>()
      : countChosenSeats(
          chosen.rows,
          level.label,
          sections,
          rosterNumbersById,
          options.excludeEnroleeNumber
        );

  return {
    level,
    sections: sections
      .map((s) => {
        const activeCount = activeCountById.get(s.id) ?? 0;
        const chosenCount = chosenCountById.get(s.id) ?? 0;
        return {
          id: s.id,
          name: s.name,
          activeCount,
          chosenCount,
          isAtCapacity: activeCount + chosenCount >= MAX_ACTIVE_PER_SECTION,
          classType: s.class_type ?? null,
          schedule: s.schedule ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Server-side validation for a registrar-chosen section — shared by the
 * assign-section route and the stage route's Enrolled-flip. Confirms the
 * section exists, belongs to the given AY, matches the applicant's level
 * (when `expectedLevelApplied` is supplied), and isn't at capacity at write
 * time (a second student could fill it between page-load and confirm).
 *
 * `exclude` names the child being placed. Their own seat — on the class list
 * already, or held by a class they chose — is not counted against them;
 * otherwise a child who chose the last seat would be refused it on the day
 * they enrol.
 */
export async function validateSectionChoice(
  service: SupabaseClient,
  sectionId: string,
  ayCode: string,
  expectedLevelApplied?: string | null,
  exclude: {
    enroleeNumber?: string | null;
    studentNumber?: string | null;
  } = {}
): Promise<
  | {
      section: {
        id: string;
        name: string;
        levelId: string;
        levelLabel: string;
      };
    }
  | { error: string }
> {
  const { data: sectionRow, error: sectionErr } = await service
    .from('sections')
    .select(
      'id, name, level_id, levels!inner(label), academic_years!inner(ay_code)'
    )
    .eq('id', sectionId)
    .maybeSingle();
  if (sectionErr)
    return { error: `Section lookup failed: ${sectionErr.message}` };
  if (!sectionRow) return { error: 'Section not found' };

  const row = sectionRow as unknown as {
    id: string;
    name: string;
    level_id: string;
    levels: { label: string } | null;
    academic_years: { ay_code: string } | null;
  };
  if (row.academic_years?.ay_code !== ayCode) {
    return { error: 'Section does not belong to this academic year' };
  }
  if (!row.levels?.label) {
    return { error: 'Section has no level label' };
  }
  const levelLabel = row.levels.label;

  if (expectedLevelApplied != null && expectedLevelApplied.trim()) {
    const expectedLevelId = await resolveLevelId(service, expectedLevelApplied);
    if (!expectedLevelId) {
      return {
        error: `The applicant's level ("${expectedLevelApplied}") isn't recognized — resolve it at /records/level-mismatches before assigning a section.`,
      };
    }
    if (expectedLevelId !== row.level_id) {
      return {
        error: `This section's level doesn't match the applicant's level (${expectedLevelApplied}).`,
      };
    }
  }

  // Counts late enrollees too. This used `.eq('enrollment_status', 'active')`,
  // which silently excluded them — so a section with 48 active + 5 late
  // enrollees reported 48, accepted two more, and landed at 55 against a
  // 50-student cap (Hard Rule #5). Measured when found: 13 of 21 AY2026
  // sections were mis-counted, with 20 late enrollees in the AY.
  //
  // A late enrollee occupies a seat exactly like anyone else — "late" describes
  // when they joined, not whether they are on the roster. The sibling transfer
  // route already counted both (section-transfer.ts), so the two paths into the
  // same roster disagreed about what "full" meant.
  //
  // Rows rather than a head count, because the student numbers are needed:
  // to leave out the child being placed, and so a child on the list is not
  // counted again as a chosen seat. A class list is at most ~50 rows.
  const [{ data: rosterRows, error: rosterErr }, chosen] = await Promise.all([
    service
      .from('section_students')
      .select('section_id, student:students(student_number)')
      .eq('section_id', sectionId)
      .in('enrollment_status', ENROLLED_STATUSES),
    loadChosenClassRows(service, ayCode, levelLabel),
  ]);
  if (rosterErr)
    return { error: `Capacity check failed: ${rosterErr.message}` };
  if ('error' in chosen)
    return { error: `Capacity check failed: ${chosen.error}` };

  const selfNumber = exclude.studentNumber?.trim() || null;
  const rosterNumbers = new Set<string>();
  let onList = 0;
  for (const r of (rosterRows ?? []) as unknown as RosterRow[]) {
    const number = rosterStudentNumber(r);
    if (number) rosterNumbers.add(number);
    if (selfNumber && number === selfNumber) continue;
    onList += 1;
  }
  const chosenSeats =
    countChosenSeats(
      chosen.rows,
      levelLabel,
      [{ id: row.id, name: row.name }],
      new Map([[row.id, rosterNumbers]]),
      exclude.enroleeNumber
    ).get(row.id) ?? 0;

  if (onList + chosenSeats >= MAX_ACTIVE_PER_SECTION) {
    return {
      error:
        chosenSeats > 0
          ? `${row.name} is full: ${onList} in the class and ${chosenSeats} more who chose it and are waiting to be enrolled (${MAX_ACTIVE_PER_SECTION} places). Pick another class.`
          : `${row.name} is full (${MAX_ACTIVE_PER_SECTION} students). Pick another class.`,
    };
  }

  return {
    section: {
      id: row.id,
      name: row.name,
      levelId: row.level_id,
      levelLabel,
    },
  };
}

/**
 * Finds the SIS class a chosen class names — the class columns on an
 * admissions row, however they were filled in (SIS, Directus, the old
 * enrolment link). Resolved exactly as the sync resolves it, so a class this
 * finds is a class the sync will place the child in.
 *
 * Returns a plain-English `reason` when there is no such class, for the
 * Enrolled flip to show.
 */
export async function resolveChosenSection(
  service: SupabaseClient,
  ayCode: string,
  classLevel: string | null,
  classSection: string | null
): Promise<{ sectionId: string } | { reason: string }> {
  const shown = [classLevel?.trim(), classSection?.trim()]
    .filter(Boolean)
    .join(' ');
  const levelLabel = normalizeLevelLabel(classLevel);
  if (!levelLabel) {
    return {
      reason: `The class chosen for this child (${shown || 'no name'}) has no level with it.`,
    };
  }
  const sectionName = normalizeSectionName(classSection);
  if (!sectionName) {
    return { reason: 'No class has been chosen for this child.' };
  }

  const { data: levelRow, error: levelErr } = await service
    .from('levels')
    .select('id, label')
    .eq('label', levelLabel)
    .maybeSingle();
  if (levelErr) return { reason: `Level lookup failed: ${levelErr.message}` };
  if (!levelRow) {
    return {
      reason: `The class chosen for this child is ${shown}, but "${classLevel?.trim()}" is not a level the school uses.`,
    };
  }
  const level = levelRow as { id: string; label: string };

  const { data: sectionRow, error: sectionErr } = await service
    .from('sections')
    .select('id, academic_years!inner(ay_code)')
    .eq('level_id', level.id)
    .eq('name', sectionName)
    .eq('academic_years.ay_code', ayCode)
    .maybeSingle();
  if (sectionErr)
    return { reason: `Class lookup failed: ${sectionErr.message}` };
  if (!sectionRow) {
    return {
      reason: `The class chosen for this child is ${shown}, but there is no class called "${sectionName}" in ${level.label} for ${ayCode}.`,
    };
  }
  return { sectionId: (sectionRow as { id: string }).id };
}
