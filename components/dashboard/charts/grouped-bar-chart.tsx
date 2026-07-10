'use client';

import dynamic from 'next/dynamic';

import { ChartSkeleton } from './chart-skeleton';
import type {
  GroupedBarChartProps,
  GroupedBarSeries,
  YFormat,
} from './grouped-bar-chart.client';

const GroupedBarChartImpl = dynamic(
  () => import('./grouped-bar-chart.client').then((m) => m.GroupedBarChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton kind="multi-bar" />,
  }
);

export function GroupedBarChart(props: GroupedBarChartProps) {
  return <GroupedBarChartImpl {...props} />;
}

export type { GroupedBarChartProps, GroupedBarSeries, YFormat };
