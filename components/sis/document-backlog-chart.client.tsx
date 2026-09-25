'use client';

import { FileWarning } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { chartLegendContent } from '@/components/dashboard/chart-legend-chip';
import {
  AXIS_TICK,
  BAR_CURSOR,
  BAR_RADIUS_TOP,
  CATEGORY_TICK,
  CHART_AXIS,
  CHART_GRID,
  SEGMENT_EDGE,
} from '@/components/dashboard/charts/chart-primitives';
import { chartTooltipContent } from '@/components/dashboard/charts/chart-tooltip';
import type { DocumentBacklogRow } from '@/lib/sis/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export type DocumentBacklogChartProps = {
  data: DocumentBacklogRow[];
  onSegmentClick?: (segment: string) => void;
  /**
   * Which kind of document this card shows. The Records dashboard gives each
   * its own card (Mr Ace, 2026-09-25): the expiring ones share a row with
   * Students by level, and the collected-once ones take a row to themselves,
   * because a list of ~20 certificates and forms needs the full width.
   */
  part: 'expiring' | 'once';
};

// Severity ramp, left to right in the stack: settled → in progress → refused →
// lapsed → never provided. `expired` takes brand-amber, which is this palette's
// warning tone (09a-design-patterns.md §9.3) and the right one for a document
// that WAS valid and needs renewing — distinct from `rejected`'s destructive
// red, where the SIS actively said no.
//
// Valid and pending are two grades of the same progress, so they take the
// shared one-blue ramp (darkest for done); rejected, expired and missing are
// statuses the reader acts on and keep their red, amber and grey. The missing
// chip was a blue `chart-2` against a grey bar; `neutral` matches the bar.
const SEGMENTS = [
  { key: 'valid', name: 'Valid', fill: 'var(--color-series-1)' },
  { key: 'pending', name: 'Pending review', fill: 'var(--color-series-1-mid)' },
  { key: 'rejected', name: 'Rejected', fill: 'var(--destructive)' },
  { key: 'expired', name: 'Expired', fill: 'var(--color-brand-amber)' },
  { key: 'missing', name: 'Missing', fill: 'var(--muted-foreground)' },
] as const;

const LEGEND_PALETTE = {
  valid: 'series-1',
  pending: 'series-1-mid',
  rejected: 'very-stale',
  expired: 'stale',
  missing: 'neutral',
} as const;

function BacklogBars({
  rows,
  height,
  showLegend,
  onSegmentClick,
}: {
  rows: DocumentBacklogRow[];
  height: number;
  showLegend: boolean;
  onSegmentClick?: (segment: string) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid {...CHART_GRID} />
        <XAxis
          dataKey="label"
          tick={CATEGORY_TICK}
          {...CHART_AXIS}
          interval={0}
          angle={-30}
          height={80}
          textAnchor="end"
        />
        <YAxis tick={AXIS_TICK} {...CHART_AXIS} allowDecimals={false} />
        <Tooltip
          wrapperStyle={{ zIndex: 20 }}
          cursor={BAR_CURSOR}
          // One bar is one document type, counted once per student it is
          // asked of, so the segments sum to the students this document
          // applies to (KD #219 gates the rest out).
          content={chartTooltipContent({
            share: true,
            totalLabel: 'All students',
          })}
        />
        {/* Rendered once for the card, under the lower chart — the two charts
            share a vocabulary, and repeating the key would imply they do not. */}
        {showLegend ? (
          <Legend content={chartLegendContent(LEGEND_PALETTE)} />
        ) : null}
        {SEGMENTS.map((segment, i) => (
          <Bar
            key={segment.key}
            dataKey={segment.key}
            name={segment.name}
            stackId="status"
            fill={segment.fill}
            {...SEGMENT_EDGE}
            radius={i === SEGMENTS.length - 1 ? BAR_RADIUS_TOP : undefined}
            onClick={
              onSegmentClick
                ? (((d: unknown) => {
                    const p = d as { payload?: { label?: string } };
                    const lbl = p?.payload?.label;
                    if (lbl) onSegmentClick(`${lbl}|${segment.key}`);
                  }) as never)
                : undefined
            }
            style={onSegmentClick ? { cursor: 'pointer' } : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DocumentBacklogChart({
  data: allRows,
  onSegmentClick,
  part,
}: DocumentBacklogChartProps) {
  // ⚠ SPLIT ON `expires`, NOT on `group`. The `student-expiring` group holds
  // two slots — the student's own passport and pass — while EIGHT documents
  // actually carry an expiry date; the other six are the mother's, father's
  // and guardian's, which live in the `parent` group. Grouping by `group`
  // would put three quarters of the expiring documents under "Other".
  const data = allRows.filter((r) =>
    part === 'expiring' ? r.expires : !r.expires
  );
  const total = data.reduce(
    (sum, r) => sum + r.valid + r.pending + r.rejected + r.expired + r.missing,
    0
  );
  const empty = total === 0;

  // A bar needs room for its rotated label, so height follows the row count.
  const heightFor = (rows: number) => Math.max(200, 80 + rows * 26);

  const copy =
    part === 'expiring'
      ? {
          title: 'Documents that expire',
          description:
            'Passports and passes, for the student and each parent or guardian. These need renewing, not collecting again.',
        }
      : {
          title: 'Documents collected once',
          description:
            'Certificates, forms and records. Once they are valid they stay valid.',
        };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Validation backlog
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {copy.title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{copy.description}</p>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <FileWarning className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[340px] flex-col items-center justify-center gap-2 text-center">
            <FileWarning className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">
              No document data
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Bars appear once documents exist for this academic year.
            </p>
          </div>
        ) : (
          // Each card carries its own legend now that the two are apart.
          <BacklogBars
            rows={data}
            height={heightFor(data.length)}
            showLegend
            onSegmentClick={onSegmentClick}
          />
        )}
      </CardContent>
    </Card>
  );
}
