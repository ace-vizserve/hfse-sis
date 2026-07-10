'use client';

import dynamic from 'next/dynamic';

import { ChartSkeleton } from './chart-skeleton';
import type {
  AyComparisonLineChartProps,
  AyComparisonSeries,
  YFormat,
} from './ay-comparison-line-chart.client';

const AyComparisonLineChartImpl = dynamic(
  () =>
    import('./ay-comparison-line-chart.client').then(
      (m) => m.AyComparisonLineChart
    ),
  {
    ssr: false,
    loading: () => <ChartSkeleton kind="multi-trend" />,
  }
);

export function AyComparisonLineChart(props: AyComparisonLineChartProps) {
  return <AyComparisonLineChartImpl {...props} />;
}

export type { AyComparisonLineChartProps, AyComparisonSeries, YFormat };
