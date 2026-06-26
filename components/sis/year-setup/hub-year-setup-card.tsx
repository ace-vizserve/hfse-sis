import Link from 'next/link';
import { ArrowUpRight, ListChecks } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { AyReadiness } from '@/lib/sis/readiness';

export function HubYearSetupCard({
  readiness,
}: {
  readiness: AyReadiness | null;
}) {
  const complete = readiness?.complete ?? 0;
  const total = readiness?.total ?? 0;
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
  const ready = total > 0 && complete === total;

  return (
    <Card className="@container/card group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader>
        <CardDescription>Year setup</CardDescription>
        <CardTitle className="font-serif text-xl">
          Set up the academic year
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <ListChecks className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-4 text-sm">
        <p className="leading-relaxed text-muted-foreground">
          {ready
            ? 'Everything is in place for this academic year.'
            : 'Term dates, calendar, classes, advisers, grading sheets, virtue themes, and letterhead — guided, in one place.'}
        </p>
        <div className="flex w-full items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-indigo-soft to-brand-sky"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {complete} / {total} ready
          </span>
        </div>
        <Button asChild size="sm">
          <Link href="/sis/ay-setup">
            Open Year Setup
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
