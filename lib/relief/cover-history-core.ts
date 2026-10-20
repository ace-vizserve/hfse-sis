import { sgDate } from '@/lib/dates';

// Every cover that has finished, rebuilt from what the system actually keeps.
//
// ⚠ THE ROWS ONLY HOLD A COVER UNTIL IT IS CLEARED. A cover that ran to its last
// day keeps its window on the row; a cover somebody stopped early, or booked
// over, does not — clearing the substitute wipes the window with the name (see
// PATCH /api/teacher-assignments/[id] and POST /api/relief/book). The audit log
// is therefore the record, and this file reads it.
//
// PURE — no database, no server-only import — so the timeline logic is tested
// on its own (`__tests__/relief/cover-history.test.ts`). The loader in
// `cover-history.ts` fetches the inputs and resolves names and class labels.
//
// TWO WRITERS, TWO SHAPES, ONE TIMELINE.
//   * POST /api/relief/book (bulk, `bulk: true`) — one entry per absence:
//     `assignment_ids`, `class_labels`, and `previous_covers` (one per class
//     that already had cover) when it overwrote or ended something.
//   * PATCH /api/teacher-assignments/[id] (one class) — `assignment_id`,
//     `section_name`, `subject_name`, `role`, and flat `previous_relief_*`.
// Both are turned into per-class steps, replayed in time order, and the
// per-class covers are grouped back into absences at the end.

export const RELIEF_START = 'assignment.relief.start';
export const RELIEF_END = 'assignment.relief.end';

export type ReliefAuditEntry = {
  action: string;
  /** UTC timestamp of the write. */
  createdAt: string;
  context: Record<string, unknown>;
};

/** A row that still holds a cover whose last day is behind us. */
export type LivePastCover = {
  assignmentId: string;
  coveredTeacherId: string;
  reliefTeacherId: string;
  startedOn: string | null;
  endedOn: string | null;
  reason: string | null;
};

/** First and last day of an academic year, from its terms. */
export type AyDateRange = {
  ayCode: string;
  startDate: string;
  endDate: string;
};

export type CoverOutcome =
  /** Reached its last day. */
  | { kind: 'ran' }
  /** Ended before its last day. `on` is the Singapore date it was ended. */
  | { kind: 'stopped'; on: string }
  /** Had no last day, and somebody ended it. */
  | { kind: 'ended'; on: string }
  /** Ended before its first day — it never ran. */
  | { kind: 'cancelled'; on: string };

export type HistoryAbsence = {
  key: string;
  coveredTeacherId: string;
  /** As the audit entry recorded it — a fallback for the live staff list. */
  coveredTeacherName: string | null;
  reliefTeacherId: string;
  reliefTeacherName: string | null;
  startedOn: string | null;
  endedOn: string | null;
  reason: string | null;
  /** The day it took effect: the first day, else the day it was booked. */
  effectiveStart: string | null;
  outcome: CoverOutcome;
  assignmentIds: string[];
  /** Class labels the audit entries carried, by assignment id. */
  auditLabels: Record<string, string>;
  /** The academic year whose dates contain `effectiveStart`. */
  ayCode: string | null;
};

type Cover = {
  assignmentId: string;
  coveredId: string;
  coveredName: string | null;
  reliefId: string;
  reliefName: string | null;
  startedOn: string | null;
  endedOn: string | null;
  reason: string | null;
  /** Singapore date of the booking, when the log has it. */
  bookedOn: string | null;
  /** Singapore date it was ended or booked over. Null = never cleared. */
  closedOn: string | null;
  label: string | null;
};

type Previous = {
  reliefId: string;
  reliefName: string | null;
  startedOn: string | null;
  endedOn: string | null;
  reason: string | null;
  label: string | null;
};

const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;

/** Blank reasons are stored as '' by some writers; treat them as none. */
const reasonOf = (v: unknown): string | null => {
  const s = str(v);
  return s && s.trim() ? s.trim() : null;
};

function previousFrom(
  src: Record<string, unknown>,
  label: string | null
): Previous | null {
  const reliefId = str(src.previous_relief_teacher_user_id);
  if (!reliefId) return null;
  return {
    reliefId,
    reliefName: str(src.previous_relief_teacher_name),
    startedOn: str(src.previous_relief_started_on),
    endedOn: str(src.previous_relief_ended_on),
    reason: reasonOf(src.previous_relief_reason),
    label: str(src.class_label) ?? label,
  };
}

/** "P4 Diligence · Mathematics" / "P5 Commitment · Form class". */
function singleLabel(ctx: Record<string, unknown>): string | null {
  const section = str(ctx.section_name);
  if (!section) return null;
  if (ctx.role === 'form_adviser') return `${section} · Form class`;
  const subject = str(ctx.subject_name);
  return subject ? `${section} · ${subject}` : section;
}

type Step = {
  assignmentId: string;
  label: string | null;
  previous: Previous | null;
};

/** One audit entry → one step per class it touched. */
function stepsOf(ctx: Record<string, unknown>): Step[] {
  if (ctx.bulk === true) {
    const ids = Array.isArray(ctx.assignment_ids)
      ? ctx.assignment_ids.filter((x): x is string => typeof x === 'string')
      : [];
    const labels = Array.isArray(ctx.class_labels) ? ctx.class_labels : [];
    // `class_labels` drops classes whose name could not be built, so it only
    // lines up with the ids when nothing was dropped.
    const aligned = labels.length === ids.length;
    const previousById = new Map<string, Previous>();
    if (Array.isArray(ctx.previous_covers)) {
      for (const p of ctx.previous_covers) {
        if (!p || typeof p !== 'object') continue;
        const rec = p as Record<string, unknown>;
        const id = str(rec.assignment_id);
        const prev = previousFrom(rec, null);
        if (id && prev) previousById.set(id, prev);
      }
    }
    return ids.map((id, i) => ({
      assignmentId: id,
      label: aligned ? str(labels[i]) : null,
      previous: previousById.get(id) ?? null,
    }));
  }

  const id = str(ctx.assignment_id);
  if (!id) return [];
  const label = singleLabel(ctx);
  return [{ assignmentId: id, label, previous: previousFrom(ctx, label) }];
}

function sameWindow(a: Cover, p: Previous): boolean {
  return (
    a.reliefId === p.reliefId &&
    a.startedOn === p.startedOn &&
    a.endedOn === p.endedOn
  );
}

export function outcomeOf(c: {
  startedOn: string | null;
  endedOn: string | null;
  bookedOn: string | null;
  closedOn: string | null;
}): CoverOutcome {
  if (!c.closedOn) return { kind: 'ran' };
  const firstDay = c.startedOn ?? c.bookedOn;
  if (firstDay && c.closedOn < firstDay) {
    return { kind: 'cancelled', on: c.closedOn };
  }
  if (!c.endedOn) return { kind: 'ended', on: c.closedOn };
  // Ended on or after its last day — it ran its course.
  if (c.closedOn >= c.endedOn) return { kind: 'ran' };
  return { kind: 'stopped', on: c.closedOn };
}

/** The year whose dates contain `date`; in a holiday, the year just ended. */
export function ayForDate(
  date: string | null,
  ranges: AyDateRange[]
): string | null {
  if (!date || ranges.length === 0) return null;
  const inside = ranges.find((r) => r.startDate <= date && date <= r.endDate);
  if (inside) return inside.ayCode;
  const started = ranges
    .filter((r) => r.startDate <= date)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  return started[0]?.ayCode ?? null;
}

const coverKey = (c: {
  assignmentId: string;
  coveredId: string;
  reliefId: string;
  startedOn: string | null;
  endedOn: string | null;
}) =>
  [
    c.assignmentId,
    c.coveredId,
    c.reliefId,
    c.startedOn ?? '-',
    c.endedOn ?? '-',
  ].join('|');

/**
 * Every finished absence: one per (absent teacher, substitute, window,
 * outcome), newest first.
 *
 * ⚠ A RE-SAVE OF THE SAME ABSENCE IS NOT A SECOND ABSENCE. Editing a cover
 * writes a new `start` carrying the old window as `previous_*`. When the
 * absent teacher and the substitute are unchanged and either the first day is
 * unchanged or the old window had not started yet, the old window is simply
 * superseded — the new one is the record. Anything else (a different
 * substitute, new dates after it had begun) closes the old window on that day.
 *
 * `today` is a Singapore `yyyy-MM-dd`. A cover never cleared counts only once
 * its last day is before today; a cover cleared today counts at once.
 */
export function buildCoverHistory(input: {
  entries: ReliefAuditEntry[];
  livePast: LivePastCover[];
  today: string;
  ayRanges: AyDateRange[];
}): HistoryAbsence[] {
  const { entries, livePast, today, ayRanges } = input;

  const open = new Map<string, Cover>();
  const finished: Cover[] = [];

  const sorted = [...entries]
    .filter((e) => e.action === RELIEF_START || e.action === RELIEF_END)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const entry of sorted) {
    const ctx = entry.context ?? {};
    const isStart = entry.action === RELIEF_START;
    const on = sgDate(entry.createdAt);
    const coveredId = str(ctx.covered_teacher_user_id);
    const coveredName = str(ctx.covered_teacher_name);
    const newReliefId = isStart ? str(ctx.relief_teacher_user_id) : null;

    for (const step of stepsOf(ctx)) {
      const current = open.get(step.assignmentId) ?? null;
      open.delete(step.assignmentId);

      // What this write replaced. The `previous_*` keys are what the row
      // actually held, so they win; the replayed cover supplies the booking
      // date and label when it is the same window.
      let closing: Cover | null = null;
      if (step.previous) {
        const p = step.previous;
        const same = current && sameWindow(current, p) ? current : null;
        closing = {
          assignmentId: step.assignmentId,
          coveredId: same?.coveredId ?? coveredId ?? '',
          coveredName: same?.coveredName ?? coveredName,
          reliefId: p.reliefId,
          reliefName: p.reliefName ?? same?.reliefName ?? null,
          startedOn: p.startedOn,
          endedOn: p.endedOn,
          reason: p.reason ?? same?.reason ?? null,
          bookedOn: same?.bookedOn ?? null,
          closedOn: null,
          label: same?.label ?? p.label ?? step.label,
        };
      } else if (current) {
        closing = current;
      }

      let carriedBookedOn: string | null = null;
      if (closing && closing.coveredId) {
        const firstDay = closing.startedOn ?? closing.bookedOn;
        const stillRunning = !closing.endedOn || closing.endedOn >= on;
        const superseded =
          isStart &&
          newReliefId === closing.reliefId &&
          (coveredId ?? closing.coveredId) === closing.coveredId &&
          stillRunning &&
          (str(ctx.relief_started_on) === closing.startedOn ||
            (firstDay !== null && on < firstDay));
        if (superseded) {
          carriedBookedOn = closing.bookedOn;
        } else {
          finished.push({ ...closing, closedOn: on });
        }
      }

      if (isStart && newReliefId && coveredId) {
        open.set(step.assignmentId, {
          assignmentId: step.assignmentId,
          coveredId,
          coveredName,
          reliefId: newReliefId,
          reliefName: str(ctx.relief_teacher_name),
          startedOn: str(ctx.relief_started_on),
          endedOn: str(ctx.relief_ended_on),
          reason: reasonOf(ctx.relief_reason),
          bookedOn: carriedBookedOn ?? on,
          closedOn: null,
          label: step.label ?? current?.label ?? null,
        });
      }
    }
  }

  // Covers never cleared. The row and the log usually both know them — the
  // same cover is kept once, with the log's booking date and label.
  const neverCleared = new Map<string, Cover>();
  for (const c of open.values()) neverCleared.set(coverKey(c), c);
  for (const r of livePast) {
    const c: Cover = {
      assignmentId: r.assignmentId,
      coveredId: r.coveredTeacherId,
      coveredName: null,
      reliefId: r.reliefTeacherId,
      reliefName: null,
      startedOn: r.startedOn,
      endedOn: r.endedOn,
      reason: reasonOf(r.reason),
      bookedOn: null,
      closedOn: null,
      label: null,
    };
    const k = coverKey(c);
    const known = neverCleared.get(k);
    neverCleared.set(
      k,
      known ? { ...known, reason: c.reason ?? known.reason } : c
    );
  }
  for (const c of neverCleared.values()) {
    if (c.endedOn && c.endedOn < today) finished.push(c);
  }

  // Back into absences.
  const groups = new Map<string, HistoryAbsence>();
  for (const c of finished) {
    const outcome = outcomeOf(c);
    const key = [
      c.coveredId,
      c.reliefId,
      c.startedOn ?? '-',
      c.endedOn ?? '-',
      outcome.kind,
      'on' in outcome ? outcome.on : '-',
    ].join('|');
    const effectiveStart = c.startedOn ?? c.bookedOn ?? null;
    const existing = groups.get(key);
    if (existing) {
      if (!existing.assignmentIds.includes(c.assignmentId)) {
        existing.assignmentIds.push(c.assignmentId);
      }
      if (c.label) existing.auditLabels[c.assignmentId] ??= c.label;
      existing.reason ??= c.reason;
      existing.coveredTeacherName ??= c.coveredName;
      existing.reliefTeacherName ??= c.reliefName;
      if (
        effectiveStart &&
        (!existing.effectiveStart || effectiveStart < existing.effectiveStart)
      ) {
        existing.effectiveStart = effectiveStart;
      }
      continue;
    }
    groups.set(key, {
      key,
      coveredTeacherId: c.coveredId,
      coveredTeacherName: c.coveredName,
      reliefTeacherId: c.reliefId,
      reliefTeacherName: c.reliefName,
      startedOn: c.startedOn,
      endedOn: c.endedOn,
      reason: c.reason,
      effectiveStart,
      outcome,
      assignmentIds: [c.assignmentId],
      auditLabels: c.label ? { [c.assignmentId]: c.label } : {},
      ayCode: null,
    });
  }

  const out = [...groups.values()];
  for (const g of out) {
    g.ayCode = ayForDate(
      g.effectiveStart ??
        g.endedOn ??
        ('on' in g.outcome ? g.outcome.on : null),
      ayRanges
    );
  }
  const lastDay = (g: HistoryAbsence) =>
    'on' in g.outcome ? g.outcome.on : (g.endedOn ?? '');
  return out.sort(
    (a, b) =>
      lastDay(b).localeCompare(lastDay(a)) ||
      (b.effectiveStart ?? '').localeCompare(a.effectiveStart ?? '')
  );
}
