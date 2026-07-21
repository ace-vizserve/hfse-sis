import * as React from 'react';

import { cn } from '@/lib/utils';
import { BAR_GRADIENT, SOFT_BADGE_CLASS, type ColorKey } from './tokens';

/**
 * Before/after pair row — a name+level header (with an optional badge),
 * then two thin labelled bars stacked "From" / "To", the "To" bar coloured
 * by direction. No `dl2-*` anatomy exists in any of the 4 locked mockups
 * (verified — none of the four HTML files contain that class prefix); this
 * is built directly from the plan's prose spec as a forward-looking
 * addition to the shared library, not a literal mockup translation.
 *
 * "From" always renders in the neutral grey tone (a baseline value, not
 * itself improving/declining); "To" renders mint when `direction: 'up'` and
 * destructive when `direction: 'down'` — the same convention
 * insights-mockup-markbook.html's regression pill-bar-chart uses for its
 * own From/To legend.
 */

export type DeltaBarRowProps = {
  name: string;
  level: string;
  badge?: { text: string; colorKey: ColorKey };
  from: { label: string; value: string; pct: number };
  to: { label: string; value: string; pct: number };
  direction: 'up' | 'down';
  className?: string;
};

function ThinBar({
  label,
  value,
  pct,
  colorKey,
}: {
  label: string;
  value: string;
  pct: number;
  colorKey: ColorKey;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between font-mono text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-semibold text-foreground">{value}</span>
      </div>
      <div className="h-[7px] overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', BAR_GRADIENT[colorKey])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function DeltaBarRow({
  name,
  level,
  badge,
  from,
  to,
  direction,
  className,
}: DeltaBarRowProps) {
  const toColorKey: ColorKey = direction === 'up' ? 'mint' : 'destructive';

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-semibold text-foreground">{name}</span>
          <span className="text-xs text-muted-foreground">{level}</span>
        </div>
        {badge && (
          <span
            className={cn(
              'shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold',
              SOFT_BADGE_CLASS[badge.colorKey]
            )}
          >
            {badge.text}
          </span>
        )}
      </div>
      <ThinBar
        label={from.label}
        value={from.value}
        pct={from.pct}
        colorKey="grey"
      />
      <ThinBar
        label={to.label}
        value={to.value}
        pct={to.pct}
        colorKey={toColorKey}
      />
    </div>
  );
}
