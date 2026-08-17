'use client';

import { GRADE_BAND_FILL } from '@/components/markbook/grade-band-colors';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  BAND_DISPLAY_ORDER,
  bandTotal,
  type BandCounts,
} from '@/lib/markbook/academic-overview-compute';

// A five-segment bar showing how a group's students are spread across the
// mastery bands, sized to sit inside a table cell. Clicking it opens the
// breakdown — the same shape as the admissions pipeline strip
// (components/sis/pipeline-strip.tsx): segment fill and popover swatch read the
// SAME map, so the popover is a real key and cannot drift (09a §10.2).
//
// It is a popover rather than a hover tooltip for the reason the pipeline strip
// is: the numbers behind these segments exist nowhere else on the page at this
// grain, and content you have to keep hovering to read is content you cannot
// compare against the row beside it.
//
// CUSTOM, deliberately (design system §5 step 5). Two existing primitives were
// checked first and neither fits: `insights/bento/segmented-bar` is a
// full-width partition with a tick row and a detail list beneath it, and
// `insights/bento/bar-stack` is a multi-column panel. Both own far more layout
// than a table row can give them.

const BASIS_NOTE = {
  overall:
    'Each student is counted once, by their average across every subject they take.',
  subject:
    'Each student is counted once, by their average in this subject alone.',
} as const;

export function BandCompositionBar({
  bands,
  title,
  basis = 'overall',
  className,
}: {
  bands: BandCounts;
  /** The group this bar describes, e.g. "Primary One" or "Mathematics". */
  title: string;
  /** What a student's average was taken over — changes one line of copy. */
  basis?: 'overall' | 'subject';
  className?: string;
}) {
  const total = bandTotal(bands);
  if (total === 0) {
    return <span className="text-muted-foreground">&ndash;</span>;
  }

  // A plain-English description of the whole bar, so a screen reader gets the
  // composition rather than five unlabelled boxes — and so the trigger's
  // accessible name says what opening it will show.
  const description = BAND_DISPLAY_ORDER.filter((b) => bands[b.key] > 0)
    .map((b) => `${bands[b.key]} ${b.label.toLowerCase()}`)
    .join(', ');

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* The paint stays 10px so the table row keeps its rhythm, but the
            button is 24px tall — a 10px click target is not one. */}
        <button
          type="button"
          aria-label={`${title}: ${description}. Open the breakdown.`}
          className={
            'group/bar flex h-6 w-full min-w-32 items-center rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-ring ' +
            (className ?? '')
          }
        >
          <span className="flex h-2.5 w-full items-stretch overflow-hidden rounded-full bg-muted ring-ring/40 transition-all group-hover/bar:h-3.5 group-hover/bar:ring-2">
            {BAND_DISPLAY_ORDER.map((band) => {
              const count = bands[band.key];
              if (count === 0) return null;
              return (
                <span
                  key={band.key}
                  aria-hidden
                  className="block h-full"
                  style={{
                    width: `${(count / total) * 100}%`,
                    background: GRADE_BAND_FILL[band.key],
                  }}
                />
              );
            })}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {title} · {total} {total === 1 ? 'student' : 'students'}
          </p>
          <ul className="space-y-2">
            {/* Every band, including the empty ones — a five-rung ladder with
                rungs missing is not a scale you can read a shape off. */}
            {BAND_DISPLAY_ORDER.map((band) => {
              const count = bands[band.key];
              const share = Math.round((count / total) * 100);
              return (
                <li
                  key={band.key}
                  className={`flex items-center justify-between gap-3 ${
                    count === 0 ? 'opacity-45' : ''
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: GRADE_BAND_FILL[band.key] }}
                    />
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {band.label}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {band.range}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2 text-right">
                    <span className="text-[13px] font-semibold tabular-nums text-foreground">
                      {count}
                    </span>
                    <span className="w-9 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {share}%
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-hairline pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
            {BASIS_NOTE[basis]}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// No separate legend component lives here on purpose. This popover names all
// five bands with their ranges, and the school-wide donut renders its own
// legend from the same GRADE_BAND_FILL colours. A third, differently-ordered
// legend would be one more key for one colour map (09a §10.4).
