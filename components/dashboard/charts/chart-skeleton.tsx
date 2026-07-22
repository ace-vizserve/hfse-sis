'use client';

import { cn } from '@/lib/utils';

export type ChartKind =
  | 'trend'
  | 'comparison-bar'
  | 'donut'
  | 'multi-trend'
  | 'multi-bar'
  | 'composed'
  | 'sparkline';

// Heights match each chart's default <ResponsiveContainer height={...}> so the
// skeleton stays layout-stable while recharts loads in a separate chunk.
const HEIGHT_BY_KIND: Record<ChartKind, string> = {
  trend: 'h-[220px]',
  'comparison-bar': 'h-[260px]',
  donut: 'h-[220px]',
  'multi-trend': 'h-[240px]',
  'multi-bar': 'h-[260px]',
  composed: 'h-[300px]',
  sparkline: 'h-10',
};

export function ChartSkeleton({
  kind,
  className,
}: {
  kind: ChartKind;
  className?: string;
}) {
  const heightClass = HEIGHT_BY_KIND[kind];

  if (kind === 'sparkline') {
    return (
      <div
        className={cn(
          'w-full animate-pulse rounded bg-muted/40',
          heightClass,
          className
        )}
      />
    );
  }

  if (kind === 'donut') {
    return (
      <div
        className={cn(
          'flex items-center justify-center',
          heightClass,
          className
        )}
      >
        <div className="size-40 animate-pulse rounded-full bg-muted/60" />
      </div>
    );
  }

  // Trend / bar / multi-* — same skeletal shape: legend slot + bar plot + axis labels.
  return (
    <div className={cn('flex flex-col gap-3', heightClass, className)}>
      {/* Legend slot */}
      <div className="flex items-center gap-3">
        <div className="h-3 w-20 animate-pulse rounded bg-muted/60" />
        <div className="h-3 w-20 animate-pulse rounded bg-muted/60" />
      </div>
      {/* Plot area — placeholder bars */}
      <div className="flex flex-1 items-end gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 animate-pulse rounded-sm bg-muted/40"
            style={{ height: `${30 + ((i * 7) % 60)}%` }}
          />
        ))}
      </div>
      {/* X-axis labels */}
      <div className="flex justify-between gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-2 w-12 animate-pulse rounded bg-muted/50" />
        ))}
      </div>
    </div>
  );
}
