import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ModuleCard } from '@/lib/home/module-cards';
import { ModuleCardChartView } from './module-card-charts';

export function ModuleCardGrid({ cards }: { cards: ModuleCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {cards.map((card) => (
        <Link key={card.href} href={card.href} className="block">
          <Card className="cursor-pointer p-4 transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-md">
            <div className="mb-2 flex items-center gap-2">
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
            <ModuleCardChartView chart={card.chart} />
            <div className="font-serif text-lg font-bold text-foreground">
              {card.statValue}
            </div>
            <div className="text-xs text-muted-foreground">
              {card.statLabel}
            </div>
            {card.fraction ? (
              <div className="mt-0.5 text-[11px] text-muted-foreground/80">
                {card.fraction}
              </div>
            ) : null}
          </Card>
        </Link>
      ))}
    </div>
  );
}
