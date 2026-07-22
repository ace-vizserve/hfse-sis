'use client';

import dynamic from 'next/dynamic';

import { ChartSkeleton } from './chart-skeleton';
import type {
  LabeledPieChartProps,
  LabeledPieSlice,
} from './labeled-pie-chart.client';

const LabeledPieChartImpl = dynamic(
  () => import('./labeled-pie-chart.client').then((m) => m.LabeledPieChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton kind="donut" />,
  }
);

export function LabeledPieChart(props: LabeledPieChartProps) {
  return <LabeledPieChartImpl {...props} />;
}

export type { LabeledPieChartProps, LabeledPieSlice };
