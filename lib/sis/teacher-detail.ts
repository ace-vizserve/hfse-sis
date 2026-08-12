import 'server-only';

import { cache } from 'react';

import { createServiceClient } from '@/lib/supabase/service';
import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import { getTeacherEmailMap } from '@/lib/auth/teacher-emails';
import { sgToday } from '@/lib/dates';

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
  reliefId: string;
  reliefTeacherId: string;
  reliefTeacherName: string;
  reason: string;
  notes: string | null;
  startedOn: string;
  endedOn: string | null;
};

export type TeacherClassRow = {
  assignmentId: string;
  sectionId: string;
  sectionName: string;
  levelLabel: string;
  role: 'form_adviser' | 'subject_teacher';
  subjectId: string | null;
  subjectName: string | null;
  /** Set only while someone is actively standing in on this class. */
  cover: CoverSummary | null;
  /** Set when cover has been arranged for this class but has not started yet. */
  scheduledCover: CoverSummary | null;
};

export type TeacherDetail = {
  userId: string;
  name: string;
  email: string | null;
  classes: TeacherClassRow[];
  /** Cover on this teacher's classes that has finished — the record of who ran what. */
  pastCover: Array<CoverSummary & { assignmentId: string; label: string }>;
  /** Cover this teacher is working for SOMEONE ELSE right now. */
  coveringForOthers: Array<{
    reliefId: string;
    label: string;
    coveredTeacherName: string;
    startedOn: string;
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
  const today = sgToday();

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
      `id, role, subject_id,
       section:sections!inner(id, name, academic_year_id, level:levels(code, label)),
       subject:subjects(id, name)`
    )
    .eq('teacher_user_id', teacherUserId)
    .eq('section.academic_year_id', ayId);

  type AssignmentRaw = {
    id: string;
    role: 'form_adviser' | 'subject_teacher';
    subject_id: string | null;
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
  const assignmentIds = assignments.map((a) => a.id);

  // Every cover on those classes — running and finished. One query; the split
  // is done below so the page can show "who has it now" apart from "who has
  // had it".
  const { data: coverRows } = assignmentIds.length
    ? await service
        .from('assignment_reliefs')
        .select(
          'id, assignment_id, relief_teacher_user_id, reason, notes, started_on, ended_on'
        )
        .in('assignment_id', assignmentIds)
        .order('started_on', { ascending: false })
    : { data: [] };

  type CoverRaw = {
    id: string;
    assignment_id: string;
    relief_teacher_user_id: string;
    reason: string;
    notes: string | null;
    started_on: string;
    ended_on: string | null;
  };

  const isRunning = (c: CoverRaw) =>
    c.started_on <= today && (c.ended_on === null || c.ended_on >= today);
  // Arranged, dated to begin later, and NOT yet granting anybody anything.
  // Without a name of its own this fell in with "finished" and the page said
  // "Nobody is covering for this teacher" — which is true today and useless,
  // because somebody has plainly been arranged and the admin who arranged them
  // has no way to tell whether it saved.
  const isScheduled = (c: CoverRaw) => c.started_on > today;

  const runningByAssignment = new Map<string, CoverRaw>();
  const scheduledByAssignment = new Map<string, CoverRaw>();
  const finished: CoverRaw[] = [];
  for (const c of (coverRows ?? []) as CoverRaw[]) {
    if (isRunning(c)) runningByAssignment.set(c.assignment_id, c);
    else if (isScheduled(c)) scheduledByAssignment.set(c.assignment_id, c);
    else finished.push(c);
  }

  const toSummary = (c: CoverRaw): CoverSummary => ({
    reliefId: c.id,
    reliefTeacherId: c.relief_teacher_user_id,
    reliefTeacherName:
      nameById.get(c.relief_teacher_user_id) ?? 'Unknown teacher',
    reason: c.reason,
    notes: c.notes,
    startedOn: c.started_on,
    endedOn: c.ended_on,
  });

  const classes: TeacherClassRow[] = assignments.map((a) => {
    const section = one(a.section);
    const subject = one(a.subject);
    const level = one(section?.level ?? null);
    const running = runningByAssignment.get(a.id) ?? null;
    const scheduled = scheduledByAssignment.get(a.id) ?? null;
    return {
      assignmentId: a.id,
      sectionId: section?.id ?? '',
      sectionName: sectionLabel(section?.name ?? '—', level),
      levelLabel: level?.label ?? '',
      role: a.role,
      subjectId: a.subject_id,
      subjectName: subject?.name ?? null,
      cover: running ? toSummary(running) : null,
      scheduledCover: scheduled ? toSummary(scheduled) : null,
    };
  });

  // Form class first, then subjects alphabetically — the order the school
  // thinks in, and the order the mockup shows.
  classes.sort((x, y) => {
    if (x.role !== y.role) return x.role === 'form_adviser' ? -1 : 1;
    return (x.subjectName ?? '').localeCompare(y.subjectName ?? '');
  });

  const labelFor = (assignmentId: string) => {
    const c = classes.find((k) => k.assignmentId === assignmentId);
    if (!c) return 'A class';
    return c.role === 'form_adviser'
      ? c.sectionName
      : `${c.subjectName ?? '—'} · ${c.sectionName}`;
  };

  const pastCover = finished.map((c) => ({
    ...toSummary(c),
    assignmentId: c.assignment_id,
    label: labelFor(c.assignment_id),
  }));

  // The other direction: classes this teacher is covering for a colleague.
  // Belongs on their page too — "what am I responsible for right now" is one
  // question, and answering half of it would send them looking for the rest.
  const { data: mine } = await service
    .from('assignment_reliefs')
    .select(
      `id, started_on,
       assignment:teacher_assignments!inner(
         id, teacher_user_id, role,
         section:sections!inner(id, name, academic_year_id, level:levels(code, label)),
         subject:subjects(id, name)
       )`
    )
    .eq('relief_teacher_user_id', teacherUserId)
    .lte('started_on', today)
    .or(`ended_on.is.null,ended_on.gte.${today}`);

  type MineRaw = {
    id: string;
    started_on: string;
    assignment: AssignmentRaw & { teacher_user_id: string };
  };

  const coveringForOthers = ((mine ?? []) as unknown as MineRaw[]).flatMap(
    (row) => {
      const a = one(row.assignment as unknown as MineRaw['assignment']);
      if (!a) return [];
      const section = one(a.section);
      const subject = one(a.subject);
      const level = one(section?.level ?? null);
      const where = sectionLabel(section?.name ?? '—', level);
      return [
        {
          reliefId: row.id,
          label:
            a.role === 'form_adviser'
              ? where
              : `${subject?.name ?? '—'} · ${where}`,
          coveredTeacherName:
            nameById.get(a.teacher_user_id) ?? 'Unknown teacher',
          startedOn: row.started_on,
        },
      ];
    }
  );

  return {
    userId: teacherUserId,
    name,
    email: emailById.get(teacherUserId) ?? null,
    classes,
    pastCover,
    coveringForOthers,
  };
}

/**
 * `loadTeacherDetail`, deduped for one request.
 *
 * The teacher layout renders the header and the stat cards; the two child
 * routes beneath it render the classes and the cover. All three need the same
 * payload, and React's `cache` makes that one round trip instead of three —
 * without it, opening a teacher would run the whole query set three times.
 */
export const getTeacherDetail = cache(loadTeacherDetail);
