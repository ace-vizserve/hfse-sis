'use client';

import dynamic from 'next/dynamic';

import { ChartSkeleton } from './chart-skeleton';
import type { TreemapBlock, TreemapChartProps } from './treemap-chart.client';

const TreemapChartImpl = dynamic(
  () => import('./treemap-chart.client').then((m) => m.TreemapChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton kind="treemap" />,
  }
);

export function TreemapChart(props: TreemapChartProps) {
  return <TreemapChartImpl {...props} />;
}

export type { TreemapBlock, TreemapChartProps };
