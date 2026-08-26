import { unstable_cache } from 'next/cache';

import { getTeacherList } from '@/lib/auth/staff-list';
import {
  type AssignmentRole,
  isAdviserRole,
  isSubjectRole,
} from '@/lib/schemas/teacher-assignment';
import { createServiceClient } from '@/lib/supabase/service';

/** A class this teacher advises — as the adviser of record, or alongside one. */
export type StaffAdviserAssignment = {
  assignmentId: string;
  sectionId: string;
  sectionName: string;
  levelCode: string;
  /** `form_adviser` (the name on the report card) or `co_adviser`. */
  role: AssignmentRole;
};

export type StaffSubjectAssignment = {
  assignmentId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  sectionId: string;
  sectionName: string;
  levelCode: string;
  /** `subject_teacher` (owns the grading sheet) or `co_teacher`. */
  role: AssignmentRole;
};

export type StaffRow = {
  userId: string;
  email: string;
  name: string;
  disabled: boolean;
  /**
   * Every class this teacher advises, not just one.
   *
   * ⚠ AN ARRAY, because the unique index is one adviser PER SECTION — it says
   * nothing about how many sections one person may advise, and HFSE staff do
   * hold more than one. This was a single value resolved with `.find()`, which
   * silently showed the first and hid the rest; KD #185 records that same
   * `.find()` shape causing a real bug in the staff drawer, where it deleted
   * whichever assignment id it happened to land on.
   */
  adviserSections: StaffAdviserAssignment[];
  subjectAssignments: StaffSubjectAssignment[];
  /** Classes of THEIRS that somebody else is standing in on today. */
  coveredCount: number;
  /** Classes they are standing in on for somebody else today. */
  coveringCount: number;
};

type RawSection = {
  id: string;
  name: string;
  levels: { code: string } | { code: string }[] | null;
};

type RawAssignment = {
  id: string;
  teacher_user_id: string;
  section_id: string;
  subject_id: string | null;
  role: string;
  relief_teacher_user_id: string | null;
  subjects:
    | { code: string; name: string }
    | { code: string; name: string }[]
    | null;
};

async function loadStaffAssignmentsUncached(
  ayCode: string
): Promise<StaffRow[]> {
  const service = createServiceClient();

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ayRow) return [];

  const { data: sectionRows } = await service
    .from('sections')
    .select('id, name, levels(code)')
    .eq('academic_year_id', (ayRow as { id: string }).id);

  const sections = (sectionRows ?? []) as RawSection[];
  const sectionMeta = new Map(
    sections.map((s) => {
      const levelCode = Array.isArray(s.levels)
        ? (s.levels[0]?.code ?? '')
        : (s.levels?.code ?? '');
      return [s.id, { id: s.id, name: s.name, levelCode }];
    })
  );

  if (sectionMeta.size === 0) {
    const teachers = await getTeacherList({ excludeDisabled: false });
    return teachers.map((t) => ({
      userId: t.id,
      email: t.email,
      name: t.name,
      disabled: t.disabled,
      adviserSections: [],
      // No sections in this year means no assignments, so no cover either.
      coveredCount: 0,
      coveringCount: 0,
      subjectAssignments: [],
    }));
  }

  const sectionIds = [...sectionMeta.keys()];

  const { data: assignmentRows } = await service
    .from('teacher_assignments')
    .select(
      'id, teacher_user_id, section_id, subject_id, role, relief_teacher_user_id, subjects(code, name)'
    )
    .in('section_id', sectionIds);

  const assignments = (assignmentRows ?? []) as RawAssignment[];

  const teachers = await getTeacherList({ excludeDisabled: false });

  // Cover is a column on the rows already loaded (migration 117), so counting
  // it costs nothing. Counted from both ends, because "who is short-handed" and
  // "who is carrying extra" are the two things these figures are read for.
  const coveredByTeacher = new Map<string, number>();
  const coveringByTeacher = new Map<string, number>();
  for (const a of assignments) {
    if (!a.relief_teacher_user_id) continue;
    coveredByTeacher.set(
      a.teacher_user_id,
      (coveredByTeacher.get(a.teacher_user_id) ?? 0) + 1
    );
    coveringByTeacher.set(
      a.relief_teacher_user_id,
      (coveringByTeacher.get(a.relief_teacher_user_id) ?? 0) + 1
    );
  }

  return teachers.map((teacher) => {
    const mine = assignments.filter((a) => a.teacher_user_id === teacher.id);

    // Both role families, primary and co (migration 124). A co-adviser or
    // co-teacher is substantive staff — the person really does teach the class —
    // so leaving them off their own row would misreport what they hold. Whether
    // a co-adviser makes a SECTION count as staffed is a separate question, and
    // the answer there is no; see getSectionStaffingCoverage in lib/sis/dashboard.ts.
    const adviserSections: StaffAdviserAssignment[] = mine
      .filter((a) => isAdviserRole(a.role))
      .flatMap((a) => {
        const sec = sectionMeta.get(a.section_id);
        if (!sec) return [];
        return [
          {
            assignmentId: a.id,
            sectionId: a.section_id,
            sectionName: sec.name,
            levelCode: sec.levelCode,
            role: a.role as AssignmentRole,
          },
        ];
      });

    const subjectAssignments: StaffSubjectAssignment[] = mine
      .filter((a) => isSubjectRole(a.role))
      .map((a) => {
        const sec = sectionMeta.get(a.section_id);
        const sub = Array.isArray(a.subjects) ? a.subjects[0] : a.subjects;
        return {
          assignmentId: a.id,
          subjectId: a.subject_id ?? '',
          subjectCode: sub?.code ?? '',
          subjectName: sub?.name ?? '',
          sectionId: a.section_id,
          sectionName: sec?.name ?? '',
          levelCode: sec?.levelCode ?? '',
          role: a.role as AssignmentRole,
        };
      });

    return {
      userId: teacher.id,
      email: teacher.email,
      name: teacher.name,
      disabled: teacher.disabled,
      adviserSections,
      subjectAssignments,
      coveredCount: coveredByTeacher.get(teacher.id) ?? 0,
      coveringCount: coveringByTeacher.get(teacher.id) ?? 0,
    };
  });
}

export function loadStaffAssignments(ayCode: string): Promise<StaffRow[]> {
  return unstable_cache(
    loadStaffAssignmentsUncached,
    ['sis', 'staff-assignments', ayCode],
    { tags: [`sis:${ayCode}`], revalidate: 60 }
  )(ayCode);
}

// ─── loadFormAdvisersBySection ────────────────────────────────────────────────
// Resolves the form-adviser name for each given section ID.  Lighter than the
// full loadStaffAssignments — only the form_adviser role, no subject joins.
// Returns a Map<sectionId, { userId, name }>; first-write-wins per section.

type AdviserEntry = { userId: string; name: string };

async function loadFormAdvisersBySectionUncached(
  sectionIds: string[],
  _ayCode: string
): Promise<Record<string, AdviserEntry>> {
  if (sectionIds.length === 0) return {};

  const service = createServiceClient();

  const { data: rows } = await service
    .from('teacher_assignments')
    .select('section_id, teacher_user_id')
    .eq('role', 'form_adviser')
    .in('section_id', sectionIds);

  const teachers = await getTeacherList({ excludeDisabled: false });
  const teacherMap = new Map(teachers.map((t) => [t.id, t.name]));

  const result: Record<string, AdviserEntry> = {};
  for (const row of rows ?? []) {
    if (!result[row.section_id]) {
      const name = teacherMap.get(row.teacher_user_id);
      if (name) {
        result[row.section_id] = { userId: row.teacher_user_id, name };
      }
    }
  }
  return result;
}

export function loadFormAdvisersBySection(
  sectionIds: string[],
  ayCode: string
): Promise<Record<string, AdviserEntry>> {
  if (sectionIds.length === 0) return Promise.resolve({});
  // Cache key must include sectionIds — the result varies by input set, and
  // several pages (markbook/attendance/evaluation/sis sections lists) call
  // this with different (sometimes filtered) section-id sets for the same
  // ayCode. Without this, one page's cached result could serve another
  // page's request within the 60s window — wrong adviser names, not just
  // stale ones. Sorted + joined so key identity doesn't depend on order.
  const sectionIdsKey = sectionIds.slice().sort().join(',');
  return unstable_cache(
    loadFormAdvisersBySectionUncached,
    ['sis', 'advisers-by-section', ayCode, sectionIdsKey],
    { tags: [`sis:${ayCode}`], revalidate: 60 }
  )(sectionIds, ayCode);
}
