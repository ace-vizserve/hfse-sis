'use client';

import { cn } from '@/lib/utils';

export type ChartKind =
  | 'trend'
  | 'comparison-bar'
  | 'donut'
  | 'multi-trend'
  | 'multi-bar'
  | 'composed'
  | 'sparkline'
  | 'treemap'
  | 'heatmap'
  | 'lollipop';

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
  treemap: 'h-[260px]',
  heatmap: 'h-[260px]',
  lollipop: 'h-[260px]',
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

  if (kind === 'treemap') {
    // A few nested blocks: one large, the rest sharing the remainder.
    return (
      <div
        className={cn(
          'grid grid-cols-5 grid-rows-4 gap-1',
          heightClass,
          className
        )}
      >
        <div className="col-span-3 row-span-4 animate-pulse rounded bg-muted/60" />
        <div className="col-span-2 row-span-2 animate-pulse rounded bg-muted/50" />
        <div className="animate-pulse rounded bg-muted/40" />
        <div className="animate-pulse rounded bg-muted/40" />
        <div className="animate-pulse rounded bg-muted/30" />
        <div className="animate-pulse rounded bg-muted/30" />
      </div>
    );
  }

  if (kind === 'heatmap') {
    return (
      <div className={cn('flex flex-col gap-1', heightClass, className)}>
        {Array.from({ length: 8 }).map((_, r) => (
          <div
            key={r}
            className="grid flex-1 grid-cols-[120px_repeat(4,minmax(0,1fr))] gap-1"
          >
            <div className="my-auto h-2.5 w-24 animate-pulse rounded bg-muted/50" />
            {Array.from({ length: 4 }).map((_, c) => (
              <div
                key={c}
                className="animate-pulse rounded-md bg-muted/40"
                style={{ opacity: 0.4 + (((r + c) * 3) % 6) / 10 }}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'lollipop') {
    return (
      <div
        className={cn('flex flex-col justify-around', heightClass, className)}
      >
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3"
          >
            <div className="ml-auto h-2.5 w-20 animate-pulse rounded bg-muted/50" />
            <div className="flex items-center">
              <div
                className="h-0.5 animate-pulse bg-muted"
                style={{ width: `${90 - i * 7}%` }}
              />
              <div className="size-2.5 shrink-0 animate-pulse rounded-full bg-muted" />
            </div>
          </div>
        ))}
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
