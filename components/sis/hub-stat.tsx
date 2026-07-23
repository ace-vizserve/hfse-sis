import type { LucideIcon } from 'lucide-react';
import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from 'lucide-react';
import Link from 'next/link';

import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Delta } from '@/lib/dashboard/range';
import { formatDeltaLabel } from '@/lib/dashboard/range';

/**
 * HubStat — the SIS Admin hub's stat-band tile (Task V1,
 * `docs/superpowers/specs/2026-07-11-sis-admin-visual-redesign.html` Screen
 * 1), also reused by Sections/Discount Codes/Audit Log's summary rows.
 *
 * Restructured onto the exact same `Card`/`CardHeader`/`CardDescription`/
 * `CardTitle`/`CardAction` shape as `components/dashboard/metric-card.tsx`
 * — the real canonical KPI card used on every operational dashboard
 * (Records/Admissions/Markbook/Attendance) — after a review found the
 * original compact flex-row (`p-3.5`, 21px value, tile inline before the
 * text) read as a flat, thin outlier against the rest of the app the
 * moment it sat on the same screen as anything using MetricCard. Same
 * gradient card wash (`from-primary/5 to-card`), same 32px serif value,
 * same size-9 icon tile positioned top-right via `CardAction`, same mono
 * eyebrow ABOVE the value. Kept as its own component (not swapped for
 * MetricCard directly) only because every call site needs `tone` — a
 * mint/amber icon-tile color swap on nonzero counts MetricCard has no
 * equivalent for and every consumer already depends on.
 */

export type HubStatTone = 'brand' | 'sky' | 'mint' | 'amber' | 'muted';

const TONE_CLASS: Record<HubStatTone, string> = {
  brand:
    'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile',
  sky: 'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile',
  mint: 'bg-gradient-to-br from-brand-mint to-brand-sky text-ink shadow-brand-tile-mint',
  amber:
    'bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber',
  muted: 'bg-muted text-muted-foreground',
};

// Same gradient-wash recipe as MetricCard's DeltaChip (components/dashboard/metric-card.tsx)
// — duplicated rather than imported, matching this file's existing precedent of not
// depending on MetricCard internals (see the file's own doc comment).
function hubDeltaChipClass(delta: Delta, goodWhen: 'up' | 'down'): string {
  if (delta.direction === 'flat')
    return 'border-border bg-muted text-muted-foreground';
  const isGood =
    (goodWhen === 'up' && delta.direction === 'up') ||
    (goodWhen === 'down' && delta.direction === 'down');
  return isGood
    ? 'border-brand-mint bg-gradient-to-b from-brand-mint/35 to-brand-mint/15 text-ink'
    : 'border-destructive/40 bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive';
}

export function HubStat({
  label,
  value,
  icon: Icon,
  tone = 'brand',
  subtext,
  href,
  emphasize,
  delta,
  deltaGoodWhen = 'up',
  comparisonLabel,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: HubStatTone;
  subtext?: string;
  /** When set, the whole tile is a real navigation target (e.g. a status
   * filter deep-link) — not a look-alike control. */
  href?: string;
  /** Pareto-primary tile — the one number checked day-to-day gets a
   * stronger border + slightly larger value type than its siblings. */
  emphasize?: boolean;
  /** Optional comparison delta (e.g. vs prior AY). When set, renders a
   * gradient-wash chip in the footer in place of `subtext`. */
  delta?: Delta;
  /** Which direction reads as "good" for the mint/destructive chip tint.
   * Defaults to 'up' (more is better). */
  deltaGoodWhen?: 'up' | 'down';
  /** Short label under the delta chip (e.g. "vs AY2025"). Only rendered
   * alongside a `delta`. */
  comparisonLabel?: string;
}) {
  const inner = (
    <Card
      className={cn(
        '@container/card bg-gradient-to-t from-primary/5 to-card shadow-xs',
        href &&
          'group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        emphasize && 'border-brand-indigo/30'
      )}
    >
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle
          className={cn(
            'font-serif font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]',
            emphasize ? 'text-[34px]' : 'text-[32px]'
          )}
        >
          {typeof value === 'number' ? value.toLocaleString('en-SG') : value}
        </CardTitle>
        <CardAction>
          <div
            className={cn(
              'flex size-9 items-center justify-center rounded-xl',
              TONE_CLASS[tone]
            )}
          >
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      {(delta || subtext) && (
        <CardFooter className="flex-col items-start gap-1">
          {delta && (
            <div
              data-slot="delta-chip"
              className={cn(
                'inline-flex items-center gap-1 self-start rounded border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider',
                hubDeltaChipClass(delta, deltaGoodWhen)
              )}
            >
              {delta.direction === 'up' ? (
                <ArrowUpIcon className="size-3" strokeWidth={2.5} />
              ) : delta.direction === 'down' ? (
                <ArrowDownIcon className="size-3" strokeWidth={2.5} />
              ) : (
                <MinusIcon className="size-3" strokeWidth={2.5} />
              )}
              {formatDeltaLabel(delta, { format: 'absolute' })}
            </div>
          )}
          {delta && comparisonLabel && (
            <p className="text-xs text-muted-foreground">{comparisonLabel}</p>
          )}
          {subtext && !delta && (
            <p className="text-xs text-muted-foreground">{subtext}</p>
          )}
        </CardFooter>
      )}
    </Card>
  );

  if (href) {
    return (
      <Link href={href} scroll={false} className="block">
        {inner}
      </Link>
    );
  }

  return inner;
}
