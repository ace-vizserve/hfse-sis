import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
 *
 * Interactivity is a hover-only value tooltip, never a click-through — an
 * earlier version of this component opened a full drill-down sheet per bar,
 * but several of those drills silently disagreed with the number the bar
 * itself represented (the drill's underlying row filter didn't share the
 * same status/scope exclusions as the aggregate powering the bar — see
 * app/(admissions)/admissions/insights/page.tsx's git history). A tooltip
 * can only ever restate a number the caller already computed for the bar,
 * so it can't drift out of sync with what's on screen the way a
 * separately-queried drill can.
 */

export type RankedBarRow = {
  key: string;
  /** Rendered inside the fill — keep short, see the width caveat above. */
  label: string;
  pct: number;
  colorKey: ColorKey;
  /** Optional hover-reveal detail, e.g. "62 of 90 applicants · 69%". Omit for no tooltip. */
  tooltip?: React.ReactNode;
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
        {rows.map((row, i) => {
          const track = (
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
          );
          const rowContent = (
            <div className="mb-2.5 flex items-center gap-2.5">
              <span className="w-3 shrink-0 font-mono text-[11px] text-muted-foreground">
                {i + 1}
              </span>
              {track}
            </div>
          );
          return row.tooltip ? (
            <Tooltip key={row.key}>
              <TooltipTrigger asChild>
                <div tabIndex={0} className="outline-hidden">
                  {rowContent}
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="text-left font-sans text-[11.5px] font-normal leading-relaxed"
              >
                {row.tooltip}
              </TooltipContent>
            </Tooltip>
          ) : (
            <React.Fragment key={row.key}>{rowContent}</React.Fragment>
          );
        })}
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
