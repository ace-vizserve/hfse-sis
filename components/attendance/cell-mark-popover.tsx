'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  STATUS_CELL_WASH,
  STATUS_TOGGLE_WASH,
} from '@/components/attendance/status-wash';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import {
  ATTENDANCE_STATUS_LABELS,
  EX_NOTE_MAX_LENGTH,
  EX_NOTE_PLACEHOLDER,
  EX_REASON_LABELS,
  type AttendanceStatus,
  type ExReason,
} from '@/lib/schemas/attendance';

// The marking palette: the shared picker rendered inside ONE popover anchored to
// the active grid cell (see wide-grid.tsx). Replaces the per-cell native
// <select> + <optgroup> — the only way to give the excuse categories a real,
// quota-aware design, since native option lists can't be styled. Statuses stamp
// in the HFSE paper palette (STATUS_CELL_WASH, shared with the cells); the two
// rationed excuse reasons surface this student's used/allowance inline, so the
// quota is visible BEFORE you commit (not an after-the-fact toast).
//
// All FOUR marks are peer tiles. They were previously three tiles above a
// permanently-open list of three excuse reasons, which read as though Excused
// were a category sitting above Present rather than a mark beside it — and it
// spent half the popover on rows most marks never need. Excused is the only
// tile with anything behind it, so it is the only one that opens a drawer, and
// the drawer carries the same cyan wash as the tile: colour as parentage, so
// there is no doubt what those reasons belong to.
//
// Both rows are `ToggleGroup type="single"` rather than hand-rolled buttons.
// That is what they are — pick exactly one — and the primitive brings roving
// tabindex with it, so the four marks are one tab stop with arrow keys inside
// rather than four separate stops. See `pickStatus` for the one place its
// default behaviour is deliberately suppressed.

const PRIMARY: { status: AttendanceStatus; word: string }[] = [
  { status: 'P', word: 'Present' },
  { status: 'A', word: 'Absent' },
  { status: 'L', word: 'Late' },
  { status: 'EX', word: 'Excused' },
];

// Shape and ink, shared by all four tiles — the colour comes from
// STATUS_TOGGLE_WASH. The `hover:` and `data-[state=on]:` text colours are here
// for the same reason the washes are: `toggleVariants` sets its own under both
// states and a plain `text-*` class does not outrank them.
const TILE_BASE =
  'relative h-auto w-full flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-attendance-mark-ink opacity-90 transition-all hover:text-attendance-mark-ink hover:opacity-100 hover:brightness-105 data-[state=on]:text-attendance-mark-ink data-[state=on]:opacity-100 data-[state=on]:ring-2 data-[state=on]:ring-inset data-[state=on]:ring-foreground';

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
  // refused to submit one ("Choose a reason for each Excused student to
  // submit"). The term grid used to allow it purely because it saves on every
  // click instead of at a submit step, which is a difference in plumbing, not
  // in policy.
  //
  // So the tile is a disclosure, not a write: it opens the reasons, and the
  // mark is saved by whichever reason gets picked. `excusedArmed` is that
  // in-between — the teacher has opened the drawer but not yet chosen. It is
  // per-cell state, which holds because wide-grid keys this component on the
  // active cell, so moving to another cell remounts it.
  const [excusedArmed, setExcusedArmed] = useState(status === 'EX');
  const excusedOpen = status === 'EX' || excusedArmed;
  const excusedComplete = status === 'EX' && exReason != null;

  // A single-select ToggleGroup treats a click on the ALREADY-selected item as
  // deselect and reports ''. That is right for a filter chip and wrong here:
  // there is no "no mark" a teacher can write, and every save is a permanent
  // line in the register — so an empty value means "clicked the mark that is
  // already set", which is a no-op.
  function pickStatus(next: string) {
    if (!next) return;
    if (next === 'EX') {
      setExcusedArmed(true);
      return;
    }
    setExcusedArmed(false);
    onPick(next as AttendanceStatus, null);
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

    const k = e.key.toLowerCase();
    if (k === 'p') onPick('P', null);
    else if (k === 'a') onPick('A', null);
    else if (k === 'l') onPick('L', null);
    else if (k === 'e') setExcusedArmed(true);
    else if (k === 'n' && canWriteNc) onPick('NC', null);
    else return;
    e.preventDefault();
  }

  const excused: {
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

  return (
    <div onKeyDown={onKeyDown} className="flex flex-col gap-3">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <span className="text-foreground">{studentName}</span>
        <span className="px-1 text-hairline-strong">·</span>
        {dateLabel}
      </p>

      {/* The four marks, as peers — stamped in the paper palette. `spacing={1}`
          keeps the group off its segmented-control branch, which would strip
          the corners off every tile but the first and last. */}
      <ToggleGroup
        type="single"
        value={status ?? ''}
        onValueChange={pickStatus}
        spacing={1}
        aria-label="Attendance mark"
        className="grid w-full grid-cols-4 gap-1.5"
      >
        {PRIMARY.map(({ status: s, word }) => {
          const active = status === s;
          const isEx = s === 'EX';
          return (
            <ToggleGroupItem
              key={s}
              value={s}
              // The tile's own word, not ATTENDANCE_STATUS_LABELS — that one
              // reads "Excused (MC / Excuse leave)", which names a single one
              // of the three reasons this tile now opens. Matching the visible
              // text is also what lets voice control say "click Excused".
              aria-label={word}
              aria-expanded={isEx ? excusedOpen : undefined}
              className={cn(
                TILE_BASE,
                STATUS_TOGGLE_WASH[s],
                // Opened but not yet saved — a lighter ring than the solid one
                // a set mark gets, because nothing is on record yet.
                isEx &&
                  excusedOpen &&
                  !active &&
                  'opacity-100 ring-2 ring-inset ring-foreground/30'
              )}
            >
              {/* Excused is the only tile with something behind it, so it is
                  the only one that needs an affordance saying so. The chevron
                  gives way to the tick once the mark is saved. */}
              {active ? (
                <Check className="absolute right-1 top-1 size-3" aria-hidden />
              ) : isEx ? (
                <ChevronDown
                  className={cn(
                    'absolute right-1 top-1 size-3 transition-transform',
                    excusedOpen ? 'rotate-180 opacity-70' : 'opacity-40'
                  )}
                  aria-hidden
                />
              ) : null}
              <span className="font-mono text-base font-semibold leading-none">
                {s}
              </span>
              <span className="text-[10px] font-medium leading-none">
                {word}
              </span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      {/* The excused drawer. It carries the cyan wash of the tile that opened
          it, so the reasons read as that tile's contents rather than as a
          second section of the popover — which also means each row no longer
          needs its own EX swatch to say what it is. Still no "Excused"
          heading: the tile above already says that word. "Reason" is a
          different thing, and naming it is what makes the three options read
          as one required choice rather than three loose buttons. */}
      {excusedOpen && (
        <div className="flex animate-in flex-col gap-1.5 rounded-lg border border-attendance-excused bg-attendance-excused/25 p-1.5 fade-in-0 slide-in-from-top-1 duration-150">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground px-1">
            Reason
          </p>
          <ToggleGroup
            type="single"
            value={exReason ?? ''}
            onValueChange={pickReason}
            spacing={1}
            aria-label="Reason for the excused absence"
            className="grid w-full grid-cols-1 gap-0.5"
          >
            {excused.map(({ reason, quota }) => {
              const over = quota != null && quota.used >= quota.allowance;
              return (
                <ToggleGroupItem
                  key={reason}
                  value={reason}
                  className="h-auto w-full justify-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[13px] font-normal text-foreground hover:bg-card/60 hover:text-foreground data-[state=on]:bg-attendance-excused data-[state=on]:text-attendance-mark-ink data-[state=on]:ring-1 data-[state=on]:ring-inset data-[state=on]:ring-foreground/30 data-[state=on]:font-medium"
                >
                  <span className="flex-1">{EX_REASON_LABELS[reason]}</span>
                  {quota && (
                    <span
                      className={cn(
                        'font-mono text-[10px] tabular-nums',
                        over
                          ? 'font-semibold text-brand-amber'
                          : 'text-muted-foreground'
                      )}
                      title={`${quota.used} used of ${quota.allowance} per ${quota.unit}`}
                    >
                      {quota.used}/{quota.allowance} {quota.unit}
                    </span>
                  )}
                  {exReason === reason && (
                    <Check className="size-3 shrink-0" aria-hidden />
                  )}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>

          {/* Christina's ask (2026-07-31, 31:07) and Melissa's (32:44):
              somewhere to record WHY, since the MC document itself cannot be attached yet.
              Lives inside the drawer because the column is EX-only at the database too.

              Three lines, not the one it started as. The field takes 300
              characters and a real note — "Medical certificate submitted,
              returning Monday" — ran off the end of a single line while it was
              still being typed.

              Disabled until a reason is chosen, because the note saves as part
              of the excused mark: typing here first would write the very
              reasonless EX this drawer exists to prevent. */}
          <div className="flex flex-col gap-1">
            <Textarea
              rows={3}
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
              className="min-h-0 resize-none px-2 py-1.5 text-[13px] leading-snug"
            />
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <span className="text-[10px] text-muted-foreground">
                {excusedComplete
                  ? // The one thing about this field that isn't obvious: it
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
        </div>
      )}

      {/* No class — registrar only. A lone Toggle rather than a fifth tile in
          the group above: it is not a judgement about the student, it says the
          class did not meet. */}
      {canWriteNc && (
        <Toggle
          pressed={status === 'NC'}
          onPressedChange={(on) => {
            if (on) onPick('NC', null);
          }}
          className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-[13px] font-normal text-foreground hover:bg-muted hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground"
        >
          <span
            className={cn('size-3 shrink-0 rounded-sm', STATUS_CELL_WASH.NC)}
            aria-hidden
          />
          <span className="flex-1 text-left">
            {ATTENDANCE_STATUS_LABELS.NC}
          </span>
          {status === 'NC' && <Check className="size-3 shrink-0" aria-hidden />}
        </Toggle>
      )}
    </div>
  );
}
