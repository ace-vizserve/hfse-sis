import * as React from 'react';

import { cn } from '@/lib/utils';
import { BAR_GRADIENT, DOT_GRADIENT, type ColorKey } from './tokens';

/**
 * "Top Services by Sales" anatomy — numbered ranked bars, an x-axis, and an
 * optional 2-column dot legend beside (not below) the bars. Matches `.nb-*`/
 * `.nb-legend`/`.nb-layout` — used in every locked mockup for a worst-first
 * or best-first ranking (Admissions conversion-by-level, Records retention-
 * by-level, Markbook lowest-averaging subjects).
 *
 * The label renders INSIDE the fill in white text — only use this component
 * when every row's `pct` is wide enough to hold its own label (the locked
 * mockups only ever apply it to values roughly ≥65-70%; a track that thin
 * clips its own text). For a heavily skewed distribution (e.g. 87/5/4/4),
 * use `segmented-bar` or put the label outside the track instead.
 */

export type RankedBarRow = {
  key: string;
  /** Rendered inside the fill — keep short, see the width caveat above. */
  label: string;
  pct: number;
  colorKey: ColorKey;
};

export type RankedBarLegendItem = {
  key: string;
  colorKey: ColorKey;
  name: string;
  value: string;
};

export type RankedBarProps = {
  rows: RankedBarRow[];
  /** 2-column dot legend rendered to the right of the bars, separated by a vertical divider — a locked layout decision, never stacked below. */
  legend?: RankedBarLegendItem[];
  className?: string;
};

export function RankedBar({ rows, legend, className }: RankedBarProps) {
  return (
    <div className={cn('flex items-start gap-8', className)}>
      <div className="min-w-0 flex-[1.3]">
        {rows.map((row, i) => (
          <div key={row.key} className="mb-2.5 flex items-center gap-2.5">
            <span className="w-3 shrink-0 font-mono text-[11px] text-muted-foreground">
              {i + 1}
            </span>
            <div className="h-[26px] flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'flex h-full items-center whitespace-nowrap rounded-full pl-3 text-[11.5px] font-bold text-white',
                  BAR_GRADIENT[row.colorKey]
                )}
                style={{ width: `${row.pct}%` }}
              >
                {row.label}
              </div>
            </div>
          </div>
        ))}
        <div className="mt-0.5 flex justify-between pl-[22px]">
          {['0%', '25%', '50%', '75%', '100%'].map((tick) => (
            <span
              key={tick}
              className="font-mono text-[10px] text-muted-foreground"
            >
              {tick}
            </span>
          ))}
        </div>
      </div>
      {legend && legend.length > 0 && (
        <div className="grid flex-1 grid-cols-2 gap-x-5 gap-y-3.5 border-l border-hairline pl-6">
          {legend.map((item) => (
            <div key={item.key} className="flex items-center gap-2">
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  DOT_GRADIENT[item.colorKey]
                )}
              />
              <div>
                <div className="text-xs text-muted-foreground">{item.name}</div>
                <div className="mt-px font-serif text-sm font-bold text-foreground">
                  {item.value}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
