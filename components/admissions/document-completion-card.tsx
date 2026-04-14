import { FileCheck2 } from 'lucide-react';

import type { DocumentCompletion } from '@/lib/admissions/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function DocumentCompletionCard({ data }: { data: DocumentCompletion }) {
  const hasData = data !== null && data.total > 0;
  return (
    <Card className="@container/card h-full">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Document completion
        </CardDescription>
        <CardTitle className="flex items-baseline gap-2 font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground">
          {hasData ? `${data.percent}%` : '—'}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <FileCheck2 className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasData ? (
          <>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={data.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Applicants with all core documents"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-indigo to-chart-4"
                style={{ width: `${data.percent}%` }}
              />
            </div>
            <p className="text-sm text-foreground">
              <span className="font-medium">{data.withAll}</span>
              <span className="text-muted-foreground">
                {' '}
                of {data.total} applicants have all 5 core documents
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Medical · Passport · Birth cert · Educ cert · ID picture
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No document records for this academic year yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
