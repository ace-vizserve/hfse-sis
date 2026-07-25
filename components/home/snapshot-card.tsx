import { Card } from '@/components/ui/card';
import type { HomeKpi } from '@/lib/home/kpis';

export function SnapshotCard({ kpis }: { kpis: HomeKpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
        Snapshot
      </div>
      <div className="px-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="border-b border-border py-2.5 last:border-b-0"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-serif text-base font-bold text-foreground">
                {kpi.value}
              </span>
              <span className="text-right text-xs text-muted-foreground">
                {kpi.label}
              </span>
            </div>
            {kpi.fraction ? (
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {kpi.fraction}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
