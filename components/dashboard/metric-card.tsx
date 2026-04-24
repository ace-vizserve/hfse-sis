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
import { Sheet, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { formatDeltaLabel, type Delta } from '@/lib/dashboard/range';
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
  format?: 'number' | 'percent' | 'days' | 'currency' | 'raw';
  currencySuffix?: string;
  delta?: Delta;
  deltaGoodWhen?: 'up' | 'down';
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
  drillSheet?: React.ReactNode;
  subtext?: string;
  className?: string;
};

function formatValue(
  value: string | number,
  format: MetricCardProps['format'],
  currencySuffix?: string,
): string {
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '—';
  switch (format) {
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'days':
      return `${value.toFixed(1)}d`;
    case 'currency':
      return `${value.toLocaleString('en-SG')}${currencySuffix ? ` ${currencySuffix}` : ''}`;
    case 'raw':
      return String(value);
    case 'number':
    default:
      return value.toLocaleString('en-SG');
  }
}

function deltaChipClass(
  delta: Delta | undefined,
  goodWhen: 'up' | 'down',
): string {
  if (!delta || delta.direction === 'flat')
    return 'border-border bg-muted text-muted-foreground';
  const isGood =
    (goodWhen === 'up' && delta.direction === 'up') ||
    (goodWhen === 'down' && delta.direction === 'down');
  return isGood
    ? 'border-brand-mint bg-brand-mint/30 text-ink'
    : 'border-destructive/40 bg-destructive/10 text-destructive';
}

function DeltaChip({ delta, goodWhen }: { delta: Delta; goodWhen: 'up' | 'down' }) {
  const Icon =
    delta.direction === 'up'
      ? ArrowUpIcon
      : delta.direction === 'down'
        ? ArrowDownIcon
        : MinusIcon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider',
        deltaChipClass(delta, goodWhen),
      )}
    >
      <Icon className="size-3" strokeWidth={2.5} />
      {formatDeltaLabel(delta)}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  format = 'number',
  currencySuffix,
  delta,
  deltaGoodWhen = 'up',
  comparisonLabel,
  icon: Icon,
  intent: _intent,
  sparkline,
  href,
  drillSheet,
  subtext,
  className,
}: MetricCardProps) {
  // Mutual exclusivity: drillSheet wins, href is ignored with a runtime warning.
  if (drillSheet && href) {
    // eslint-disable-next-line no-console
    console.warn(
      '[MetricCard] drillSheet and href are mutually exclusive; drillSheet takes precedence',
    );
  }
  const effectiveHref = drillSheet ? undefined : href;
  const interactive = Boolean(drillSheet || effectiveHref);

  const cardClass = cn(
    '@container/card bg-gradient-to-t from-primary/5 to-card shadow-xs',
    interactive &&
      'group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
    className,
  );

  const inner = (
    <Card className={cardClass}>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {formatValue(value, format, currencySuffix)}
        </CardTitle>
        {Icon && (
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Icon className="size-4" />
            </div>
          </CardAction>
        )}
      </CardHeader>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        <div className="flex items-center gap-2">
          {delta && <DeltaChip delta={delta} goodWhen={deltaGoodWhen} />}
          {comparisonLabel && (
            <span className="text-xs text-muted-foreground">{comparisonLabel}</span>
          )}
        </div>
        {subtext && !comparisonLabel && (
          <p className="text-xs text-muted-foreground">{subtext}</p>
        )}
        {sparkline && sparkline.length > 1 && (
          <div className="-mx-1 h-10 w-full">
            <SparklineChart points={sparkline} />
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
      <Sheet>
        <SheetTrigger asChild>
          <button type="button" className="block w-full text-left">
            {inner}
          </button>
        </SheetTrigger>
        {drillSheet}
      </Sheet>
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
