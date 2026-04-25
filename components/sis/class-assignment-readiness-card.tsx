'use client';

import * as React from 'react';
import Link from 'next/link';
import { UserPlus2 } from 'lucide-react';

import { RecordsDrillSheet } from '@/components/sis/drills/records-drill-sheet';
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
import type { ClassAssignmentReadinessRow } from '@/lib/sis/dashboard';

const BADGE_BASE = 'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

/**
 * ClassAssignmentReadinessCard — surfaces students with applicationStatus =
 * Enrolled but no AY-current section assignment. The gap between "enrolled"
 * and "fully placed in a class". Actionable for registrars during the
 * section-assignment workflow.
 *
 * Severity: students unassigned ≥14 days = overdue (destructive); newer
 * gaps = recent (muted). Top 8 visible; "View all" opens the drill.
 */
export function ClassAssignmentReadinessCard({
  data,
  ayCode,
}: {
  data: ClassAssignmentReadinessRow[];
  ayCode: string;
}) {
  const [open, setOpen] = React.useState(false);

  const overdue = data.filter((r) => (r.daysSinceEnrollment ?? 0) >= 14).length;
  const recent = data.length - overdue;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Class assignment
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Enrolled but unassigned
          </CardTitle>
          <CardAction className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              View all
            </Button>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <UserPlus2 className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="blocked" className={BADGE_BASE}>
              {overdue} overdue
            </Badge>
            <Badge variant="muted" className={BADGE_BASE}>
              {recent} recent
            </Badge>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em]">
              {data.length} unassigned
            </span>
          </div>

          {data.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              All enrolled students are assigned to a section.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2">Student</th>
                  <th className="py-2">Level</th>
                  <th className="py-2 text-right">Days since enrol</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.slice(0, 8).map((r) => (
                  <tr key={r.enroleeNumber} className="border-b border-border/60">
                    <td className="py-2 font-medium text-foreground">{r.fullName}</td>
                    <td className="py-2 text-muted-foreground">{r.level ?? '—'}</td>
                    <td
                      className={
                        'py-2 text-right font-mono tabular-nums ' +
                        ((r.daysSinceEnrollment ?? 0) >= 14
                          ? 'text-destructive'
                          : 'text-muted-foreground')
                      }
                    >
                      {r.daysSinceEnrollment ?? '—'}
                    </td>
                    <td className="py-2 text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href="/sis/sections">Assign</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      {open && (
        <RecordsDrillSheet
          target="class-assignment-readiness"
          ayCode={ayCode}
          initialScope="ay"
        />
      )}
    </Sheet>
  );
}
