import type { ModuleCardChart } from '@/lib/home/module-cards';

export function ModuleCardChartView({ chart }: { chart: ModuleCardChart }) {
  if (chart.kind === 'sparkline') {
    const max = Math.max(...chart.points, 1);
    return (
      <div className="mb-2 flex h-6 items-end gap-0.5" aria-hidden>
        {chart.points.map((p, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm bg-gradient-to-t from-brand-indigo to-brand-indigo-soft"
            style={{ height: `${Math.max((p / max) * 100, 8)}%` }}
          />
        ))}
      </div>
    );
  }

  if (chart.kind === 'ring') {
    const deg = Math.max(0, Math.min(100, chart.pct)) * 3.6;
    return (
      <div
        className="mb-2 flex size-8 items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(var(--color-brand-indigo) ${deg}deg, var(--color-hairline) ${deg}deg)`,
        }}
        aria-hidden
      >
        <div className="flex size-5 items-center justify-center rounded-full bg-card text-[9px] font-semibold" />
      </div>
    );
  }

  if (chart.kind === 'dots') {
    return (
      <div className="mb-2 flex gap-0.5" aria-hidden>
        {Array.from({ length: chart.total }, (_, i) => (
          <div
            key={i}
            className={
              i < chart.done
                ? 'h-2 w-2 rounded-[2px] bg-brand-indigo'
                : 'h-2 w-2 rounded-[2px] bg-hairline'
            }
          />
        ))}
      </div>
    );
  }

  return null;
}
