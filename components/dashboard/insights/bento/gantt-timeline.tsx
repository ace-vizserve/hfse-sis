import * as React from 'react';

import { cn } from '@/lib/utils';
import { BAR_GRADIENT, type ColorKey } from './tokens';

/**
 * "Project Timeline" anatomy — a month-axis header, dashed vertical
 * gridlines, and one row per item whose pill spans from a start column to
 * an end column (fractional % positions, caller computes). Matches `.gt-*`
 * in insights-mockup-records.html ("Late enrollees by term").
 */

export type GanttRow = {
  key: string;
  label: string;
  startPct: number;
  widthPct: number;
  /** Text shown in (or beside) the pill. */
  value: string;
  colorKey: ColorKey;
  /** Matches `.gt-bar.hi` — full opacity + drop shadow vs the default dimmed 0.55. */
  highlighted?: boolean;
  /** Default 'inside'; use 'outside' when the pill is too narrow to hold its own label. */
  labelPosition?: 'inside' | 'outside';
};

export type GanttTimelineProps = {
  axisLabels: string[];
  rows: GanttRow[];
  labelColWidthPx?: number;
  className?: string;
};

export function GanttTimeline({
  axisLabels,
  rows,
  labelColWidthPx = 78,
  className,
}: GanttTimelineProps) {
  return (
    <div className={className}>
      <div className="mb-3 flex" style={{ paddingLeft: labelColWidthPx }}>
        {axisLabels.map((lbl) => (
          <span
            key={lbl}
            className="flex-1 font-mono text-[10.5px] text-muted-foreground"
          >
            {lbl}
          </span>
        ))}
      </div>
      <div className="relative">
        <div
          className="absolute inset-y-0 right-0 flex"
          style={{ left: labelColWidthPx }}
        >
          {axisLabels.map((lbl, i) => (
            <div
              key={i}
              className="flex-1 border-l border-dashed border-hairline"
            />
          ))}
        </div>
        <div className="relative z-10 flex flex-col gap-4">
          {rows.map((row) => {
            const outside = row.labelPosition === 'outside';
            return (
              <div key={row.key} className="flex items-center">
                <span
                  className="shrink-0 text-[12.5px] font-semibold text-foreground/85"
                  style={{ width: labelColWidthPx }}
                >
                  {row.label}
                </span>
                <div className="relative h-7 flex-1">
                  <div
                    className={cn(
                      'absolute top-0 flex h-7 items-center justify-center whitespace-nowrap rounded-full font-mono text-[10.5px] font-bold text-white',
                      BAR_GRADIENT[row.colorKey],
                      row.highlighted
                        ? 'opacity-100 shadow-brand-tile-amber'
                        : 'opacity-55'
                    )}
                    style={{
                      left: `${row.startPct}%`,
                      width: `${row.widthPct}%`,
                    }}
                  >
                    {!outside && row.value}
                  </div>
                  {outside && (
                    <span
                      className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-2 font-mono text-[10.5px] font-semibold text-foreground"
                      style={{
                        left: `${row.startPct + row.widthPct}%`,
                      }}
                    >
                      {row.value}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
