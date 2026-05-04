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
  autoComparisonAcademic,
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
   * second arg is the picker's auto-computed comparison range — only set
   * when the user already has a comparison enabled, so changing the current
   * range slides the comparison along with it. The parent applies both in a
   * single state/URL update.
   */
  onChange: (next: DateRange, autoComparison?: DateRange) => void;
  /** Null when no comparison is set — comparison is opt-in. */
  comparison: DateRange | null;
  /** Pass `null` to clear the comparison entirely. */
  onComparisonChange?: (next: DateRange | null) => void;
  termWindows: TermWindows;
  ayWindows: AYWindows;
  presets?: Preset[];
  minDate?: string;
  maxDate?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
};

// `'custom'` is a state, not an action — when no preset window matches the
// current range, `detectPreset` returns `'custom'` and the trigger-button
// chip is suppressed. The calendar itself is the custom-range UI; rendering
// `'custom'` as a clickable preset row was misleading (it had no action).
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
    if (!comparison) return undefined;
    const from = parseLocalDate(comparison.from);
    const to = parseLocalDate(comparison.to);
    if (!from || !to) return undefined;
    return { from, to };
  }, [comparison]);

  // Calendar selection is staged here until the user hits Apply (or completes
  // a multi-day range). Auto-committing on every click broke the flow:
  // first click pushed `?from=A&to=A`, the picker re-rendered with that as a
  // complete range, and react-day-picker started a fresh range on the next
  // click — making multi-day selection impossible. Single-day selection is
  // an explicit Apply.
  const [pendingRange, setPendingRange] = React.useState<DayPickerRange | undefined>(undefined);
  const [pendingComparison, setPendingComparison] = React.useState<DayPickerRange | undefined>(undefined);

  // Seed the staged ranges from URL state whenever the popover opens.
  React.useEffect(() => {
    if (!open) return;
    setPendingRange(calendarValue);
    setPendingComparison(cmpCalendarValue);
    // intentionally only on open — re-syncing on every value/comparison change
    // would clobber an in-progress selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // What the calendar renders as `selected`. Prefer the staged range so the
  // user sees their click feedback even before they hit Apply.
  const liveCalendarValue = pendingRange ?? calendarValue;
  const liveCmpCalendarValue = pendingComparison ?? cmpCalendarValue;

  // Comparison auto-slides with the current range only when the user
  // already opted into a comparison. Passing the auto-comparison
  // unconditionally would silently re-introduce a comparison the user had
  // explicitly removed.
  function autoCmpIfEnabled(range: DateRange): DateRange | undefined {
    if (!comparison) return undefined;
    return autoComparisonAcademic(range, windows) ?? undefined;
  }

  function applyPreset(p: Preset) {
    if (p === 'custom') return;
    const range = resolvePreset(p, windows);
    if (!range) return;
    onChange(range, autoCmpIfEnabled(range));
    setEditingComparison(false);
    setPendingRange(undefined);
    setPendingComparison(undefined);
    setOpen(false);
  }

  function onRangeSelect(next: DayPickerRange | undefined) {
    setPendingRange(next);
    // Auto-commit when the user has picked two distinct days. Single-day
    // selection still requires Apply.
    if (next?.from && next.to && +next.from !== +next.to) {
      const range: DateRange = {
        from: toISODate(next.from),
        to: toISODate(next.to),
      };
      onChange(range, autoCmpIfEnabled(range));
      setPendingRange(undefined);
      setOpen(false);
    }
  }

  function onComparisonSelect(next: DayPickerRange | undefined) {
    setPendingComparison(next);
    if (next?.from && next.to && +next.from !== +next.to && onComparisonChange) {
      onComparisonChange({
        from: toISODate(next.from),
        to: toISODate(next.to),
      });
      setPendingComparison(undefined);
      setEditingComparison(false);
    }
  }

  function applyPending() {
    if (editingComparison) {
      if (!pendingComparison?.from || !onComparisonChange) return;
      onComparisonChange({
        from: toISODate(pendingComparison.from),
        to: toISODate(pendingComparison.to ?? pendingComparison.from),
      });
      setPendingComparison(undefined);
      setEditingComparison(false);
      return;
    }
    if (!pendingRange?.from) return;
    const range: DateRange = {
      from: toISODate(pendingRange.from),
      to: toISODate(pendingRange.to ?? pendingRange.from),
    };
    onChange(range, autoCmpIfEnabled(range));
    setPendingRange(undefined);
    setOpen(false);
  }

  // True when the staged selection differs from the URL-committed value.
  const hasUnappliedChanges = (() => {
    if (editingComparison) {
      if (!pendingComparison?.from) return false;
      const draftFrom = toISODate(pendingComparison.from);
      const draftTo = toISODate(pendingComparison.to ?? pendingComparison.from);
      return draftFrom !== comparison?.from || draftTo !== comparison?.to;
    }
    if (!pendingRange?.from) return false;
    const draftFrom = toISODate(pendingRange.from);
    const draftTo = toISODate(pendingRange.to ?? pendingRange.from);
    return draftFrom !== value.from || draftTo !== value.to;
  })();

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
    const auto = autoComparisonAcademic(value, windows);
    if (auto) onComparisonChange(auto);
    setEditingComparison(false);
  }

  function addComparison() {
    if (!onComparisonChange) return;
    const auto = autoComparisonAcademic(value, windows);
    if (auto) {
      onComparisonChange(auto);
      setEditingComparison(true);
    }
  }

  function removeComparison() {
    if (!onComparisonChange) return;
    onComparisonChange(null);
    setEditingComparison(false);
    setPendingComparison(undefined);
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
                {editingComparison && comparison
                  ? formatRangeLabel(comparison)
                  : formatRangeLabel(value)}
              </div>
            </div>
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={editingComparison ? liveCmpCalendarValue : liveCalendarValue}
              onSelect={editingComparison ? onComparisonSelect : onRangeSelect}
              captionLayout="dropdown"
              disabled={buildDisabledMatcher(minDate, maxDate)}
            />
            <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-2.5">
              <div className="flex items-center gap-2 text-xs text-ink-4">
                {comparison ? (
                  <>
                    <span className="font-mono text-[10px] uppercase tracking-wider">
                      Compared to
                    </span>
                    <ArrowRightIcon className="size-3 text-ink-5" />
                    <span className="font-mono text-[11px] tabular-nums text-foreground">
                      {formatRangeLabel(comparison)}
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-[10px] uppercase tracking-wider">
                    No comparison
                  </span>
                )}
              </div>
              <div className="flex gap-1.5">
                {onComparisonChange && !comparison && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={addComparison}
                  >
                    Add comparison
                  </Button>
                )}
                {onComparisonChange && comparison && editingComparison && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={resetComparison}
                  >
                    Auto
                  </Button>
                )}
                {onComparisonChange && comparison && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-ink-4 hover:text-foreground"
                    onClick={removeComparison}
                  >
                    Remove
                  </Button>
                )}
                {onComparisonChange && comparison && (
                  <Button
                    size="sm"
                    variant={editingComparison ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => setEditingComparison((prev) => !prev)}
                  >
                    {editingComparison ? 'Done' : 'Edit'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs"
                  disabled={!hasUnappliedChanges}
                  onClick={applyPending}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
