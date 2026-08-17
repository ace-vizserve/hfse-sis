import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { trendDirection } from '@/lib/markbook/academic-overview-compute';

// Cell formatting shared by the Academic Overview page and the two DataTables
// inside it. Hoisted out of academic-overview-view.tsx when the grade-level and
// subject tables became client components: the page still renders the KPI tiles
// and the per-term table on the server, so the same `84.8` has to be produced
// by one function on both sides of that boundary.

export const DASH = '–';

export function fmt(value: number | null, digits = 1): string {
  return value == null ? DASH : value.toFixed(digits);
}

export function pct(value: number | null): string {
  return value == null ? DASH : `${Math.round(value)}%`;
}

/** One decimal, because attendance moves in fractions of a point. */
export function pct1(value: number | null): string {
  return value == null ? DASH : `${value.toFixed(1)}%`;
}

/** Right-aligned numeric cell — the alignment that lets a column be compared. */
export function Num({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'bad';
}) {
  return (
    <div
      className={`text-right tabular-nums ${tone === 'bad' ? 'font-semibold text-destructive' : ''}`}
    >
      {children}
    </div>
  );
}

// Movement reads as a chip, not coloured text: mint is a background tint in
// this design system (09a §9.3) — mint text on white does not carry enough
// contrast, which is why every shipped delta chip pairs it with `text-ink`.
const TREND_CHIP: Record<'up' | 'down' | 'flat', string> = {
  up: 'border-brand-mint bg-brand-mint/30 text-ink',
  down: 'border-destructive/40 bg-destructive/10 text-destructive',
  flat: 'border-border bg-muted text-muted-foreground',
};

export function TrendCell({ delta }: { delta: number | null }) {
  const direction = trendDirection(delta);
  if (direction == null || delta == null) {
    return <span className="text-muted-foreground">{DASH}</span>;
  }
  const Icon =
    direction === 'up'
      ? TrendingUp
      : direction === 'down'
        ? TrendingDown
        : Minus;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${TREND_CHIP[direction]}`}
    >
      <Icon className="size-3" aria-hidden />
      {delta > 0 ? '+' : ''}
      {delta.toFixed(1)}
    </span>
  );
}

/** "Science 92.4" — a named extreme with its figure kept subordinate. */
export function ExtremeCell({
  name,
  average,
  emptyLabel = DASH,
}: {
  name: string | null;
  average: number | null;
  emptyLabel?: string;
}) {
  if (name == null || average == null) {
    return <span className="text-muted-foreground">{emptyLabel}</span>;
  }
  return (
    <span className="whitespace-nowrap">
      {name}{' '}
      <span className="tabular-nums text-muted-foreground">
        {average.toFixed(1)}
      </span>
    </span>
  );
}
