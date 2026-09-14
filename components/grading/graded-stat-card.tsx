'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';

import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { queryKeys } from '@/lib/query/keys';

export type GradedProgress = {
  graded: number;
  total: number;
};

/**
 * The "Graded n/N · % complete" card above a grading sheet.
 *
 * WHY IT OWNS ITS NUMBERS NOW. It used to arrive as a server prop, so the only
 * way to move it after a teacher typed a score was to re-render the whole page
 * — and the grid AWAITED that render before it said "Saved", which is most of
 * what made encoding feel slow. The grid now writes a score straight to
 * Supabase (migration 152) and pushes the new count into this query instead.
 *
 * ⚠ THERE IS NO `queryFn`, AND THAT IS THE POINT. This card is not fetching
 * anything. `graded` and `total` are derived from exactly the rows the grid is
 * already holding in memory — the server computed them the same way, off the
 * same list — so a round trip would be asking the database to recount
 * something the browser can already see. The query is being used as a shared
 * cache slot between two components that cannot pass props to each other,
 * because one is rendered by the page above the other.
 *
 * `initialData` is the server's own count, so first paint is identical to the
 * server-rendered version.
 */
export function GradedStatCard({
  sheetId,
  initialProgress,
  isExaminable,
}: {
  sheetId: string;
  initialProgress: GradedProgress;
  isExaminable: boolean;
}) {
  const { data } = useQuery({
    queryKey: queryKeys.gradingSheetProgress(sheetId),
    // No `queryFn`: nothing to fetch. `staleTime: Infinity` keeps TanStack from
    // ever trying, which without a fetcher would leave the card stuck loading.
    queryFn: () => Promise.resolve(initialProgress),
    initialData: initialProgress,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const { graded, total } = data;
  const pct = total > 0 ? Math.round((graded / total) * 100) : 0;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Graded
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {`${graded}/${total || 0}`}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <CheckCircle2 className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">
          {total > 0 ? `${pct}% complete` : 'No students yet'}
        </p>
        <p className="text-xs text-muted-foreground">
          {isExaminable ? 'Quarterly grade computed' : 'Letter grade recorded'}
        </p>
      </CardFooter>
    </Card>
  );
}
