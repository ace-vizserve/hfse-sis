'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { CalendarRange, Loader2 } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { formatRangeLabel, type AYWindows, type DateRange, type TermWindows } from '@/lib/dashboard/range';

/**
 * ComparisonToolbar — the URL-param contract executor shared by every
 * dashboard. Combines AY switcher + DateRangePicker, writes:
 *   ?ay=AY2026&from=YYYY-MM-DD&to=YYYY-MM-DD&cmpFrom=...&cmpTo=...
 *
 * Mirrors the single-transition `router.push` pattern from
 * `components/admissions/ay-switcher.tsx` so AY and range changes share
 * the same routing UX.
 */

export type ComparisonToolbarProps = {
  ayCode: string;
  ayCodes: readonly string[];
  range: DateRange;
  comparison: DateRange;
  termWindows: TermWindows;
  ayWindows: AYWindows;
  showAySwitcher?: boolean;
  trustStrip?: React.ReactNode;
  className?: string;
};

function updateParams(
  current: URLSearchParams,
  next: Partial<{ ay: string; range: DateRange; comparison: DateRange }>,
): URLSearchParams {
  const params = new URLSearchParams(current.toString());
  if (next.ay) params.set('ay', next.ay);
  if (next.range) {
    params.set('from', next.range.from);
    params.set('to', next.range.to);
  }
  if (next.comparison) {
    params.set('cmpFrom', next.comparison.from);
    params.set('cmpTo', next.comparison.to);
  }
  return params;
}

export function ComparisonToolbar({
  ayCode,
  ayCodes,
  range,
  comparison,
  termWindows,
  ayWindows,
  showAySwitcher = true,
  trustStrip,
  className,
}: ComparisonToolbarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function pushParams(params: URLSearchParams) {
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false });
    });
  }

  function onAyChange(code: string) {
    pushParams(updateParams(searchParams, { ay: code }));
  }

  function onRangeChange(next: DateRange, autoComparison?: DateRange) {
    // Apply range + auto-comparison in ONE push. Two separate router.push
    // calls in the same tick both read the same stale `searchParams` from
    // useSearchParams(), and the second one wins — clobbering the first.
    const update: Parameters<typeof updateParams>[1] = { range: next };
    if (autoComparison) update.comparison = autoComparison;
    pushParams(updateParams(searchParams, update));
  }

  function onComparisonChange(next: DateRange) {
    pushParams(updateParams(searchParams, { comparison: next }));
  }

  return (
    <div
      className={
        'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 ' +
        (className ?? '')
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {showAySwitcher && (
          <div className="flex w-[9.5rem] shrink-0 items-center">
            <Select value={ayCode} onValueChange={onAyChange}>
              <SelectTrigger className="h-10 w-full">
                <div className="flex items-center gap-2">
                  {pending ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <CalendarRange className="size-4 text-muted-foreground" />
                  )}
                  <SelectValue placeholder="Select AY" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {ayCodes.length === 0 ? (
                  <SelectItem value={ayCode} disabled>
                    {ayCode}
                  </SelectItem>
                ) : (
                  ayCodes.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        )}
        <DateRangePicker
          value={range}
          onChange={onRangeChange}
          comparison={comparison}
          onComparisonChange={onComparisonChange}
          termWindows={termWindows}
          ayWindows={ayWindows}
        />
        <div className="hidden items-center gap-1.5 text-[11px] text-ink-4 sm:flex">
          <span className="font-mono uppercase tracking-wider text-ink-5">vs</span>
          <span className="font-mono tabular-nums">{formatRangeLabel(comparison)}</span>
        </div>
      </div>
      {trustStrip && <div className="flex items-center gap-2">{trustStrip}</div>}
    </div>
  );
}
