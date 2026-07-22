'use client';

import dynamic from 'next/dynamic';

import { ChartSkeleton } from './chart-skeleton';
import type {
  CategoryLineChartProps,
  CategoryLinePoint,
} from './category-line-chart.client';

const CategoryLineChartImpl = dynamic(
  () => import('./category-line-chart.client').then((m) => m.CategoryLineChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton kind="trend" />,
  }
);

export function CategoryLineChart(props: CategoryLineChartProps) {
  return <CategoryLineChartImpl {...props} />;
}

export type { CategoryLineChartProps, CategoryLinePoint };
