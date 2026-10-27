import { TrendChart } from '@/components/dashboard/charts/trend-chart';
import {
  AT_RISK_ATTENDANCE_THRESHOLD_PCT,
  type OverviewAttendanceTermRow,
  type OverviewTermRow,
} from '@/lib/markbook/academic-overview-compute';

// One measurement across the year's terms — used twice, for grades and for
// attendance — drawn with the app's shared recharts `TrendChart`.
//
// Only terms with a reading are plotted. A term still being taught is the
// chart's provisional last point (dashed grey, hollow), so a year in progress
// does not read as a real rise or fall; terms not started yet are named under
// the chart instead of being plotted at a made-up height.
//
// Both charts keep the SAME 60–100 axis. Attendance sits at 98-point-something
// school-wide, so a zoomed axis would turn a 0.8-point move into a dramatic
// climb. The 80% reference line does the work instead.

const DOMAIN: [number, number] = [60, 100];
const TICKS = [60, 70, 80, 90, 100];

type TermReading = {
  termNumber: number;
  status: OverviewTermRow['status'];
  value: number | null;
};

function TermTrend({
  label,
  terms,
  yFormat,
  referenceLine,
  emptyText,
}: {
  label: string;
  terms: TermReading[];
  yFormat?: 'percent1';
  referenceLine?: { value: number; label: string };
  emptyText: string;
}) {
  const plotted = terms.filter(
    (t): t is TermReading & { value: number } => t.value != null
  );
  const notStarted = terms.filter((t) => t.value == null);
  const last = plotted[plotted.length - 1];

  if (plotted.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }

  return (
    <figure className="m-0">
      <TrendChart
        label={label}
        current={plotted.map((t) => ({
          x: `Term ${t.termNumber}`,
          // One decimal, as the term table prints it.
          y: Math.round(t.value * 10) / 10,
        }))}
        height={240}
        domain={DOMAIN}
        ticks={TICKS}
        yFormat={yFormat}
        showValues
        lastPointProvisional={last?.status === 'in_progress'}
        referenceLine={referenceLine}
      />
      {notStarted.length > 0 && (
        <figcaption className="mt-2 text-xs text-muted-foreground">
          {notStarted.map((t) => `Term ${t.termNumber}`).join(', ')}:{' '}
          {emptyText.toLowerCase()}
        </figcaption>
      )}
    </figure>
  );
}

export function TermTrendChart({ terms }: { terms: OverviewTermRow[] }) {
  return (
    <TermTrend
      label="Average grade"
      terms={terms.map((t) => ({
        termNumber: t.termNumber,
        status: t.status,
        value: t.average,
      }))}
      emptyText="No grades yet"
    />
  );
}

export function AttendanceTrendChart({
  terms,
}: {
  terms: OverviewAttendanceTermRow[];
}) {
  return (
    <TermTrend
      label="Attendance"
      terms={terms.map((t) => ({
        termNumber: t.termNumber,
        status: t.status,
        value: t.rate,
      }))}
      yFormat="percent1"
      referenceLine={{
        value: AT_RISK_ATTENDANCE_THRESHOLD_PCT,
        label: `${AT_RISK_ATTENDANCE_THRESHOLD_PCT}% line`,
      }}
      emptyText="Nothing recorded yet"
    />
  );
}
