'use client';

import { ArrowUpRight, Umbrella } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { AttendanceDrillSheet } from '@/components/attendance/drills/attendance-drill-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import {
  AT_RISK_LEAVE_LIMIT,
  selectAtRiskVacationLeave,
  type VacationLeaveUsageRow,
} from '@/lib/attendance/drill';

const BADGE_BASE =
  'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

/**
 * VacationLeaveQuotaCard — students near or over their per-term vacation-leave
 * quota (KD #94). HFSE policy: 1 VL per term, no carry-forward. School-wide
 * default lives in `school_config.default_vl_allowance_per_term`; per-student
 * override on `students.vacation_leave_allowance_per_term`.
 *
 * Scope is one term (set by the page that mounts this card). Card opens the
 * drill sheet for the matching `vacation-leave-quota` target.
 */
export function VacationLeaveQuotaCard({
  data,
  ayCode,
  termId,
  termLabel,
}: {
  data: VacationLeaveUsageRow[];
  ayCode: string;
  termId: string;
  termLabel: string;
}) {
  const [open, setOpen] = React.useState(false);

  // At-risk = used > 0 AND (over quota OR remaining ≤ 0). With a 1-per-term
  // default this collapses to "anyone who took VL this term", which is
  // exactly what the registrar wants to see at a glance. Shared with the
  // dashboard CSV export (lib/attendance/dashboard-export.ts) via
  // lib/attendance/drill.ts so the two can't disagree on who counts.
  const atRisk = React.useMemo(() => selectAtRiskVacationLeave(data), [data]);

  const overCount = atRisk.filter((r) => r.isOverTermQuota).length;
  const atLimitCount = atRisk.length - overCount;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Vacation leave · {termLabel}
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Students at or over term quota
          </CardTitle>
          <CardAction className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              View all
            </Button>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-sky to-brand-indigo text-white shadow-brand-tile">
              <Umbrella className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="blocked" className={BADGE_BASE}>
              {overCount} over
            </Badge>
            <Badge variant="muted" className={BADGE_BASE}>
              {atLimitCount} at limit
            </Badge>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em]">
              {data.length} students total
            </span>
          </div>
          {atRisk.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              No students at or over the vacation-leave quota this term.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2">Student</th>
                  <th className="py-2">Section</th>
                  <th className="py-2 text-right">This term</th>
                  <th className="py-2 text-right">Remaining</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {atRisk.slice(0, AT_RISK_LEAVE_LIMIT).map((r) => (
                  <tr
                    key={r.studentSectionId}
                    className="border-b border-border/60"
                  >
                    <td className="py-2 font-medium text-foreground">
                      {r.studentName}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {r.sectionName}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {r.usedThisTerm}/{r.allowance}
                    </td>
                    <td
                      className={
                        'py-2 text-right font-mono tabular-nums ' +
                        (r.isOverTermQuota
                          ? 'text-destructive'
                          : r.remainingThisTerm <= 0
                            ? 'text-foreground'
                            : 'text-muted-foreground')
                      }
                    >
                      {r.remainingThisTerm}
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        href={`/attendance/students/${encodeURIComponent(r.studentNumber)}`}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        View
                        <ArrowUpRight className="size-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Counts EX entries marked as Vacation leave, scoped to {termLabel}.
            Unused days do not carry forward.
          </p>
        </CardContent>
      </Card>
      {open && (
        <AttendanceDrillSheet
          target="vacation-leave-quota"
          ayCode={ayCode}
          termId={termId}
          initialVacationLeave={data}
        />
      )}
    </Sheet>
  );
}
