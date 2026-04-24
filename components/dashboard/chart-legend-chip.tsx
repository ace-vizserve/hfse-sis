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
  | 'very-stale'
  | 'neutral';

// Each chip renders as a fully-filled gradient pill (same craft as the default
// Badge: mono uppercase tracked label, white text, inset-highlight shadow).
// Gradients terminate at a darker endpoint so white text stays readable across
// the whole palette.
const chipGradientByColor: Record<ChartLegendChipColor, string> = {
  'chart-1': 'from-chart-1 to-brand-indigo-deep',
  'chart-2': 'from-chart-2 to-chart-1',
  'chart-3': 'from-chart-3 to-chart-2',
  'chart-4': 'from-chart-4 to-chart-2',
  'chart-5': 'from-chart-5 to-chart-3',
  primary: 'from-brand-indigo to-brand-navy',
  fresh: 'from-chart-5 to-chart-3',
  stale: 'from-brand-amber to-brand-amber/80',
  'very-stale': 'from-destructive to-destructive/80',
  neutral: 'from-ink-4 to-ink-3',
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
        'inline-flex items-center gap-1 rounded-md border border-transparent bg-gradient-to-b px-2 py-0.5 font-mono text-[11px] font-semibold uppercase leading-none tracking-[0.14em] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_1px_2px_rgba(15,23,42,0.08)]',
        chipGradientByColor[color],
        className,
      )}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span className="font-mono text-[10px] tabular-nums text-white/80">
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
type RechartsLegendEntry = {
  value: string;
  dataKey?: string | number;
  color?: string;
};

// Typed as (props: unknown) to satisfy recharts' ContentType (which uses
// readonly LegendPayload[]) without coupling to recharts' internal types.
export function chartLegendContent(
  palette: Record<string, ChartLegendChipColor>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function ChartLegendContent(props: any) {
    const payload: RechartsLegendEntry[] = props?.payload ?? [];
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
