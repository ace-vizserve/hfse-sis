'use client';

import dynamic from 'next/dynamic';

import { ChartSkeleton } from './chart-skeleton';
import type { SparkPoint } from './sparkline-chart.client';
import type { MetricFormat } from '@/lib/dashboard/format-metric';

const SparklineChartImpl = dynamic(
  () => import('./sparkline-chart.client').then((m) => m.SparklineChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton kind="sparkline" />,
  }
);

export function SparklineChart({
  points,
  seriesName,
  format,
  currencySuffix,
}: {
  points: SparkPoint[];
  /** What one y value is — shown beside the number in the hover readout. */
  seriesName?: string;
  /** Format NAME, not a formatter — this crosses into a client component. */
  format?: MetricFormat;
  currencySuffix?: string;
}) {
  return (
    <SparklineChartImpl
      points={points}
      seriesName={seriesName}
      format={format}
      currencySuffix={currencySuffix}
    />
  );
}

export type { SparkPoint };
