'use client';

import dynamic from 'next/dynamic';

import { ChartSkeleton } from './chart-skeleton';
import type {
  AttritionStackedBarChartProps,
  AttritionStackedBarPoint,
} from './attrition-stacked-bar-chart.client';

const AttritionStackedBarChartImpl = dynamic(
  () =>
    import('./attrition-stacked-bar-chart.client').then(
      (m) => m.AttritionStackedBarChart
    ),
  {
    ssr: false,
    loading: () => <ChartSkeleton kind="comparison-bar" />,
  }
);

export function AttritionStackedBarChart(props: AttritionStackedBarChartProps) {
  return <AttritionStackedBarChartImpl {...props} />;
}

export type { AttritionStackedBarChartProps, AttritionStackedBarPoint };
