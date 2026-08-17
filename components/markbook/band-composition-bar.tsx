import { GRADE_BAND_FILL } from '@/components/markbook/grade-band-colors';
import {
  BAND_DISPLAY_ORDER,
  bandTotal,
  type BandCounts,
} from '@/lib/markbook/academic-overview-compute';

// A thin five-segment bar showing how a group's students are spread across the
// mastery bands, sized to sit inside a table cell.
//
// CUSTOM, deliberately (design system §5 step 5). Two existing primitives were
// checked first and neither fits: `insights/bento/segmented-bar` is a
// full-width partition with a tick row and a detail list beneath it, and
// `insights/bento/bar-stack` is a multi-column panel. Both own far more layout
// than a table row can give them.
//
// The tint comes from GRADE_BAND_FILL, the same map the grade-distribution
// chart and this page's donut read, so the legend documents all three (09a
// §10.2). Segments are ordered best-to-worst, left to right.

export function BandCompositionBar({
  bands,
  className,
}: {
  bands: BandCounts;
  className?: string;
}) {
  const total = bandTotal(bands);
  if (total === 0) {
    return <span className="text-muted-foreground">&ndash;</span>;
  }

  // A plain-English description of the whole bar, so a screen reader gets the
  // composition rather than five unlabelled boxes.
  const description = BAND_DISPLAY_ORDER.filter((b) => bands[b.key] > 0)
    .map((b) => `${bands[b.key]} ${b.label.toLowerCase()}`)
    .join(', ');

  return (
    <span
      className={
        'flex h-2.5 min-w-32 overflow-hidden rounded-full bg-muted ' +
        (className ?? '')
      }
      role="img"
      aria-label={description}
      title={description}
    >
      {BAND_DISPLAY_ORDER.map((band) => {
        const count = bands[band.key];
        if (count === 0) return null;
        return (
          <span
            key={band.key}
            className="block h-full"
            style={{
              width: `${(count / total) * 100}%`,
              background: GRADE_BAND_FILL[band.key],
            }}
          />
        );
      })}
    </span>
  );
}

// No separate legend component lives here on purpose. The school-wide donut
// (components/dashboard/charts/donut-chart) renders its own legend from the
// same GRADE_BAND_FILL colours, so that legend is the single key documenting
// both it and every spread bar above. A second, differently-ordered legend
// would be two keys for one colour map (09a §10.4).
