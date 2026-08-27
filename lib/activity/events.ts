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
  /** Co-sign trail (migration 044). Null unless a second designated
   *  approver has also reviewed — see `buildGradeChangeEvents` below. */
  secondaryReviewedById: string | null;
  secondaryReviewedByEmail: string | null;
  secondaryReviewedAt: string | null;
  appliedById: string | null;
  appliedAt: string | null;
  /** Who is reading. Decides whether the first row says "You". */
  viewerId: string;
  nameById: ReadonlyMap<string, string>;
  href: string;
};

/**
 * Human copy for the five values `field_changed` is constrained to
 * (`009_change_requests.sql:31-33`). Shared by the dialog title, the
 * predicate text below, and — until this fix — nobody, because it sat
 * unused as a dead constant in `my-requests-table.tsx`.
 *
 * ⚠ Do not add a key here without checking that CHECK constraint first: an
 * unrecognised key falls through to a naive split-and-titlecase in
 * `markChangeFieldLabel`, which reads as a raw column name ("Ww Scores")
 * rather than English — a safety net, not a design.
 */
export const FIELD_CHANGE_LABELS: Record<string, string> = {
  ww_scores: 'Written work',
  pt_scores: 'Performance task',
  qa_score: 'Quarterly assessment',
  letter_grade: 'Letter grade',
  is_na: 'N/A flag',
};

/**
 * "ww_scores" + slot 2 (0-based) → "Written work 3".
 *
 * ⚠ `slotIndex` is 0-based (`009_change_requests.sql:67`) — the +1 here is
 * load-bearing. The table cell beside this dialog (`fieldLabel` in both
 * `change-requests-data-table.tsx` and `grading/requests/page.tsx`) already
 * does the same +1 to print "W2"; this must never drift from that.
 */
export function markChangeFieldLabel(
  fieldChanged: string,
  slotIndex: number | null
): string {
  const label =
    FIELD_CHANGE_LABELS[fieldChanged] ??
    fieldChanged
      .split('_')
      .filter(Boolean)
      .map((w) => w[0]?.toUpperCase() + w.slice(1))
      .join(' ');
  return slotIndex == null ? label : `${label} ${slotIndex + 1}`;
}

/**
 * The history dialog's subtitle line — shared by both mark-change tables
 * (Task 5 duplicated this verbatim; hoisted here per fix round 1). No
 * student name reaches either table's own columns (that's what the title
 * carries, via a real join as of this fix round), so section/subject/term
 * — already loaded for the tables' own columns — stand in for context;
 * "Mark change" is the last resort when none of the three are known.
 */
export function markChangeHistorySubtitle(row: {
  sectionName?: string | null;
  subjectCode?: string | null;
  termLabel?: string | null;
}): string {
  return (
    [row.sectionName, row.subjectCode, row.termLabel]
      .filter(Boolean)
      .join(' · ') || 'Mark change'
  );
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

  // A co-sign (migration 044): a second designated approver reviewed after
  // the first. `ReviewerLine` on both tables already renders "Co-signed by
  // A and B" from the same two columns three lines away in the same row —
  // the dialog built to be the audit record must not show less than that.
  // Always 'went-through': the only path that reaches `secondary_reviewed_*`
  // at all is a co-sign onto an already-approved request (`decide.ts`
  // blocks a secondary review once the primary has rejected).
  if (input.secondaryReviewedAt) {
    const cosigner = personName(
      input.secondaryReviewedById,
      input.secondaryReviewedByEmail,
      input.nameById
    );
    events.push({
      id: `grade_change:${input.id}:reviewed:secondary`,
      flow: 'grade_change',
      requestId: input.id,
      at: input.secondaryReviewedAt,
      tone: 'went-through',
      actorLabel: cosigner,
      actorInitials: initialsFromName(cosigner),
      predicate: `co-signed the mark change for ${input.studentLabel}.`,
      details: null,
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
