'use client';

import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';

import { STATUS_CELL_WASH } from '@/components/attendance/status-wash';
import { cn } from '@/lib/utils';
import {
  ATTENDANCE_STATUS_LABELS,
  EX_NOTE_MAX_LENGTH,
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

const PRIMARY: { status: AttendanceStatus; word: string }[] = [
  { status: 'P', word: 'Present' },
  { status: 'A', word: 'Absent' },
  { status: 'L', word: 'Late' },
];

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

  return (
    <div onKeyDown={onKeyDown} className="flex flex-col gap-3">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <span className="text-foreground">{studentName}</span>
        <span className="px-1 text-hairline-strong">·</span>
        {dateLabel}
      </p>

      {/* Primary marks — stamp in the paper palette */}
      <div className="grid grid-cols-3 gap-1.5">
        {PRIMARY.map(({ status: s, word }) => {
          const active = status === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              onClick={() => onPick(s, null)}
              className={cn(
                'relative flex flex-col items-center gap-0.5 rounded-lg px-2 py-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                STATUS_CELL_WASH[s],
                active
                  ? 'ring-2 ring-inset ring-foreground'
                  : 'opacity-90 hover:opacity-100 hover:brightness-105'
              )}
            >
              {active && (
                <Check className="absolute right-1 top-1 size-3" aria-hidden />
              )}
              <span className="font-mono text-base font-semibold leading-none">
                {s}
              </span>
              <span className="text-[10px] font-medium leading-none">
                {word}
              </span>
            </button>
          );
        })}
      </div>

      {/* Excused — labelled reasons with live quota at point of entry */}
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Excused
        </p>
        {excused.map(({ reason, quota }) => {
          const active = status === 'EX' && exReason === reason;
          const over = quota != null && quota.used >= quota.allowance;
          return (
            <button
              key={reason}
              type="button"
              aria-pressed={active}
              onClick={() => onPick('EX', reason)}
              className={cn(
                'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-foreground/30 bg-accent'
                  : 'border-transparent hover:bg-muted'
              )}
            >
              <span
                className={cn(
                  'size-3 shrink-0 rounded-sm',
                  STATUS_CELL_WASH.EX
                )}
                aria-hidden
              />
              <span className="flex-1 text-[13px] text-foreground">
                {EX_REASON_LABELS[reason]}
              </span>
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
              {active && (
                <Check className="size-3 text-foreground" aria-hidden />
              )}
            </button>
          );
        })}

        {/* Melissa's ask (2026-07-31): somewhere to record WHY, since the MC
            document itself cannot be attached yet. Only offered once the mark
            is EX — the column is EX-only at the database too. */}
        {status === 'EX' && (
          <input
            type="text"
            value={noteDraft}
            maxLength={EX_NOTE_MAX_LENGTH}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={commitNote}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitNote();
              }
            }}
            placeholder="Add a note (optional)"
            aria-label={`Note for ${studentName} on ${dateLabel}`}
            className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
      </div>

      {/* No-class — registrar only */}
      {canWriteNc && (
        <button
          type="button"
          aria-pressed={status === 'NC'}
          onClick={() => onPick('NC', null)}
          className={cn(
            'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            status === 'NC'
              ? 'border-foreground/30 bg-accent'
              : 'border-transparent hover:bg-muted'
          )}
        >
          <span
            className={cn('size-3 shrink-0 rounded-sm', STATUS_CELL_WASH.NC)}
            aria-hidden
          />
          <span className="flex-1 text-foreground">
            {ATTENDANCE_STATUS_LABELS.NC}
          </span>
          {status === 'NC' && (
            <Check className="size-3 text-foreground" aria-hidden />
          )}
        </button>
      )}
    </div>
  );
}
