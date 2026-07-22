'use client';

import dynamic from 'next/dynamic';

import { ChartSkeleton } from './chart-skeleton';
import type {
  ComposedBarLineChartProps,
  ComposedBarLinePoint,
} from './composed-bar-line-chart.client';

const ComposedBarLineChartImpl = dynamic(
  () =>
    import('./composed-bar-line-chart.client').then(
      (m) => m.ComposedBarLineChart
    ),
  {
    ssr: false,
    loading: () => <ChartSkeleton kind="composed" />,
  }
);

export function ComposedBarLineChart(props: ComposedBarLineChartProps) {
  return <ComposedBarLineChartImpl {...props} />;
}

export type { ComposedBarLineChartProps, ComposedBarLinePoint };
