import {
  AT_RISK_ATTENDANCE_THRESHOLD_PCT,
  type OverviewAttendanceTermRow,
  type OverviewTermRow,
} from '@/lib/markbook/academic-overview-compute';

// One measurement across the year's terms — used twice, for grades and for
// attendance.
//
// CUSTOM, deliberately (design system §5 step 5). Two things the shared
// recharts wrappers don't express, and both are the point of this chart:
//   1. Terms with no readings yet must still appear on the axis, unplotted, as
//      a dashed run — so a year in progress reads as unfinished rather than as
//      a cliff or a short line.
//   2. A term is labelled with its STATUS, not just its number.
// It is also four points at most, and pulling recharts (a dynamic client chunk)
// for four points is disproportionate. Plain SVG renders on the server with no
// client JavaScript at all.
//
// Both charts keep the SAME 60–100 axis. Attendance sits at 98-point-something
// school-wide, so a zoomed axis would turn a 0.8-point move into a dramatic
// climb — the same exaggeration that got the four-band attendance donut cut.
// The reference line does the work instead: it puts the at-risk cut-off on the
// chart, so "well clear of it" is what you read.
//
// Colour comes from tokens only (Hard Rule #7) via CSS classes, because `var()`
// inside an SVG presentation attribute is not reliably supported.

const VIEW_W = 460;
const PLOT_TOP = 30;
const PLOT_BOTTOM = 190;
const AXIS_X = 52;
const RIGHT_PAD = 24;
/** Grades are transmuted into 60–100, so the axis starts where marks start. */
const Y_MIN = 60;
const Y_MAX = 100;
const GRID_LINES = [100, 90, 80, 70, 60];

const STATUS_CAPTION: Record<OverviewTermRow['status'], string | null> = {
  completed: null,
  in_progress: 'In progress',
  upcoming: 'Not started',
};

function yFor(value: number): number {
  const clamped = Math.max(Y_MIN, Math.min(Y_MAX, value));
  const ratio = (clamped - Y_MIN) / (Y_MAX - Y_MIN);
  return PLOT_BOTTOM - ratio * (PLOT_BOTTOM - PLOT_TOP);
}

type TrendPoint = {
  key: string;
  termNumber: number;
  label: string;
  status: OverviewTermRow['status'];
  value: number | null;
};

/** A named cut-off drawn across the plot — the at-risk line, not a data series. */
type ReferenceLine = { value: number; label: string };

function TrendChart({
  points: rows,
  formatValue,
  legendPlotted,
  legendMissing,
  referenceLine,
  ariaUnit,
}: {
  points: TrendPoint[];
  formatValue: (value: number) => string;
  legendPlotted: string;
  legendMissing: string;
  referenceLine?: ReferenceLine;
  /** Read out after each value, e.g. "%", so the caption is not bare numbers. */
  ariaUnit?: string;
}) {
  if (rows.length === 0) return null;

  const usableWidth = VIEW_W - AXIS_X - RIGHT_PAD;
  const step = usableWidth / (rows.length + 1);
  const points = rows.map((row, i) => ({
    row,
    // The stored label is "Term 1 — AY2026". At four across a 460-unit axis
    // those collide into an unreadable run, and the academic year is already
    // stated twice above the chart — so the axis carries the term alone.
    axisLabel: `Term ${row.termNumber}`,
    x: AXIS_X + step * (i + 1),
    y: row.value == null ? null : yFor(row.value),
  }));

  const plotted = points.filter(
    (p): p is (typeof points)[number] & { y: number } => p.y != null
  );
  // The dashed run carries on from the last real value at that height — it is
  // a "no reading yet" line, not a prediction, so it never changes level.
  const lastPlotted = plotted[plotted.length - 1];

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${VIEW_W} 250`}
        className="block h-auto w-full [&_.axis]:fill-muted-foreground [&_.grid]:stroke-border [&_.sub]:fill-muted-foreground [&_.val]:fill-foreground [&_.xlab]:fill-muted-foreground"
        role="img"
        aria-label={rows
          .map(
            (r) =>
              `${r.label}: ${r.value == null ? 'nothing recorded yet' : `${formatValue(r.value)}${ariaUnit ?? ''}`}`
          )
          .join('. ')}
      >
        <g className="grid">
          {GRID_LINES.filter((value) => value !== referenceLine?.value).map(
            (value) => (
              <line
                key={value}
                x1={AXIS_X}
                y1={yFor(value)}
                x2={VIEW_W - RIGHT_PAD + 8}
                y2={yFor(value)}
                strokeWidth={1}
              />
            )
          )}
        </g>
        <g className="axis font-mono text-[11px]" textAnchor="end">
          {GRID_LINES.map((value) => (
            <text key={value} x={AXIS_X - 8} y={yFor(value) + 4}>
              {value}
            </text>
          ))}
        </g>

        {/* The cut-off, drawn over the grid it replaces so it reads as a rule
            rather than as one more gridline. */}
        {referenceLine && (
          <>
            <line
              x1={AXIS_X}
              y1={yFor(referenceLine.value)}
              x2={VIEW_W - RIGHT_PAD + 8}
              y2={yFor(referenceLine.value)}
              className="stroke-destructive/50"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            <text
              x={VIEW_W - RIGHT_PAD + 8}
              y={yFor(referenceLine.value) - 7}
              textAnchor="end"
              className="fill-destructive font-mono text-[10px] uppercase tracking-wider"
            >
              {referenceLine.label}
            </text>
          </>
        )}

        {/* Solid run through the terms that have readings. */}
        {plotted.length > 1 && (
          <polyline
            points={plotted.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            className="stroke-primary"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Dashed run across the terms still to come. */}
        {lastPlotted &&
          points
            .filter((p) => p.y == null && p.x > lastPlotted.x)
            .map((p, i, arr) => {
              const prev = i === 0 ? lastPlotted : arr[i - 1];
              return (
                <line
                  key={p.row.key}
                  x1={prev.x}
                  y1={lastPlotted.y}
                  x2={p.x}
                  y2={lastPlotted.y}
                  className="stroke-border"
                  strokeWidth={2.5}
                  strokeDasharray="5 6"
                  strokeLinecap="round"
                />
              );
            })}

        {points.map((p) =>
          p.y == null ? (
            <circle
              key={p.row.key}
              cx={p.x}
              cy={lastPlotted ? lastPlotted.y : yFor(Y_MIN)}
              r={4}
              className="fill-card stroke-border"
              strokeWidth={2}
            />
          ) : (
            <circle
              key={p.row.key}
              cx={p.x}
              cy={p.y}
              r={4}
              className="fill-primary stroke-card"
              strokeWidth={2}
            />
          )
        )}

        <g className="val font-mono text-xs font-semibold" textAnchor="middle">
          {plotted.map((p) => (
            <text key={p.row.key} x={p.x} y={p.y - 13}>
              {formatValue(p.row.value as number)}
            </text>
          ))}
        </g>
        <g className="xlab text-xs" textAnchor="middle">
          {points.map((p) => (
            <text key={p.row.key} x={p.x} y={PLOT_BOTTOM + 24}>
              {p.axisLabel}
            </text>
          ))}
        </g>
        <g
          className="sub font-mono text-[10px] uppercase tracking-wider"
          textAnchor="middle"
        >
          {points.map((p) => {
            const caption = STATUS_CAPTION[p.row.status];
            return caption ? (
              <text key={p.row.key} x={p.x} y={PLOT_BOTTOM + 40}>
                {caption}
              </text>
            ) : null;
          })}
        </g>
      </svg>

      <figcaption className="mt-3 flex flex-wrap gap-5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="h-[3px] w-5 rounded-full bg-primary" />
          {legendPlotted}
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="w-5 border-t-[3px] border-dashed border-border"
          />
          {legendMissing}
        </span>
        {referenceLine && (
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className="w-5 border-t-[3px] border-dashed border-destructive/50"
            />
            {referenceLine.label}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

export function TermTrendChart({ terms }: { terms: OverviewTermRow[] }) {
  return (
    <TrendChart
      points={terms.map((term) => ({
        key: term.termId,
        termNumber: term.termNumber,
        label: term.label,
        status: term.status,
        value: term.average,
      }))}
      formatValue={(value) => value.toFixed(1)}
      legendPlotted="Terms with grades"
      legendMissing="No grades yet"
    />
  );
}

export function AttendanceTrendChart({
  terms,
}: {
  terms: OverviewAttendanceTermRow[];
}) {
  return (
    <TrendChart
      points={terms.map((term) => ({
        key: term.termId,
        termNumber: term.termNumber,
        label: term.label,
        status: term.status,
        value: term.rate,
      }))}
      formatValue={(value) => `${value.toFixed(1)}%`}
      ariaUnit=""
      legendPlotted="Terms with a register"
      legendMissing="Nothing recorded yet"
      referenceLine={{
        value: AT_RISK_ATTENDANCE_THRESHOLD_PCT,
        label: `${AT_RISK_ATTENDANCE_THRESHOLD_PCT}% line`,
      }}
    />
  );
}
