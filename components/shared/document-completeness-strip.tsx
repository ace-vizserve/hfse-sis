'use client';

import * as React from 'react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  ACTION_LEGEND,
  ACTION_FILL,
  STATUS_CHIP,
  fillForStatus,
  isOutstanding,
} from '@/components/shared/document-status-visuals';
import type { DocumentStatus } from '@/lib/p-files/document-config';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────────────────────
// Per-row completeness strip for the document tables — one segment per
// document slot, in DOCUMENT_SLOTS order, each filled by what that slot
// needs doing. Click (or Enter/Space) opens a popover naming all the slots
// in full with their expiry dates.
//
// Replaces a 13-column dot matrix that took ~520px of table width, forced
// every student name to wrap, and could not be decoded without hovering
// each dot (there was no legend anywhere on the page). Segment order is
// fixed across rows, so scanning down a position still works the way the
// matrix allowed — in 112px.
//
// Same shape as components/sis/pipeline-strip.tsx, which solved this for
// the 9 admissions stages (KD #152). Segment fill, popover swatch and the
// table's legend all read one map (document-status-visuals.ts) — §10.2, no
// drift possible.
// ──────────────────────────────────────────────────────────────────────────

export type StripSlot = {
  key: string;
  label: string;
  status: DocumentStatus;
  expiryDate: string | null;
};

function formatExpiry(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

/**
 * `na` slots don't apply to this student, so they're excluded from both
 * halves of the ratio — matching `StudentCompleteness.total`, which is
 * built from the applicable slots only.
 */
export function completenessRatio(slots: StripSlot[]): {
  done: number;
  total: number;
} {
  const applicable = slots.filter((s) => s.status !== 'na');
  return {
    done: applicable.filter((s) => s.status === 'valid').length,
    total: applicable.length,
  };
}

/**
 * The trigger's accessible name. Leads with what is outstanding, so a
 * screen-reader or tooltip user gets the same "what needs attention" read a
 * sighted user gets from the colours.
 */
function summarize(slots: StripSlot[], studentName: string): string {
  const { done, total } = completenessRatio(slots);
  const open = slots.filter((s) => isOutstanding(s.status));
  if (open.length === 0) {
    return `${studentName}: all ${total} documents on file`;
  }
  const detail = open
    .map((s) => `${s.label} ${STATUS_CHIP[s.status].label.toLowerCase()}`)
    .join(', ');
  return `${studentName}: ${done} of ${total} on file — ${detail}`;
}

export type DocumentCompletenessStripProps = {
  slots: StripSlot[];
  studentName: string;
};

export function DocumentCompletenessStrip({
  slots,
  studentName,
}: DocumentCompletenessStripProps) {
  const { done, total } = completenessRatio(slots);
  const summary = summarize(slots, studentName);
  const naCount = slots.filter((s) => s.status === 'na').length;

  return (
    <Popover>
      <div className="flex flex-col items-start gap-1.5">
        {/* The ratio, not a percentage — the officer collects documents, and
            it sorts identically. */}
        <span
          className={cn(
            'font-mono text-xs font-semibold tabular-nums',
            done < total ? 'text-destructive' : 'text-ink-2'
          )}
        >
          {done}/{total}
        </span>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={summary}
            title={summary}
            className="flex h-2 w-28 items-stretch gap-px overflow-hidden rounded-full outline-hidden transition-transform hover:scale-y-[1.4] focus-visible:ring-2 focus-visible:ring-ring"
          >
            {slots.map((slot) => (
              <span
                key={slot.key}
                aria-hidden
                className={cn('flex-1', fillForStatus(slot.status))}
              />
            ))}
          </button>
        </PopoverTrigger>
      </div>

      <PopoverContent className="w-[22rem]" align="start">
        <div className="space-y-3">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {studentName}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {done} of {total} on file
              {naCount > 0 ? ` · ${naCount} not applicable` : ''}
            </p>
          </div>

          <ul className="space-y-2">
            {slots.map((slot) => {
              const expiry = formatExpiry(slot.expiryDate);
              return (
                <li
                  key={slot.key}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        'size-2.5 shrink-0 rounded-full',
                        fillForStatus(slot.status)
                      )}
                    />
                    <span
                      className={cn(
                        'truncate text-[13px] font-medium',
                        slot.status === 'na'
                          ? 'text-muted-foreground'
                          : 'text-foreground'
                      )}
                    >
                      {slot.label}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-right">
                    <span className="text-xs text-muted-foreground">
                      {STATUS_CHIP[slot.status].label}
                    </span>
                    {expiry && (
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                        {expiry}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Always-visible key above the table. Renders `ACTION_FILL` directly, so a
 * swatch is the same paint as the segment it documents (§10.5).
 */
export function DocumentStatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border bg-muted/40 px-6 py-3">
      {ACTION_LEGEND.map((entry) => (
        <span key={entry.action} className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              'h-2 w-5 shrink-0 rounded-full',
              ACTION_FILL[entry.action]
            )}
          />
          <span className="text-xs text-ink-3">
            <span className="font-medium text-ink-2">{entry.label}</span>
            {' — '}
            {entry.hint}
          </span>
        </span>
      ))}
    </div>
  );
}
