import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import type { Role } from '@/lib/auth/roles';
import { sgDate, sgToday } from '@/lib/dates';
import {
  isEmptyRichText,
  normalizeRichText,
  proseLength,
  toPlainText,
} from '@/lib/rich-text';
import { SOW_APPROVAL_FLOW } from '@/lib/schemas/approval-flows';
import { type SowSnapshot, SowSnapshotSchema } from '@/lib/schemas/sow';
import { isSubjectRole } from '@/lib/schemas/teacher-assignment';
import { compareLevelLabels } from '@/lib/sis/levels';
import { subjectDisplayName } from '@/lib/sis/subjects/display-name';
import { type SowState, type SowTrack, trackOf } from '@/lib/sow/access';
import {
  type CellMark,
  CHECK_LABELS,
  type CheckOption,
  type CheckRow,
  cellMark,
  checksAsSigned,
  latestChecks,
  newestSignoff,
  SIGNOFF_REMARKS_MAX,
  type SignoffRow,
} from '@/lib/sow/checks';
import type { SowActor } from '@/lib/sow/create';
import { listSowReviewQueue, loadSowStepLabels } from '@/lib/sow/review';
import { type SubjectHeadRow, subjectHeadPool } from '@/lib/sow/subject-heads';
import {
  loadTermWeeks,
  loadTermWeeksForLevels,
  type TermWeek,
} from '@/lib/sow/weeks';
import { fetchAllPages } from '@/lib/supabase/paginate';

// Scheme of work oversight (spec §5.3, boards 9–11): every scheme of the term
// with its state, the weekly-checks grid, "Needs a look", and the subject
// head's sign-off of a class's week.
//
// WHO SEES WHAT (spec §5.3, "our call"):
//   office roles                            → everything
//   a subject head                          → their subjects (one half, if
//                                             their row is scoped to one)
//   anyone on a named step of the SOW flow  → every subject in the half their
//     (the OIC, the Asst P, the AEB)          row is scoped to; everything when
//                                             it is unscoped
//   anyone else                             → nothing (a 403 page)
// Somebody holding several of these sees the union.
//
// WHO SIGNS: only a head of THAT scheme's subject, for its half. Seeing a
// week is not signing it — the office and the approvers oversee, the subject
// head signs ("Signed by subject head", board 7).
//
// ⚠ EVERY READ IS BATCHED. The grid is classes × weeks; nothing here asks the
// database per row or per cell. `loadOversight` reads the term's schemes,
// checks, sign-offs and relief notes in one wave each.

export type LevelType = 'primary' | 'secondary';

export type OversightScope =
  | { all: true }
  | {
      all: false;
      /** Subjects the viewer heads (each limited by `heads`' half). */
      subjectIds: string[];
      /** Halves the viewer sees EVERY subject in, from a step of the flow. */
      levelTypes: LevelType[];
      /** The viewer's subject-head rows; null half = both halves. */
      heads: { subjectId: string; levelType: LevelType | null }[];
    };

const OFFICE_ROLES: ReadonlySet<Role> = new Set<Role>([
  'academic_coordinator',
  'school_admin',
  'superadmin',
]);

const asLevelType = (v: unknown): LevelType | null =>
  v === 'primary' || v === 'secondary' ? v : null;

/**
 * How much of the oversight page this person sees; null = none of it.
 *
 * Named steps are the flow's ACTIVE `named` steps: a retired step no longer
 * makes anyone an approver, and a `subject_head` step lists nobody (its people
 * are the subject heads, read on their own). A step row scoped to preschool
 * covers no scheme of work, so it adds nothing.
 */
export async function resolveOversightScope(
  service: SupabaseClient,
  userId: string,
  role: Role | null
): Promise<OversightScope | null> {
  if (role && OFFICE_ROLES.has(role)) return { all: true };

  const [headRes, stageRes] = await Promise.all([
    service
      .from('subject_heads')
      .select('subject_id, applies_to_level_type')
      .eq('user_id', userId),
    service
      .from('approval_stages')
      .select('id')
      .eq('flow', SOW_APPROVAL_FLOW)
      .eq('is_active', true)
      .eq('resolver', 'named'),
  ]);
  if (headRes.error) throw new Error(headRes.error.message);
  if (stageRes.error) throw new Error(stageRes.error.message);

  const stageIds = ((stageRes.data ?? []) as { id: string }[]).map((s) => s.id);
  let stepScopes: (LevelType | null | 'preschool')[] = [];
  if (stageIds.length > 0) {
    const { data, error } = await service
      .from('approval_stage_approvers')
      .select('applies_to_level_type')
      .eq('user_id', userId)
      .in('stage_id', stageIds);
    if (error) throw new Error(error.message);
    stepScopes = (
      (data ?? []) as { applies_to_level_type: string | null }[]
    ).map((r) =>
      r.applies_to_level_type === 'preschool'
        ? ('preschool' as const)
        : asLevelType(r.applies_to_level_type)
    );
  }
  // Unscoped on any step: every subject, both halves.
  if (stepScopes.some((s) => s === null)) return { all: true };
  const levelTypes = [
    ...new Set(stepScopes.filter((s): s is LevelType => s !== 'preschool')),
  ].sort();

  const heads = (
    (headRes.data ?? []) as {
      subject_id: string;
      applies_to_level_type: string | null;
    }[]
  ).map((r) => ({
    subjectId: r.subject_id,
    levelType: asLevelType(r.applies_to_level_type),
  }));
  const subjectIds = [...new Set(heads.map((h) => h.subjectId))];

  if (subjectIds.length === 0 && levelTypes.length === 0) return null;
  return { all: false, subjectIds, levelTypes, heads };
}

/** Does this scope take in a scheme of this subject and half? */
export function inOversightScope(
  scope: OversightScope,
  sow: { subjectId: string; levelType: LevelType | null }
): boolean {
  if (scope.all) return true;
  if (sow.levelType && scope.levelTypes.includes(sow.levelType)) return true;
  return scope.heads.some(
    (h) =>
      h.subjectId === sow.subjectId &&
      (h.levelType === null || h.levelType === sow.levelType)
  );
}

// ── The weekly-checks grid (board 10) ───────────────────────────────────────

export type GridSow = {
  id: string;
  subjectId: string;
  subjectName: string;
  levelId: string;
  levelLabel: string;
  levelType: LevelType | null;
  track: SowTrack;
  snapshot: SowSnapshot;
  sectionIds: string[];
};

export type GridCheck = {
  teacherUserId: string;
  name: string;
  role: 'subject_teacher' | 'co_teacher' | null;
  option: CheckOption;
  note: string | null;
  recordedAt: string;
};

export type GridCell = {
  weekNumber: number;
  startsOn: string;
  endsOn: string;
  started: boolean;
  ended: boolean;
  mark: CellMark;
  /** The newest sign-off row is a signature (shown underlined). */
  signed: boolean;
  /** Each teacher's latest check, as it stood when the week was signed. */
  checks: GridCheck[];
  reliefNotes: { taughtOn: string; name: string; note: string }[];
  /** The newest sign-off row, signature or "Ask the teacher". */
  signoff: {
    kind: 'signed' | 'asked';
    remarks: string | null;
    at: string;
    by: string;
  } | null;
};

/**
 * The planned row of each week, ONCE per scheme (not per class): sowId →
 * week number → plan. The drawer reads it; the cells carry no plan HTML.
 */
export type SowPlans = Record<
  string,
  Record<
    number,
    {
      topic: string | null;
      activities: string | null;
      assessment: string | null;
    }
  >
>;

export function buildPlans(sows: GridSow[]): SowPlans {
  const out: SowPlans = {};
  for (const sow of sows) {
    out[sow.id] = {};
    for (const w of sow.snapshot.weeks) {
      out[sow.id][w.weekNumber] = {
        topic: w.topic ?? null,
        activities: w.activities ?? null,
        assessment: w.assessment ?? null,
      };
    }
  }
  return out;
}

export type GridRow = {
  /** `${sowId}|${sectionId}` */
  id: string;
  sowId: string;
  sectionId: string;
  /** "Secondary Two Integrity 1" — the level's label, then the section's. */
  className: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  levelId: string;
  levelLabel: string;
  levelType: LevelType | null;
  track: SowTrack;
  /** The week today falls in for this level, if any. */
  currentWeek: number | null;
  /** The viewer heads this subject for this half, so signs its weeks. */
  canSign: boolean;
  /** Who checks the class: its subject and co-teachers. */
  teachers: {
    userId: string;
    name: string;
    role: 'subject_teacher' | 'co_teacher';
  }[];
  cells: GridCell[];
};

type AssignmentLite = {
  teacher_user_id: string;
  section_id: string;
  subject_id: string | null;
  role: string;
};

type ReliefLite = {
  sow_id: string | null;
  week_number: number | null;
  section_id: string;
  taught_on: string;
  relief_teacher_user_id: string;
  note: string;
};

export type GridSignoff = SignoffRow & { sow_id: string; signed_by: string };

/**
 * One row per class × subject of a scheme with an approved plan; one cell per
 * planned week the term still has. Pure: every row it needs arrives as input.
 */
export function buildCheckGrid(input: {
  sows: GridSow[];
  sectionNames: Map<string, string>;
  termWeeks: Map<string, TermWeek[]>;
  assignments: AssignmentLite[];
  checks: (CheckRow & { sow_id: string })[];
  signoffs: GridSignoff[];
  reliefNotes: ReliefLite[];
  names: Map<string, string>;
  heads: SubjectHeadRow[];
  viewerId: string;
  today: string;
}): GridRow[] {
  const nameOf = (id: string, fallback: string) =>
    input.names.get(id) ?? fallback;

  const bySow = <T extends { sow_id: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      if (!r.sow_id) continue;
      m.set(r.sow_id, [...(m.get(r.sow_id) ?? []), r]);
    }
    return m;
  };
  const checksBySow = bySow(input.checks);
  const signoffsBySow = bySow(input.signoffs);
  const reliefBySow = bySow(input.reliefNotes);

  const rows: GridRow[] = [];
  for (const sow of input.sows) {
    const termWeek = new Map(
      (input.termWeeks.get(sow.levelId) ?? [])
        .filter(
          (w): w is Extract<TermWeek, { kind: 'week' }> => w.kind === 'week'
        )
        .map((w) => [w.weekNumber, w])
    );
    const planned = [...sow.snapshot.weeks]
      .filter((w) => termWeek.has(w.weekNumber))
      .sort((a, b) => a.weekNumber - b.weekNumber);
    const current =
      [...termWeek.values()].find(
        (w) => w.startsOn <= input.today && input.today <= w.endsOn
      )?.weekNumber ?? null;

    const sowSignoffs = signoffsBySow.get(sow.id) ?? [];
    const latest = latestChecks(
      checksAsSigned(checksBySow.get(sow.id) ?? [], sowSignoffs)
    );
    const canSign = subjectHeadPool(
      input.heads,
      sow.subjectId,
      sow.levelType
    ).includes(input.viewerId);

    for (const sectionId of sow.sectionIds) {
      const teachers = input.assignments
        .filter(
          (a) =>
            a.section_id === sectionId &&
            a.subject_id === sow.subjectId &&
            isSubjectRole(a.role)
        )
        .map((a) => ({
          userId: a.teacher_user_id,
          name: nameOf(a.teacher_user_id, 'Teacher'),
          role: a.role as 'subject_teacher' | 'co_teacher',
        }))
        // The subject teacher first, then co-teachers.
        .sort((a, b) =>
          a.role === b.role
            ? a.name.localeCompare(b.name)
            : a.role === 'subject_teacher'
              ? -1
              : 1
        );
      const roleOf = new Map(teachers.map((t) => [t.userId, t.role]));

      const cells: GridCell[] = planned.map((w) => {
        const tw = termWeek.get(w.weekNumber)!;
        const ended = input.today > tw.endsOn;
        const here = latest.filter(
          (c) => c.week_number === w.weekNumber && c.section_id === sectionId
        );
        const newest = newestSignoff(
          sowSignoffs.filter(
            (s) => s.week_number === w.weekNumber && s.section_id === sectionId
          )
        );
        return {
          weekNumber: w.weekNumber,
          startsOn: tw.startsOn,
          endsOn: tw.endsOn,
          started: input.today >= tw.startsOn,
          ended,
          mark: cellMark({
            teacherIds: teachers.map((t) => t.userId),
            latestChecks: here.map((c) => ({
              teacherUserId: c.teacher_user_id,
              option: c.option,
            })),
            weekEnded: ended,
          }),
          signed: newest?.kind === 'signed',
          checks: here.map((c) => ({
            teacherUserId: c.teacher_user_id,
            name: nameOf(c.teacher_user_id, 'Teacher'),
            role: roleOf.get(c.teacher_user_id) ?? null,
            option: c.option,
            note: c.note,
            recordedAt: c.recorded_at,
          })),
          reliefNotes: (reliefBySow.get(sow.id) ?? [])
            .filter(
              (r) =>
                r.week_number === w.weekNumber && r.section_id === sectionId
            )
            .sort((a, b) => a.taught_on.localeCompare(b.taught_on))
            .map((r) => ({
              taughtOn: r.taught_on,
              name: nameOf(r.relief_teacher_user_id, 'Relief teacher'),
              note: r.note,
            })),
          signoff: newest
            ? {
                kind: newest.kind,
                remarks: newest.remarks ?? null,
                at: newest.created_at,
                by: nameOf(newest.signed_by, 'Subject head'),
              }
            : null,
        };
      });

      rows.push({
        id: `${sow.id}|${sectionId}`,
        sowId: sow.id,
        sectionId,
        // Section names repeat across levels in some years, so the label
        // always leads with the level (board 10: "Sec 2 Integrity 1").
        className:
          `${sow.levelLabel} ${input.sectionNames.get(sectionId) ?? 'Class'}`.trim(),
        sectionName: input.sectionNames.get(sectionId) ?? 'Class',
        subjectId: sow.subjectId,
        subjectName: sow.subjectName,
        levelId: sow.levelId,
        levelLabel: sow.levelLabel,
        levelType: sow.levelType,
        track: sow.track,
        currentWeek: current,
        canSign,
        teachers,
        cells,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      compareLevelLabels(a.levelLabel, b.levelLabel) ||
      a.className.localeCompare(b.className) ||
      a.subjectName.localeCompare(b.subjectName)
  );
}

// ── Needs a look (board 10) ─────────────────────────────────────────────────

export type NeedsALookItem = {
  /** Stable key: `${rowId}|${weekNumber}|${kind}`. */
  id: string;
  rowId: string;
  kind: 'note' | 'missed' | 'run';
  /** The week "Review and sign" opens — a run's latest week. */
  weekNumber: number;
  /** "Sec 2 Integrity 1 · Science, Wk 3". */
  who: string;
  /** "Delayed: “Lab not available Tuesday.”" */
  note: string;
};

const RUN_WORDS = ['', '', 'two', 'three', 'four', 'five', 'six'];

/** The first teacher note of a cell, as plain text. */
function firstNote(cell: GridCell): { option: CheckOption; text: string } {
  const c = cell.checks.find(
    (x) => x.option !== 'as_planned' && x.note && !isEmptyRichText(x.note)
  );
  return c
    ? { option: c.option, text: toPlainText(c.note).trim() }
    : { option: 'adjusted', text: '' };
}

const quoted = (text: string) => (text ? `: “${text}”` : '');

/**
 * What the supervisor should open first, in grid order:
 *
 *   - a week with a note (Adjusted, Delayed or Extra activities);
 *   - a week that is over and was never checked;
 *   - a class with a note two (or more) weeks running — one item for the
 *     run, opening its latest week, in place of one item per week.
 *
 * A single week already signed has been looked at, so it drops off; a run
 * stays while any week of it is unsigned. Weeks after the row's OWN current
 * week are not read (a level-only closure can number one level's weeks
 * differently); `currentWeek` is the fallback for a row outside the term's
 * weeks today.
 */
export function needsALook(
  rows: GridRow[],
  currentWeek: number
): NeedsALookItem[] {
  const items: NeedsALookItem[] = [];
  for (const row of rows) {
    const label = `${row.className} · ${row.subjectName}`;
    const upTo = row.currentWeek ?? currentWeek;
    const cells = row.cells.filter((c) => c.weekNumber <= upTo);
    let i = 0;
    while (i < cells.length) {
      const cell = cells[i];
      if (cell.mark === 'note') {
        // A run of consecutive weeks with a note.
        let j = i;
        while (
          j + 1 < cells.length &&
          cells[j + 1].mark === 'note' &&
          cells[j + 1].weekNumber === cells[j].weekNumber + 1
        ) {
          j += 1;
        }
        const run = cells.slice(i, j + 1);
        if (run.length >= 2) {
          if (run.some((c) => !c.signed)) {
            const last = run[run.length - 1];
            const notes = run.map(firstNote);
            const same = notes.every((n) => n.option === notes[0].option);
            const what = same
              ? CHECK_LABELS[notes[0].option]
              : 'Not as planned';
            const count = RUN_WORDS[run.length] ?? String(run.length);
            items.push({
              id: `${row.id}|${last.weekNumber}|run`,
              rowId: row.id,
              kind: 'run',
              weekNumber: last.weekNumber,
              who: `${label}, Wk ${run[0].weekNumber}–${last.weekNumber}`,
              note: `${what} ${count} weeks running${quoted(notes[notes.length - 1].text)}`,
            });
          }
        } else if (!cell.signed) {
          const n = firstNote(cell);
          items.push({
            id: `${row.id}|${cell.weekNumber}|note`,
            rowId: row.id,
            kind: 'note',
            weekNumber: cell.weekNumber,
            who: `${label}, Wk ${cell.weekNumber}`,
            note: `${CHECK_LABELS[n.option]}${quoted(n.text)}`,
          });
        }
        i = j + 1;
        continue;
      }
      if (cell.mark === 'missed' && !cell.signed) {
        items.push({
          id: `${row.id}|${cell.weekNumber}|missed`,
          rowId: row.id,
          kind: 'missed',
          weekNumber: cell.weekNumber,
          who: `${label}, Wk ${cell.weekNumber}`,
          note: `Week ${cell.weekNumber} is over and was never checked.`,
        });
      }
      i += 1;
    }
  }
  return items;
}

// ── Signing (board 11) ──────────────────────────────────────────────────────

export const SIGNOFF_NOT_HEAD = 'Only the subject head signs off weeks.';
export const SIGNOFF_REMARKS_REQUIRED =
  'Say what you would like the teacher to look at.';
export { SIGNOFF_REMARKS_MAX };

/**
 * The capability a viewer gets on one scheme once oversight is counted: an
 * overseer whose scope takes the scheme in may READ it (they open it from the
 * oversight page); nothing here ever grants 'edit', and a capability the
 * viewer already has is left as it is.
 */
export function withOversightRead(
  capability: 'edit' | 'read' | 'none',
  scope: OversightScope | null,
  sow: { subjectId: string; levelType: LevelType | null }
): 'edit' | 'read' | 'none' {
  if (capability !== 'none' || !scope) return capability;
  return inOversightScope(scope, sow) ? 'read' : 'none';
}

export type RecordSignoffResult =
  | { ok: true; signoffId: string }
  | { ok: false; status: 403 | 404 | 422 | 423; error: string };

const fail = (
  status: 403 | 404 | 422 | 423,
  error: string
): RecordSignoffResult => ({ ok: false, status, error });

/**
 * "Sign Week N" or "Ask the teacher" on one class's week.
 *
 * Append-only, like the checks: a signature after an ask, or an ask after a
 * signature, is a new row and the newest row is the week's state. Asking
 * re-opens the week for the teacher (`recordCheck` reads the newest row), and
 * shows them the remarks on the scheme's page until they check again or the
 * week is signed (`openAsk`).
 *
 * An open ask is also a to-do for the class's teachers on their Classroom
 * home (`lib/sow/home.ts`, read with `openAsk` over this table). Nothing is
 * sent as a notification.
 */
export async function recordSignoff(
  service: SupabaseClient,
  actor: SowActor,
  input: {
    sowId: string;
    weekNumber: number;
    sectionId: string;
    kind: 'signed' | 'asked';
    remarks: string;
  },
  opts: { today?: string } = {}
): Promise<RecordSignoffResult> {
  // Rich text (KD #205): sanitised in, "empty" is no prose, capped on what
  // was typed.
  const normalized = normalizeRichText(input.remarks);
  const remarks = isEmptyRichText(normalized) ? null : normalized;
  if (input.kind === 'asked' && !remarks) {
    return fail(422, SIGNOFF_REMARKS_REQUIRED);
  }
  if (remarks && proseLength(remarks) > SIGNOFF_REMARKS_MAX) {
    return fail(
      422,
      `Keep the remarks to ${SIGNOFF_REMARKS_MAX} characters or fewer.`
    );
  }

  const { data, error } = await service
    .from('schemes_of_work')
    .select('id, subject_id, level_id, term_id, approved_snapshot')
    .eq('id', input.sowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return fail(404, 'That scheme of work could not be found.');
  const sow = data as {
    id: string;
    subject_id: string;
    level_id: string;
    term_id: string;
    approved_snapshot: unknown;
  };
  const snapshot = readSnapshot(sow.approved_snapshot);
  if (!snapshot) {
    return fail(
      423,
      "This scheme of work isn't approved yet, so its weeks can't be signed."
    );
  }

  const [levelRes, headRes, classRes] = await Promise.all([
    service
      .from('levels')
      .select('level_type')
      .eq('id', sow.level_id)
      .maybeSingle(),
    service
      .from('subject_heads')
      .select('subject_id, user_id, applies_to_level_type')
      .eq('subject_id', sow.subject_id),
    service
      .from('scheme_of_work_classes')
      .select('section_id')
      .eq('sow_id', sow.id)
      .eq('section_id', input.sectionId)
      .maybeSingle(),
  ]);
  for (const r of [levelRes, headRes, classRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  const levelType = asLevelType(
    (levelRes.data as { level_type?: string } | null)?.level_type
  );
  const heads: SubjectHeadRow[] = (
    (headRes.data ?? []) as {
      subject_id: string;
      user_id: string;
      applies_to_level_type: string | null;
    }[]
  ).map((r) => ({
    subjectId: r.subject_id,
    userId: r.user_id,
    appliesToLevelType: asLevelType(r.applies_to_level_type),
  }));
  if (!subjectHeadPool(heads, sow.subject_id, levelType).includes(actor.id)) {
    return fail(403, SIGNOFF_NOT_HEAD);
  }
  if (!classRes.data) {
    return fail(404, "That class doesn't follow this scheme of work.");
  }

  const { weeks } = await loadTermWeeks(service, sow.term_id, sow.level_id);
  const week = weeks.find(
    (w): w is Extract<TermWeek, { kind: 'week' }> =>
      w.kind === 'week' && w.weekNumber === input.weekNumber
  );
  if (!week || !snapshot.weeks.some((w) => w.weekNumber === input.weekNumber)) {
    return fail(404, 'That week could not be found.');
  }
  if ((opts.today ?? sgToday()) < week.startsOn) {
    return fail(422, "This week hasn't started yet.");
  }

  const { data: inserted, error: insertError } = await service
    .from('scheme_of_work_signoffs')
    .insert({
      sow_id: sow.id,
      week_number: input.weekNumber,
      section_id: input.sectionId,
      signed_by: actor.id,
      kind: input.kind,
      remarks,
    })
    .select('id')
    .single();
  if (insertError) throw new Error(insertError.message);

  await logAction({
    service,
    actor: { id: actor.id, email: actor.email, role: actor.role ?? null },
    action: input.kind === 'signed' ? 'sow.sign' : 'sow.ask',
    entityType: 'scheme_of_work',
    entityId: sow.id,
    // THAT there were remarks, never what they said.
    context: {
      week_number: input.weekNumber,
      section_id: input.sectionId,
      remarks_present: remarks !== null,
    },
  });
  return { ok: true, signoffId: (inserted as { id: string }).id };
}

function readSnapshot(raw: unknown): SowSnapshot | null {
  if (raw == null) return null;
  const parsed = SowSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ── The page's read ─────────────────────────────────────────────────────────

export type OversightSowRow = {
  /** `${subjectId}|${levelId}|${track}` */
  id: string;
  sowId: string | null;
  subjectId: string;
  subjectName: string;
  levelId: string;
  levelLabel: string;
  levelType: LevelType | null;
  track: SowTrack;
  classes: string[];
  teachers: string[];
  /** null = no scheme of work yet. */
  state: SowState | null;
  /** The step it waits on (in review) or that returned it. */
  step: string | null;
  /** Its live step is the viewer's to decide. */
  waitingOnYou: boolean;
  /** "6 days", "With the teacher", "Not sent", "Term started 23 Mar", "—". */
  waiting: string;
};

export type OversightData = {
  /** Levels with something in the viewer's scope, in school order. */
  levels: { id: string; label: string }[];
  /** The one level everything below is for; null when there is none. */
  levelId: string | null;
  levelLabel: string | null;
  sows: OversightSowRow[];
  grid: GridRow[];
  plans: SowPlans;
  needsALook: NeedsALookItem[];
  /** The week most classes are in today; null outside the term's weeks. */
  currentWeek: number | null;
  /** The highest week number any row has (the grid's columns run 1…this). */
  weekCount: number;
  tiles: {
    approved: number;
    total: number;
    notStarted: number;
    waitingOnYou: number;
    /** Classes whose current week is checked, of those that have it. */
    checkedThisWeek: { checked: number; of: number } | null;
  };
};

type SchemeRow = {
  id: string;
  subject_id: string;
  level_id: string;
  track: SowTrack;
  state: SowState;
  current_submission_id: string | null;
  approved_snapshot: unknown;
  scheme_of_work_classes: { section_id: string }[] | null;
};

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const dayLabel = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const utcDay = (iso: string) =>
  Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10))
  );

/**
 * Both tabs, read for one term in a fixed number of queries:
 *
 *   wave 1 — the term's schemes (with classes), levels, subjects, the year's
 *            sections, its subject-teacher rows, subject configs and level
 *            offerings (for "not started"), subject heads, the term;
 *   wave 2 — checks, sign-offs and relief notes of the schemes in scope,
 *            the term's weeks for their levels, the steps they wait on, the
 *            viewer's review queue, and when each in-review one was sent.
 *
 * Staff names come from the cached staff list, not a query.
 */
export async function loadOversight(
  service: SupabaseClient,
  input: {
    scope: OversightScope;
    viewer: { id: string; role: Role | null };
    termId: string;
    academicYearId: string;
    /** `?level=`; an unknown or missing one falls to the first level. */
    levelId?: string | null;
    today?: string;
  }
): Promise<OversightData> {
  const today = input.today ?? sgToday();

  const [
    schemeRes,
    levelRes,
    subjectRes,
    sectionRes,
    assignments,
    configRes,
    offeringRes,
    headRes,
    termRes,
  ] = await Promise.all([
    service
      .from('schemes_of_work')
      .select(
        'id, subject_id, level_id, track, state, current_submission_id, approved_snapshot, scheme_of_work_classes(section_id)'
      )
      .eq('term_id', input.termId),
    service.from('levels').select('id, code, label, level_type'),
    service.from('subjects').select('id, name'),
    service
      .from('sections')
      .select('id, name, level_id, class_type')
      .eq('academic_year_id', input.academicYearId),
    fetchAllPages<AssignmentLite>((from, to) =>
      service
        .from('teacher_assignments')
        .select(
          'id, teacher_user_id, section_id, subject_id, role, sections!inner(academic_year_id)'
        )
        .eq('sections.academic_year_id', input.academicYearId)
        .in('role', ['subject_teacher', 'co_teacher'])
        .range(from, to)
    ),
    service
      .from('subject_configs')
      .select('subject_id, display_name')
      .eq('academic_year_id', input.academicYearId),
    service
      .from('subject_level_offerings')
      .select('subject_id, level_id')
      .eq('academic_year_id', input.academicYearId),
    service
      .from('subject_heads')
      .select('subject_id, user_id, applies_to_level_type'),
    service
      .from('terms')
      .select('start_date, end_date')
      .eq('id', input.termId)
      .maybeSingle(),
  ]);
  for (const r of [
    schemeRes,
    levelRes,
    subjectRes,
    sectionRes,
    configRes,
    offeringRes,
    headRes,
    termRes,
  ]) {
    if (r.error) throw new Error(r.error.message);
  }

  const levels = new Map(
    (
      (levelRes.data ?? []) as {
        id: string;
        code: string;
        label: string;
        level_type: string;
      }[]
    ).map((l) => [
      l.id,
      { code: l.code, label: l.label, type: asLevelType(l.level_type) },
    ])
  );
  // This year's subject name (migration 137), from the year's config rows
  // read above; a subject not set up this year keeps its catalogue name.
  const displayNameOf = new Map(
    (
      (configRes.data ?? []) as {
        subject_id: string;
        display_name?: string | null;
      }[]
    ).map((c) => [c.subject_id, c.display_name ?? null])
  );
  const subjectName = new Map(
    ((subjectRes.data ?? []) as { id: string; name: string }[]).map((s) => [
      s.id,
      subjectDisplayName(s, { display_name: displayNameOf.get(s.id) }),
    ])
  );
  const sections = (sectionRes.data ?? []) as {
    id: string;
    name: string;
    level_id: string;
    class_type: string | null;
  }[];
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const sectionNames = new Map(sections.map((s) => [s.id, s.name]));
  const heads: SubjectHeadRow[] = (
    (headRes.data ?? []) as {
      subject_id: string;
      user_id: string;
      applies_to_level_type: string | null;
    }[]
  ).map((r) => ({
    subjectId: r.subject_id,
    userId: r.user_id,
    appliesToLevelType: asLevelType(r.applies_to_level_type),
  }));
  const termRow = termRes.data as {
    start_date: string | null;
    end_date: string | null;
  } | null;
  const termStart = termRow?.start_date ?? null;

  const levelTypeOf = (levelId: string) => levels.get(levelId)?.type ?? null;
  const scoped = ((schemeRes.data ?? []) as SchemeRow[]).filter((s) =>
    inOversightScope(input.scope, {
      subjectId: s.subject_id,
      levelType: levelTypeOf(s.level_id),
    })
  );
  const subjectRows = assignments.filter(
    (a) => a.subject_id && isSubjectRole(a.role)
  );

  // ── "Not started": a subject × level × track the year teaches, with
  // grading set up for it (`listMySowRows`' rule), and no scheme yet.
  const configured = new Set(
    ((configRes.data ?? []) as { subject_id: string }[]).map(
      (c) => c.subject_id
    )
  );
  const offered = new Set(
    (
      (offeringRes.data ?? []) as { subject_id: string; level_id: string }[]
    ).map((o) => `${o.subject_id}|${o.level_id}`)
  );
  const allSchemeKeys = new Set(
    ((schemeRes.data ?? []) as SchemeRow[]).map(
      (s) => `${s.subject_id}|${s.level_id}|${s.track}`
    )
  );
  const groups = new Map<
    string,
    {
      subjectId: string;
      levelId: string;
      track: SowTrack;
      sections: Set<string>;
    }
  >();
  for (const a of subjectRows) {
    const section = sectionById.get(a.section_id);
    if (!section || !a.subject_id) continue;
    if (!configured.has(a.subject_id)) continue;
    if (!offered.has(`${a.subject_id}|${section.level_id}`)) continue;
    const track = trackOf(section.class_type);
    const key = `${a.subject_id}|${section.level_id}|${track}`;
    const g = groups.get(key) ?? {
      subjectId: a.subject_id,
      levelId: section.level_id,
      track,
      sections: new Set<string>(),
    };
    g.sections.add(section.id);
    groups.set(key, g);
  }
  const notStarted = [...groups.entries()].filter(
    ([key, g]) =>
      !allSchemeKeys.has(key) &&
      inOversightScope(input.scope, {
        subjectId: g.subjectId,
        levelType: levelTypeOf(g.levelId),
      })
  );

  // ── ONE LEVEL AT A TIME, ALWAYS SET (Mr Ace's rule for a long list: one
  // group at a time, never "all"). The levels on offer are those with a
  // scheme, or a subject still to start one, in the viewer's scope; an
  // unknown or missing `?level=` falls to the first. Everything below — the
  // heavy wave included — reads that level only.
  const levelOptions = [
    ...new Set([
      ...scoped.map((s) => s.level_id),
      ...notStarted.map(([, g]) => g.levelId),
    ]),
  ]
    .map((id) => ({ id, label: levels.get(id)?.label ?? '' }))
    .sort((a, b) => compareLevelLabels(a.label, b.label));
  const levelId =
    levelOptions.find((l) => l.id === input.levelId)?.id ??
    levelOptions[0]?.id ??
    null;
  const schemes = scoped.filter((s) => s.level_id === levelId);

  const gridSows: GridSow[] = [];
  for (const s of schemes) {
    const snapshot = readSnapshot(s.approved_snapshot);
    if (!snapshot) continue;
    gridSows.push({
      id: s.id,
      subjectId: s.subject_id,
      subjectName: subjectName.get(s.subject_id) ?? '',
      levelId: s.level_id,
      levelLabel: levels.get(s.level_id)?.label ?? '',
      levelType: levelTypeOf(s.level_id),
      track: s.track,
      snapshot,
      sectionIds: (s.scheme_of_work_classes ?? []).map((c) => c.section_id),
    });
  }
  const gridIds = gridSows.map((s) => s.id);
  const submissionIds = schemes
    .filter(
      (s) =>
        (s.state === 'in_review' || s.state === 'returned') &&
        s.current_submission_id
    )
    .map((s) => s.current_submission_id as string);

  const [
    checks,
    signoffs,
    relief,
    termWeeks,
    stepLabels,
    queue,
    submissionRes,
    names,
  ] = await Promise.all([
    gridIds.length > 0
      ? fetchAllPages<CheckRow & { sow_id: string }>((from, to) =>
          service
            .from('scheme_of_work_checks')
            .select(
              'id, sow_id, week_number, section_id, teacher_user_id, option, note, recorded_at'
            )
            .in('sow_id', gridIds)
            .range(from, to)
        )
      : Promise.resolve([]),
    gridIds.length > 0
      ? fetchAllPages<GridSignoff>((from, to) =>
          service
            .from('scheme_of_work_signoffs')
            .select(
              'id, sow_id, week_number, section_id, kind, remarks, signed_by, created_at'
            )
            .in('sow_id', gridIds)
            .range(from, to)
        )
      : Promise.resolve([]),
    gridIds.length > 0
      ? fetchAllPages<ReliefLite>((from, to) =>
          service
            .from('scheme_of_work_relief_notes')
            .select(
              'id, sow_id, week_number, section_id, taught_on, relief_teacher_user_id, note'
            )
            .in('sow_id', gridIds)
            .range(from, to)
        )
      : Promise.resolve([]),
    // The term and the level codes are already read above; passed in so the
    // weeks cost the calendar and event reads only.
    loadTermWeeksForLevels(
      service,
      input.termId,
      gridSows.map((s) => s.levelId),
      {
        term: {
          start_date: termRow?.start_date ?? null,
          end_date: termRow?.end_date ?? null,
        },
        levelCodes: new Map(
          [...levels.entries()].map(([id, l]) => [id, l.code])
        ),
      }
    ),
    loadSowStepLabels(service, submissionIds),
    listSowReviewQueue(service, {
      userId: input.viewer.id,
      role: input.viewer.role,
    }),
    submissionIds.length > 0
      ? service
          .from('scheme_of_work_submissions')
          .select('id, submitted_at')
          .in('id', submissionIds)
      : Promise.resolve({ data: [], error: null }),
    getStaffDisplayNameById()
      .then((entries) => new Map(entries))
      .catch(() => new Map<string, string>()),
  ]);
  if (submissionRes.error) throw new Error(submissionRes.error.message);
  const sentAt = new Map(
    ((submissionRes.data ?? []) as { id: string; submitted_at: string }[]).map(
      (s) => [s.id, s.submitted_at]
    )
  );
  const waitingOnYou = new Set(queue.map((q) => q.sowId));

  // ── SOWs tab ─────────────────────────────────────────────────────────────
  const teachersFor = (subjectId: string, sectionIds: Iterable<string>) => {
    const ids = new Set(sectionIds);
    return [
      ...new Set(
        subjectRows
          .filter(
            (a) =>
              a.subject_id === subjectId &&
              ids.has(a.section_id) &&
              a.role === 'subject_teacher'
          )
          .map((a) => names.get(a.teacher_user_id) ?? 'Teacher')
      ),
    ].sort();
  };
  const classNames = (ids: Iterable<string>) =>
    [...ids]
      .map((id) => sectionNames.get(id) ?? '')
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

  const waitingText = (s: SchemeRow | null): string => {
    if (!s) {
      return termStart && termStart <= today
        ? `Term started ${dayLabel(termStart)}`
        : '—';
    }
    switch (s.state) {
      case 'in_review': {
        const at = s.current_submission_id
          ? sentAt.get(s.current_submission_id)
          : undefined;
        if (!at) return '—';
        const days = Math.round(
          (utcDay(today) - utcDay(sgDate(at))) / 86_400_000
        );
        return days <= 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`;
      }
      case 'returned':
        return 'With the teacher';
      case 'draft':
        return 'Not sent';
      default:
        return '—';
    }
  };

  const sowRows: OversightSowRow[] = schemes.map((s) => {
    const sectionIds = (s.scheme_of_work_classes ?? []).map(
      (c) => c.section_id
    );
    return {
      id: `${s.subject_id}|${s.level_id}|${s.track}`,
      sowId: s.id,
      subjectId: s.subject_id,
      subjectName: subjectName.get(s.subject_id) ?? '',
      levelId: s.level_id,
      levelLabel: levels.get(s.level_id)?.label ?? '',
      levelType: levelTypeOf(s.level_id),
      track: s.track,
      classes: classNames(sectionIds),
      teachers: teachersFor(s.subject_id, sectionIds),
      state: s.state,
      step: s.current_submission_id
        ? (stepLabels.get(s.current_submission_id) ?? null)
        : null,
      waitingOnYou: waitingOnYou.has(s.id),
      waiting: waitingText(s),
    };
  });
  for (const [key, g] of notStarted) {
    if (g.levelId !== levelId) continue;
    const levelType = levelTypeOf(g.levelId);
    sowRows.push({
      id: key,
      sowId: null,
      subjectId: g.subjectId,
      subjectName: subjectName.get(g.subjectId) ?? '',
      levelId: g.levelId,
      levelLabel: levels.get(g.levelId)?.label ?? '',
      levelType,
      track: g.track,
      classes: classNames(g.sections),
      teachers: teachersFor(g.subjectId, g.sections),
      state: null,
      step: null,
      waitingOnYou: false,
      waiting: waitingText(null),
    });
  }
  sowRows.sort(
    (a, b) =>
      compareLevelLabels(a.levelLabel, b.levelLabel) ||
      a.subjectName.localeCompare(b.subjectName) ||
      a.track.localeCompare(b.track)
  );

  // ── Weekly checks tab ────────────────────────────────────────────────────
  const grid = buildCheckGrid({
    sows: gridSows,
    sectionNames,
    termWeeks: new Map(
      [...termWeeks.entries()].map(([levelId, w]) => [levelId, w.weeks])
    ),
    assignments: subjectRows,
    checks,
    signoffs,
    reliefNotes: relief,
    names,
    heads,
    viewerId: input.viewer.id,
    today,
  });

  // The week most rows are in (levels share a calendar but a level-only
  // closure can shift one level's numbering).
  const tally = new Map<number, number>();
  for (const r of grid) {
    if (r.currentWeek != null) {
      tally.set(r.currentWeek, (tally.get(r.currentWeek) ?? 0) + 1);
    }
  }
  const currentWeek =
    [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ??
    null;
  // Outside the term's weeks, every week that has started is read.
  const lookUpTo =
    currentWeek ??
    Math.max(
      0,
      ...grid.flatMap((r) =>
        r.cells.filter((c) => c.started).map((c) => c.weekNumber)
      )
    );
  const look = needsALook(grid, lookUpTo);

  let checkedThisWeek: OversightData['tiles']['checkedThisWeek'] = null;
  if (currentWeek != null) {
    const cells = grid
      .map((r) => r.cells.find((c) => c.weekNumber === currentWeek))
      .filter((c): c is GridCell => Boolean(c));
    checkedThisWeek = {
      checked: cells.filter((c) => c.mark === 'ok' || c.mark === 'note').length,
      of: cells.length,
    };
  }

  return {
    levels: levelOptions,
    levelId,
    levelLabel: levelOptions.find((l) => l.id === levelId)?.label ?? null,
    sows: sowRows,
    grid,
    plans: buildPlans(gridSows),
    needsALook: look,
    currentWeek,
    weekCount: Math.max(
      0,
      ...grid.flatMap((r) => r.cells.map((c) => c.weekNumber))
    ),
    tiles: {
      approved: sowRows.filter((r) => r.state === 'approved').length,
      total: sowRows.length,
      notStarted: sowRows.filter((r) => r.state === null).length,
      waitingOnYou: sowRows.filter((r) => r.waitingOnYou).length,
      checkedThisWeek,
    },
  };
}
