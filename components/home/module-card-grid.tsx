import Link from 'next/link';
import {
  FileStack,
  Users,
  FolderKanban,
  BookOpen,
  CalendarCheck,
  ClipboardCheck,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

import {
  Card,
  CardHeader,
  CardDescription,
  CardTitle,
  CardAction,
  CardFooter,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ModuleCard } from '@/lib/home/module-cards';
import { ModuleCardChartView } from './module-card-charts';

// Same 7 module → icon assignments the original module picker used
// (docs/context/09-design-system.md §7.4 — icon tiles are crafted, not
// flat single-letter placeholders).
const MODULE_ICONS: Record<string, LucideIcon> = {
  Admissions: FileStack,
  Records: Users,
  'P-Files': FolderKanban,
  Markbook: BookOpen,
  Attendance: CalendarCheck,
  Evaluation: ClipboardCheck,
  'SIS Admin': ShieldCheck,
};

export function ModuleCardGrid({ cards }: { cards: ModuleCard[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const Icon = MODULE_ICONS[card.module] ?? FileStack;
        return (
          <Link key={card.href} href={card.href} className="block">
            <Card className="@container/card cursor-pointer gap-0 py-0 transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-md">
              <CardHeader className="pt-5 pb-3">
                <CardDescription className="font-mono text-[10px] font-semibold tracking-[0.14em] uppercase">
                  {card.module}
                </CardDescription>
                <CardTitle className="font-serif text-[32px] leading-none font-semibold tabular-nums text-foreground">
                  {card.statValue}
                </CardTitle>
                <CardAction>
                  <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                    <Icon className="size-4" />
                  </div>
                  {card.badge ? (
                    <Badge variant={card.badge.tone} className="mt-2">
                      {card.badge.label}
                    </Badge>
                  ) : null}
                </CardAction>
              </CardHeader>
              <CardFooter className="flex-col items-start gap-2 pb-5 text-sm">
                <p className="text-xs font-medium text-foreground">
                  {card.statLabel}
                </p>
                <ModuleCardChartView chart={card.chart} />
              </CardFooter>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
