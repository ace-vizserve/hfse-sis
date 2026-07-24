import { Card } from '@/components/ui/card';
import type { HomeKpi } from '@/lib/home/kpis';

export function KpiRow({ kpis }: { kpis: HomeKpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {kpis.map((kpi) => (
        <Card key={kpi.label} className="p-4">
          <div className="font-serif text-2xl font-bold text-foreground">
            {kpi.value}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{kpi.label}</div>
        </Card>
      ))}
    </div>
  );
}
