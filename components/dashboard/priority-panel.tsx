import Link from 'next/link';
import { ArrowRightIcon } from 'lucide-react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ChartLegendChip,
  type ChartLegendChipColor,
} from '@/components/dashboard/chart-legend-chip';
import { cn } from '@/lib/utils';
import type { InsightSeverity } from '@/lib/dashboard/insights';
import type { PriorityChip, PriorityPayload } from '@/lib/dashboard/priority';

/**
 * PriorityPanel — top-of-fold "what to act on right now?" answer.
 *
 * Sits ABOVE the KPI strip on operational dashboards (Markbook, Attendance,
 * P-Files). Composes from the same §7.4 craft vocabulary as ActionList +
 * MetricCard: gradient icon tile in CardAction, mono uppercase eyebrow,
 * serif tabular-nums headline number, severity dots on action chips.
 *
 * Server component — renders a static payload.
 */

// Mirror of ActionList's DOT_BY_SEVERITY (kept in sync intentionally).
const DOT_BY_SEVERITY: Record<InsightSeverity, string> = {
  good: 'bg-brand-mint',
  warn: 'bg-brand-amber',
  bad: 'bg-destructive',
  info: 'bg-brand-indigo',
};

// Maps insight severity onto the ChartLegendChip palette so the headline
// chip stays visually consistent with the rest of the dashboard sweep.
const CHIP_COLOR_BY_SEVERITY: Record<InsightSeverity, ChartLegendChipColor> = {
  good: 'fresh',
  warn: 'stale',
  bad: 'very-stale',
  info: 'primary',
};

export type PriorityPanelProps = {
  payload: PriorityPayload;
};

export function PriorityPanel({ payload }: PriorityPanelProps) {
  const { eyebrow = 'Priority', title, headline, chips, cta, icon: Icon } = payload;
  const isEmpty = headline.value === 0 && chips.length === 0;
  const headlineSeverity = headline.severity ?? 'info';
  const headlineChipColor = CHIP_COLOR_BY_SEVERITY[headlineSeverity];

  return (
    <Card className="@container/card bg-gradient-to-t from-primary/5 to-card shadow-xs">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </CardTitle>
        {Icon && (
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Icon className="size-4" />
            </div>
          </CardAction>
        )}
      </CardHeader>

      {isEmpty ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            All clear · nothing needs your attention right now
          </p>
        </CardContent>
      ) : (
        <>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-3">
              <span className="font-serif text-[44px] font-semibold leading-none tabular-nums text-foreground">
                {headline.value.toLocaleString('en-SG')}
              </span>
              <ChartLegendChip
                color={headlineChipColor}
                label={headline.label}
                className="mb-1"
              />
            </div>

            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {chips.map((chip, i) => (
                  <PriorityChipLink key={`${i}-${chip.label}`} chip={chip} />
                ))}
              </div>
            )}
          </CardContent>

          {cta && (
            <CardFooter className="justify-end">
              <Button asChild variant="default" size="sm">
                <Link href={cta.href}>
                  {cta.label}
                  <ArrowRightIcon className="size-3.5" />
                </Link>
              </Button>
            </CardFooter>
          )}
        </>
      )}
    </Card>
  );
}

function PriorityChipLink({ chip }: { chip: PriorityChip }) {
  const dot = DOT_BY_SEVERITY[chip.severity ?? 'info'];
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={chip.href}>
        <span className={cn('size-2 shrink-0 rounded-full', dot)} aria-hidden />
        <span className="text-sm">{chip.label}</span>
        <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
          {chip.count.toLocaleString('en-SG')}
        </span>
      </Link>
    </Button>
  );
}
