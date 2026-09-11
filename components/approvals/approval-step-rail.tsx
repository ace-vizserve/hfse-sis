'use client';

import { Ban, Check, X } from 'lucide-react';

import { joinNames } from '@/lib/approvals/readiness';
import {
  approvalTally,
  describeLadderPosition,
  isEveryoneStep,
  ladderStoppedAt,
  type ApprovalRailPerson,
  type ApprovalRailStage,
} from '@/lib/approvals/rail';
import { formatDecidedAt } from '@/lib/declarations/format';
import { toPlainText } from '@/lib/rich-text';
import { APPROVAL_STAGE_STATUS_LABELS } from '@/lib/schemas/approval-flows';
import { cn } from '@/lib/utils';

// Where an ordered approval (KD #196) has got to, step by step.
//
// ⚠ EXTRACTED FROM THE DECLARATION DECISION SHEET, NOT REDESIGNED. The full
// rail below is the markup that sheet shipped, class for class and sentence
// for sentence, so declarations read exactly as they did. Grade changes
// (migration 144) are the second reader; the only thing they added is the
// 'cancelled' step, which a declaration can never reach.
//
// Two shapes of the same device, one visual language:
//   • `ApprovalStepRail` — the vertical ladder with names, dates and notes,
//     for a sheet or dialog that has the room.
//   • `ApprovalStepStrip` — the same tiles laid in a row with a one-line
//     caption, for a table cell that does not.
//
// ⚠ AN "EVERYONE MUST APPROVE" STEP (migration 145) IS THE ONE PLACE THE RAIL
// SHOWS PEOPLE ONE BY ONE. On an "any one of them" step the names are a list of
// who COULD act, and one line is enough. On an everyone step the question is
// who HAS, so each person gets a tick or an empty box — the same mint and
// dashed-hairline families the step tiles use, one size down, so a person's
// mark reads as a smaller copy of the step's.

type RailProps = {
  stages: readonly ApprovalRailStage[];
  /** Step number → the names of whoever may decide that step. */
  peopleByStageOrder: Readonly<Record<number, string>>;
  /** Step number → the name of whoever did decide it. */
  decidedByNames: Readonly<Record<number, string>>;
  /**
   * What the thing being approved is called in the "never reached" line —
   * "filing" for a parent's declaration, "request" for a grade change.
   */
  subjectNoun?: string;
};

/**
 * The tile's colour, by what happened at that step (§9.3 families). Shared by
 * both shapes so a step reads the same wherever it is drawn.
 */
function stageTileTone(
  status: ApprovalRailStage['status'],
  neverReached: boolean
): string {
  return cn(
    status === 'approved' && 'bg-brand-mint/30 text-ink',
    status === 'rejected' && 'bg-destructive/10 text-destructive',
    status === 'pending' && 'bg-accent text-accent-foreground',
    (status === 'waiting' || status === 'cancelled') &&
      'bg-muted text-muted-foreground',
    neverReached &&
      'border border-dashed border-hairline-strong bg-card text-ink-5'
  );
}

function StageGlyph({
  stage,
  iconClassName,
}: {
  stage: ApprovalRailStage;
  iconClassName: string;
}) {
  if (stage.status === 'approved') {
    return <Check className={iconClassName} aria-hidden />;
  }
  if (stage.status === 'rejected') {
    return <X className={iconClassName} aria-hidden />;
  }
  if (stage.status === 'cancelled') {
    return <Ban className={iconClassName} aria-hidden />;
  }
  return <>{stage.stageOrder}</>;
}

export function ApprovalStepRail({
  stages,
  peopleByStageOrder,
  decidedByNames,
  subjectNoun = 'filing',
}: RailProps) {
  // ⚠ A rejection ENDS the ladder — every later step keeps status 'waiting'
  // in the table forever — and so does a withdrawal. Rendered the same as a
  // step that is still coming, they read as "not yet" when the truth is
  // "never".
  const stoppedAt = ladderStoppedAt(stages);

  return (
    <ol className="space-y-0">
      {stages.map((stage, index, all) => {
        const decided =
          stage.status === 'approved' || stage.status === 'rejected';
        const neverReached =
          stoppedAt != null &&
          stage.stageOrder > stoppedAt.stageOrder &&
          !decided;
        const people = peopleByStageOrder[stage.stageOrder];
        const everyone = isEveryoneStep(stage);
        const tally = approvalTally(stage);
        const everyonePeople = stage.people ?? [];
        return (
          <li key={stage.stageOrder} className="flex gap-3">
            {/* The rail: a real sequence, so a real line. */}
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-[11px] font-semibold tabular-nums',
                  stageTileTone(stage.status, neverReached)
                )}
              >
                <StageGlyph stage={stage} iconClassName="size-3.5" />
              </span>
              {index < all.length - 1 && (
                <span className="my-1 w-px flex-1 bg-border" aria-hidden />
              )}
            </div>

            <div className="min-w-0 flex-1 pb-5">
              <p className="text-[14px] font-medium text-foreground">
                {stage.label}
              </p>
              {decided && everyone && stage.status === 'approved' ? (
                // Nobody "carried" this step — it took all of them, and the
                // ticks below say who and when.
                <p className="text-[13px] text-muted-foreground">
                  Approved by everyone on this step ·{' '}
                  {formatDecidedAt(stage.decidedAt)}
                </p>
              ) : decided ? (
                <p className="text-[13px] text-muted-foreground">
                  {stage.status === 'approved' ? 'Approved' : 'Turned down'} by{' '}
                  {decidedByNames[stage.stageOrder] ?? 'someone'} ·{' '}
                  {formatDecidedAt(stage.decidedAt)}
                </p>
              ) : stage.status === 'cancelled' ? (
                // Nobody on this step decided it — the request was closed
                // around them (migration 144), so there is no name to give.
                <p className="text-[13px] text-muted-foreground">
                  Cancelled — the {subjectNoun} was withdrawn while it waited
                  here.
                </p>
              ) : stage.resolver === 'form_adviser' ? (
                <p className="text-[13px] text-muted-foreground">
                  Whoever advises the class, including anyone covering it this
                  week.
                </p>
              ) : neverReached ? (
                <p className="text-[13px] text-muted-foreground">
                  Never reached — the {subjectNoun} was{' '}
                  {stoppedAt?.status === 'cancelled'
                    ? 'withdrawn'
                    : 'turned down'}{' '}
                  before this step.
                </p>
              ) : tally && tally.total > 0 ? (
                stage.status === 'pending' ? (
                  <p className="text-[13px] text-muted-foreground">
                    <span className="font-medium text-foreground tabular-nums">
                      {tally.approved} of {tally.total} approved
                    </span>{' '}
                    — everyone on this step must approve.
                  </p>
                ) : (
                  <p className="text-[13px] text-muted-foreground">
                    {joinNames(
                      everyonePeople.map((p) => p.name),
                      'and'
                    )}{' '}
                    — everyone must approve.
                  </p>
                )
              ) : people ? (
                <p className="text-[13px] text-muted-foreground">{people}</p>
              ) : (
                // ⚠ A step with nobody on it really will stall. Say so here
                // rather than let a request appear to vanish.
                <p className="text-[13px] text-destructive">
                  Nobody has been added to this step yet, so it will stop here.
                </p>
              )}
              {/* Who has signed. Not on a step that has not been reached — the
                  line above already names them — and not after a withdrawal
                  or turn-down unless somebody had approved before it stopped
                  (`railPeopleForStage` keeps only those). */}
              {everyone &&
                stage.status !== 'waiting' &&
                everyonePeople.length > 0 && (
                  <PersonTicks
                    people={everyonePeople}
                    stageLabel={stage.label}
                    live={stage.status === 'pending'}
                  />
                )}
              {/* ⚠ STRIPPED, because the box that WRITES this is a rich-text
                  field and it stores HTML. Printed raw, an approver's note
                  would read “<p>Back Monday.</p>”. Plain text rather than
                  rendered markup: the note is quoted inline inside a sentence
                  here, which is no place for a bullet list.
                  ⚠ NOT ON A FINISHED "EVERYONE" STEP WHOSE TICKS ARE SHOWN.
                  The step's note is the last approver's own, and it already
                  sits under their tick with everyone else's — quoting it again
                  here would pin one person's words to the whole step. */}
              {stage.decisionNote &&
                !(
                  everyone &&
                  stage.status === 'approved' &&
                  everyonePeople.length > 0
                ) && (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-foreground italic">
                    “{toPlainText(stage.decisionNote)}”
                  </p>
                )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One line per person on an "Everyone must approve" step: a tick and when, or
 * an empty box and "not yet" — and, under an approver who wrote one, their
 * note, quoted exactly as the step's own note is.
 *
 * `live` is false once the step has stopped moving; "not yet" is then never
 * said, because on a finished step it would promise a decision that is not
 * coming.
 */
function PersonTicks({
  people,
  stageLabel,
  live,
}: {
  people: readonly ApprovalRailPerson[];
  stageLabel: string;
  live: boolean;
}) {
  return (
    <ul
      className="mt-2 space-y-1"
      aria-label={`Who has approved ${stageLabel}`}
    >
      {people.map((person, index) => {
        const approved = person.approvedAt != null;
        // Stripped for the same reason as the step's note: stored as HTML.
        const note =
          approved && person.note ? toPlainText(person.note).trim() : '';
        return (
          <li key={`${person.name}-${index}`} className="min-w-0 text-[13px]">
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded',
                  approved
                    ? 'bg-brand-mint/30 text-ink'
                    : 'border border-dashed border-hairline-strong bg-card'
                )}
              >
                {approved && <Check className="size-3" />}
              </span>
              <span
                className={cn(
                  'truncate',
                  approved ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {person.name}
              </span>
              <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                {approved
                  ? `approved ${formatDecidedAt(person.approvedAt)}`
                  : live
                    ? 'not yet'
                    : ''}
              </span>
            </div>
            {/* Indented to the name, not the box, so the words read as the
                person's and the column of ticks stays unbroken. */}
            {note && (
              <p className="mt-0.5 pl-6 leading-relaxed text-foreground italic">
                “{note}”
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The same ladder as a row of tiles and one line of words — for a table cell.
 *
 * Each tile carries its step and outcome as screen-reader text, because the
 * tiles on their own are a picture; the caption under them says the one thing
 * a scanning reader needs, which is who has it now.
 */
export function ApprovalStepStrip({
  stages,
  peopleByStageOrder,
  className,
}: {
  stages: readonly ApprovalRailStage[];
  peopleByStageOrder: Readonly<Record<number, string>>;
  className?: string;
}) {
  const stoppedAt = ladderStoppedAt(stages);

  return (
    <div className={cn('space-y-1', className)}>
      <ol className="flex items-center gap-1">
        {stages.map((stage, index, all) => {
          const decided =
            stage.status === 'approved' || stage.status === 'rejected';
          const neverReached =
            stoppedAt != null &&
            stage.stageOrder > stoppedAt.stageOrder &&
            !decided;
          // On a live "everyone" step the count is the outcome so far — the
          // tile is a picture, so its words have to carry it.
          const tally =
            stage.status === 'pending' ? approvalTally(stage) : null;
          const outcome = neverReached
            ? 'Never reached'
            : tally && tally.total > 0
              ? `${APPROVAL_STAGE_STATUS_LABELS[stage.status]}, ${tally.approved} of ${tally.total} approved`
              : APPROVAL_STAGE_STATUS_LABELS[stage.status];
          return (
            <li key={stage.stageOrder} className="flex items-center gap-1">
              <span
                title={`${stage.label} — ${outcome}`}
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold tabular-nums',
                  stageTileTone(stage.status, neverReached)
                )}
              >
                <StageGlyph stage={stage} iconClassName="size-3" />
                <span className="sr-only">
                  Step {stage.stageOrder}, {stage.label}: {outcome}
                </span>
              </span>
              {index < all.length - 1 && (
                <span className="h-px w-2 bg-border" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {describeLadderPosition(stages, peopleByStageOrder)}
      </p>
    </div>
  );
}
