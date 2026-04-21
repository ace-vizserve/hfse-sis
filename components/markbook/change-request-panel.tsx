import Link from 'next/link';
import { ArrowRight, CheckCircle2, Clock, MessageSquareWarning, XCircle } from 'lucide-react';

import type { ChangeRequestSummary } from '@/lib/markbook/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function ChangeRequestPanel({ summary }: { summary: ChangeRequestSummary }) {
  const { byStatus, total, avgDecisionHours, windowDays } = summary;
  const pendingDecision = byStatus.pending + byStatus.approved; // awaiting action

  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Compliance · Last {windowDays}d
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Grade change requests
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <MessageSquareWarning className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {total === 0 ? (
          <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
            <MessageSquareWarning className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">No recent change requests</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Post-lock edits filed in the last {windowDays} days will appear here.
            </p>
          </div>
        ) : (
          <>
            {/* Hero — total + avg decision time */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Filed
                </p>
                <p className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground">
                  {total}
                </p>
              </div>
              <div className="space-y-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Avg decision
                </p>
                <p className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground">
                  {avgDecisionHours != null ? `${avgDecisionHours}h` : '—'}
                </p>
              </div>
            </div>

            {/* Status breakdown bars */}
            <div className="space-y-2">
              <StatusRow
                label="Pending"
                count={byStatus.pending}
                total={total}
                icon={Clock}
                tint="bg-brand-amber"
              />
              <StatusRow
                label="Approved · awaiting apply"
                count={byStatus.approved}
                total={total}
                icon={CheckCircle2}
                tint="bg-chart-1"
              />
              <StatusRow
                label="Applied"
                count={byStatus.applied}
                total={total}
                icon={CheckCircle2}
                tint="bg-chart-5"
              />
              <StatusRow
                label="Rejected"
                count={byStatus.rejected}
                total={total}
                icon={XCircle}
                tint="bg-destructive"
              />
              <StatusRow
                label="Cancelled"
                count={byStatus.cancelled}
                total={total}
                icon={XCircle}
                tint="bg-muted-foreground"
              />
            </div>
          </>
        )}
      </CardContent>
      {total > 0 && (
        <CardFooter className="flex items-center justify-between border-t border-border px-6 py-3 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground tabular-nums">{pendingDecision}</span>{' '}
            awaiting action
          </span>
          <Link
            href="/markbook/change-requests"
            className="inline-flex items-center gap-1 font-medium text-foreground hover:text-brand-indigo-deep"
          >
            Open inbox
            <ArrowRight className="size-3" />
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}

function StatusRow({
  label,
  count,
  total,
  tint,
}: {
  label: string;
  count: number;
  total: number;
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums text-foreground">
          {count} <span className="text-muted-foreground">· {pct}%</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${tint}`}
          style={{ width: total > 0 ? `${(count / total) * 100}%` : '0%' }}
        />
      </div>
    </div>
  );
}
