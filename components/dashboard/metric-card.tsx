import * as React from 'react';
import Link from 'next/link';
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ChevronsRight,
  MinusIcon,
  type LucideIcon,
} from 'lucide-react';

import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MetricCardDrillButton } from './metric-card-drill-button';
import { HintedText } from '@/components/ui/hinted-text';
import { cn } from '@/lib/utils';
import { formatDeltaLabel, type Delta } from '@/lib/dashboard/range';
import {
  formatMetricValue,
  type MetricFormat,
} from '@/lib/dashboard/format-metric';
import { SparklineChart, type SparkPoint } from './charts/sparkline-chart';

/**
 * MetricCard — KPI tile, conforming to the dashboard-01 SectionCards pattern
 * documented in `docs/context/09a-design-patterns.md` §8.
 *
 * Hard rule #7 binding: gradient `from-brand-indigo to-brand-navy` icon tile
 * placed in `CardAction`, serif 32px stat value with `tabular-nums`,
 * mono uppercase eyebrow, hover-lift on interactive variants.
 */

export type MetricIntent = 'default' | 'good' | 'bad' | 'warning';

export type MetricCardProps = {
  label: string;
  value: string | number;
  format?: MetricFormat;
  currencySuffix?: string;
  delta?: Delta;
  deltaGoodWhen?: 'up' | 'down';
  deltaFormat?: 'percent' | 'absolute';
  deltaUnit?: string;
  comparisonLabel?: string;
  icon?: LucideIcon;
  intent?: MetricIntent;
  sparkline?: SparkPoint[];
  href?: string;
  /**
   * When provided, the card becomes a Sheet trigger instead of a link.
   * Pass the full `<SheetContent>...</SheetContent>` (or a component that
   * renders one) — MetricCard wraps its own `<Sheet>` internally.
   * Mutually exclusive with `href`; `drillSheet` takes precedence if both
   * are set (a runtime console.warn is emitted in that case).
   */
  drillSheet?: () => React.ReactNode;
  subtext?: string;
  tileClassName?: string;
  className?: string;
  /**
   * What this number counts, in one plain sentence — revealed by the small
   * "?" beside the label.
   *
   * A KPI is the most-looked-at thing on a dashboard and the least
   * self-explaining: "501" does not say whether withdrawn students are in it.
   * Keep it to what a school administrator needs (what is counted, what is
   * excluded) and out of database vocabulary.
   */
  hint?: React.ReactNode;
  /**
   * What the delta is measured against, e.g. "the same point last academic
   * year". Shown on the chip itself, which otherwise names no baseline at all.
   */
  deltaHint?: React.ReactNode;
};

// Moved to lib/dashboard/format-metric.ts so the sparkline — a client
// component — can print its hover readout in the same units without the card
// handing it a function across the RSC boundary.
const formatValue = formatMetricValue;

function deltaChipClass(
  delta: Delta | undefined,
  goodWhen: 'up' | 'down'
): string {
  if (!delta || delta.direction === 'flat')
    return 'border-border bg-muted text-muted-foreground';
  const isGood =
    (goodWhen === 'up' && delta.direction === 'up') ||
    (goodWhen === 'down' && delta.direction === 'down');
  return isGood
    ? 'border-brand-mint bg-gradient-to-b from-brand-mint/35 to-brand-mint/15 text-ink'
    : 'border-destructive/40 bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive';
}

function DeltaChip({
  delta,
  goodWhen,
  format,
  unit,
  hint,
}: {
  delta: Delta;
  goodWhen: 'up' | 'down';
  format?: 'percent' | 'absolute';
  unit?: string;
  hint?: React.ReactNode;
}) {
  const Icon =
    delta.direction === 'up'
      ? ArrowUpIcon
      : delta.direction === 'down'
        ? ArrowDownIcon
        : MinusIcon;
  // HintedText, not HoverHint: this file is a server component, and HoverHint
  // clones its child to attach the trigger. The span has to be created inside
  // the client boundary. With no `hint` it renders the bare span as before.
  return (
    <HintedText
      hint={hint}
      className={cn(
        'inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider',
        deltaChipClass(delta, goodWhen)
      )}
    >
      <Icon className="size-3" strokeWidth={2.5} />
      {formatDeltaLabel(delta, { format, unit })}
    </HintedText>
  );
}

function MetricCardImpl({
  label,
  value,
  format = 'number',
  currencySuffix,
  delta,
  deltaGoodWhen = 'up',
  deltaFormat,
  deltaUnit,
  comparisonLabel,
  icon: Icon,
  intent: _intent,
  sparkline,
  href,
  drillSheet,
  subtext,
  tileClassName,
  className,
  hint,
  deltaHint,
}: MetricCardProps) {
  // Mutual exclusivity: drillSheet wins, href is ignored with a runtime warning.
  if (drillSheet && href) {
    // eslint-disable-next-line no-console
    console.warn(
      '[MetricCard] drillSheet and href are mutually exclusive; drillSheet takes precedence'
    );
  }
  const effectiveHref = drillSheet ? undefined : href;
  const interactive = Boolean(drillSheet || effectiveHref);

  const cardClass = cn(
    '@container/card bg-gradient-to-t from-primary/5 to-card shadow-xs',
    interactive &&
      'group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
    className
  );

  const inner = (
    <Card className={cardClass}>
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
          {/* Deliberately not the whole tile: an interactive card is already a
              link or a sheet trigger, and hanging a tooltip on it would fire
              every time the pointer crossed the card on its way elsewhere. */}
          {hint && (
            <HintedText
              hint={hint}
              className="inline-flex size-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-hairline-strong font-sans text-[9px] font-semibold normal-case tracking-normal text-ink-5"
            >
              ?
            </HintedText>
          )}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {formatValue(value, format, currencySuffix)}
        </CardTitle>
        {Icon && (
          <CardAction>
            <div
              className={cn(
                'flex size-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-brand-tile',
                tileClassName ?? 'from-brand-indigo to-brand-navy'
              )}
            >
              <Icon className="size-4" />
            </div>
          </CardAction>
        )}
      </CardHeader>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        <div className="flex items-center gap-2">
          {delta && (
            <DeltaChip
              delta={delta}
              goodWhen={deltaGoodWhen}
              format={deltaFormat}
              unit={deltaUnit}
              hint={deltaHint}
            />
          )}
          {comparisonLabel && (
            <span className="text-xs font-medium text-foreground/75">
              {comparisonLabel}
            </span>
          )}
        </div>
        {subtext && !comparisonLabel && (
          <p className="text-xs text-muted-foreground">{subtext}</p>
        )}
        {sparkline && sparkline.length > 1 && (
          <div className="-mx-1 h-10 w-full">
            <SparklineChart
              points={sparkline}
              seriesName={label}
              // The format NAME, not a formatter. A function cannot cross into
              // a client component; the sparkline rebuilds it on its side so
              // the trend still reads in the card's units rather than printing
              // a raw float under a percentage.
              format={format}
              currencySuffix={currencySuffix}
            />
          </div>
        )}
        {effectiveHref && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-indigo-deep">
            View
            <ArrowRightIcon className="size-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        )}
        {drillSheet && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-indigo-deep">
            Details
            <ChevronsRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        )}
      </CardFooter>
    </Card>
  );

  if (drillSheet) {
    return (
      <MetricCardDrillButton sheet={drillSheet()}>
        {inner}
      </MetricCardDrillButton>
    );
  }

  if (effectiveHref) {
    return (
      <Link href={effectiveHref} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}

export const MetricCard = React.memo(MetricCardImpl);
MetricCard.displayName = 'MetricCard';
