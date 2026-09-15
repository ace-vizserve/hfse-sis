'use client';

import { LineChart } from 'lucide-react';
import * as React from 'react';

import { AttendanceDrillSheet } from '@/components/attendance/drills/attendance-drill-sheet';
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
import type { SectionAttendanceRow } from '@/lib/attendance/drill';

/**
 * AttendanceBySectionCard — horizontal bar chart of attendance % per section.
 * Bars sort ascending so the worst-performing sections surface first. Clicking
 * a bar opens the `attendance-by-section` drill scoped to that section.
 *
 * Data is pre-fetched server-side in `buildAllRowSets()` and passed in;
 * lazy-fetch on click via the existing `/api/attendance/drill` endpoint.
 */
export function AttendanceBySectionCard({
  data,
  ayCode,
  rangeFrom,
  rangeTo,
}: {
  data: SectionAttendanceRow[];
  ayCode: string;
  rangeFrom?: string;
  rangeTo?: string;
}) {
  const [openSection, setOpenSection] = React.useState<string | null>(null);
  const empty = data.length === 0;
  const chartData = data.map((r) => ({
    category: r.sectionName,
    current: r.attendancePct,
  }));

  // Find the section row by name to thread the segment through cleanly.
  // Section name is unique within an AY so this is deterministic.
  return (
    <Sheet
      open={!!openSection}
      onOpenChange={(o) => !o && setOpenSection(null)}
    >
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Attendance by section
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Where attendance lags
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <LineChart className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {empty ? (
            <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
              <LineChart className="size-6 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">
                No section data
              </p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Bars appear once attendance is encoded for sections in this
                range.
              </p>
            </div>
          ) : (
            <ComparisonBarChart
              data={chartData}
              orientation="horizontal"
              height={Math.min(620, Math.max(420, data.length * 26))}
              yFormat="percent"
              onSegmentClick={setOpenSection}
            />
          )}
        </CardContent>
      </Card>
      {openSection && (
        <AttendanceDrillSheet
          target="attendance-by-section"
          segment={openSection}
          ayCode={ayCode}
          initialFrom={rangeFrom}
          initialTo={rangeTo}
          initialSectionAttendance={data}
        />
      )}
    </Sheet>
  );
}
