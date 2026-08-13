import { unstable_cache } from 'next/cache';

import { getTeacherList } from '@/lib/auth/staff-list';
import { createServiceClient } from '@/lib/supabase/service';

export type StaffSubjectAssignment = {
  assignmentId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  sectionId: string;
  sectionName: string;
  levelCode: string;
};

export type StaffRow = {
  userId: string;
  email: string;
  name: string;
  disabled: boolean;
  fcaSection: { id: string; name: string; levelCode: string } | null;
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
      fcaSection: null,
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

    const fcaRow = mine.find((a) => a.role === 'form_adviser');
    const fcaSec = fcaRow ? sectionMeta.get(fcaRow.section_id) : undefined;

    const subjectAssignments: StaffSubjectAssignment[] = mine
      .filter((a) => a.role === 'subject_teacher')
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
        };
      });

    return {
      userId: teacher.id,
      email: teacher.email,
      name: teacher.name,
      disabled: teacher.disabled,
      fcaSection: fcaSec
        ? { id: fcaSec.id, name: fcaSec.name, levelCode: fcaSec.levelCode }
        : null,
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
