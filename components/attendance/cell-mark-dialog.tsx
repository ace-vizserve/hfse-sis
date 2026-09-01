'use client';

// `Plane` is the same icon the declarations queue puts on a travel row, so one
// filing wears one symbol wherever a person meets it.
import {
  ArrowUpRight,
  Check,
  Eraser,
  FileText,
  Plane,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { MedicalCertificateField } from '@/components/attendance/medical-certificate-field';
import { STATUS_SEGMENT_WASH } from '@/components/attendance/status-wash';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import {
  EX_NOTE_MAX_LENGTH,
  EX_NOTE_PLACEHOLDER,
  EX_REASON_LABELS,
  type AttendanceStatus,
  type ExReason,
} from '@/lib/schemas/attendance';

// The marking palette: ONE dialog for the whole register, opened on whichever
// grid cell was clicked (see wide-grid.tsx). Replaces the per-cell native
// <select> + <optgroup> — the only way to give the excuse categories a real,
// quota-aware design, since native option lists cannot be styled.
//
// ── MOVED OUT OF A POPOVER 2026-08-31, and the reasons were the user's ────
//
// Mr Ace: *"its not a sheet its a dialog"*, on two problems with the popover:
//
//   * NOTHING SAID WHICH CELL WAS OPEN. A popover floats beside its anchor,
//     and at ~1,410 cells "beside" is not an answer — a teacher a third of the
//     way down a 47-day row could not tell which day they were editing. The
//     grid now rings the open cell for as long as this dialog is up, and that
//     ring is the only thing carrying that information.
//   * THE NOTE AND THE COMING MEDICAL-CERTIFICATE UPLOAD WOULD BE CRAMPED.
//     A 288px popover was already tight for a two-line textarea; an upload
//     control under it does not fit at all.
//
// ⚠ A DIALOG DOES NOT SCROLL ITS OWN BODY FOR FREE. `DialogContent` is a
// `grid` with `p-6` by default; this one overrides to `flex flex-col` with a
// bounded `max-h-[85dvh]` and no padding, so the header and the footer stay
// pinned while the middle band scrolls on `flex-1 min-h-0 overflow-y-auto`.
// The tall case is Excused with the note AND the certificate slot showing —
// check that one, not the empty cell, after any change to this layout.
//
// ⚠ NEVER NEST A DIALOG INSIDE THIS ONE. `OverrideConfirm` — the question a
// teacher gets before changing a day an approved parent filing already
// excused — REPLACES the body of this dialog rather than opening a second
// one. Two stacked dialogs fight over the focus trap, and dismissing the
// inner one takes the outer one with it. Anything else that needs to
// interrupt goes the same way: swap the body, keep one dialog.
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
//   * The note committing on blur, and the P / A / L / E shortcuts.
//   * Marking staying ONE CLICK. The container got bigger; the number of
//     clicks it takes to mark a class did not, or the register pass becomes a
//     chore and the teachers stop doing it here.
//
// Both control groups stay `ToggleGroup type="single"` rather than hand-rolled
// buttons. That is what they are — pick exactly one — and the primitive brings
// roving tabindex, so the marks are ONE tab stop with arrow keys inside rather
// than four separate stops. See `pickStatus` for the one place its default
// behaviour is deliberately suppressed.

const MARKS: { status: AttendanceStatus; word: string }[] = [
  { status: 'P', word: 'Present' },
  { status: 'A', word: 'Absent' },
  { status: 'L', word: 'Late' },
  { status: 'EX', word: 'Excused' },
];

// ⚠ "NO CLASS" IS NOT ON THE TRACK, AND MUST NOT BE PUT BACK.
//
// Mr Ace, 2026-08-31: *"there is no NC type of attendance mark"*. A day the
// class did not meet is a property of the SCHOOL CALENDAR, not a judgement
// about a student — it is set on `/sis/calendar`, which the register card
// above this grid already links to, and the grid then renders that whole
// column as a non-encodable band. Offering it per cell invited a teacher to
// record "no class" for one child on a day the other twenty-nine were taught.
//
// ⚠ EXISTING NC MARKS ARE STILL REAL DATA AND STILL RENDER. Imports, holidays
// and not-yet-enrolled rows have written them; `STATUS_CELL_WASH` and
// `ATTENDANCE_STATUS_LABELS` keep their NC entries, and the grid paints an NC
// cell exactly as before. What was removed is a way to PICK it, never a way to
// SHOW it.
//
// ⚠ THE SERVER'S REGISTRAR-ONLY NC GUARD STAYS EXACTLY AS IT IS, and removing
// it because "the UI no longer offers NC" would be the wrong lesson: the API
// is reachable without this component (imports, the daily register, anything
// holding a session), so the guard is what actually enforces the rule. This
// palette dropping the segment is a design change; the permission is not.

// Shape and ink shared by every segment; the colour comes from
// STATUS_SEGMENT_WASH. The `hover:` and `data-[state=on]:` text colours are
// spelled out for the same reason the fills are — `toggleVariants` sets its
// own under both states, and a plain `text-*` class does not outrank them.
// ⚠ THE CHOSEN SEGMENT IS SAID FOUR WAYS, NOT ONE. Mr Ace on the first cut:
// *"its not clear whats the selected attendance type"*. It leaned entirely on
// the fill going from a fraction of its paper colour to all of it — which on
// an unmarked cell gives nothing to compare against, since no segment is on.
// So the chosen one now also takes a ring in the mark ink, heavier type, and
// darker ink, and only the ring is a shape rather than a shade. Contrast alone
// is not a selected state: it fails anyone who cannot separate these four
// pastels, and it failed the person who asked for the screen.
const SEGMENT_BASE =
  'relative h-auto w-full flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-[10px] font-medium text-ink-2 transition-all hover:text-ink-2 data-[state=on]:font-semibold data-[state=on]:text-attendance-mark-ink data-[state=on]:shadow-sm data-[state=on]:ring-2 data-[state=on]:ring-attendance-mark-ink/45 data-[state=on]:ring-inset';

// The eyebrow over each band of the body. One voice, declared once, so
// "Reason" / "Note" / "Medical certificate" cannot drift apart.
const BAND_EYEBROW =
  'font-mono text-[10px] font-semibold tracking-[0.13em] text-muted-foreground uppercase';

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
  /**
   * Which kind of filing excused the day — an absence, or a family holiday.
   *
   * Both write the register (`REGISTER_WRITING_TYPES`), so both belong here.
   * They differ in one word of copy and one icon: a holiday has no
   * certificate to have or lack, so the evidence clause is absence-only.
   */
  kind: 'absence' | 'travel';
  /** A certificate was uploaded or a link was given. Absence only. */
  hasEvidence: boolean;
  /**
   * The SCHOOL recorded this, not a parent — a certificate handed in at the
   * office and scanned onto the day.
   *
   * ⚠ IT SUPPRESSES THE FILING CARD ENTIRELY, and that is the point. "Excused
   * by a parent's filing" is false for one of these, there is no queue entry
   * to link to (the row goes in with no approval ladder), and the certificate
   * band below already says a certificate is on the day. The card would be a
   * wrong sentence pointing at a page that cannot show the row.
   */
  recordedBySchool: boolean;
  /** Who gave the final approval. Null if the name could not be resolved. */
  approvedBy: string | null;
  /** Opens the filing in the declarations queue. */
  href: string;
};

export type CellMarkDialogProps = {
  /** The dialog is open on exactly one cell, or on none. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentName: string;
  /**
   * The enrolment being marked — `section_students.id`, which is what the
   * register itself is keyed on. Carried so a medical certificate can be
   * recorded against this cell without the dialog reaching back into the grid.
   */
  sectionStudentId: string;
  /** The day being marked as `yyyy-MM-dd`, for the certificate write. */
  date: string;
  /** The student's permanent roster number, shown beside the date. */
  indexNumber: number;
  /** The day being marked, written out in full ("Friday, 7 August 2026"). */
  dateLabel: string;
  status: AttendanceStatus | null;
  exReason: ExReason | null;
  exNote: string | null;
  vlUsed: number;
  vlAllowance: number;
  compassionateUsed: number;
  compassionateAllowance: number;
  /** Present only when a parent's approved filing covers this day. */
  filing?: CellFiling | null;
  /**
   * Save a mark — or, with `null`, CLEAR the day (migration 134).
   *
   * A clear is not a fifth mark and is not offered on the track beside the
   * four. It is the undo for a mark that should not be there, so it always
   * arrives as `(null, null, null)`: a cleared day may carry neither a reason
   * nor a note, which is a database constraint, not a convention.
   */
  onPick: (
    status: AttendanceStatus | null,
    exReason: ExReason | null,
    exNote?: string | null
  ) => void;
};

export function CellMarkDialog({
  open,
  onOpenChange,
  studentName,
  sectionStudentId,
  date,
  indexNumber,
  dateLabel,
  status,
  exReason,
  exNote,
  vlUsed,
  vlAllowance,
  compassionateUsed,
  compassionateAllowance,
  filing = null,
  onPick,
}: CellMarkDialogProps) {
  // Draft note, committed on blur rather than per keystroke — the grid writes
  // to an append-only ledger, so a write per character would be a row per
  // character.
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
  // see `OverrideConfirm` for why this replaces the body instead of opening a
  // second dialog on top of this one.
  //
  // `'clear'` is a change like any other as far as this question goes: a
  // teacher blanking a day two people approved is exactly the moment the
  // filing has to interrupt. Routing it anywhere else would repeat the bug
  // the keyboard shortcuts already had — a guard only one path respects is
  // not a guard.
  const [pendingOverride, setPendingOverride] = useState<
    AttendanceStatus | 'clear' | null
  >(null);

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
    if (next === 'clear') onPick(null, null, null);
    else onPick(next, null);
  }

  /**
   * Return the day to unmarked.
   *
   * Offered only on a cell that HAS a mark — there is nothing to clear
   * otherwise, and an action that does nothing is worse than no action. The
   * grid opens this dialog on one cell at a time, so `status` is that cell's
   * current mark.
   *
   * ⚠ It is not destructive in the sense the design rules mean. `attendance_
   * daily` is append-only, so the mark being cleared stays in the ledger with
   * its author and its timestamp; what changes is which row wins. That is why
   * this is a quiet `ghost` and not a red commit button — a red button here
   * would say "this is final" about the one action in the dialog that is not.
   */
  function clearMark() {
    if (filing && status === 'EX') {
      setPendingOverride('clear');
      return;
    }
    setExcusedArmed(false);
    onPick(null, null, null);
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
    //
    // ⚠ THERE IS NO "n" ANY MORE. It stamped NC, which is not a mark a person
    // picks — see the note above `SEGMENT_BASE`.
    const k = e.key.toLowerCase();
    if (k === 'p') pickStatus('P');
    else if (k === 'a') pickStatus('A');
    else if (k === 'l') pickStatus('L');
    else if (k === 'e') pickStatus('EX');
    else return;
    e.preventDefault();
  }

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

  const pendingWord =
    pendingOverride === 'clear'
      ? 'cleared'
      : (MARKS.find((m) => m.status === pendingOverride)?.word ?? '');

  const overriding = pendingOverride != null && filing != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ⚠ `flex flex-col` and `max-h-[85dvh]` are load-bearing, not styling.
          `DialogContent`'s own base is `grid … gap-4 p-6`, which grows the
          whole dialog past the viewport once Excused opens the reasons, the
          note and the certificate slot together. Bounding the height here and
          scrolling the middle band is what keeps the header and the footer —
          the student's name and the way out — on screen at every height.
          Padding moves onto the three bands so the hairlines run edge to edge. */}
      <DialogContent
        onKeyDown={onKeyDown}
        className="flex max-h-[85dvh] flex-col gap-0 p-0 sm:max-w-xl"
      >
        {/* The student is the headline, so it is set like one. The number and
            the day are reference, so they are mono and quiet. `pr-10` keeps a
            long name clear of the close button, which floats over this band. */}
        <DialogHeader className="shrink-0 gap-1.5 border-b border-border px-5 pt-5 pr-10 pb-4 text-left sm:text-left">
          <DialogTitle className="font-serif text-[19px] leading-tight font-semibold tracking-[-0.005em] text-foreground">
            {studentName}
          </DialogTitle>
          <DialogDescription
            className={cn(BAND_EYEBROW, 'tabular-nums')}
          >{`No. ${indexNumber} · ${dateLabel}`}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
          {/* Overriding an approved day REPLACES the body rather than stacking
              on it — and never opens a second dialog. The reasons and the
              filing are not decisions the teacher is being asked to make at
              this moment, and leaving them on screen under a question is how a
              panel becomes unreadable. */}
          {overriding ? (
            <OverrideConfirm
              filing={filing}
              nextStatus={pendingOverride}
              nextWord={pendingWord}
              onCancel={() => setPendingOverride(null)}
              onConfirm={confirmOverride}
            />
          ) : (
            <>
              {/* The mark comes FIRST and takes the full width: nine times in
                  ten it is the only thing the teacher touches, and it has to
                  stay one click. `spacing={1}` keeps the group off its
                  segmented-control branch, which would strip the corners off
                  every item but the first and last — and here every item is
                  rounded. */}
              <div className="flex flex-col gap-2">
                <span className={BAND_EYEBROW}>Mark</span>
                <ToggleGroup
                  type="single"
                  value={status ?? ''}
                  onValueChange={pickStatus}
                  spacing={1}
                  aria-label="Attendance mark"
                  className="grid w-full grid-cols-4 gap-1 rounded-xl bg-muted p-1"
                >
                  {MARKS.map(({ status: s, word }) => (
                    <ToggleGroupItem
                      key={s}
                      value={s}
                      // The segment's own word, not ATTENDANCE_STATUS_LABELS —
                      // that one reads "Excused (MC / Excuse leave)", which
                      // names a single one of the three reasons this segment
                      // opens. Matching the visible text is also what lets
                      // voice control say "click Excused".
                      aria-label={word}
                      aria-expanded={s === 'EX' ? excusedOpen : undefined}
                      className={cn(
                        SEGMENT_BASE,
                        STATUS_SEGMENT_WASH[s],
                        // Opened but not yet saved — a ring rather than the
                        // solid fill a chosen mark gets, because nothing is on
                        // record yet.
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
              </div>

              {/* The reasons. A rule separates and a label names — where a
                  bordered, cyan-washed container used to nest inside a cyan
                  tile. The pills are plain until chosen; the chosen one takes
                  the same excused wash as the segment above it, so colour still
                  says what these belong to. */}
              {excusedOpen && (
                <>
                  <div className="h-px bg-border" aria-hidden />

                  <div className="flex animate-in flex-col gap-2 fade-in-0 slide-in-from-top-1 duration-150">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={BAND_EYEBROW}>Reason</span>
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
                        const left = quota
                          ? quota.allowance - quota.used
                          : null;
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
                              // ⚠ "1 left", not "0/1 term". This is the one
                              // warning that has to land BEFORE the click — it
                              // says a rationed leave day is about to be spent
                              // — and it used to be the smallest grey text on
                              // the panel.
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

                  {/* The parent's filing, when one covers this day. */}
                  {filing && !filing.recordedBySchool && (
                    <FilingCard filing={filing} />
                  )}

                  {/* ⚠ THE NOTE SHOWS WHETHER OR NOT A PARENT FILED, and it
                      used to be REPLACED by the card above it. Mr Ace,
                      2026-08-31: *"show the note regardless its internal
                      notes"*.

                      The old reasoning was that the parent's note is already
                      on the filing, so a second explanation underneath is how
                      the two come to disagree. That mistook them for the same
                      fact. `attendance_daily.ex_note` is the SCHOOL'S OWN
                      record and never leaves the school — migration 109 keeps
                      it out of `audit_log` deliberately, and no parent route
                      returns it. `student_declarations.parent_note` is the
                      parent's message coming IN. One is not a copy of the
                      other, and a teacher still needs somewhere to put
                      "certificate seen by the office" or "back Monday" on a
                      day the parent has already explained in their own words.

                      The either/or was also decided when this was a 288px
                      popover, where the two genuinely competed for one slot.
                      It is a dialog now and that constraint is gone. The daily
                      register already showed both, so this ends a real
                      disagreement between the two surfaces about one day. */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={BAND_EYEBROW}>Note</span>
                      <span className="text-[11px] text-muted-foreground">
                        optional
                      </span>
                    </div>
                    {/* Christina's ask (2026-07-31, 31:07) and Melissa's
                          (32:44): somewhere to record WHY. Disabled until a
                          reason is chosen, because the note saves as part of
                          the excused mark — typing here first would write the
                          very reasonless EX the disclosure above exists to
                          prevent. */}
                    {/* ⚠ ENTER NO LONGER SAVES. It used to commit the note,
                        which cost the teacher any way of writing a second
                        line; in a formatted field Enter starts a new
                        paragraph, and the blur save below is unchanged and is
                        what the help line has always described. */}
                    <RichTextEditor
                      rows={3}
                      value={noteDraft}
                      disabled={!excusedComplete}
                      maxLength={EX_NOTE_MAX_LENGTH}
                      onChange={setNoteDraft}
                      onBlur={commitNote}
                      placeholder={EX_NOTE_PLACEHOLDER}
                      aria-label={`Note for ${studentName} on ${dateLabel}`}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {excusedComplete
                        ? // The one thing about this field that is not
                          // obvious: it saves on blur, not as you type.
                          'Saves when you click away.'
                        : 'Choose a reason to mark this student excused.'}
                    </span>
                  </div>

                  {/* The certificate for this day — the slot this band was
                      reserved for when the panel stopped being a popover.
                      Mr Ace: *"the simplest way is just allow the SIS users to
                      upload the MC."*

                      ⚠ ONLY ON A MARK THAT IS ACTUALLY ON RECORD, not merely
                      on `excusedOpen`. Arming Excused without picking a reason
                      has saved nothing, and offering to attach proof to a day
                      that carries no mark is the same reasonless EX the note
                      field is disabled to prevent.

                      ⚠ NOT ON A FAMILY HOLIDAY. A travel filing carries no
                      certificate and the schema forbids it one, so the band is
                      absent rather than present-and-refusing — the same
                      absence-only rule `FilingCard` follows when it declines to
                      say "no certificate" on a holiday. */}
                  {status === 'EX' && filing?.kind !== 'travel' && (
                    <>
                      <div className="h-px bg-border" aria-hidden />
                      <MedicalCertificateField
                        sectionStudentId={sectionStudentId}
                        date={date}
                        studentName={studentName}
                        hasCertificate={filing?.hasEvidence === true}
                      />
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* The footer carries the way out of a mark already made, and the one
            sentence about how this dialog saves. Pinned, so neither moves when
            Excused grows the body. Hidden while the override question is up —
            that step brings its own two actions, and a "Clear mark" button
            beside them would offer a third answer to a yes/no question. */}
        {!overriding && (
          <DialogFooter className="shrink-0 flex-row items-center justify-between gap-2 border-t border-border px-5 py-3.5 sm:justify-between">
            {/* ⚠ EMPTY CELLS ONLY for the "saves as soon as you pick" line.
                The reader of it is someone who has not picked yet; on a marked
                cell the sentence beside "Clear mark" has to describe THAT. */}
            <span className="text-[11px] text-muted-foreground">
              {status === null
                ? excusedOpen
                  ? 'Pick a reason to save this mark.'
                  : 'Saves as soon as you pick.'
                : 'Returns the day to unmarked.'}
            </span>
            {/* Undo. Deliberately quieter than the four marks: it is not a
                fifth thing to choose between, it is the way out of the choice
                already made. Never rendered on an empty cell — see
                `clearMark`. */}
            {status !== null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearMark}
                className="h-7 gap-1.5 px-2 text-[12px] font-normal text-muted-foreground hover:text-foreground"
              >
                <Eraser className="size-3.5" aria-hidden />
                Clear mark
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
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
 * answers "why is this day excused" and nothing else. The extra room a dialog
 * brings is NOT an invitation to put the four dropped things back — it went to
 * the note and the certificate slot, which are things a teacher does. What was
 * dropped, and where each thing went:
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
  const isTravel = filing.kind === 'travel';
  // ⚠ The kind goes in the BOLD phrase rather than being appended as another
  // "· travel" clause. It is the first thing read, it keeps the card to one
  // line, and — the practical reason — it leaves the absence copy exactly as
  // it shipped and was reviewed, instead of re-opening a string that carries
  // the school's own words.
  const Icon = isTravel ? Plane : FileText;
  return (
    <a
      href={filing.href}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-2.5 rounded-xl bg-muted px-3 py-2.5 transition-colors hover:bg-accent"
    >
      <Icon className="size-4 shrink-0 text-brand-indigo" aria-hidden />
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
        <span className="font-semibold">
          {isTravel
            ? "Excused by a parent's travel filing"
            : "Excused by a parent's filing"}
        </span>
        <span className="text-muted-foreground">
          {' · '}
          {filing.dateRange}
          {/* ⚠ The absence of proof is stated, not left blank. A parent may
              file without a certificate, and a teacher reading only "excused
              by a filing" would assume one exists. Two words, because the
              panel has to stay readable.

              ⚠ ABSENCE ONLY. A holiday has no certificate to have or lack —
              the schema forbids one — so "no certificate" there would invent
              a missing document nobody ever asked the parent for. */}
          {isTravel
            ? ''
            : filing.hasEvidence
              ? ' · certificate'
              : ' · no certificate'}
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
 * ⚠ AN INLINE STEP, NEVER A SECOND DIALOG, and that is now a rule and not
 * just a preference. Two reasons, and the second one is newer:
 *
 *   1. A confirm modal is for something destructive, and this is not:
 *      `attendance_daily` is append-only, so the old mark survives, and the
 *      filing itself is untouched. More to the point, the COMMON reason to
 *      change a filed day is that the teacher is right — a parent files Monday
 *      to Friday and the child comes back on Wednesday — and putting a modal
 *      in front of the correct action trains people to click through warnings.
 *   2. The panel this lives in IS a dialog now. Nesting a second one inside it
 *      is the shape the design rules single out as never worth it: the two
 *      focus traps fight, and dismissing the inner one can dismiss both.
 *
 * So it takes over the body of the dialog it is already in, names the person
 * who approved the day, and offers both ways out. Cancelling puts the mark
 * palette back exactly as it was, with the day still excused.
 */
function OverrideConfirm({
  filing,
  nextStatus,
  nextWord,
  onCancel,
  onConfirm,
}: {
  filing: CellFiling;
  nextStatus: AttendanceStatus | 'clear';
  nextWord: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isClear = nextStatus === 'clear';
  // ⚠ SAME RULE AS THE SENTENCE BELOW — built in JS, never as JSX text around
  // an expression. "Marking it cleared" is also not English, so the clear
  // branch rewrites the verb rather than substituting a word into the
  // reviewed absence sentence.
  // ⚠ "WHAT THE PARENT SENT" IS FALSE FOR A CERTIFICATE THE OFFICE SCANNED IN,
  // and that row is the commonest one this warning now fires on. What survives
  // the change is different in each case, so the noun changes with it: a
  // parent's filing, or the certificate on the day.
  const survives = filing.recordedBySchool
    ? 'the certificate on file'
    : 'what the parent sent';
  const consequence = isClear
    ? `Clearing it won’t change ${survives}.`
    : `Marking it ${nextWord.toLowerCase()} won’t change ${survives}.`;
  const confirmLabel = isClear
    ? 'Clear the mark'
    : `Mark ${nextWord.toLowerCase()}`;
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
          {filing.recordedBySchool
            ? 'The school office recorded a certificate for this day.'
            : filing.approvedBy
              ? `${filing.approvedBy} approved this day as excused.`
              : 'The school approved this day as excused.'}{' '}
          <span className="text-muted-foreground">{consequence}</span>
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Keep excused
        </Button>
        <Button type="button" size="sm" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
      <span className="sr-only" role="status">
        {isClear
          ? 'Confirm returning an excused day to unmarked.'
          : `Confirm changing an excused day to ${nextStatus}.`}
      </span>
    </div>
  );
}
