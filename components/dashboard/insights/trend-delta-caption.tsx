import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { TrendDeltaDirection } from '@/lib/dashboard/trend-delta';

/**
 * Headline + delta caption sat above every Insights "Trend" chart.
 *
 * Answers "which way / how much" before the reader parses the axes — the
 * single biggest readability win for a trend, independent of chart type.
 * Omit `delta` (no comparison AY selected, or no comparison value at the
 * anchor period) to render the headline alone; never fabricate a pill.
 */
export type TrendDeltaCaptionProps = {
  /** The big headline number, already formatted (e.g. "95%", "268", "+38"). */
  value: string;
  /** Short trailing caption (e.g. "attendance rate in T4", "applications this year"). */
  caption: string;
  delta?: {
    /** Already formatted (e.g. "+9% vs AY2025", "2 pts vs last year"). */
    label: string;
    direction: TrendDeltaDirection;
  };
  className?: string;
};

const DIRECTION_ICON: Record<TrendDeltaDirection, typeof ArrowUp> = {
  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
};

// §9.3 semantic recipe: mint = healthy/improving, amber = attention/declining,
// muted = no meaningful change. Icon + text together carry the signal so
// direction is never colour-only.
const DIRECTION_CLASSES: Record<TrendDeltaDirection, string> = {
  up: 'bg-brand-mint/15 text-ink',
  down: 'bg-brand-amber/15 text-ink',
  flat: 'bg-muted text-muted-foreground',
};

export function TrendDeltaCaption({
  value,
  caption,
  delta,
  className,
}: TrendDeltaCaptionProps) {
  const Icon = delta ? DIRECTION_ICON[delta.direction] : null;

  return (
    <div className={cn('flex flex-wrap items-baseline gap-2.5', className)}>
      <span className="font-serif text-2xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </span>
      <span className="text-sm text-muted-foreground">{caption}</span>
      {delta && Icon ? (
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
            DIRECTION_CLASSES[delta.direction]
          )}
        >
          <Icon aria-hidden className="h-3 w-3" />
          {delta.label}
        </span>
      ) : null}
    </div>
  );
}
