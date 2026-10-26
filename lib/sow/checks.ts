import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import {
  type EffectiveAssignmentRow,
  loadEffectiveAssignmentsForUser,
} from '@/lib/auth/teacher-assignments';
import { sgToday } from '@/lib/dates';
import {
  isEmptyRichText,
  normalizeRichText,
  proseLength,
} from '@/lib/rich-text';
import { type SowSnapshot, SowSnapshotSchema } from '@/lib/schemas/sow';
import { isSubjectRole } from '@/lib/schemas/teacher-assignment';
import {
  type CellMark,
  CHECK_LABELS,
  CHECK_NOTE_MAX,
  type CheckOption,
  cellMark,
} from '@/lib/sow/check-options';
import type { SowActor } from '@/lib/sow/create';
import { loadTermWeeks, type TermWeek } from '@/lib/sow/weeks';

export * from '@/lib/sow/check-options';

// The weekly check (spec §5.1, board 7): for each class × week of an approved
// scheme of work, each teacher who takes the subject in that class says how
// the week went — As planned, Adjusted, Delayed or Extra activities, with a
// note for anything but As planned.
//
// ⚠ IT READS THE APPROVED SNAPSHOT, NOT THE WORKING COPY (spec §4.4). A scheme
// the office reopened is a draft again while it is revised, but the plan in
// force is still the one last approved, and teachers keep checking against
// it. So "approved" here means "has an `approved_snapshot`", whatever the
// state; the snapshot's week numbers are laid onto this term's weeks for
// dates.
//
// ⚠ APPEND-ONLY. A change of mind is a new row; the newest row per (week,
// class, teacher) is the check. Nothing is ever updated or deleted, so what
// a teacher said before the subject head signed stays on record.
//
// Who checks: a teacher who HOLDS a subject or co-teacher assignment for the
// scheme's subject on that class. Relief cover never checks (the regular
// teacher answers for the week; a relief teacher leaves a relief note), and
// an office role checks only if it holds such an assignment itself.

export const CHECK_NOT_APPROVED =
  "This scheme of work isn't approved yet, so weeks can't be checked.";
export const CHECK_WEEK_SIGNED =
  "This week is signed for that class, so its check can't be changed.";
export const CHECK_NOT_STARTED = "This week hasn't started yet.";
export const CHECK_NOTE_REQUIRED =
  "Add a note saying how the week didn't go as planned.";
export const CHECK_NOT_TEACHER =
  'Only a teacher who takes this subject in that class can check its week.';

export type RecordCheckResult =
  | { ok: true; checkId: string }
  | { ok: false; status: 403 | 404 | 422 | 423; error: string };

const fail = (
  status: 403 | 404 | 422 | 423,
  error: string
): RecordCheckResult => ({ ok: false, status, error });

/** The snapshot, or null when there is none or it cannot be read. */
function readSnapshot(raw: unknown): SowSnapshot | null {
  if (raw == null) return null;
  const parsed = SowSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(
      '[sow.check] the approved snapshot did not validate:',
      parsed.error.issues[0]?.message
    );
    return null;
  }
  return parsed.data;
}

/** A substantive subject or co-teacher row for this subject on this class. */
function holdsClass(
  a: EffectiveAssignmentRow,
  userId: string,
  subjectId: string,
  sectionId: string
): boolean {
  return (
    a.teacher_user_id === userId &&
    a.via === 'substantive' &&
    isSubjectRole(a.role) &&
    a.subject_id === subjectId &&
    a.section_id === sectionId
  );
}

export type SignoffRow = {
  week_number: number;
  section_id: string;
  kind: 'signed' | 'asked';
  created_at: string;
  remarks?: string | null;
};

/** The newest sign-off row of a list (one week of one class), if any. */
export function newestSignoff<T extends SignoffRow>(rows: T[]): T | null {
  return (
    [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ??
    null
  );
}

/** Is the newest sign-off row a signature? ("Ask the teacher" is not.) */
function isSigned(rows: SignoffRow[]): boolean {
  return newestSignoff(rows)?.kind === 'signed';
}

/**
 * The checks as they stood when each week was signed.
 *
 * ⚠ THE SIGN-OFF RACE IS CLOSED ON READ. `recordCheck` refuses a check once
 * the newest sign-off of that week and class is a signature, but a check and
 * a signature sent at the same moment can both pass their reads. Whatever
 * landed AFTER the signature the subject head put their name to is not what
 * they signed, so every screen that shows or marks a week drops it here
 * (the row stays in the table — append-only — it is just not the week's
 * check). A week whose newest row is "Ask the teacher" is open again, so
 * nothing is dropped from it.
 */
export function checksAsSigned<C extends CheckRow>(
  checks: C[],
  signoffs: SignoffRow[]
): C[] {
  const byKey = new Map<string, SignoffRow[]>();
  for (const s of signoffs) {
    const k = `${s.week_number}|${s.section_id}`;
    byKey.set(k, [...(byKey.get(k) ?? []), s]);
  }
  const cutoff = new Map<string, string>();
  for (const [k, rows] of byKey) {
    const newest = newestSignoff(rows);
    if (newest?.kind === 'signed') cutoff.set(k, newest.created_at);
  }
  if (cutoff.size === 0) return checks;
  return checks.filter((c) => {
    const at = cutoff.get(`${c.week_number}|${c.section_id}`);
    return at === undefined || c.recorded_at <= at;
  });
}

/**
 * "Your subject head asked: …" — the remarks of an "Ask the teacher" that
 * is still the last word on that week of that class: no signature since, and
 * no check recorded after it (a new check is the teacher's answer).
 */
export function openAsk(
  signoffs: SignoffRow[],
  checks: Pick<CheckRow, 'recorded_at'>[]
): { remarks: string; at: string } | null {
  const newest = newestSignoff(signoffs);
  if (!newest || newest.kind !== 'asked' || !newest.remarks) return null;
  if (checks.some((c) => c.recorded_at > newest.created_at)) return null;
  return { remarks: newest.remarks, at: newest.created_at };
}

export async function recordCheck(
  service: SupabaseClient,
  actor: SowActor,
  input: {
    sowId: string;
    weekNumber: number;
    sectionId: string;
    option: CheckOption;
    note: string | null;
  },
  opts: { today?: string } = {}
): Promise<RecordCheckResult> {
  const planned = input.option === 'as_planned';
  // A note on "As planned" has no box to be read in, so it is not kept.
  // The note is rich text (KD #205): sanitised on the way in, "empty" is no
  // prose, and the cap counts what was typed rather than the markup.
  const note = planned ? null : normalizeRichText(input.note);
  if (!planned && isEmptyRichText(note)) {
    return fail(422, CHECK_NOTE_REQUIRED);
  }
  if (note && proseLength(note) > CHECK_NOTE_MAX) {
    return fail(422, `Keep the note to ${CHECK_NOTE_MAX} characters or fewer.`);
  }

  const { data, error } = await service
    .from('schemes_of_work')
    .select('id, subject_id, term_id, level_id, approved_snapshot')
    .eq('id', input.sowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return fail(404, 'That scheme of work could not be found.');
  const sow = data as {
    id: string;
    subject_id: string;
    term_id: string;
    level_id: string;
    approved_snapshot: unknown;
  };
  const snapshot = readSnapshot(sow.approved_snapshot);
  if (!snapshot) return fail(423, CHECK_NOT_APPROVED);

  const [classRes, assignments, termWeeks, signoffRes] = await Promise.all([
    service
      .from('scheme_of_work_classes')
      .select('section_id')
      .eq('sow_id', sow.id)
      .eq('section_id', input.sectionId)
      .maybeSingle(),
    loadEffectiveAssignmentsForUser(service, actor.id),
    loadTermWeeks(service, sow.term_id, sow.level_id),
    service
      .from('scheme_of_work_signoffs')
      .select('week_number, section_id, kind, created_at')
      .eq('sow_id', sow.id)
      .eq('week_number', input.weekNumber)
      .eq('section_id', input.sectionId),
  ]);
  if (classRes.error) throw new Error(classRes.error.message);
  if (signoffRes.error) throw new Error(signoffRes.error.message);
  if (!classRes.data) {
    return fail(404, "That class doesn't follow this scheme of work.");
  }
  if (
    !assignments.some((a) =>
      holdsClass(a, actor.id, sow.subject_id, input.sectionId)
    )
  ) {
    return fail(403, CHECK_NOT_TEACHER);
  }

  const week = termWeeks.weeks.find(
    (w): w is Extract<TermWeek, { kind: 'week' }> =>
      w.kind === 'week' && w.weekNumber === input.weekNumber
  );
  if (!week || !snapshot.weeks.some((w) => w.weekNumber === input.weekNumber)) {
    return fail(404, 'That week could not be found.');
  }
  // The check opens on the week's first day (spec §5.1).
  if ((opts.today ?? sgToday()) < week.startsOn) {
    return fail(422, CHECK_NOT_STARTED);
  }
  if (isSigned((signoffRes.data ?? []) as SignoffRow[])) {
    return fail(423, CHECK_WEEK_SIGNED);
  }

  const { data: inserted, error: insertError } = await service
    .from('scheme_of_work_checks')
    .insert({
      sow_id: sow.id,
      week_number: input.weekNumber,
      section_id: input.sectionId,
      teacher_user_id: actor.id,
      option: input.option,
      note,
    })
    .select('id')
    .single();
  if (insertError) throw new Error(insertError.message);

  await logAction({
    service,
    actor: { id: actor.id, email: actor.email, role: actor.role ?? null },
    action: 'sow.check',
    entityType: 'scheme_of_work',
    entityId: sow.id,
    // THAT there was a note, never what it said.
    context: {
      week_number: input.weekNumber,
      section_id: input.sectionId,
      option: input.option,
      note_present: note !== null,
    },
  });
  return { ok: true, checkId: (inserted as { id: string }).id };
}

export type CheckRow = {
  week_number: number;
  section_id: string;
  teacher_user_id: string;
  option: CheckOption;
  note: string | null;
  recorded_at: string;
};

/**
 * The newest row per (week, class, teacher). Sorted here rather than trusted
 * to the query's order; on equal times the later row in the list wins.
 */
export function latestChecks(rows: CheckRow[]): CheckRow[] {
  const byKey = new Map<string, CheckRow>();
  const ordered = rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) => a.r.recorded_at.localeCompare(b.r.recorded_at) || a.i - b.i
    );
  for (const { r } of ordered) {
    byKey.set(`${r.week_number}|${r.section_id}|${r.teacher_user_id}`, r);
  }
  return [...byKey.values()];
}

// ── The page's read ─────────────────────────────────────────────────────────

export type SowCheckClass = {
  sectionId: string;
  name: string;
  mark: CellMark;
  /** The subject head signed this class's week. */
  signed: boolean;
  /** Each teacher's latest note, where the week didn't go as planned. */
  notes: { option: CheckOption; note: string }[];
  /** The viewer takes this class, so they check it. */
  canCheck: boolean;
  /** The viewer's own latest check on it. */
  mine: { option: CheckOption; note: string | null } | null;
  /** What relief teachers covered in this class that week (Task 14). */
  reliefNotes: { taughtOn: string; name: string; note: string }[];
  /**
   * The subject head's "Ask the teacher" remarks, while they are still the
   * last word on this week (`openAsk`). Rich text.
   */
  asked: { remarks: string; at: string } | null;
};

export type SowCheckWeek = {
  weekNumber: number;
  startsOn: string;
  endsOn: string;
  topic: string | null;
  learningOutcomes: string | null;
  activities: string | null;
  assessment: string | null;
  events: string[];
  /** Today is on or after its first day. */
  started: boolean;
  /** Today is after its last day. */
  ended: boolean;
  classes: SowCheckClass[];
};

export type SowChecking = {
  /** The week today falls in (Singapore), if any. */
  thisWeekNumber: number | null;
  weeks: SowCheckWeek[];
  /** The viewer checks at least one of its classes. */
  canCheck: boolean;
  /** "Weeks 1–2 checked · 1 adjusted · supervisor signed both". */
  summary: string;
};

/**
 * Everything the "How did Week N go?" block reads, from the approved
 * snapshot. Null when the scheme has no approved plan.
 *
 * `teacher_assignments` is read for WHO MUST CHECK a class: the holders
 * (`teacher_user_id`) of a subject or co-teacher row — never the relief
 * column, so cover does not add a teacher the week waits on.
 */
export async function loadSowChecking(
  service: SupabaseClient,
  input: {
    viewerId: string;
    sowId: string;
    subjectId: string;
    approvedSnapshot: unknown;
    termWeeks: TermWeek[];
    eventsByWeek: Map<number, string[]>;
    classes: { sectionId: string; name: string }[];
    viewerAssignments: EffectiveAssignmentRow[];
    today?: string;
  }
): Promise<SowChecking | null> {
  const snapshot = readSnapshot(input.approvedSnapshot);
  if (!snapshot) return null;
  const today = input.today ?? sgToday();
  const sectionIds = input.classes.map((c) => c.sectionId);

  const [assignRes, checkRes, signRes, reliefRes] = await Promise.all([
    sectionIds.length > 0
      ? service
          .from('teacher_assignments')
          .select('teacher_user_id, section_id, role')
          .eq('subject_id', input.subjectId)
          .in('section_id', sectionIds)
      : Promise.resolve({ data: [], error: null }),
    service
      .from('scheme_of_work_checks')
      .select(
        'week_number, section_id, teacher_user_id, option, note, recorded_at'
      )
      .eq('sow_id', input.sowId),
    service
      .from('scheme_of_work_signoffs')
      .select('week_number, section_id, kind, remarks, created_at')
      .eq('sow_id', input.sowId),
    // Relief notes (lib/sow/relief.ts): shown on their week so the subject
    // teacher and the supervisor see what the cover taught.
    service
      .from('scheme_of_work_relief_notes')
      .select(
        'week_number, section_id, taught_on, relief_teacher_user_id, note'
      )
      .eq('sow_id', input.sowId),
  ]);
  for (const r of [assignRes, checkRes, signRes, reliefRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  type ReliefRow = {
    week_number: number | null;
    section_id: string;
    taught_on: string;
    relief_teacher_user_id: string;
    note: string;
  };
  const reliefRows = (reliefRes.data ?? []) as ReliefRow[];
  // Names only when there is a note to put one on; a failed lookup leaves the
  // note unattributed rather than failing the page.
  let staffName = new Map<string, string>();
  if (reliefRows.length > 0) {
    try {
      staffName = new Map(await getStaffDisplayNameById());
    } catch {
      staffName = new Map();
    }
  }
  const reliefAt = new Map<string, SowCheckClass['reliefNotes']>();
  for (const r of [...reliefRows].sort((a, b) =>
    a.taught_on.localeCompare(b.taught_on)
  )) {
    if (r.week_number == null) continue;
    const k = `${r.week_number}|${r.section_id}`;
    reliefAt.set(k, [
      ...(reliefAt.get(k) ?? []),
      {
        taughtOn: r.taught_on,
        name: staffName.get(r.relief_teacher_user_id) ?? 'Relief teacher',
        note: r.note,
      },
    ]);
  }

  const teachersOf = new Map<string, Set<string>>();
  for (const a of (assignRes.data ?? []) as {
    teacher_user_id: string;
    section_id: string;
    role: string;
  }[]) {
    if (!isSubjectRole(a.role)) continue;
    const set = teachersOf.get(a.section_id) ?? new Set<string>();
    set.add(a.teacher_user_id);
    teachersOf.set(a.section_id, set);
  }

  const signoffRows = (signRes.data ?? []) as SignoffRow[];
  const latest = latestChecks(
    checksAsSigned((checkRes.data ?? []) as CheckRow[], signoffRows)
  );
  const checksAt = new Map<string, CheckRow[]>();
  for (const c of latest) {
    const k = `${c.week_number}|${c.section_id}`;
    checksAt.set(k, [...(checksAt.get(k) ?? []), c]);
  }
  const signoffsAt = new Map<string, SignoffRow[]>();
  for (const s of signoffRows) {
    const k = `${s.week_number}|${s.section_id}`;
    signoffsAt.set(k, [...(signoffsAt.get(k) ?? []), s]);
  }

  const mineIds = new Set(
    sectionIds.filter((id) =>
      input.viewerAssignments.some((a) =>
        holdsClass(a, input.viewerId, input.subjectId, id)
      )
    )
  );

  const termWeek = new Map(
    input.termWeeks
      .filter(
        (w): w is Extract<TermWeek, { kind: 'week' }> => w.kind === 'week'
      )
      .map((w) => [w.weekNumber, w])
  );

  const weeks: SowCheckWeek[] = [...snapshot.weeks]
    .filter((w) => termWeek.has(w.weekNumber))
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((w) => {
      const tw = termWeek.get(w.weekNumber)!;
      const ended = today > tw.endsOn;
      return {
        weekNumber: w.weekNumber,
        startsOn: tw.startsOn,
        endsOn: tw.endsOn,
        topic: w.topic ?? null,
        learningOutcomes: w.learningOutcomes ?? null,
        activities: w.activities ?? null,
        assessment: w.assessment ?? null,
        events: input.eventsByWeek.get(w.weekNumber) ?? [],
        started: today >= tw.startsOn,
        ended,
        classes: input.classes.map((c) => {
          const k = `${w.weekNumber}|${c.sectionId}`;
          const rows = checksAt.get(k) ?? [];
          const own = rows.find((r) => r.teacher_user_id === input.viewerId);
          return {
            sectionId: c.sectionId,
            name: c.name,
            mark: cellMark({
              teacherIds: [...(teachersOf.get(c.sectionId) ?? [])],
              latestChecks: rows.map((r) => ({
                teacherUserId: r.teacher_user_id,
                option: r.option,
              })),
              weekEnded: ended,
            }),
            signed: isSigned(signoffsAt.get(k) ?? []),
            notes: rows
              .filter((r) => r.option !== 'as_planned' && r.note)
              .map((r) => ({ option: r.option, note: r.note as string })),
            canCheck: mineIds.has(c.sectionId),
            mine: own ? { option: own.option, note: own.note } : null,
            reliefNotes: reliefAt.get(k) ?? [],
            asked: openAsk(signoffsAt.get(k) ?? [], rows),
          };
        }),
      };
    });

  const thisWeek = weeks.find((w) => w.startsOn <= today && today <= w.endsOn);
  return {
    thisWeekNumber: thisWeek?.weekNumber ?? null,
    weeks,
    canCheck: mineIds.size > 0,
    summary: checkSummary(weeks),
  };
}

/** "1–2, 4" from [1, 2, 4]. */
function weekRanges(ns: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    parts.push(i === j ? `${ns[i]}` : `${ns[i]}–${ns[j]}`);
    i = j;
  }
  return parts.join(', ');
}

/**
 * The line over the term view (board 7): which weeks every class has checked,
 * how many class-weeks did not go as planned (by option), how many ended
 * unchecked, and how far the subject head has signed.
 */
export function checkSummary(weeks: SowCheckWeek[]): string {
  const done = weeks.filter(
    (w) =>
      w.classes.length > 0 &&
      w.classes.every((c) => c.mark === 'ok' || c.mark === 'note')
  );
  const parts: string[] = [];
  parts.push(
    done.length === 0
      ? 'No weeks checked yet'
      : `${done.length === 1 ? 'Week' : 'Weeks'} ${weekRanges(done.map((w) => w.weekNumber))} checked`
  );

  const byOption: Record<'adjusted' | 'delayed' | 'extra', number> = {
    adjusted: 0,
    delayed: 0,
    extra: 0,
  };
  let missed = 0;
  for (const w of weeks) {
    for (const c of w.classes) {
      if (c.mark === 'missed') missed += 1;
      for (const option of ['adjusted', 'delayed', 'extra'] as const) {
        if (c.notes.some((n) => n.option === option)) byOption[option] += 1;
      }
    }
  }
  if (byOption.adjusted > 0) parts.push(`${byOption.adjusted} adjusted`);
  if (byOption.delayed > 0) parts.push(`${byOption.delayed} delayed`);
  if (byOption.extra > 0) {
    parts.push(`${byOption.extra} with ${CHECK_LABELS.extra.toLowerCase()}`);
  }
  if (missed > 0) parts.push(`${missed} not checked`);

  if (done.length > 0) {
    const signed = done.filter((w) => w.classes.every((c) => c.signed)).length;
    if (signed === done.length) {
      parts.push(
        done.length === 1
          ? 'supervisor signed it'
          : done.length === 2
            ? 'supervisor signed both'
            : 'supervisor signed all'
      );
    } else if (signed > 0) {
      parts.push(`supervisor signed ${signed} of ${done.length}`);
    } else {
      parts.push('not signed yet');
    }
  }
  return parts.join(' · ');
}
