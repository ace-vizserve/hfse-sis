import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  BAR_GRADIENT,
  DELTA_PILL_CLASS,
  SOFT_BADGE_CLASS,
  type ColorKey,
} from './tokens';

/**
 * "Sales performance" anatomy — an optional big headline value + delta, a
 * divider, then N side-by-side columns each with its own sub-header
 * (label + value + optional quality badge) and a vertical stack of thin
 * horizontal bars with a trailing value label per bar. Matches `.sp-*`/
 * `.perf-*` — insights-mockup-v4.html's "What's behind the rate" (per-term
 * P/L/EX/A composition, no headline) and insights-mockup-records.html's
 * "Population by level" (headline + divider, tabs feed the columns).
 */

export type BarStackBar = {
  key: string;
  pct: number;
  colorKey: ColorKey;
  /** Trailing label printed after the bar — optional (v4's composition bars carry none). */
  value?: string;
};

export type BarStackColumn = {
  key: string;
  label: string;
  value?: string;
  badge?: { text: string; colorKey: ColorKey };
  bars: BarStackBar[];
  /** Dims the column + flattens its bars to a neutral hairline tint — a future/no-data period (e.g. an unstarted term). */
  muted?: boolean;
};

export type BarStackProps = {
  headline?: {
    value: string;
    label: string;
    delta?: { value: string; direction: 'up' | 'down' };
  };
  columns: BarStackColumn[];
  className?: string;
};

export function BarStack({ headline, columns, className }: BarStackProps) {
  return (
    <div className={className}>
      {headline && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-serif text-[30px] font-bold leading-none text-foreground">
                {headline.value}
              </p>
              <p className="mt-1.5 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                {headline.label}
                {headline.delta && (
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-extrabold',
                      DELTA_PILL_CLASS[headline.delta.direction]
                    )}
                  >
                    {headline.delta.value}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="my-[18px] border-t border-hairline" />
        </>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-7">
        {columns.map((col) => (
          <div key={col.key} className={col.muted ? 'opacity-40' : undefined}>
            <div className="mb-2 text-xs text-muted-foreground">
              {col.label}
            </div>
            {(col.value || col.badge) && (
              <div className="mb-4 flex items-center gap-2">
                {col.value && (
                  <span className="font-serif text-2xl font-bold text-foreground">
                    {col.value}
                  </span>
                )}
                {col.badge && (
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-bold',
                      SOFT_BADGE_CLASS[col.badge.colorKey]
                    )}
                  >
                    {col.badge.text}
                  </span>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              {col.bars.map((bar) => (
                <div key={bar.key} className="flex items-center gap-2">
                  <span
                    className={cn(
                      'h-[9px] rounded-full',
                      col.muted ? 'bg-hairline' : BAR_GRADIENT[bar.colorKey]
                    )}
                    style={{ width: `${bar.pct}%` }}
                  />
                  {bar.value && (
                    <span className="shrink-0 font-mono text-[10px] font-semibold text-muted-foreground">
                      {bar.value}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
