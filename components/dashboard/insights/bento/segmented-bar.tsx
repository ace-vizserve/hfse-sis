import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  BAR_GRADIENT,
  DOT_GRADIENT,
  TILE_GRADIENT,
  type ColorKey,
} from './tokens';

/**
 * "Vehicle overview" anatomy — one segmented bar for mutually-exclusive
 * categories that sum to 100%, tick labels above segments wide enough to
 * carry one, then a detail list below (icon tile + label + value + %).
 * Matches `.vo-*` in insights-mockup-admissions.html ("Where applicants
 * stall") — segments must genuinely be a partition of the whole; this isn't
 * a general-purpose stacked bar.
 */

export type SegmentedBarSegment = {
  key: string;
  label: string;
  /** Detail-row value text, e.g. "62 applicants". */
  value: string;
  pct: number;
  colorKey: ColorKey;
  icon?: LucideIcon;
};

export type SegmentedBarProps = {
  segments: SegmentedBarSegment[];
  /** Segments at or above this share get a tick label + an in-bar % label; thinner slivers stay honestly present but unlabelled rather than overlapping their neighbours. Default 15 (mirrors the locked mockup). */
  tickThresholdPct?: number;
  className?: string;
};

export function SegmentedBar({
  segments,
  tickThresholdPct = 15,
  className,
}: SegmentedBarProps) {
  return (
    <div className={className}>
      <div className="flex">
        {segments.map((seg) => (
          <div
            key={seg.key}
            className="flex flex-col gap-1"
            style={{ flexGrow: seg.pct, flexBasis: 0 }}
          >
            {seg.pct >= tickThresholdPct && (
              <>
                <span className="truncate text-[11.5px] text-muted-foreground">
                  {seg.label}
                </span>
                <span className="h-2.5 w-px bg-hairline-strong" />
              </>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex h-10 overflow-hidden rounded-[10px]">
        {segments.map((seg) => (
          <div
            key={seg.key}
            className={cn(
              'flex items-center justify-center font-mono text-[12.5px] font-bold text-white',
              BAR_GRADIENT[seg.colorKey]
            )}
            style={{ flexGrow: seg.pct, flexBasis: 0 }}
          >
            {seg.pct >= tickThresholdPct && `${seg.pct}%`}
          </div>
        ))}
      </div>
      <div className="mt-5">
        {segments.map((seg) => {
          const Icon = seg.icon;
          return (
            <div
              key={seg.key}
              className="flex items-center gap-3 border-t border-hairline py-3 first:border-t-0 first:pt-1"
            >
              {Icon ? (
                <div
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-lg',
                    TILE_GRADIENT[seg.colorKey]
                  )}
                >
                  <Icon className="size-3.5" />
                </div>
              ) : (
                <span
                  className={cn(
                    'size-2.5 shrink-0 rounded-sm',
                    DOT_GRADIENT[seg.colorKey]
                  )}
                />
              )}
              <span className="flex-1 text-[13px] text-foreground/80">
                {seg.label}
              </span>
              <span className="mr-2.5 text-[13px] font-semibold text-foreground">
                {seg.value}
              </span>
              <span className="w-11 text-right font-mono text-xs text-muted-foreground">
                {seg.pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
