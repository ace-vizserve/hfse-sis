'use client';

import * as React from 'react';
import { CalendarIcon, ArrowRightIcon } from 'lucide-react';
import type { DateRange as DayPickerRange, Matcher } from 'react-day-picker';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  PRESET_LABEL,
  autoComparison,
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
 * DatePicker / DateTimePicker). Popover + shadcn Calendar in `mode="range"`,
 * left-rail preset list, comparison strip with auto-prior-period default.
 *
 * Replacement for `<input type="date">` ranges. Value + comparison are ISO
 * `yyyy-MM-dd` strings. The component is controlled — the parent toolbar owns
 * the state and writes URL params.
 */

export type DateRangePickerProps = {
  value: DateRange;
  /**
   * Fires when the user picks a new range (calendar click or preset). The
   * second arg is the picker's auto-computed comparison range — the parent
   * should apply both in a single state/URL update so they don't stomp on
   * each other (two separate router.push calls back-to-back read the same
   * stale searchParams snapshot and the second one clobbers the first).
   */
  onChange: (next: DateRange, autoComparison?: DateRange) => void;
  comparison: DateRange;
  onComparisonChange?: (next: DateRange) => void;
  termWindows: TermWindows;
  ayWindows: AYWindows;
  presets?: Preset[];
  minDate?: string;
  maxDate?: string;
  id?: string;
  disabled?: boolean;
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
  'custom',
];

export function DateRangePicker({
  value,
  onChange,
  comparison,
  onComparisonChange,
  termWindows,
  ayWindows,
  presets = DEFAULT_PRESETS,
  minDate,
  maxDate,
  id,
  disabled,
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [editingComparison, setEditingComparison] = React.useState(false);

  const windows = React.useMemo(
    () => ({ term: termWindows, ay: ayWindows }),
    [termWindows, ayWindows],
  );
  const activePreset = detectPreset(value, windows);

  const calendarValue: DayPickerRange | undefined = React.useMemo(() => {
    const from = parseLocalDate(value.from);
    const to = parseLocalDate(value.to);
    if (!from || !to) return undefined;
    return { from, to };
  }, [value.from, value.to]);

  const cmpCalendarValue: DayPickerRange | undefined = React.useMemo(() => {
    const from = parseLocalDate(comparison.from);
    const to = parseLocalDate(comparison.to);
    if (!from || !to) return undefined;
    return { from, to };
  }, [comparison.from, comparison.to]);

  function applyPreset(p: Preset) {
    if (p === 'custom') return;
    const range = resolvePreset(p, windows);
    if (!range) return;
    onChange(range, autoComparison(range) ?? undefined);
    setEditingComparison(false);
  }

  function onRangeSelect(next: DayPickerRange | undefined) {
    if (!next?.from) return;
    const from = toISODate(next.from);
    const to = toISODate(next.to ?? next.from);
    const range: DateRange = { from, to };
    onChange(range, autoComparison(range) ?? undefined);
  }

  function onComparisonSelect(next: DayPickerRange | undefined) {
    if (!next?.from || !onComparisonChange) return;
    onComparisonChange({
      from: toISODate(next.from),
      to: toISODate(next.to ?? next.from),
    });
  }

  function buildDisabledMatcher(
    min: string | undefined,
    max: string | undefined,
  ): Matcher | undefined {
    const before = min ? parseLocalDate(min) : null;
    const after = max ? parseLocalDate(max) : null;
    if (before && after) return { before, after };
    if (before) return { before };
    if (after) return { after };
    return undefined;
  }

  function resetComparison() {
    if (!onComparisonChange) return;
    const auto = autoComparison(value);
    if (auto) onComparisonChange(auto);
    setEditingComparison(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-10 min-w-[15rem] justify-start gap-2 font-normal',
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 text-ink-4" />
          <span className="font-mono text-[12px] tabular-nums text-foreground">
            {formatRangeLabel(value)}
          </span>
          {activePreset !== 'custom' && (
            <span className="ml-1.5 rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent-foreground">
              {PRESET_LABEL[activePreset]}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex">
          <div className="flex w-44 flex-col gap-0.5 border-r border-border bg-muted/40 p-2">
            <div className="px-2 pb-1 pt-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-4">
              Range
            </div>
            {presets.map((p) => {
              const range = p === 'custom' ? null : resolvePreset(p, windows);
              const enabled = p === 'custom' || !!range;
              const isActive = activePreset === p && !editingComparison;
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
                    !enabled && 'cursor-not-allowed opacity-40',
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

          <div className="flex flex-col">
            <div className="border-b border-border px-4 py-2.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                {editingComparison ? 'Comparison period' : 'Current period'}
              </div>
              <div className="mt-0.5 font-mono text-[12px] tabular-nums text-foreground">
                {editingComparison
                  ? formatRangeLabel(comparison)
                  : formatRangeLabel(value)}
              </div>
            </div>
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={editingComparison ? cmpCalendarValue : calendarValue}
              onSelect={editingComparison ? onComparisonSelect : onRangeSelect}
              captionLayout="dropdown"
              disabled={buildDisabledMatcher(minDate, maxDate)}
            />
            <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-2.5">
              <div className="flex items-center gap-2 text-xs text-ink-4">
                <span className="font-mono text-[10px] uppercase tracking-wider">
                  Compared to
                </span>
                <ArrowRightIcon className="size-3 text-ink-5" />
                <span className="font-mono text-[11px] tabular-nums text-foreground">
                  {formatRangeLabel(comparison)}
                </span>
              </div>
              <div className="flex gap-1.5">
                {onComparisonChange && editingComparison && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={resetComparison}
                  >
                    Auto
                  </Button>
                )}
                {onComparisonChange && (
                  <Button
                    size="sm"
                    variant={editingComparison ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => setEditingComparison((prev) => !prev)}
                  >
                    {editingComparison ? 'Done' : 'Edit'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
