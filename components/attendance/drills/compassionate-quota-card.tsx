'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, Heart } from 'lucide-react';

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
import type { CompassionateUsageRow } from '@/lib/attendance/drill';

const BADGE_BASE = 'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

/**
 * CompassionateQuotaCard — top students approaching or over their compassionate
 * leave quota. Surfaces only at-risk rows (used >= 1 day, prioritising over-
 * quota). Clicking the card body opens the full quota drill.
 *
 * Quota allowance lives on `students.urgent_compassionate_allowance` (default
 * 5 per year per HFSE policy). EX entries with `ex_reason='compassionate'`
 * count toward used.
 */
export function CompassionateQuotaCard({
  data,
  ayCode,
}: {
  data: CompassionateUsageRow[];
  ayCode: string;
}) {
  const [open, setOpen] = React.useState(false);

  // At-risk = used > 0 AND (over quota OR remaining ≤ 1).
  const atRisk = React.useMemo(
    () =>
      data
        .filter((r) => r.used > 0 && (r.isOverQuota || r.remaining <= 1))
        .sort((a, b) => {
          if (a.isOverQuota !== b.isOverQuota) return a.isOverQuota ? -1 : 1;
          return b.used - a.used;
        }),
    [data],
  );

  const overCount = atRisk.filter((r) => r.isOverQuota).length;
  const nearCount = atRisk.length - overCount;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Compassionate leave
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Students near or over quota
          </CardTitle>
          <CardAction className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              View all
            </Button>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Heart className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Severity strip */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="blocked" className={BADGE_BASE}>
              {overCount} over
            </Badge>
            <Badge variant="muted" className={BADGE_BASE}>
              {nearCount} near
            </Badge>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em]">
              {data.length} students total
            </span>
          </div>
          {atRisk.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              No students near or over the compassionate-leave quota.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2">Student</th>
                  <th className="py-2">Section</th>
                  <th className="py-2 text-right">Used</th>
                  <th className="py-2 text-right">Remaining</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {atRisk.slice(0, 8).map((r) => (
                  <tr key={r.studentSectionId} className="border-b border-border/60">
                    <td className="py-2 font-medium text-foreground">{r.studentName}</td>
                    <td className="py-2 text-muted-foreground">{r.sectionName}</td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {r.used}/{r.allowance}
                    </td>
                    <td
                      className={
                        'py-2 text-right font-mono tabular-nums ' +
                        (r.isOverQuota
                          ? 'text-destructive'
                          : r.remaining <= 1
                            ? 'text-foreground'
                            : 'text-muted-foreground')
                      }
                    >
                      {r.remaining}
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
        </CardContent>
      </Card>
      {open && (
        <AttendanceDrillSheet
          target="compassionate-quota"
          ayCode={ayCode}
          initialScope="ay"
          initialCompassionate={data}
        />
      )}
    </Sheet>
  );
}
