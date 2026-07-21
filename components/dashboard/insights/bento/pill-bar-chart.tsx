import * as React from 'react';

import { cn } from '@/lib/utils';
import { BAR_GRADIENT, DOT_GRADIENT, type ColorKey } from './tokens';

/**
 * "Total Revenue" anatomy — dot legend, dashed-gridline y-axis, and one
 * column per period with a rounded "up" pill (grows upward from a shared
 * zero baseline) and a "down" pill (grows downward). Matches `.mv-*` across
 * every locked mockup.
 *
 * Two real use cases share this one anatomy: (1) two always-positive series
 * where "up" and "down" are just a visual split, not a sign (e.g. intake
 * this-AY/prior-AY, enrollments/withdrawals) — both pill heights are plain
 * magnitudes; (2) one genuinely signed series (e.g. term-over-term
 * regression, "from" vs "to") where a positive delta renders as an up pill
 * and a negative one as a down pill. Either way, THIS component only ever
 * takes resolved pixel heights/positions and a colour per pill — the caller
 * does the scale math (data value → px) and picks per-column colours, so the
 * component never needs to know which case it's in.
 */

export type PillBarColumn = {
  key: string;
  /** X-axis label; use "\n" for a second line (e.g. "Filipino\nP4"). */
  label: string;
  upHeightPx: number;
  downHeightPx: number;
  /** Falls back to `defaultUpColorKey` / `defaultDownColorKey` when omitted. */
  upColorKey?: ColorKey;
  downColorKey?: ColorKey;
};

export type PillBarChartProps = {
  columns: PillBarColumn[];
  /** Total plot height in px (e.g. 300). */
  plotHeightPx: number;
  /** Distance from the top of the plot to the zero baseline, in px. */
  zeroOffsetPx: number;
  /** Y-axis labels, top to bottom, evenly spaced across `plotHeightPx`. */
  axisLabels: string[];
  legend: Array<{ colorKey: ColorKey; label: string }>;
  defaultUpColorKey: ColorKey;
  defaultDownColorKey: ColorKey;
  pillWidthPx?: number;
  columnGapPx?: number;
  className?: string;
};

const AXIS_WIDTH_PX = 38;

export function PillBarChart({
  columns,
  plotHeightPx,
  zeroOffsetPx,
  axisLabels,
  legend,
  defaultUpColorKey,
  defaultDownColorKey,
  pillWidthPx = 12,
  columnGapPx = 12,
  className,
}: PillBarChartProps) {
  const gridPositions = axisLabels.map(
    (_, i) => (plotHeightPx / Math.max(axisLabels.length - 1, 1)) * i
  );
  const bottomFromZero = plotHeightPx - zeroOffsetPx;

  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-4 text-xs text-muted-foreground">
        {legend.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1.5">
            <span
              className={cn('size-2 rounded-full', DOT_GRADIENT[item.colorKey])}
            />
            {item.label}
          </span>
        ))}
      </div>
      <div className="flex gap-2.5">
        <div
          className="flex shrink-0 flex-col justify-between"
          style={{ height: plotHeightPx, width: AXIS_WIDTH_PX }}
        >
          {axisLabels.map((lbl, i) => (
            <span
              key={i}
              className={cn(
                'font-mono text-[10px] text-muted-foreground',
                i === 0 && 'translate-y-0',
                i === axisLabels.length - 1
                  ? '-translate-y-full'
                  : i !== 0 && '-translate-y-1/2'
              )}
            >
              {lbl}
            </span>
          ))}
        </div>
        <div className="relative flex-1" style={{ height: plotHeightPx }}>
          {gridPositions.map((top, i) => (
            <div
              key={i}
              className="absolute inset-x-0 border-t border-dashed border-hairline"
              style={{ top }}
            />
          ))}
          <div
            className="absolute inset-x-0 h-px bg-hairline-strong"
            style={{ top: zeroOffsetPx }}
          />
          <div
            className="relative z-10 flex h-full"
            style={{ gap: columnGapPx }}
          >
            {columns.map((col) => {
              const upColor = BAR_GRADIENT[col.upColorKey ?? defaultUpColorKey];
              const downColor =
                BAR_GRADIENT[col.downColorKey ?? defaultDownColorKey];
              return (
                <div key={col.key} className="relative h-full flex-1">
                  {col.upHeightPx > 0 && (
                    <div
                      className={cn(
                        'absolute left-1/2 -translate-x-1/2 rounded-t-full rounded-b-[4px]',
                        upColor
                      )}
                      style={{
                        width: pillWidthPx,
                        height: col.upHeightPx,
                        bottom: bottomFromZero,
                      }}
                    />
                  )}
                  {col.downHeightPx > 0 && (
                    <div
                      className={cn(
                        'absolute left-1/2 -translate-x-1/2 rounded-b-full rounded-t-[4px]',
                        downColor
                      )}
                      style={{
                        width: pillWidthPx,
                        height: col.downHeightPx,
                        top: zeroOffsetPx,
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div
        className="mt-2 flex"
        style={{ gap: columnGapPx, paddingLeft: AXIS_WIDTH_PX + 10 }}
      >
        {columns.map((col) => (
          <span
            key={col.key}
            className="flex-1 text-center font-mono text-[10.5px] leading-tight text-muted-foreground"
          >
            {col.label.split('\n').map((line, i) => (
              <React.Fragment key={i}>
                {i > 0 && <br />}
                {line}
              </React.Fragment>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}
