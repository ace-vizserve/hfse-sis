import 'server-only';

import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import type { DisciplineRecordType } from '@/lib/schemas/discipline';
import { createServiceClient } from '@/lib/supabase/service';

// Reading a student's disciplinary record — action item #7 from the 2026-07-31
// academics training. Christina, 18:20: "if we click the name of the student, I
// was hoping we can also find those incidents that the student was involved in
// for the whole year."
//
// Every read here uses the service client, as every other server-side loader in
// this codebase does. That means RLS is bypassed and the CALLER'S REACH IS THE
// ROUTE'S JOB, not this file's — the policies in migration 120 are defence in
// depth for cookie-scoped reads, never the gate. Do not call these from a
// surface that has not already proved the caller may see the student.

/** One row on a student's record — an incident, or a letter the school sent. */
export type DisciplineRecordRow = {
  id: string;
  studentId: string;
  studentNumber: string | null;
  studentName: string | null;
  sectionId: string;
  /** "Sec 1 Discipline 1" — the school form's "Level / Class", as one phrase. */
  className: string | null;
  academicYearId: string;
  ayCode: string | null;
  recordType: DisciplineRecordType;
  /** `YYYY-MM-DD`. */
  occurredOn: string;
  /** `HH:MM`, or null — the school's own form is often filed without a time. */
  occurredAtTime: string | null;
  nature: string;
  details: string;
  remarks: string | null;
  /** Link to the paperwork, or null. A convenience — never the record itself. */
  documentUrl: string | null;
  /**
   * `YYYY-MM-DD` when the parent's signed slip came back; null means it has
   * not. Letters only (migration 122) — always null on an incident.
   */
  acknowledgedOn: string | null;
  filedBy: string;
  filedByName: string;
  filedByOffice: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  updatedByName: string | null;
};

// What every read selects. One string so the student, section and per-section
// reads cannot drift into returning different shapes for the same row type.
const SELECT = `
  id,
  student_id,
  section_id,
  academic_year_id,
  record_type,
  occurred_on,
  occurred_at_time,
  nature,
  details,
  remarks,
  document_url,
  acknowledged_on,
  filed_by,
  filed_by_office,
  created_at,
  updated_at,
  updated_by,
  student:students(student_number, first_name, middle_name, last_name),
  section:sections(name, level:levels(label)),
  academic_year:academic_years(ay_code)
`;
// Plain embeds, no `!constraint_name` hints. This table has exactly one foreign
// key to each of the three, so PostgREST resolves them unambiguously — and a
// hint would hardcode Postgres's auto-generated constraint names, which nothing
// in the migration states explicitly and any future rename would silently
// break. Same spelling as lib/change-requests/labels.ts.

/**
 * PostgREST returns an embedded one-to-one as an object, but the generated
 * types (and some query shapes) allow an array. Every existing loader in this
 * codebase hits the same ambiguity — see `invalidateForSection` in
 * app/api/teacher-assignments/[id]/route.ts — so it is unwrapped once here
 * rather than at each of the dozen field reads below.
 */
function one<T>(rel: T | T[] | null | undefined): T | null {
  if (rel == null) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

type RawRow = {
  id: string;
  student_id: string;
  section_id: string;
  academic_year_id: string;
  record_type: DisciplineRecordType;
  occurred_on: string;
  occurred_at_time: string | null;
  nature: string;
  details: string | null;
  remarks: string | null;
  document_url: string | null;
  acknowledged_on: string | null;
  filed_by: string;
  filed_by_office: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  student?:
    | {
        student_number: string | null;
        first_name: string | null;
        middle_name: string | null;
        last_name: string | null;
      }
    | Array<{
        student_number: string | null;
        first_name: string | null;
        middle_name: string | null;
        last_name: string | null;
      }>
    | null;
  section?:
    | {
        name: string | null;
        level?:
          | { label: string | null }
          | Array<{ label: string | null }>
          | null;
      }
    | Array<{
        name: string | null;
        level?:
          | { label: string | null }
          | Array<{ label: string | null }>
          | null;
      }>
    | null;
  academic_year?:
    | { ay_code: string | null }
    | Array<{ ay_code: string | null }>
    | null;
};

/**
 * `time` comes back from Postgres as `HH:MM:SS`. The form only ever collects
 * `HH:MM`, so the seconds are always `00` and showing them would be noise.
 */
function trimSeconds(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{2}:\d{2})/.exec(value);
  return match ? match[1] : value;
}

function fullName(parts: {
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
}): string | null {
  const joined = [parts.first_name, parts.middle_name, parts.last_name]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(' ');
  return joined || null;
}

function toRow(
  raw: RawRow,
  staffNames: Map<string, string>
): DisciplineRecordRow {
  const student = one(raw.student);
  const section = one(raw.section);
  const level = one(section?.level);
  const ay = one(raw.academic_year);

  // "Sec 1" + "Discipline 1" reads as one class name on the school's own form,
  // so it is joined here rather than left for each surface to reassemble.
  const className =
    [level?.label, section?.name].filter(Boolean).join(' ') || null;

  return {
    id: raw.id,
    studentId: raw.student_id,
    studentNumber: student?.student_number ?? null,
    studentName: student ? fullName(student) : null,
    sectionId: raw.section_id,
    className,
    academicYearId: raw.academic_year_id,
    ayCode: ay?.ay_code ?? null,
    recordType: raw.record_type,
    occurredOn: raw.occurred_on,
    occurredAtTime: trimSeconds(raw.occurred_at_time),
    nature: raw.nature,
    details: raw.details ?? '',
    remarks: raw.remarks,
    // `|| null` collapses a stored empty string — rows written before the
    // mutation layer normalised it — so the UI's "is there a link" check is a
    // single truthiness test rather than two.
    documentUrl: raw.document_url || null,
    acknowledgedOn: raw.acknowledged_on,
    filedBy: raw.filed_by,
    // Falls back to the raw id rather than "Unknown": a filing whose author
    // left the school still has to be attributable to someone, and an id is
    // traceable where a blank is not.
    filedByName: staffNames.get(raw.filed_by) ?? raw.filed_by,
    filedByOffice: raw.filed_by_office,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    updatedBy: raw.updated_by,
    updatedByName: raw.updated_by
      ? (staffNames.get(raw.updated_by) ?? raw.updated_by)
      : null,
  };
}

async function staffNameMap(): Promise<Map<string, string>> {
  try {
    return new Map(await getStaffDisplayNameById());
  } catch (e) {
    // A name lookup failing must not blank a student's disciplinary history —
    // `toRow` falls back to the raw id, which is still attributable.
    console.error(
      '[discipline] staff name lookup failed:',
      e instanceof Error ? e.message : e
    );
    return new Map();
  }
}

/**
 * Everything filed against one student, newest first.
 *
 * Cross-year by default, because `studentNumber` is the stable id (Hard Rule
 * #4) and a student's behavioural history does not restart in August. Pass
 * `academicYearId` to narrow it to the year on screen — which is what
 * Christina asked for ("for the whole year").
 */
export async function listDisciplineForStudent(
  studentId: string,
  opts: { academicYearId?: string } = {}
): Promise<DisciplineRecordRow[]> {
  const service = createServiceClient();
  let q = service
    .from('student_discipline_records')
    .select(SELECT)
    .eq('student_id', studentId);

  if (opts.academicYearId) q = q.eq('academic_year_id', opts.academicYearId);

  const { data, error } = await q
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[discipline] student read failed:', error.message);
    return [];
  }

  const names = await staffNameMap();
  return ((data ?? []) as unknown as RawRow[]).map((r) => toRow(r, names));
}

/**
 * Everything filed against any student in one class, newest first — the
 * Classroom "all filings" list.
 *
 * Section-scoped rather than student-scoped on purpose: `section_id` is stored
 * on the row (migration 120), so a student who transfers later keeps their
 * history on the class where it happened instead of having it follow them.
 */
export async function listDisciplineForSection(
  sectionId: string
): Promise<DisciplineRecordRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('student_discipline_records')
    .select(SELECT)
    .eq('section_id', sectionId)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[discipline] section read failed:', error.message);
    return [];
  }

  const names = await staffNameMap();
  return ((data ?? []) as unknown as RawRow[]).map((r) => toRow(r, names));
}

/**
 * Everything filed across the whole school for one academic year — the Records
 * register.
 *
 * Mr Ace, 2026-08-21: "how can i see all disciplinary records and update them
 * bro?" Until this there was no answer: records were reachable class by class
 * only, so "which letters are still waiting on a signed slip" could not be
 * asked, even though `acknowledged_on` has stored the answer since migration
 * 122.
 *
 * YEAR-SCOPED, not all-time. A register is a working list for the year in
 * front of you; a student's whole history already lives on their Records tab,
 * which is deliberately cross-year. The caller passes the year it is showing,
 * so the AY switcher on the page needs nothing else.
 */
export async function listDisciplineForAy(
  academicYearId: string
): Promise<DisciplineRecordRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('student_discipline_records')
    .select(SELECT)
    .eq('academic_year_id', academicYearId)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[discipline] year read failed:', error.message);
    return [];
  }

  const names = await staffNameMap();
  return ((data ?? []) as unknown as RawRow[]).map((r) => toRow(r, names));
}

/**
 * One record, or null. Used by the edit path, which needs `filed_by` to decide
 * whether the caller is the filer.
 */
export async function getDisciplineRecord(
  id: string
): Promise<DisciplineRecordRow | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('student_discipline_records')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[discipline] record read failed:', error.message);
    return null;
  }
  if (!data) return null;

  const names = await staffNameMap();
  return toRow(data as unknown as RawRow, names);
}
