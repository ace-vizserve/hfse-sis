'use client';

import dynamic from 'next/dynamic';

import { ChartSkeleton } from './chart-skeleton';
import type {
  RetentionStackedBarChartProps,
  RetentionStackRow,
} from './retention-stacked-bar-chart.client';

const RetentionStackedBarChartImpl = dynamic(
  () =>
    import('./retention-stacked-bar-chart.client').then(
      (m) => m.RetentionStackedBarChart
    ),
  {
    ssr: false,
    loading: () => <ChartSkeleton kind="comparison-bar" />,
  }
);

export function RetentionStackedBarChart(props: RetentionStackedBarChartProps) {
  return <RetentionStackedBarChartImpl {...props} />;
}

export type { RetentionStackedBarChartProps, RetentionStackRow };
