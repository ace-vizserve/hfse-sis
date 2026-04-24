import Link from 'next/link';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  InfoIcon,
  Sparkles,
  TrendingDownIcon,
  type LucideIcon,
} from 'lucide-react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartLegendChip,
  type ChartLegendChipColor,
} from '@/components/dashboard/chart-legend-chip';
import { cn } from '@/lib/utils';
import type { Insight, InsightSeverity } from '@/lib/dashboard/insights';

/**
 * InsightsPanel — narrative observations for a dashboard. Editorial row
 * composition: crafted gradient icon tile (§7.4) on the left, serif title +
 * muted body in the middle, severity ChartLegendChip on the right (matches
 * the badge language across the rest of the app).
 *
 * Header shows the total observation count plus a mini breakdown by severity
 * so users can scan "2 alerts, 1 watch" without reading the list.
 */

const SEVERITY_ICON: Record<InsightSeverity, LucideIcon> = {
  good: CheckCircle2Icon,
  warn: AlertTriangleIcon,
  bad: TrendingDownIcon,
  info: InfoIcon,
};

// Crafted §7.4 icon tile per severity — gradient fill + white/ink text +
// matching shadow-brand-tile-* token. Same craft the Alert + AlertIcon slot
// uses, so InsightRow tiles read as part of the same visual family.
const SEVERITY_TILE: Record<InsightSeverity, string> = {
  good: 'bg-gradient-to-br from-brand-mint to-brand-sky text-ink shadow-brand-tile-mint',
  warn: 'bg-brand-amber text-ink shadow-brand-tile-amber',
  bad: 'bg-destructive text-destructive-foreground shadow-brand-tile-destructive',
  info: 'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile',
};

const SEVERITY_BADGE_COLOR: Record<InsightSeverity, ChartLegendChipColor> = {
  good: 'fresh',
  warn: 'stale',
  bad: 'very-stale',
  info: 'primary',
};

const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  good: 'Good',
  warn: 'Watch',
  bad: 'Alert',
  info: 'Info',
};

export function InsightsPanel({
  insights,
  title = 'Insights',
}: {
  insights: Insight[];
  title?: string;
}) {
  if (insights.length === 0) return null;

  // Count insights by severity for the header breakdown strip.
  const counts = insights.reduce(
    (acc, ins) => {
      acc[ins.severity] += 1;
      return acc;
    },
    { good: 0, warn: 0, bad: 0, info: 0 } as Record<InsightSeverity, number>,
  );
  const breakdownOrder: InsightSeverity[] = ['bad', 'warn', 'info', 'good'];
  const breakdownParts = breakdownOrder
    .filter((sev) => counts[sev] > 0)
    .map((sev) => `${counts[sev]} ${SEVERITY_LABEL[sev].toLowerCase()}`);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Narrative · {insights.length} observation{insights.length === 1 ? '' : 's'}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {title}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Sparkles className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      {/* Severity breakdown strip — mini eyebrow above the list that shows
          the shape of the observations at a glance. */}
      {breakdownParts.length > 0 && (
        <div className="border-t border-hairline bg-muted/20 px-5 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)]">
          <span className="tabular-nums">{breakdownParts.join(' · ')}</span>
        </div>
      )}
      <CardContent className="p-0">
        <ul className="divide-y divide-hairline">
          {insights.map((item, i) => (
            <InsightRow key={`${i}-${item.title}`} insight={item} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function InsightRow({ insight }: { insight: Insight }) {
  const Icon = SEVERITY_ICON[insight.severity];
  const inner = (
    <div className="group flex items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/30">
      {/* Crafted gradient icon tile — §7.4 pattern. */}
      <div
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-xl [&>svg]:size-[18px]',
          SEVERITY_TILE[insight.severity],
        )}
      >
        <Icon strokeWidth={2.25} />
      </div>
      {/* Text + CTA */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-3">
          <p className="font-serif text-[15px] font-semibold leading-snug text-foreground">
            {insight.title}
          </p>
          <ChartLegendChip
            color={SEVERITY_BADGE_COLOR[insight.severity]}
            label={SEVERITY_LABEL[insight.severity]}
            className="shrink-0"
          />
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {insight.detail}
        </p>
        {insight.cta && (
          <p className="inline-flex items-center gap-1 pt-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-indigo-deep">
            {insight.cta.label}
            <ArrowRightIcon className="size-3 transition-transform group-hover:translate-x-0.5" />
          </p>
        )}
      </div>
    </div>
  );

  if (insight.cta?.href) {
    return (
      <li>
        <Link href={insight.cta.href} className="block">
          {inner}
        </Link>
      </li>
    );
  }
  return <li>{inner}</li>;
}
