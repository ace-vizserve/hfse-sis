import type { ReactNode } from 'react';
import { Filter, type LucideIcon } from 'lucide-react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Shared chart-panel shell for the module analytics pages (Academic Summary
 * relocation). Mono cap + serif title + gradient icon tile in CardAction,
 * chart or EmptyChartState in the body. Extracted from the page-local copies
 * in the Insights pages so the Awards / Attendance Summary / Comments pages
 * don't each re-declare it.
 */
export function InsightChartCard({
  cap,
  title,
  icon: Icon,
  scopeNote,
  children,
}: {
  cap: string;
  title: string;
  icon: LucideIcon;
  scopeNote?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {cap}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {title}
        </CardTitle>
        {scopeNote && (
          <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-brand-indigo-soft/50 bg-gradient-to-b from-brand-indigo/12 to-brand-indigo/4 px-2.5 py-1 font-mono text-[10.5px] font-semibold text-brand-indigo-deep">
            {scopeNote}
          </span>
        )}
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Filter className="size-4" />
      </div>
      <p className="max-w-70 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
