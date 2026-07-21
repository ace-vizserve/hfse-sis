import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { STROKE_CLASS, TILE_GRADIENT, type ColorKey } from './tokens';

/**
 * Dashed-tick semicircle gauge — 16 individual tick marks sweeping a
 * semicircle with an opacity gradient (faint at the start, solid at the
 * end), a big serif value + label centred under the arc, a caption line,
 * and up to 2 icon-tile total rows below. Matches `.dial-wrap` across every
 * locked mockup ("Revenue goal" growth panel, reused verbatim for Admissions
 * intake growth, Records population growth, and Records retention).
 *
 * Deliberately NOT a full ring — full circular/radial gauges were reviewed
 * and rejected earlier this session (see the plan's Global Constraints);
 * this dashed semicircle is the accepted substitute across all 4 pages.
 *
 * The 16 ticks are computed, not hand-copied from the mockup's literal SVG —
 * each is a short radial line at bin-midpoint angles across 180°, so the
 * geometry stays a single reusable formula instead of 16 magic coordinates.
 */

const TICK_COUNT = 16;
const CX = 80;
const CY = 85;
const R_INNER = 56;
const R_OUTER = 70;
const MIN_OPACITY = 0.15;
const MAX_OPACITY = 1;

function polar(radius: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: CX + radius * Math.cos(rad),
    y: CY - radius * Math.sin(rad),
  };
}

const TICKS = Array.from({ length: TICK_COUNT }, (_, i) => {
  const angle = 180 - (180 / TICK_COUNT) * (i + 0.5);
  const inner = polar(R_INNER, angle);
  const outer = polar(R_OUTER, angle);
  const opacity =
    MIN_OPACITY + ((MAX_OPACITY - MIN_OPACITY) * i) / (TICK_COUNT - 1);
  return { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, opacity };
});

export type RateDialTotalRow = {
  icon: LucideIcon;
  iconGradient: ColorKey;
  value: string;
  label: string;
};

export type RateDialProps = {
  value: string;
  label: string;
  caption: string;
  colorKey: ColorKey;
  /** Up to 2 icon-tile rows below the dial (e.g. "867 · AY2026" / "642 · AY2025"). */
  totals?: RateDialTotalRow[];
  className?: string;
};

export function RateDial({
  value,
  label,
  caption,
  colorKey,
  totals,
  className,
}: RateDialProps) {
  return (
    <div className={className}>
      <div className="relative mx-auto my-1 h-[95px] w-40">
        <svg viewBox="0 0 160 95" className="block h-full w-full">
          {TICKS.map((tick, i) => (
            <line
              key={i}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              strokeWidth={6}
              strokeLinecap="round"
              opacity={tick.opacity}
              className={STROKE_CLASS[colorKey]}
            />
          ))}
        </svg>
        <div className="absolute inset-x-0 bottom-1.5 flex flex-col items-center">
          <span className="font-serif text-2xl font-bold text-foreground">
            {value}
          </span>
          <span className="mt-0.5 text-[11px] text-muted-foreground">
            {label}
          </span>
        </div>
      </div>
      <p className="my-3 text-center text-[12.5px] text-muted-foreground">
        {caption}
      </p>
      {totals && totals.length > 0 && (
        <div className="flex gap-3.5">
          {totals.map((row, i) => {
            const Icon = row.icon;
            return (
              <div key={i} className="flex flex-1 items-center gap-2.5">
                <div
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-lg',
                    TILE_GRADIENT[row.iconGradient]
                  )}
                >
                  <Icon className="size-3.5" />
                </div>
                <div>
                  <div className="font-serif text-[15px] font-bold text-foreground">
                    {row.value}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {row.label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
