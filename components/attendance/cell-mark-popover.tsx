'use client';

import { ArrowUpRight, Check, FileText, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import { STATUS_SEGMENT_WASH } from '@/components/attendance/status-wash';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import {
  EX_NOTE_MAX_LENGTH,
  EX_NOTE_PLACEHOLDER,
  EX_REASON_LABELS,
  type AttendanceStatus,
  type ExReason,
} from '@/lib/schemas/attendance';

// The marking palette: the picker rendered inside ONE popover anchored to the
// active grid cell (see wide-grid.tsx). Replaces the per-cell native <select>
// + <optgroup> — the only way to give the excuse categories a real,
// quota-aware design, since native option lists cannot be styled.
//
// ── REDESIGNED 2026-08-27, and the brief was one word: "modern" ───────────
//
// Mr Ace on the previous version: *"i personally dont like this"*. What was
// wrong with it, and what each fix is:
//
//   * The Excused tile was cyan, the panel it opened was cyan, and the chosen
//     reason inside that was cyan again — three nested boxes of one colour.
//     Now the reasons sit below a hairline rule as pills. No container.
//   * Four tall two-line tiles for a decision that is "P" nine times in ten.
//     Now one recessed SEGMENTED TRACK: an unchosen mark keeps a quiet third
//     of its paper colour so the legend still reads, and the chosen one takes
//     the whole fill and lifts off the track (STATUS_SEGMENT_WASH).
//   * The panel was ~360px tall whatever you clicked. Now it is ~130px for a
//     plain mark and only grows when Excused is picked. The rare case no
//     longer sets the size of the common one.
//   * The quota — a warning that you are about to spend a rationed leave day —
//     was the smallest grey text on the panel. Now it reads "1 left", and a
//     spent allowance dims and turns amber.
//   * A day excused by an approved parent filing looked identical to one a
//     teacher typed. Now it says so, names who approved it, and links to the
//     certificate (KD #195 / #197).
//
// ⚠ WHAT WAS DELIBERATELY NOT CHANGED, and each has a reason on record:
//
//   * The four paper washes (KD #132). They match the physical register and
//     the teachers asked for them; §10.2 makes STATUS_CELL_WASH the single
//     source the cells, the legend and this panel all read.
//   * `EX_REASON_LABELS` verbatim. The approved mockup shortened them to
//     "Medical certificate" / "Vacation" / "Urgent" for space — but that map
//     is SHARED with the daily register and the drills, and it carries the
//     school's own words from the paper legend. Shortening it here would
//     either fork the vocabulary or silently reword a surface nobody reviewed.
//   * Excused refusing to save without a reason (see `excusedArmed` below).
//   * The note committing on blur, and the P / A / L / E / N shortcuts.
//
// Both control groups stay `ToggleGroup type="single"` rather than hand-rolled
// buttons. That is what they are — pick exactly one — and the primitive brings
// roving tabindex, so the marks are ONE tab stop with arrow keys inside rather
// than five separate stops. See `pickStatus` for the one place its default
// behaviour is deliberately suppressed.

const MARKS: { status: AttendanceStatus; word: string }[] = [
  { status: 'P', word: 'Present' },
  { status: 'A', word: 'Absent' },
  { status: 'L', word: 'Late' },
  { status: 'EX', word: 'Excused' },
];

// ⚠ NC JOINED THE TRACK, having been a lone Toggle underneath.
//
// The old separation argued that "no class" is not a judgement about the
// student but a statement that the class did not meet — true, and it is still
// last in the row and greyed rather than washed in a paper colour. But sitting
// outside the group meant it was invisible to anyone who had not already been
// told it existed, and it is a mark like the others: one click, saved
// immediately. It appears only for registrar and above, which is unchanged.
const NC_MARK = { status: 'NC' as const, word: 'No class' };

// Shape and ink shared by every segment; the colour comes from
// STATUS_SEGMENT_WASH. The `hover:` and `data-[state=on]:` text colours are
// spelled out for the same reason the fills are — `toggleVariants` sets its
// own under both states, and a plain `text-*` class does not outrank them.
const SEGMENT_BASE =
  'relative h-auto w-full flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium text-ink-2 transition-all hover:text-ink-2 data-[state=on]:text-attendance-mark-ink data-[state=on]:shadow-sm';

// NC is chrome, not paper — its selected fill is dark, so its ink inverts.
const NC_SEGMENT = 'data-[state=on]:text-white hover:text-ink-2';

/**
 * What an approved parent filing put on this day (KD #195 / #197).
 *
 * ⚠ THE PARENT IS NOT NAMED HERE, and the approved mockup's "Mrs Tan" was
 * dropped on purpose. The only identifier we hold reliably is `filed_by_email`,
 * and a parent's email address answers nothing a teacher marking a register
 * needs to know — the question is "why is this day excused", not "who sent
 * it". It is on the filing itself, behind the link, where the queue does its
 * own scoping. Neither the parent's note nor the certificate is inlined here
 * for the same reason.
 */
export type CellFiling = {
  /**
   * The whole filed range, not just this day, already written the way a
   * person reads it ("27–31 Aug 2026") by `formatDayRange`.
   *
   * ⚠ Formatted by the caller, not here. A bare `YYYY-MM-DD` fed to
   * `new Date()` is treated as UTC midnight and re-rendered in the viewer's
   * zone, which moves it a day for anyone west of Greenwich — the same class
   * of slip that once shifted the relief cover board by a whole month.
   */
  dateRange: string;
  /** A certificate was uploaded or a link was given. */
  hasEvidence: boolean;
  /** Who gave the final approval. Null if the name could not be resolved. */
  approvedBy: string | null;
  /** Opens the filing in the declarations queue. */
  href: string;
};

export type CellMarkPaletteProps = {
  studentName: string;
  dateLabel: string;
  status: AttendanceStatus | null;
  exReason: ExReason | null;
  exNote: string | null;
  canWriteNc: boolean;
  vlUsed: number;
  vlAllowance: number;
  compassionateUsed: number;
  compassionateAllowance: number;
  /** Present only when a parent's approved filing covers this day. */
  filing?: CellFiling | null;
  onPick: (
    status: AttendanceStatus,
    exReason: ExReason | null,
    exNote?: string | null
  ) => void;
};

export function CellMarkPalette({
  studentName,
  dateLabel,
  status,
  exReason,
  exNote,
  canWriteNc,
  vlUsed,
  vlAllowance,
  compassionateUsed,
  compassionateAllowance,
  filing = null,
  onPick,
}: CellMarkPaletteProps) {
  // Draft note, committed on blur or Enter rather than per keystroke — the
  // grid writes to an append-only ledger, so a write per character would be
  // a row per character.
  const [noteDraft, setNoteDraft] = useState(exNote ?? '');
  useEffect(() => setNoteDraft(exNote ?? ''), [exNote]);

  function commitNote() {
    const next = noteDraft.trim();
    if (next === (exNote ?? '').trim()) return;
    onPick('EX', exReason, next === '' ? null : next);
  }

  // Excused is not a mark you can stamp on its own — an excused absence with
  // no reason is not a record of anything, and the daily register has always
  // refused to submit one. The term grid used to allow it purely because it
  // saves on every click instead of at a submit step, which is a difference in
  // plumbing, not in policy: 2,511 of 2,516 EX rows on production carry no
  // reason.
  //
  // So the segment is a disclosure, not a write: it opens the reasons, and the
  // mark is saved by whichever reason gets picked. `excusedArmed` is that
  // in-between. It is per-cell state, which holds because wide-grid keys this
  // component on the active cell, so moving to another cell remounts it.
  const [excusedArmed, setExcusedArmed] = useState(status === 'EX');
  const excusedOpen = status === 'EX' || excusedArmed;
  const excusedComplete = status === 'EX' && exReason != null;

  // A single-select ToggleGroup treats a click on the ALREADY-selected item as
  // deselect and reports ''. That is right for a filter chip and wrong here:
  // there is no "no mark" a teacher can write, and every save is a permanent
  // line in the register — so an empty value means "clicked the mark that is
  // already set", which is a no-op.
  // Changing a day the school has already excused. Held here until confirmed —
  // see `OverrideConfirm` for why this is inline rather than a dialog.
  const [pendingOverride, setPendingOverride] =
    useState<AttendanceStatus | null>(null);

  function pickStatus(next: string) {
    if (!next) return;
    if (next === 'EX') {
      setPendingOverride(null);
      setExcusedArmed(true);
      return;
    }
    // ⚠ Only when a filing actually covers this day AND it is currently
    // excused. A teacher fixing a day they marked excused themselves is
    // nobody's business but theirs, and asking about it would make the
    // interruption meaningless by making it routine.
    if (filing && status === 'EX') {
      setPendingOverride(next as AttendanceStatus);
      return;
    }
    setExcusedArmed(false);
    onPick(next as AttendanceStatus, null);
  }

  function confirmOverride() {
    if (!pendingOverride) return;
    const next = pendingOverride;
    setPendingOverride(null);
    setExcusedArmed(false);
    onPick(next, null);
  }

  function pickReason(next: string) {
    if (!next) return;
    onPick('EX', next as ExReason);
  }

  // Letter keys for the common marks — speed for bulk encoding. Excuse reasons
  // stay Tab/click (they carry a quota decision, not a reflex).
  function onKeyDown(e: React.KeyboardEvent) {
    // The note field lives inside this handler's subtree, so without this
    // guard typing "please" into it would stamp Present, Late and Absent on
    // the way through.
    const target = e.target as HTMLElement | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;

    // ⚠ ROUTED THROUGH `pickStatus`, NOT STRAIGHT TO `onPick`. It used to call
    // onPick directly, which was harmless while every mark was a plain write —
    // but the moment overriding an approved day needed confirming, pressing
    // "a" would have skipped the question the mouse now has to answer. A guard
    // only one input path respects is not a guard.
    const k = e.key.toLowerCase();
    if (k === 'p') pickStatus('P');
    else if (k === 'a') pickStatus('A');
    else if (k === 'l') pickStatus('L');
    else if (k === 'e') pickStatus('EX');
    else if (k === 'n' && canWriteNc) pickStatus('NC');
    else return;
    e.preventDefault();
  }

  const marks = canWriteNc ? [...MARKS, NC_MARK] : MARKS;

  const reasons: {
    reason: ExReason;
    quota: { used: number; allowance: number; unit: string } | null;
  }[] = [
    { reason: 'mc', quota: null },
    {
      reason: 'vacation',
      quota: { used: vlUsed, allowance: vlAllowance, unit: 'term' },
    },
    {
      reason: 'compassionate',
      quota: {
        used: compassionateUsed,
        allowance: compassionateAllowance,
        unit: 'year',
      },
    },
  ];

  const noteLeft = EX_NOTE_MAX_LENGTH - noteDraft.length;

  const pendingWord =
    marks.find((m) => m.status === pendingOverride)?.word ?? '';

  return (
    <div onKeyDown={onKeyDown} className="flex flex-col gap-3.5">
      {/* The student is the headline, so it is set like one. The date is
          reference, so it is mono and quiet. Previously both were one line of
          uppercase mono, which gave the name no more weight than the day. */}
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-serif text-[17px] leading-tight font-semibold tracking-[-0.005em] text-foreground">
          {studentName}
        </p>
        <span className="shrink-0 font-mono text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">
          {dateLabel}
        </span>
      </div>

      {/* The segmented track. `spacing={1}` keeps the group off its
          segmented-control branch, which would strip the corners off every
          item but the first and last — and here every item is rounded. */}
      <ToggleGroup
        type="single"
        value={status ?? ''}
        onValueChange={pickStatus}
        spacing={1}
        aria-label="Attendance mark"
        className={cn(
          'grid w-full gap-1 rounded-xl bg-muted p-1',
          canWriteNc ? 'grid-cols-5' : 'grid-cols-4'
        )}
      >
        {marks.map(({ status: s, word }) => (
          <ToggleGroupItem
            key={s}
            value={s}
            // The segment's own word, not ATTENDANCE_STATUS_LABELS — that one
            // reads "Excused (MC / Excuse leave)", which names a single one of
            // the three reasons this segment opens. Matching the visible text
            // is also what lets voice control say "click Excused".
            aria-label={word}
            aria-expanded={s === 'EX' ? excusedOpen : undefined}
            className={cn(
              SEGMENT_BASE,
              STATUS_SEGMENT_WASH[s],
              s === 'NC' && NC_SEGMENT,
              // Opened but not yet saved — a dashed ring rather than the solid
              // fill a chosen mark gets, because nothing is on record yet.
              s === 'EX' &&
                excusedOpen &&
                status !== 'EX' &&
                'ring-2 ring-foreground/25 ring-inset'
            )}
          >
            <span className="font-mono text-[15px] leading-none font-semibold tracking-[-0.02em]">
              {s}
            </span>
            <span className="leading-none">{word}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* The reasons. A rule separates and a label names — where a bordered,
          cyan-washed container used to nest inside a cyan tile. The pills are
          plain until chosen; the chosen one takes the same excused wash as the
          segment above it, so colour still says what these belong to. */}
      {/* Overriding an approved day REPLACES the body rather than stacking on
          it. The reasons and the filing are not decisions the teacher is being
          asked to make at this moment, and leaving them on screen under a
          question is how a panel becomes unreadable. */}
      {pendingOverride && filing && (
        <>
          <div className="h-px bg-border" aria-hidden />
          <OverrideConfirm
            filing={filing}
            nextStatus={pendingOverride}
            nextWord={pendingWord}
            onCancel={() => setPendingOverride(null)}
            onConfirm={confirmOverride}
          />
        </>
      )}

      {excusedOpen && !pendingOverride && (
        <>
          <div className="h-px bg-border" aria-hidden />

          <div className="flex animate-in flex-col gap-2 fade-in-0 slide-in-from-top-1 duration-150">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[10px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">
                Reason
              </span>
              <span className="text-[11px] text-muted-foreground">
                required
              </span>
            </div>
            <ToggleGroup
              type="single"
              value={exReason ?? ''}
              onValueChange={pickReason}
              spacing={1}
              aria-label="Reason for the excused absence"
              className="flex w-full flex-wrap justify-start gap-1.5"
            >
              {reasons.map(({ reason, quota }) => {
                const left = quota ? quota.allowance - quota.used : null;
                const spent = left != null && left <= 0;
                return (
                  <ToggleGroupItem
                    key={reason}
                    value={reason}
                    className={cn(
                      'h-auto w-auto gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[12.5px] font-normal text-foreground hover:bg-muted/70 hover:text-foreground data-[state=on]:bg-attendance-excused data-[state=on]:font-semibold data-[state=on]:text-attendance-mark-ink data-[state=on]:shadow-sm',
                      spent && 'opacity-65'
                    )}
                  >
                    <span>{EX_REASON_LABELS[reason]}</span>
                    {left != null && (
                      // ⚠ "1 left", not "0/1 term". This is the one warning
                      // that has to land BEFORE the click — it says a rationed
                      // leave day is about to be spent — and it used to be the
                      // smallest grey text on the panel.
                      <span
                        className={cn(
                          'text-[10.5px] tabular-nums',
                          spent
                            ? 'font-semibold text-brand-amber'
                            : 'text-muted-foreground'
                        )}
                        title={`${quota!.used} used of ${quota!.allowance} per ${quota!.unit}`}
                      >
                        {spent ? 'none left' : `${left} left`}
                      </span>
                    )}
                    {exReason === reason && (
                      <Check className="size-3 shrink-0" aria-hidden />
                    )}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>

          {/* The parent's filing, when one covers this day. It stands in for
              the note field rather than sitting beside it: the parent's own
              note is ON the filing, and asking the teacher to write a second
              explanation under the first is how the two end up disagreeing. */}
          {filing ? (
            <FilingCard filing={filing} />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[10px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">
                  Note
                </span>
                <span className="text-[11px] text-muted-foreground">
                  optional
                </span>
              </div>
              {/* Christina's ask (2026-07-31, 31:07) and Melissa's (32:44):
                  somewhere to record WHY. Disabled until a reason is chosen,
                  because the note saves as part of the excused mark — typing
                  here first would write the very reasonless EX the disclosure
                  above exists to prevent. */}
              <Textarea
                rows={2}
                value={noteDraft}
                disabled={!excusedComplete}
                maxLength={EX_NOTE_MAX_LENGTH}
                onChange={(e) => setNoteDraft(e.target.value)}
                onBlur={commitNote}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitNote();
                  }
                }}
                placeholder={EX_NOTE_PLACEHOLDER}
                aria-label={`Note for ${studentName} on ${dateLabel}`}
                className="min-h-0 resize-none border-0 bg-muted px-3 py-2 text-[13px] leading-snug shadow-none"
              />
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {excusedComplete
                    ? // The one thing about this field that is not obvious: it
                      // saves on blur, not as you type.
                      'Saves when you click away.'
                    : 'Choose a reason to mark this student excused.'}
                </span>
                {excusedComplete && (
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {noteLeft} left
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* The resting line. A plain mark saves on the click and the popover
          closes, which is the fast bulk-encoding path — worth saying once
          rather than leaving the teacher to discover it. */}
      {!excusedOpen && !pendingOverride && (
        <p className="text-[11px] text-muted-foreground">
          Saves as soon as you pick.
        </p>
      )}
    </div>
  );
}

/**
 * What an approved parent filing put on this day — in two lines.
 *
 * The payoff of KD #195/#197: until now a day excused by an approved
 * certificate looked exactly like one a teacher typed from memory, which is
 * the guessing the whole declaration feature was built to stop.
 *
 * ⚠ IT STARTED AS A FIVE-LINE CARD AND MR ACE WAS RIGHT TO CUT IT: *"then the
 * popover content will have many details its hard to read"*. This control
 * exists to make marking fast, so the filing gets the ONE sentence that
 * answers "why is this day excused" and nothing else. What was dropped, and
 * where each thing went:
 *
 *   * who approved it → into the confirmation, where it is the reason to stop
 *     and think, rather than a badge nobody reads at rest;
 *   * "changing this won't change the filing" → same place. A warning shown
 *     permanently is wallpaper; shown at the moment you change the mark, it
 *     is information.
 *   * the parent, their note, the certificate itself → behind the link, on
 *     the filing, where the queue does its own scoping.
 */
function FilingCard({ filing }: { filing: CellFiling }) {
  return (
    <a
      href={filing.href}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-2.5 rounded-xl bg-muted px-3 py-2.5 transition-colors hover:bg-accent"
    >
      <FileText className="size-4 shrink-0 text-brand-indigo" aria-hidden />
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
        <span className="font-semibold">Excused by a parent&apos;s filing</span>
        <span className="text-muted-foreground">
          {' · '}
          {filing.dateRange}
          {/* ⚠ The absence of proof is stated, not left blank. A parent may
              file without a certificate, and a teacher reading only "excused
              by a filing" would assume one exists. Two words, because the
              panel has to stay readable. */}
          {filing.hasEvidence ? ' · certificate' : ' · no certificate'}
        </span>
      </span>
      <ArrowUpRight
        className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
        aria-hidden
      />
    </a>
  );
}

/**
 * The one moment the filing needs to interrupt: a teacher changing a day the
 * school has already excused.
 *
 * ⚠ INLINE, NOT A DIALOG, and that was the decision. A confirm modal is for
 * something destructive, and this is not: `attendance_daily` is append-only,
 * so the old mark survives, and the filing itself is untouched. More to the
 * point, the COMMON reason to change a filed day is that the teacher is right
 * — a parent files Monday to Friday and the child comes back on Wednesday —
 * and putting a modal in front of the correct action trains people to click
 * through warnings. A pop-up on top of a pop-up is also the one shape the
 * design rules single out as never worth it.
 *
 * So it takes over the body of the panel it is already in, names the person
 * who approved the day, and offers both ways out.
 */
function OverrideConfirm({
  filing,
  nextStatus,
  nextWord,
  onCancel,
  onConfirm,
}: {
  filing: CellFiling;
  nextStatus: AttendanceStatus;
  nextWord: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex animate-in flex-col gap-3 fade-in-0 slide-in-from-top-1 duration-150">
      <div className="flex items-start gap-2.5 rounded-xl bg-brand-amber/10 px-3 py-2.5">
        <TriangleAlert
          className="mt-0.5 size-4 shrink-0 text-brand-amber"
          aria-hidden
        />
        {/* ⚠ EACH SENTENCE IS ONE STRING, not JSX text wrapped around an
            expression. JSX strips the whitespace between an expression and an
            adjacent newline, so `Marking it {word} won't` renders as
            "absentwon't" the moment a formatter wraps that line — which is
            exactly what it looked like on screen. Building the sentence in JS
            removes the whole class of bug rather than re-adding one space. */}
        <p className="text-[12px] leading-relaxed text-foreground">
          {filing.approvedBy
            ? `${filing.approvedBy} approved this day as excused.`
            : 'The school approved this day as excused.'}{' '}
          <span className="text-muted-foreground">
            {`Marking it ${nextWord.toLowerCase()} won’t change what the parent sent.`}
          </span>
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Keep excused
        </Button>
        <Button type="button" size="sm" onClick={onConfirm}>
          Mark {nextWord.toLowerCase()}
        </Button>
      </div>
      <span className="sr-only" role="status">
        {`Confirm changing an excused day to ${nextStatus}.`}
      </span>
    </div>
  );
}
