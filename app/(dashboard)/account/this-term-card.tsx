import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, TrendingUp } from 'lucide-react';
import type { StatRow } from '@/lib/account/this-term-stats';

/**
 * The account page's "This term" stat rows — per-role numbers already
 * computed by `getThisTermStats` (lib/account/this-term-stats.ts) from
 * existing dashboard/priority-panel loaders. Pure presentation: no data
 * fetching here. Spec:
 * docs/superpowers/specs/2026-07-24-account-page-role-aware-design.md §5.
 */
export function ThisTermCard({ stats }: { stats: StatRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          This term
        </CardTitle>
      </CardHeader>
      <CardContent className="border-t border-border p-0">
        <dl className="divide-y divide-border">
          {stats.map((s) => {
            const Icon = s.tone === 'warning' ? AlertTriangle : TrendingUp;
            const iconBg =
              s.tone === 'warning' ? 'bg-brand-amber/10' : 'bg-brand-indigo/10';
            const iconColor =
              s.tone === 'warning' ? 'text-brand-amber' : 'text-brand-indigo';

            return (
              <div
                key={s.label}
                className="flex items-center justify-between px-6 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className={`shrink-0 rounded p-1 ${iconBg}`}>
                    <Icon className={`h-5 w-5 ${iconColor}`} />
                  </div>
                  <dt className="text-sm text-muted-foreground">{s.label}</dt>
                </div>
                <dd
                  className={`font-mono text-base font-bold ${s.tone === 'warning' ? 'text-brand-amber' : 'text-brand-indigo'}`}
                >
                  {s.value}
                </dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}
