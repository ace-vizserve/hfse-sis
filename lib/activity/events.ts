import type { RequestLadder } from '@/lib/approvals/inbox';

/**
 * One thing that happened to an approval, in the shape the panel and the
 * history timeline both render.
 *
 * ⚠ PURE. This module does no I/O and imports nothing from `app/` or
 * `components/`. Every string a person reads is decided here, so the wording
 * is testable without a database or a browser.
 */

export type ActivityFlow = 'grade_change' | 'student_declaration';

/** The three §9.3 tones. There is deliberately no fourth. */
export type ActivityTone = 'started' | 'went-through' | 'turned-down';

export type ActivityDetail =
  | { kind: 'note'; text: string }
  | { kind: 'outcome'; text: string };

export type ActivityEvent = {
  /**
   * ⚠ DERIVED AND STABLE, never an array index. The panel appends pages, and a
   * positional key reorders every row already on screen when a page lands.
   */
  id: string;
  flow: ActivityFlow;
  requestId: string;
  /** ISO timestamp. The sort key. */
  at: string;
  tone: ActivityTone;
  /** "Radhika Putrevu" · "A parent" · "You". Rendered bold. */
  actorLabel: string;
  actorInitials: string;
  /** Follows the actor: "approved the form class adviser step for …". */
  predicate: string;
  details: ActivityDetail[] | null;
  href: string;
};

/**
 * Two letters for the avatar.
 *
 * ⚠ Never throws. This renders in the header of every page in the app; an
 * exception here costs the whole screen, not one circle.
 */
export function initialsFromName(nameOrEmail: string): string {
  const source = (nameOrEmail ?? '').trim();
  if (!source) return '—';

  const base = source.includes('@')
    ? (source.split('@')[0] ?? '').replace(/[._-]+/g, ' ')
    : source;

  const letters = base
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

  return letters.slice(0, 2) || '—';
}

function personName(
  id: string | null,
  email: string | null,
  nameById: ReadonlyMap<string, string>
): string {
  if (id) {
    const known = nameById.get(id);
    if (known) return known;
  }
  return email ?? 'Someone';
}

// ── Declarations ───────────────────────────────────────────────────────────

export type DeclarationEventInput = {
  ladder: RequestLadder;
  /** "Amelia Ng, travel 3 Sep" — built by the caller, which has the student. */
  subjectLabel: string;
  nameById: ReadonlyMap<string, string>;
  registerWrittenAt: string | null;
  registerDaysWritten: number | null;
  registerWriteError: string | null;
};

export function buildDeclarationEvents(
  input: DeclarationEventInput
): ActivityEvent[] {
  const { ladder, subjectLabel, nameById } = input;
  const href = `/attendance/declarations?req=${ladder.requestId}`;
  const events: ActivityEvent[] = [];

  // ⚠ "A parent", never their email. A parent has no SIS account and their
  // address is not staff-facing information.
  events.push({
    id: `student_declaration:${ladder.requestId}:filed`,
    flow: 'student_declaration',
    requestId: ladder.requestId,
    at: ladder.filedAt,
    tone: 'started',
    actorLabel: 'A parent',
    actorInitials: initialsFromName(subjectLabel),
    predicate: `filed ${subjectLabel}.`,
    details: null,
    href,
  });

  // ⚠ ONLY DECIDED STEPS. A rejection stops the ladder and every later step
  // stays 'waiting' in the table forever; emitting those would invent activity
  // that never happened.
  const decided = ladder.stages.filter(
    (s) =>
      (s.status === 'approved' || s.status === 'rejected') &&
      s.decidedAt != null
  );

  const lastApprovalOrder =
    ladder.status === 'approved'
      ? [...decided].reverse().find((s) => s.status === 'approved')?.stageOrder
      : undefined;

  for (const stage of decided) {
    const details: ActivityDetail[] = [];
    if (stage.decisionNote) {
      details.push({ kind: 'note', text: stage.decisionNote });
    }
    // The register write lands in the same second as the final approval, so it
    // rides on that row rather than becoming a second row a second later.
    if (stage.stageOrder === lastApprovalOrder) {
      const outcome = registerOutcomeText(input);
      if (outcome) details.push({ kind: 'outcome', text: outcome });
    }

    events.push({
      id: `student_declaration:${ladder.requestId}:step:${stage.stageOrder}`,
      flow: 'student_declaration',
      requestId: ladder.requestId,
      at: stage.decidedAt as string,
      tone: stage.status === 'approved' ? 'went-through' : 'turned-down',
      actorLabel: personName(stage.decidedBy, stage.decidedByEmail, nameById),
      actorInitials: initialsFromName(
        personName(stage.decidedBy, stage.decidedByEmail, nameById)
      ),
      predicate: `${
        stage.status === 'approved' ? 'approved' : 'turned down'
      } the ${stage.label.toLocaleLowerCase()} step for ${subjectLabel}.`,
      details: details.length > 0 ? details : null,
      href,
    });
  }

  return events;
}

function registerOutcomeText(input: DeclarationEventInput): string | null {
  if (input.registerWriteError) {
    return 'The register could not be marked. An administrator needs to finish this.';
  }
  if (input.registerWrittenAt == null) return null;
  const days = input.registerDaysWritten ?? 0;
  if (days === 0) return 'No school days fell inside those dates.';
  return `${days} ${days === 1 ? 'day' : 'days'} marked as excused on the register`;
}

// ── Mark changes ───────────────────────────────────────────────────────────

export type GradeChangeEventInput = {
  id: string;
  fieldChanged: string;
  slotIndex: number | null;
  currentValue: string | null;
  proposedValue: string;
  studentLabel: string;
  requestedById: string | null;
  requestedByEmail: string;
  requestedAt: string;
  status: string;
  reviewedById: string | null;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  decisionNote: string | null;
  appliedById: string | null;
  appliedAt: string | null;
  /** Who is reading. Decides whether the first row says "You". */
  viewerId: string;
  nameById: ReadonlyMap<string, string>;
  href: string;
};

/** "written_work" + slot 3 → "Written Work 3". */
export function markChangeFieldLabel(
  fieldChanged: string,
  slotIndex: number | null
): string {
  const words = fieldChanged
    .split('_')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
  return slotIndex == null ? words : `${words} ${slotIndex}`;
}

export function buildGradeChangeEvents(
  input: GradeChangeEventInput
): ActivityEvent[] {
  const field = markChangeFieldLabel(input.fieldChanged, input.slotIndex);
  const events: ActivityEvent[] = [];

  const askedBy =
    input.requestedById === input.viewerId
      ? 'You'
      : personName(input.requestedById, input.requestedByEmail, input.nameById);

  events.push({
    id: `grade_change:${input.id}:requested`,
    flow: 'grade_change',
    requestId: input.id,
    at: input.requestedAt,
    tone: 'started',
    actorLabel: askedBy,
    actorInitials: initialsFromName(
      askedBy === 'You'
        ? personName(
            input.requestedById,
            input.requestedByEmail,
            input.nameById
          )
        : askedBy
    ),
    predicate: `asked to change ${field} for ${input.studentLabel}.`,
    details: null,
    href: input.href,
  });

  if (input.reviewedAt) {
    const turnedDown = input.status === 'rejected';
    const reviewer = personName(
      input.reviewedById,
      input.reviewedByEmail,
      input.nameById
    );
    events.push({
      id: `grade_change:${input.id}:reviewed`,
      flow: 'grade_change',
      requestId: input.id,
      at: input.reviewedAt,
      tone: turnedDown ? 'turned-down' : 'went-through',
      actorLabel: reviewer,
      actorInitials: initialsFromName(reviewer),
      predicate: `${turnedDown ? 'turned down' : 'approved'} the mark change for ${input.studentLabel}.`,
      details: input.decisionNote
        ? [{ kind: 'note', text: input.decisionNote }]
        : null,
      href: input.href,
    });
  }

  if (input.appliedAt) {
    const applier = personName(input.appliedById, null, input.nameById);
    events.push({
      id: `grade_change:${input.id}:applied`,
      flow: 'grade_change',
      requestId: input.id,
      at: input.appliedAt,
      tone: 'went-through',
      actorLabel: applier,
      actorInitials: initialsFromName(applier),
      predicate: `applied the mark change for ${input.studentLabel} to the sheet.`,
      details: [
        {
          kind: 'outcome',
          text: `${field} · ${input.currentValue ?? '—'} → ${input.proposedValue}`,
        },
      ],
      href: input.href,
    });
  }

  return events;
}

/**
 * Newest first, ties broken on id.
 *
 * ⚠ The tiebreak is not cosmetic. Two events can share a timestamp to the
 * millisecond, and an unstable order across pages duplicates or drops rows at
 * the cursor boundary.
 */
export function sortEventsNewestFirst<T extends { at: string; id: string }>(
  events: T[]
): T[] {
  return [...events].sort(
    (a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)
  );
}
