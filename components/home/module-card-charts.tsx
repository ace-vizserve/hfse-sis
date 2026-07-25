import type { ModuleCardChart } from '@/lib/home/module-cards';

export function ModuleCardChartView({ chart }: { chart: ModuleCardChart }) {
  if (chart.kind === 'none') return null;

  const pct = Math.max(0, Math.min(100, chart.pct));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-hairline"
      aria-hidden
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand-indigo to-brand-sky"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
