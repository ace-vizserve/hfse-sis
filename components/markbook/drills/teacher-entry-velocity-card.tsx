'use client';

import * as React from 'react';
import { Users } from 'lucide-react';

import { MarkbookDrillSheet } from '@/components/markbook/drills/markbook-drill-sheet';
import { ComparisonBarChart } from '@/components/dashboard/charts/comparison-bar-chart';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import type { TeacherVelocityRow } from '@/lib/markbook/drill';

/**
 * TeacherEntryVelocityCard — registrar+ only chart of grade entries written
 * per teacher across the AY. Clicking a bar drills into that teacher's
 * entries (lazy-fetched since entries aren't pre-fetched at the page level).
 *
 * The card is privacy-gated: only registrar+ sees it (gated by canSeeAdmin
 * on the page). Teacher emails come from the shared `getTeacherEmailMap`
 * cache; rows without a resolved email show the user-id stub.
 */
export function TeacherEntryVelocityCard({
  data,
  ayCode,
}: {
  data: TeacherVelocityRow[];
  ayCode: string;
}) {
  const [openTeacher, setOpenTeacher] = React.useState<string | null>(null);

  const chartData = React.useMemo(
    () =>
      data.map((r) => ({
        category: r.teacherEmail ?? r.teacherUserId.slice(0, 8),
        current: r.entryCount,
      })),
    [data],
  );

  const totalEntries = data.reduce((sum, r) => sum + r.entryCount, 0);
  const empty = data.length === 0;

  return (
    <Sheet open={!!openTeacher} onOpenChange={(o) => !o && setOpenTeacher(null)}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Teacher activity
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Grade entries by teacher
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Users className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {empty ? (
            <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
              <Users className="size-6 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">No teacher attribution yet</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Entries appear once teachers are assigned to subjects via teacher_assignments.
              </p>
            </div>
          ) : (
            <>
              <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {totalEntries.toLocaleString('en-SG')} entries · {data.length}{' '}
                {data.length === 1 ? 'teacher' : 'teachers'}
              </p>
              <ComparisonBarChart
                data={chartData}
                orientation="horizontal"
                height={Math.min(420, Math.max(220, data.length * 26))}
                yFormat="number"
                onSegmentClick={setOpenTeacher}
              />
            </>
          )}
        </CardContent>
      </Card>
      {openTeacher && (
        <MarkbookDrillSheet
          target="teacher-entry-velocity"
          segment={openTeacher}
          ayCode={ayCode}
          initialScope="ay"
        />
      )}
    </Sheet>
  );
}
