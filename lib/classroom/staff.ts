import 'server-only';

import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import { createServiceClient } from '@/lib/supabase/service';
import { reliefStatus } from '@/lib/relief/display';
import { subjectDisplayName } from '@/lib/sis/subjects/display-name';
import type { AssignmentRole } from '@/lib/schemas/teacher-assignment';

// Who runs this class — the form adviser, the subject teachers, and anyone
// covering. Mr Ace, 2026-08-21: "there is no trace of who teaches who/FCA etc
// in the classroom/[id] page." He was right, and it was worse than absent: the
// adviser was named in exactly one situation, when there ISN'T one (the
// no-form-adviser Health row). Assign one and the class page went silent about
// who runs it.
//
// READ ONLY, and not the gate. Like every other loader here this uses the
// service client, so the CALLER'S REACH IS THE PAGE'S JOB — call it only after
// `loadClassroomAccess` has proved the caller may open the section.
//
// ⚠ NAMES OF RECORD, NOT ACCESS. This file answers "whose name appears",
// which since relief teachers (migration 117) is a different question from
// "who may act". The substantive holder stays the name of record for the whole
// of a cover — that is why `teacherName` is always the person who HOLDS the
// assignment and the substitute is reported separately as `coveringName`,
// never in their place. See the header of lib/auth/teacher-assignments.ts;
// __tests__/auth/assignment-read-classification.test.ts classifies this file
// and fails the build if a new reader is left unclassified.

/** One subject the class takes, and who teaches it. */
export type SectionStaffSubject = {
  subjectId: string;
  code: string | null;
  name: string;
  /** The teacher who HOLDS this subject. Null means nobody is assigned. */
  teacherName: string | null;
  /** Their auth id, so a coordinator can open their staff page. */
  teacherId: string | null;
  /** Who is covering right now, or null. Never replaces `teacherName`. */
  coveringName: string | null;
  coveringId: string | null;
  /**
   * Cover that is BOOKED but not yet running (migration 123). Kept apart from
   * `coveringName` on purpose: this panel answers "who runs this class", and a
   * substitute who starts next week does not, yet. Naming them in the same
   * breath would tell a reader somebody has the class when they have nothing.
   */
  scheduledCoveringName: string | null;
  scheduledCoverFrom: string | null;
};

export type SectionStaff = {
  adviserName: string | null;
  adviserId: string | null;
  adviserCoveringName: string | null;
  adviserCoveringId: string | null;
  adviserScheduledCoveringName: string | null;
  adviserScheduledCoverFrom: string | null;
  subjects: SectionStaffSubject[];
  /** True when the class has no `section_subjects` rows at all. */
  noSubjectsConfigured: boolean;
};

type AssignmentRow = {
  teacher_user_id: string;
  subject_id: string | null;
  role: AssignmentRole;
  relief_teacher_user_id: string | null;
  relief_started_on: string | null;
  relief_ended_on: string | null;
};

type SubjectRow = {
  subject_config: {
    subject_id: string;
    /** This year's name for the subject, or null if it was never renamed. */
    display_name: string | null;
    subject: { code: string | null; name: string } | null;
  } | null;
};

/** PostgREST returns a one-to-one embed as an object or a single-item array. */
function one<T>(rel: T | T[] | null | undefined): T | null {
  if (rel == null) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

export async function getSectionStaff(
  sectionId: string
): Promise<SectionStaff> {
  const service = createServiceClient();

  const [assignmentsRes, subjectsRes, names] = await Promise.all([
    service
      .from('teacher_assignments')
      .select(
        'teacher_user_id, subject_id, role, relief_teacher_user_id, relief_started_on, relief_ended_on'
      )
      .eq('section_id', sectionId),
    // Which subjects this class takes. `section_subjects` IS the membership
    // test — migration 079 made subjects per-section rather than purely
    // level-derived, and lib/markbook/grading-sheet-scope.ts confirms there is
    // no level cross-check left to do here.
    service
      .from('section_subjects')
      .select(
        // display_name is this year's name for the subject (migration 137) —
        // it is on the config row this select already walks through, because
        // a config IS the per-(subject, year) row.
        'subject_config:subject_configs(subject_id, display_name, subject:subjects(code, name))'
      )
      .eq('section_id', sectionId),
    // Falls back to an empty map rather than throwing: a name lookup failing
    // must not blank the panel, it should just show the gaps it can prove.
    getStaffDisplayNameById()
      .then((entries) => new Map(entries))
      .catch((e) => {
        console.error(
          '[classroom-staff] name lookup failed:',
          e instanceof Error ? e.message : e
        );
        return new Map<string, string>();
      }),
  ]);

  if (assignmentsRes.error) {
    console.error(
      '[classroom-staff] assignment read failed:',
      assignmentsRes.error.message
    );
  }
  if (subjectsRes.error) {
    console.error(
      '[classroom-staff] subject read failed:',
      subjectsRes.error.message
    );
  }

  const nameOf = (id: string | null | undefined): string | null =>
    // The raw id rather than "Unknown": a teacher who has left the school is
    // still attributable, and a blank is not.
    id ? (names.get(id) ?? id) : null;

  // ⚠ A relief id on the row is NOT the same as somebody covering today.
  // Since migration 123 the row carries a window, so every read here has to
  // ask which side of it we are on. Splitting it into these four one-liners
  // keeps the question in one place rather than repeated at both call sites.
  const liveCoverName = (a: AssignmentRow | null): string | null =>
    a?.relief_teacher_user_id &&
    reliefStatus(a.relief_started_on, a.relief_ended_on) === 'active'
      ? nameOf(a.relief_teacher_user_id)
      : null;

  const liveCoverId = (a: AssignmentRow | null): string | null =>
    a?.relief_teacher_user_id &&
    reliefStatus(a.relief_started_on, a.relief_ended_on) === 'active'
      ? a.relief_teacher_user_id
      : null;

  const scheduledCoverName = (a: AssignmentRow | null): string | null =>
    a?.relief_teacher_user_id &&
    reliefStatus(a.relief_started_on, a.relief_ended_on) === 'scheduled'
      ? nameOf(a.relief_teacher_user_id)
      : null;

  const scheduledCoverFrom = (a: AssignmentRow | null): string | null =>
    scheduledCoverName(a) ? (a?.relief_started_on ?? null) : null;

  const assignments = (assignmentsRes.data ?? []) as unknown as AssignmentRow[];

  const adviser = assignments.find((a) => a.role === 'form_adviser') ?? null;

  // One row per (section, subject) since migration 118 — before it, two
  // teachers could share one class's Filipino and did. Keyed by subject so a
  // legacy duplicate collapses rather than rendering the subject twice.
  const bySubject = new Map<string, AssignmentRow>();
  for (const a of assignments) {
    if (a.role !== 'subject_teacher' || !a.subject_id) continue;
    if (!bySubject.has(a.subject_id)) bySubject.set(a.subject_id, a);
  }

  const subjectRows = (subjectsRes.data ?? []) as unknown as SubjectRow[];
  const subjects: SectionStaffSubject[] = subjectRows
    .map((row) => {
      const cfg = one(row.subject_config);
      if (!cfg?.subject_id) return null;
      const s = one(cfg.subject);
      const held = bySubject.get(cfg.subject_id) ?? null;
      return {
        subjectId: cfg.subject_id,
        code: s?.code ?? null,
        name: s ? subjectDisplayName(s, cfg) : 'Untitled subject',
        teacherName: nameOf(held?.teacher_user_id),
        teacherId: held?.teacher_user_id ?? null,
        coveringName: liveCoverName(held),
        coveringId: liveCoverId(held),
        scheduledCoveringName: scheduledCoverName(held),
        scheduledCoverFrom: scheduledCoverFrom(held),
      };
    })
    .filter((s): s is SectionStaffSubject => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    adviserName: nameOf(adviser?.teacher_user_id),
    adviserId: adviser?.teacher_user_id ?? null,
    adviserCoveringName: liveCoverName(adviser),
    adviserCoveringId: liveCoverId(adviser),
    adviserScheduledCoveringName: scheduledCoverName(adviser),
    adviserScheduledCoverFrom: scheduledCoverFrom(adviser),
    subjects,
    // Distinct from "every subject is unassigned": a class nobody has given
    // subjects to yet is a different problem, with a different fix, from a
    // class whose subjects nobody teaches.
    noSubjectsConfigured: subjects.length === 0,
  };
}
