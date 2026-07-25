import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ModuleCard } from '@/lib/home/module-cards';
import { ModuleCardChartView } from './module-card-charts';

export function ModuleCardGrid({ cards }: { cards: ModuleCard[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <Link key={card.href} href={card.href} className="block">
          <Card className="cursor-pointer p-4 transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-md">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-brand-indigo to-brand-navy text-[10px] font-semibold text-white shadow-brand-tile">
                {card.module.charAt(0)}
              </div>
              <span className="flex-1 text-sm font-semibold text-foreground">
                {card.module}
              </span>
              {card.badge ? (
                <Badge variant={card.badge.tone}>{card.badge.label}</Badge>
              ) : null}
            </div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="font-serif text-base font-bold text-foreground">
                {card.statValue}
              </span>
              <span className="text-right text-xs text-muted-foreground">
                {card.statLabel}
              </span>
            </div>
            <ModuleCardChartView chart={card.chart} />
          </Card>
        </Link>
      ))}
    </div>
  );
}
