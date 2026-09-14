'use client';

import * as React from 'react';
import { CalendarIcon, ArrowRightIcon, Loader2 } from 'lucide-react';
import type { DateRange as DayPickerRange, Matcher } from 'react-day-picker';

import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  PRESET_LABEL,
  detectPreset,
  formatRangeLabel,
  parseLocalDate,
  resolvePreset,
  toISODate,
  type AYWindows,
  type DateRange,
  type Preset,
  type TermWindows,
} from '@/lib/dashboard/range';

/**
 * DateRangePicker — canonical range primitive (KD #44 sibling to
 * DatePicker / DateTimePicker).
 *
 * Trigger: two inline text inputs showing from/to in YYYY-MM-DD format,
 * directly typeable. Validation fires on blur or Enter; errors show above
 * the preset rail. Popover closes and auto-applies on Enter, click-outside,
 * or Escape when the pending range is valid and different from the committed
 * value. Preset clicks apply and close immediately.
 */

export type DateRangePickerProps = {
  value: DateRange;
  onChange: (next: DateRange) => void;
  termWindows: TermWindows;
  ayWindows: AYWindows;
  presets?: Preset[];
  minDate?: string;
  maxDate?: string;
  id?: string;
  disabled?: boolean;
  /**
   * A range change is in flight — swaps the calendar icon for a spinner.
   *
   * The dashboards' only progress indicator used to live inside the AY
   * switcher, which four of them hide (`showAySwitcher={false}`: attendance,
   * evaluation, markbook, the audit-log overview). On those pages a range
   * change computed a `pending` state and threw it away, so picking a date did
   * nothing visible until the new numbers appeared. Showing it on the control
   * that was actually operated fixes those four and is more honest on the rest,
   * where changing a DATE used to spin the AY picker.
   */
  pending?: boolean;
  className?: string;
};

const DEFAULT_PRESETS: Preset[] = [
  'last7d',
  'last30d',
  'last90d',
  'thisTerm',
  'lastTerm',
  'thisAY',
  'lastAY',
];

export function DateRangePicker({
  value,
  onChange,
  termWindows,
  ayWindows,
  presets = DEFAULT_PRESETS,
  minDate,
  maxDate,
  id,
  disabled,
  pending = false,
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [pendingRange, setPendingRange] = React.useState<
    DayPickerRange | undefined
  >(undefined);

  // Text inputs — YYYY-MM-DD strings, editable directly in the trigger.
  const [fromText, setFromText] = React.useState(value.from);
  const [toText, setToText] = React.useState(value.to);
  const [fromError, setFromError] = React.useState<string | null>(null);
  const [toError, setToError] = React.useState<string | null>(null);

  // Tracks the most recently applied range synchronously so handlePopoverChange
  // can reset texts to the right value before the async RSC prop update arrives.
  const appliedRangeRef = React.useRef<DateRange>(value);

  const windows = React.useMemo(
    () => ({ term: termWindows, ay: ayWindows }),
    [termWindows, ayWindows]
  );

  const activePreset = detectPreset(value, windows, undefined, presets);

  const calendarValue: DayPickerRange | undefined = React.useMemo(() => {
    const from = parseLocalDate(value.from);
    const to = parseLocalDate(value.to);
    if (!from || !to) return undefined;
    return { from, to };
  }, [value.from, value.to]);

  // When value changes from outside (URL param reset, AY switch): update the
  // ref + sync visible texts if the popover is closed. Intentionally omits
  // `open` from deps — we only want to react to prop changes, not toggle state.
  React.useEffect(() => {
    appliedRangeRef.current = value;
    if (!open) {
      setFromText(value.from);
      setToText(value.to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.from, value.to]);

  // On open: seed calendar pending state. Close logic lives in handlePopoverChange.
  React.useEffect(() => {
    if (open) {
      setPendingRange(calendarValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const liveCalendarValue = pendingRange ?? calendarValue;

  // ── Popover open/close ────────────────────────────────────────────────────

  // Handles all popover close events (click-outside, Escape, Enter key, explicit close).
  //
  // Source-of-truth priority: text inputs (fromText / toText) over pendingRange.
  // Reason: validate* functions call setPendingRange which is async setState — the
  // state update hasn't propagated yet when Enter triggers an immediate close, so
  // pendingRange is always one render stale in that path. fromText / toText are
  // updated on every keystroke (synchronous per-event re-renders) and are always
  // current in the closure by the time any close event fires.
  function handlePopoverChange(next: boolean) {
    if (!next && open) {
      let applied = false;
      if (!fromError && !toError) {
        const fromDate = parseLocalDate(fromText.trim());
        const toDate = parseLocalDate(toText.trim());
        if (fromDate && toDate && toDate >= fromDate) {
          const draftFrom = toISODate(fromDate);
          const draftTo = toISODate(toDate);
          if (
            draftFrom !== appliedRangeRef.current.from ||
            draftTo !== appliedRangeRef.current.to
          ) {
            const range: DateRange = { from: draftFrom, to: draftTo };
            appliedRangeRef.current = range;
            onChange(range);
            setFromText(range.from);
            setToText(range.to);
            setPendingRange(undefined);
            applied = true;
          }
        }
      }
      if (!applied) {
        setFromText(appliedRangeRef.current.from);
        setToText(appliedRangeRef.current.to);
      }
      setFromError(null);
      setToError(null);
    }
    setOpen(next);
  }

  // ── Presets ────────────────────────────────────────────────────────────────

  function applyPreset(p: Preset) {
    if (p === 'custom') return;
    const range = resolvePreset(p, windows);
    if (!range) return;
    appliedRangeRef.current = range;
    onChange(range);
    setFromText(range.from);
    setToText(range.to);
    setFromError(null);
    setToError(null);
    setPendingRange(undefined);
    setOpen(false);
  }

  // ── Text input validation ──────────────────────────────────────────────────

  function validateFrom(text: string = fromText): boolean {
    const parsed = parseLocalDate(text.trim());
    if (!parsed) {
      setFromError('Invalid date — use YYYY-MM-DD');
      return false;
    }
    setFromError(null);
    setFromText(toISODate(parsed));
    setPendingRange((prev) => ({ from: parsed, to: prev?.to }));
    return true;
  }

  function validateTo(text: string = toText): boolean {
    const parsed = parseLocalDate(text.trim());
    if (!parsed) {
      setToError('Invalid date — use YYYY-MM-DD');
      return false;
    }
    const fromDate =
      pendingRange?.from ??
      parseLocalDate(fromText) ??
      parseLocalDate(value.from);
    if (fromDate && parsed < fromDate) {
      setToError('End date must be on or after the start date');
      return false;
    }
    setToError(null);
    setToText(toISODate(parsed));
    setPendingRange((prev) => ({
      from: prev?.from ?? fromDate ?? new Date(),
      to: parsed,
    }));
    return true;
  }

  // ── Calendar ───────────────────────────────────────────────────────────────

  function onRangeSelect(next: DayPickerRange | undefined) {
    setPendingRange(next);
    if (next?.from) {
      setFromText(toISODate(next.from));
      setFromError(null);
    }
    if (next?.to) {
      setToText(toISODate(next.to));
      setToError(null);
    } else if (next?.from) {
      setToText(toISODate(next.from));
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function buildDisabledMatcher(
    min: string | undefined,
    max: string | undefined
  ): Matcher | undefined {
    const before = min ? parseLocalDate(min) : null;
    const after = max ? parseLocalDate(max) : null;
    if (before && after) return { before, after };
    if (before) return { before };
    if (after) return { after };
    return undefined;
  }

  const namedPresets = presets.filter((p) => p !== 'custom');

  const pendingLabel = pendingRange?.from
    ? formatRangeLabel({
        from: toISODate(pendingRange.from),
        to: toISODate(pendingRange.to ?? pendingRange.from),
      })
    : formatRangeLabel(value);

  return (
    <Popover open={open} onOpenChange={handlePopoverChange}>
      <PopoverTrigger asChild>
        <div
          id={id}
          role="group"
          aria-label="Date range picker"
          className={cn(
            'flex h-10 cursor-default items-center gap-2 rounded-md border border-input bg-background px-3',
            'ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
            disabled && 'pointer-events-none opacity-50',
            className
          )}
        >
          {/* Same swap the AY switcher makes, so the two controls report
              progress identically. aria-live announces it, because the icon
              alone tells a screen-reader user nothing. */}
          {pending ? (
            <Loader2
              className="size-4 shrink-0 animate-spin text-ink-4"
              aria-hidden="true"
            />
          ) : (
            <CalendarIcon className="size-4 shrink-0 text-ink-4" />
          )}
          <span className="sr-only" aria-live="polite">
            {pending ? 'Updating for the new dates' : ''}
          </span>

          <input
            type="text"
            value={fromText}
            placeholder="YYYY-MM-DD"
            disabled={disabled}
            aria-label="Start date"
            onChange={(e) => {
              setFromText(e.target.value);
              setFromError(null);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => validateFrom()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const ok = validateFrom();
                if (ok) handlePopoverChange(false);
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            className={cn(
              'w-[6.5rem] bg-transparent font-mono text-[12px] tabular-nums focus:outline-none',
              fromError ? 'text-destructive' : 'text-foreground'
            )}
          />

          <ArrowRightIcon className="size-3 shrink-0 text-ink-4" />

          <input
            type="text"
            value={toText}
            placeholder="YYYY-MM-DD"
            disabled={disabled}
            aria-label="End date"
            onChange={(e) => {
              setToText(e.target.value);
              setToError(null);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => validateTo()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const ok = validateTo();
                if (ok) handlePopoverChange(false);
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            className={cn(
              'w-[6.5rem] bg-transparent font-mono text-[12px] tabular-nums focus:outline-none',
              toError ? 'text-destructive' : 'text-foreground'
            )}
          />

          {activePreset !== 'custom' && (
            <span className="ml-1 rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent-foreground">
              {PRESET_LABEL[activePreset]}
            </span>
          )}
        </div>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="end">
        {(fromError || toError) && (
          <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-2.5 space-y-1">
            {fromError && (
              <p className="font-mono text-[11px] text-destructive">
                <span className="font-semibold">From:</span> {fromError}
              </p>
            )}
            {toError && (
              <p className="font-mono text-[11px] text-destructive">
                <span className="font-semibold">To:</span> {toError}
              </p>
            )}
          </div>
        )}

        <div className="flex">
          {/* Preset rail */}
          <div className="flex w-44 flex-col gap-0.5 border-r border-border bg-muted/40 p-2">
            <div className="px-2 pb-1 pt-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-4">
              Range
            </div>
            {namedPresets.map((p) => {
              const range = resolvePreset(p, windows);
              const enabled = !!range;
              const isActive = activePreset === p;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={!enabled}
                  onClick={() => applyPreset(p)}
                  className={cn(
                    'flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-accent/60',
                    !enabled && 'cursor-not-allowed opacity-40'
                  )}
                >
                  <span className="font-medium">{PRESET_LABEL[p]}</span>
                  {isActive && (
                    <span className="font-mono text-[9px] uppercase tracking-wider text-ink-4">
                      on
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Calendar panel */}
          <div className="flex flex-col">
            <div className="border-b border-border px-4 py-2.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                Selected period
              </div>
              <div className="mt-0.5 font-mono text-[12px] tabular-nums text-foreground">
                {pendingLabel}
              </div>
            </div>

            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={liveCalendarValue}
              onSelect={onRangeSelect}
              captionLayout="dropdown"
              disabled={buildDisabledMatcher(minDate, maxDate)}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
