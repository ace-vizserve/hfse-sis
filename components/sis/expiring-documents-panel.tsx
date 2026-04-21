import Link from 'next/link';
import { AlertTriangle, ArrowRight, CalendarClock } from 'lucide-react';

import type { ExpiringDocRow } from '@/lib/sis/dashboard';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function ExpiringDocumentsPanel({
  rows,
  ayCode,
  windowDays = 60,
  studentHrefBase = '/records/students',
  viewAllHref,
}: {
  rows: ExpiringDocRow[];
  ayCode: string;
  windowDays?: number;
  studentHrefBase?: string;
  viewAllHref?: string;
}) {
  const empty = rows.length === 0;
  const expired = rows.filter((r) => r.daysUntilExpiry < 0).length;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Documents · Expiring soon
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Renewals in the next {windowDays} days
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <CalendarClock className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-0 p-0">
        {empty ? (
          <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-center">
            <CalendarClock className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">Nothing expiring soon</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              No passports or passes expire in the next {windowDays} days.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {rows.map((r) => (
              <li key={`${r.enroleeNumber}-${r.slotKey}`}>
                <Link
                  href={`${studentHrefBase}/${r.enroleeNumber}?ay=${ayCode}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{r.studentName}</p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {r.slotLabel} · {r.expiryDate}
                    </p>
                  </div>
                  <DaysBadge days={r.daysUntilExpiry} />
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {!empty && (
        <CardFooter className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
          {expired > 0 ? (
            <span className="flex items-center gap-1 font-medium text-destructive">
              <AlertTriangle className="size-3" />
              {expired} already expired
            </span>
          ) : (
            <span>Showing soonest {rows.length}</span>
          )}
          <Link
            href={viewAllHref ?? `/records/students?ay=${ayCode}`}
            className="inline-flex items-center gap-1 font-medium text-foreground hover:text-brand-indigo-deep"
          >
            All students
            <ArrowRight className="size-3" />
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}

function DaysBadge({ days }: { days: number }) {
  if (days < 0) {
    return (
      <Badge className="h-6 border-destructive/40 bg-destructive/10 text-destructive">
        Expired · {Math.abs(days)}d ago
      </Badge>
    );
  }
  if (days <= 14) {
    return (
      <Badge className="h-6 border-destructive/40 bg-destructive/10 text-destructive tabular-nums">
        {days}d
      </Badge>
    );
  }
  if (days <= 30) {
    return (
      <Badge className="h-6 border-brand-indigo-soft bg-accent text-brand-indigo-deep tabular-nums">
        {days}d
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="h-6 tabular-nums">
      {days}d
    </Badge>
  );
}
