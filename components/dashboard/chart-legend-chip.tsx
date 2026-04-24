import * as React from 'react';
import { cn } from '@/lib/utils';

export type ChartLegendChipColor =
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
  | 'primary'
  | 'fresh'
  | 'stale'
  | 'very-stale';

const stripeGradientByColor: Record<ChartLegendChipColor, string> = {
  'chart-1': 'from-chart-1 to-chart-1/60',
  'chart-2': 'from-chart-2 to-chart-2/60',
  'chart-3': 'from-chart-3 to-chart-3/60',
  'chart-4': 'from-chart-4 to-chart-4/60',
  'chart-5': 'from-chart-5 to-chart-5/60',
  primary: 'from-brand-indigo to-brand-navy',
  fresh: 'from-brand-mint to-brand-sky',
  stale: 'from-brand-amber to-brand-amber',
  'very-stale': 'from-destructive to-destructive/80',
};

export type ChartLegendChipProps = {
  color: ChartLegendChipColor;
  label: string;
  count?: number;
  className?: string;
};

export function ChartLegendChip({
  color,
  label,
  count,
  className,
}: ChartLegendChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-md border border-hairline bg-background px-2 py-1 text-xs text-foreground shadow-xs',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-4 w-[3px] rounded-sm bg-gradient-to-b',
          stripeGradientByColor[color],
        )}
      />
      <span>{label}</span>
      {count !== undefined && (
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </span>
  );
}

/**
 * Render-prop compatible with recharts `<Legend content={...} />`.
 * Maps recharts payload entries to ChartLegendChips.
 *
 * Pass a `palette` mapping `dataKey` or series name → ChartLegendChipColor.
 */
type RechartsLegendPayload = {
  value: string;
  dataKey?: string | number;
  color?: string;
}[];

type RechartsLegendProps = {
  payload?: RechartsLegendPayload;
};

export function chartLegendContent(
  palette: Record<string, ChartLegendChipColor>,
) {
  return function ChartLegendContent(props: RechartsLegendProps) {
    const payload = props.payload ?? [];
    return (
      <div className="flex flex-wrap items-center gap-2 pt-2">
        {payload.map((entry, idx) => {
          const key = String(entry.dataKey ?? entry.value);
          const color = palette[key] ?? palette[entry.value] ?? 'chart-1';
          return (
            <ChartLegendChip key={`${key}-${idx}`} color={color} label={entry.value} />
          );
        })}
      </div>
    );
  };
}
