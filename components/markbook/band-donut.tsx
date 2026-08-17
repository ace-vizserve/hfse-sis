import { GRADE_BAND_FILL } from '@/components/markbook/grade-band-colors';
import {
  BAND_DISPLAY_ORDER,
  bandTotal,
  type BandCounts,
} from '@/lib/markbook/academic-overview-compute';

// The school's spread across the five mastery bands.
//
// CUSTOM rather than the shared `DonutChart` (design system §5 step 5). That
// wrapper always renders its own legend, sorted by slice size — which is right
// for unordered categories and wrong here: these bands are a ladder, and a key
// that lists them biggest-first stops reading as one. It also pulls recharts
// into the page for a five-slice ring that never animates or responds to a
// cursor.
//
// Colours come from GRADE_BAND_FILL, the same map the spread bars in both
// tables use, so this ring and every bar above it share one key (09a §10.2).

const RADIUS = 62;
const STROKE = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const BOX = (RADIUS + STROKE / 2) * 2;

export function BandDonut({ bands }: { bands: BandCounts }) {
  const total = bandTotal(bands);

  let offset = 0;
  const arcs = BAND_DISPLAY_ORDER.map((band) => {
    const count = bands[band.key];
    const length = total > 0 ? (count / total) * CIRCUMFERENCE : 0;
    const arc = { band, count, length, offset };
    offset += length;
    return arc;
  });

  return (
    <div className="flex flex-wrap items-center gap-8">
      <div className="relative shrink-0" style={{ width: BOX, height: BOX }}>
        <svg
          viewBox={`0 0 ${BOX} ${BOX}`}
          className="size-full -rotate-90"
          role="img"
          aria-label={arcs
            .filter((a) => a.count > 0)
            .map((a) => `${a.band.label}: ${a.count}`)
            .join(', ')}
        >
          <circle
            cx={BOX / 2}
            cy={BOX / 2}
            r={RADIUS}
            fill="none"
            className="stroke-muted"
            strokeWidth={STROKE}
          />
          {arcs.map((arc) =>
            arc.count === 0 ? null : (
              <circle
                key={arc.band.key}
                cx={BOX / 2}
                cy={BOX / 2}
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                stroke={GRADE_BAND_FILL[arc.band.key]}
                strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
                strokeDashoffset={-arc.offset}
              />
            )
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground">
            {total}
          </span>
          <span className="mt-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            students
          </span>
        </div>
      </div>

      <BandLegend bands={bands} />
    </div>
  );
}

/** The key for the ring and for every spread bar on the page. Ladder order. */
export function BandLegend({ bands }: { bands: BandCounts }) {
  const total = bandTotal(bands);
  return (
    <ul className="flex min-w-56 flex-1 flex-col gap-3">
      {BAND_DISPLAY_ORDER.map((band) => {
        const count = bands[band.key];
        return (
          <li key={band.key} className="flex items-center gap-3 text-sm">
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-sm"
              style={{ background: GRADE_BAND_FILL[band.key] }}
            />
            <span className="flex-1">
              <span className="block font-medium text-foreground">
                {band.label}
              </span>
              <span className="block text-xs text-muted-foreground">
                {band.range}
              </span>
            </span>
            <span className="font-semibold tabular-nums text-foreground">
              {count}
            </span>
            <span className="w-12 text-right font-mono text-xs text-muted-foreground">
              {total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '—'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
