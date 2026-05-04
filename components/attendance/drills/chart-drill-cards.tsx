'use client';

import * as React from 'react';

import { AttendanceDrillSheet } from '@/components/attendance/drills/attendance-drill-sheet';
import { DonutChart } from '@/components/dashboard/charts/donut-chart';
import { TrendChart } from '@/components/dashboard/charts/trend-chart';
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
import type {
  AttendanceEntryRow,
  CalendarDayRow,
  CompassionateUsageRow,
  SectionAttendanceRow,
  TopAbsentDrillRow,
} from '@/lib/attendance/drill';

type CommonProps = {
  ayCode: string;
  rangeFrom?: string;
  rangeTo?: string;
  initialEntries?: AttendanceEntryRow[];
  initialTopAbsent?: TopAbsentDrillRow[];
  initialSectionAttendance?: SectionAttendanceRow[];
  initialCalendar?: CalendarDayRow[];
  initialCompassionate?: CompassionateUsageRow[];
};

type DailyPoint = { x: string; y: number };

// ─── Daily attendance trend → daily-attendance-day ──────────────────────────

export function DailyAttendanceDrillCard({
  current,
  comparison,
  ayCode,
  rangeFrom,
  rangeTo,
  initialEntries,
}: CommonProps & { current: DailyPoint[]; comparison: DailyPoint[] | null }) {
  const [segment, setSegment] = React.useState<string | null>(null);

  // We expose a button-style prompt to drill into the latest day, since the
  // TrendChart doesn't natively click-on-segment. Real per-day click is wired
  // through the Tooltip-backing area, but as a pragmatic shortcut we surface a
  // dropdown of recent days.
  const recentDays = React.useMemo(() => current.slice(-14).reverse(), [current]);

  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Daily attendance
          </CardDescription>
          <CardTitle className="font-serif text-xl">% attended per day</CardTitle>
          <CardAction>
            <details className="group">
              <summary className="cursor-pointer list-none">
                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-muted">
                  Drill day
                </span>
              </summary>
              <div className="absolute z-10 mt-1 w-[180px] rounded-md border border-border bg-popover p-1 shadow-lg">
                {recentDays.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">No days in range.</p>
                ) : recentDays.map((d) => (
                  <button
                    key={d.x}
                    type="button"
                    onClick={() => setSegment(d.x)}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent"
                  >
                    <span className="tabular-nums">{d.x}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">{Math.round(d.y)}%</span>
                  </button>
                ))}
              </div>
            </details>
          </CardAction>
        </CardHeader>
        <CardContent>
          <TrendChart label="Attendance %" current={current} comparison={comparison} yFormat="percent" />
        </CardContent>
      </Card>
      {segment && (
        <AttendanceDrillSheet
          target="daily-attendance-day"
          segment={segment}
          ayCode={ayCode}
          initialScope="range"
          initialFrom={rangeFrom}
          initialTo={rangeTo}
          initialEntries={initialEntries}
        />
      )}
    </Sheet>
  );
}

// ─── EX reason donut → ex-reason ────────────────────────────────────────────

export function ExReasonDrillCard({
  data,
  ayCode,
  rangeFrom,
  rangeTo,
  initialEntries,
}: CommonProps & { data: { name: string; value: number }[] }) {
  const [segment, setSegment] = React.useState<string | null>(null);
  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Excused reason mix
          </CardDescription>
          <CardTitle className="font-serif text-xl">Why absences are excused</CardTitle>
        </CardHeader>
        <CardContent>
          {data.length > 0 ? (
            <DonutChart
              data={data}
              centerValue={data.reduce((s, d) => s + d.value, 0)}
              centerLabel="Total EX"
              onSegmentClick={setSegment}
            />
          ) : (
            <div className="flex h-40 items-center justify-center text-xs text-ink-4">
              No excused absences in range.
            </div>
          )}
        </CardContent>
      </Card>
      {segment && (
        <AttendanceDrillSheet
          target="ex-reason"
          segment={segment}
          ayCode={ayCode}
          initialScope="range"
          initialFrom={rangeFrom}
          initialTo={rangeTo}
          initialEntries={initialEntries}
        />
      )}
    </Sheet>
  );
}

// ─── Day-type donut → day-type ──────────────────────────────────────────────

export function DayTypeDrillCard({
  data,
  ayCode,
  rangeFrom,
  rangeTo,
  initialCalendar,
}: CommonProps & { data: { name: string; value: number }[] }) {
  const [segment, setSegment] = React.useState<string | null>(null);
  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Day-type distribution
          </CardDescription>
          <CardTitle className="font-serif text-xl">Calendar make-up of range</CardTitle>
        </CardHeader>
        <CardContent>
          {data.length > 0 ? (
            <DonutChart
              data={data}
              centerValue={data.reduce((s, d) => s + d.value, 0)}
              centerLabel="Days"
              onSegmentClick={setSegment}
            />
          ) : (
            <div className="flex h-40 items-center justify-center text-xs text-ink-4">No calendar data in range.</div>
          )}
        </CardContent>
      </Card>
      {segment && (
        <AttendanceDrillSheet
          target="day-type"
          segment={segment}
          ayCode={ayCode}
          initialScope="range"
          initialFrom={rangeFrom}
          initialTo={rangeTo}
          initialCalendar={initialCalendar}
        />
      )}
    </Sheet>
  );
}

// ─── Top-absent table — adopted CSV button + click to drill ─────────────────

export function TopAbsentDrillCard({
  data,
  ayCode,
  rangeFrom,
  rangeTo,
  initialTopAbsent,
}: CommonProps & { data: TopAbsentDrillRow[] }) {
  const [open, setOpen] = React.useState(false);
  const csvHref = `/api/attendance/drill/top-absent?ay=${ayCode}&scope=range&from=${rangeFrom ?? ''}&to=${rangeTo ?? ''}&format=csv`;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Needs attention
          </CardDescription>
          <CardTitle className="font-serif text-xl">Top-absent students</CardTitle>
          <CardAction className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={csvHref} download>Export CSV</a>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              Open drill
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {data.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-ink-4">
              No absences in range.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-ink-4">
                  <th className="py-2">Student</th>
                  <th className="py-2">Section</th>
                  <th className="py-2 text-right">Absences</th>
                  <th className="py-2 text-right">Lates</th>
                </tr>
              </thead>
              <tbody>
                {data.slice(0, 10).map((r) => (
                  <tr key={r.studentSectionId} className="border-b border-border/60">
                    <td className="py-2 font-medium text-foreground">{r.studentName}</td>
                    <td className="py-2 text-ink-4">{r.sectionName}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{r.absences}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-ink-4">{r.lates}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      {open && (
        <AttendanceDrillSheet
          target="top-absent"
          ayCode={ayCode}
          initialScope="range"
          initialFrom={rangeFrom}
          initialTo={rangeTo}
          initialTopAbsent={initialTopAbsent}
        />
      )}
    </Sheet>
  );
}
