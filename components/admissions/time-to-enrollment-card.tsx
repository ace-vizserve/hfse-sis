import { Clock } from 'lucide-react';

import type { TimeToEnrollment } from '@/lib/admissions/dashboard';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function TimeToEnrollmentCard({ data }: { data: TimeToEnrollment }) {
  const hasData = data.sampleSize > 0;
  return (
    <Card className="@container/card bg-gradient-to-t from-primary/5 to-card shadow-xs">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Avg time to enrol
        </CardDescription>
        <CardTitle className="flex items-baseline gap-2 font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {hasData ? data.avgDays : '—'}
          {hasData && (
            <span className="font-sans text-sm font-medium text-muted-foreground">
              days
            </span>
          )}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Clock className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">
          {hasData
            ? `Based on ${data.sampleSize} enrolled ${data.sampleSize === 1 ? 'student' : 'students'}`
            : 'No enrolments yet this AY'}
        </p>
        <p className="text-xs text-muted-foreground">
          Submission → enrolment, rounded to whole days
        </p>
      </CardFooter>
    </Card>
  );
}
