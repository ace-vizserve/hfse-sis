import 'server-only';

import { cache } from 'react';

import { createServiceClient } from '@/lib/supabase/service';
import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import { getTeacherEmailMap } from '@/lib/auth/teacher-emails';
import {
  type AssignmentRole,
  isAdviserRole,
} from '@/lib/schemas/teacher-assignment';

// Everything the teacher page needs, for one teacher in one academic year.
//
// Reads with the SERVICE client and scopes by hand. The page is registrar-and-
// above, so it must show a teacher's classes to someone who holds none of them
// — which is exactly what the RLS policies refuse. Every caller is behind the
// `staff.read` capability check on the page itself.
//
// NOTE ON WHAT "COVERED" MEANS HERE. A class of this teacher's that someone
// else is currently covering is still THIS teacher's class: they remain the
// name of record on the report card and the mark sheet for the whole of it.
// So cover is attached to the assignment as an annotation, never used to move
// the assignment onto the substitute's page.

export type CoverSummary = {
  reliefTeacherId: string;
  reliefTeacherName: string;
  /** First day of the cover; null means it started when it was set. */
  startedOn: string | null;
  /** Last day, inclusive; null means open-ended. */
  endedOn: string | null;
};

export type TeacherClassRow = {
  assignmentId: string;
  sectionId: string;
  sectionName: string;
  levelLabel: string;
  /**
   * All four roles (migration 124), not two.
   *
   * ⚠ This was typed `'form_adviser' | 'subject_teacher'` while the query
   * below selected every role — so a co-teacher's own classes were a type lie
   * at runtime and vanished from the page and its stat cards.
   */
  role: AssignmentRole;
  subjectId: string | null;
  subjectName: string | null;
  /** Set while someone is standing in on this class; null when nobody is. */
  cover: CoverSummary | null;
};

export type TeacherDetail = {
  userId: string;
  name: string;
  email: string | null;
  classes: TeacherClassRow[];
  /** Classes this teacher is covering for SOMEONE ELSE. */
  coveringForOthers: Array<{
    assignmentId: string;
    label: string;
    coveredTeacherName: string;
    /** ⚠ A row here may not be live yet — check the window before saying so. */
    startedOn: string | null;
    endedOn: string | null;
  }>;
};

type LevelLite = { code: string | null; label: string | null };

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/** "P4 Diligence" — how staff say it. The bare virtue is ambiguous across levels. */
function sectionLabel(name: string, level: LevelLite | null): string {
  return level?.code ? `${level.code} ${name}` : name;
}

export async function loadTeacherDetail(
  teacherUserId: string,
  ayCode: string
): Promise<TeacherDetail | null> {
  const service = createServiceClient();

  const [nameEntries, emailEntries] = await Promise.all([
    getStaffDisplayNameById(),
    getTeacherEmailMap(),
  ]);
  const nameById = new Map<string, string>(nameEntries);
  const emailById = new Map<string, string>(emailEntries);

  const name = nameById.get(teacherUserId);
  if (!name) return null;

  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ay as { id: string } | null)?.id;
  if (!ayId) return null;

  const { data: assignmentRows } = await service
    .from('teacher_assignments')
    .select(
      `id, role, subject_id, relief_teacher_user_id,
       relief_started_on, relief_ended_on,
       section:sections!inner(id, name, academic_year_id, level:levels(code, label)),
       subject:subjects(id, name)`
    )
    .eq('teacher_user_id', teacherUserId)
    .eq('section.academic_year_id', ayId);

  type AssignmentRaw = {
    id: string;
    role: AssignmentRole;
    subject_id: string | null;
    relief_teacher_user_id: string | null;
    relief_started_on: string | null;
    relief_ended_on: string | null;
    section:
      | { id: string; name: string; level: LevelLite | LevelLite[] | null }
      | Array<{
          id: string;
          name: string;
          level: LevelLite | LevelLite[] | null;
        }>
      | null;
    subject:
      | { id: string; name: string }
      | { id: string; name: string }[]
      | null;
  };

  const assignments = (assignmentRows ?? []) as AssignmentRaw[];

  const classes: TeacherClassRow[] = assignments.map((a) => {
    const section = one(a.section);
    const subject = one(a.subject);
    const level = one(section?.level ?? null);
    return {
      assignmentId: a.id,
      sectionId: section?.id ?? '',
      sectionName: sectionLabel(section?.name ?? '—', level),
      levelLabel: level?.label ?? '',
      role: a.role,
      subjectId: a.subject_id,
      subjectName: subject?.name ?? null,
      cover: a.relief_teacher_user_id
        ? {
            reliefTeacherId: a.relief_teacher_user_id,
            reliefTeacherName:
              nameById.get(a.relief_teacher_user_id) ?? 'Unknown teacher',
            startedOn: a.relief_started_on,
            endedOn: a.relief_ended_on,
          }
        : null,
    };
  });

  // Form class first, then subjects alphabetically — the order the school
  // thinks in, and the order the mockup shows. Within each family the teacher
  // of record comes before anyone sharing the class, so a shared subject reads
  // as one group rather than two scattered rows (same rule as the section
  // Teachers tab).
  const ROLE_RANK: Record<AssignmentRole, number> = {
    form_adviser: 0,
    co_adviser: 1,
    subject_teacher: 2,
    co_teacher: 3,
  };
  classes.sort((x, y) => {
    const xAdviser = isAdviserRole(x.role);
    const yAdviser = isAdviserRole(y.role);
    if (xAdviser !== yAdviser) return xAdviser ? -1 : 1;
    const bySubject = (x.subjectName ?? '').localeCompare(y.subjectName ?? '');
    if (bySubject !== 0) return bySubject;
    return ROLE_RANK[x.role] - ROLE_RANK[y.role];
  });

  // The other direction: classes this teacher is covering for a colleague.
  // Belongs on their page too — "what am I responsible for right now" is one
  // question, and answering half of it would send them looking for the rest.
  const { data: mine } = await service
    .from('teacher_assignments')
    .select(
      `id, teacher_user_id, role,
       relief_started_on, relief_ended_on,
       section:sections!inner(id, name, academic_year_id, level:levels(code, label)),
       subject:subjects(id, name)`
    )
    .eq('relief_teacher_user_id', teacherUserId)
    .eq('section.academic_year_id', ayId);

  type MineRaw = AssignmentRaw & { teacher_user_id: string };

  const coveringForOthers = ((mine ?? []) as unknown as MineRaw[]).flatMap(
    (a) => {
      if (!a) return [];
      const section = one(a.section);
      const subject = one(a.subject);
      const level = one(section?.level ?? null);
      const where = sectionLabel(section?.name ?? '—', level);
      return [
        {
          assignmentId: a.id,
          // Adviser roles carry no subject (the role/subject CHECK enforces
          // it), so naming one would print "— · P4 Diligence".
          label: isAdviserRole(a.role)
            ? where
            : `${subject?.name ?? '—'} · ${where}`,
          coveredTeacherName:
            nameById.get(a.teacher_user_id) ?? 'Unknown teacher',
          startedOn: a.relief_started_on,
          endedOn: a.relief_ended_on,
        },
      ];
    }
  );

  return {
    userId: teacherUserId,
    name,
    email: emailById.get(teacherUserId) ?? null,
    classes,
    coveringForOthers,
  };
}

/**
 * `loadTeacherDetail`, deduped for one request.
 *
 * The teacher layout renders the header and the stat cards; the page beneath it
 * renders the classes. Both need the same payload, and React's `cache` makes
 * that one round trip instead of two.
 */
export const getTeacherDetail = cache(loadTeacherDetail);
