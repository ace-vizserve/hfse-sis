import {
  TIER_FILL,
  TIER_LABEL,
  TIER_LABEL_SHADOW,
} from '@/components/markbook/awards/award-tier-visuals';
import { TierCompositionPopover } from '@/components/markbook/awards/tier-composition-bar';
import type { AwardThresholds } from '@/lib/compute/awards';
import {
  TIER_DISPLAY_ORDER,
  tierTotal,
  type TierCounts,
} from '@/lib/markbook/awards-overview-compute';

// Where the cohort sits against the award cut-offs.
//
// A stacked bar rather than a donut, and the reason is the cut lines: the bands
// are a LADDER with named boundaries the school owns, and a ring cannot show a
// boundary — only a share. Drawing 88.5 / 91.5 / 95.5 across the bar turns four
// counts into "how far the school is from each rung", which is the question an
// awards page exists to answer.
//
// The segments are sized by COUNT, not by score range, so the cut labels sit
// over the boundary between two segments rather than at their numeric position.
// That is deliberate: a score axis would leave the 60–88 stretch mostly empty
// and squeeze every award band into the last fifth of the width.
//
// Server-rendered: it is four numbers and three labels, and pulling a chart
// library for that would ship client JavaScript to draw a row of divs. The one
// interactive part is the breakdown popover, shared with the ladder strips so
// every bar on the page answers "what am I looking at" the same way.

export function AwardThresholdStrip({
  tiers,
  thresholds,
  withinReach,
  title,
  settled,
}: {
  tiers: TierCounts;
  thresholds: AwardThresholds;
  withinReach: { bronze: number; silver: number; gold: number };
  /** What the bar describes, for the breakdown heading. */
  title: string;
  settled: boolean;
}) {
  const total = tierTotal(tiers);
  if (total === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No marks recorded for this scope yet.
      </p>
    );
  }

  // Worst first, left to right — the ladder read upward, so each cut line is a
  // step to the right and "moving up" is always the same direction.
  const order = [...TIER_DISPLAY_ORDER].reverse();
  const cuts = [
    { at: 'bronze', min: thresholds.bronzeMin, near: withinReach.bronze },
    { at: 'silver', min: thresholds.silverMin, near: withinReach.silver },
    { at: 'gold', min: thresholds.goldMin, near: withinReach.gold },
  ] as const;

  // Cumulative share up to each boundary, so a rule lands exactly where one
  // band ends and the next begins.
  let running = 0;
  const boundaryAt: Record<string, number> = {};
  for (const band of order) {
    running += tiers[band.key];
    boundaryAt[band.key] = (running / total) * 100;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative pt-6">
        {cuts.map((cut) => {
          // The boundary INTO this band is the end of the band below it.
          const below =
            cut.at === 'bronze'
              ? 'none'
              : cut.at === 'silver'
                ? 'bronze'
                : 'silver';
          const left = boundaryAt[below] ?? 0;
          return (
            <span
              key={cut.at}
              aria-hidden
              className="absolute bottom-0 top-4 w-0 border-l-2 border-dashed border-ink-4"
              style={{ left: `${left}%` }}
            >
              <span className="absolute -top-5 left-1.5 whitespace-nowrap font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {cut.min} {TIER_LABEL[cut.at]}
              </span>
            </span>
          );
        })}
        <TierCompositionPopover
          tiers={tiers}
          title={title}
          withinReach={
            withinReach.bronze + withinReach.silver + withinReach.gold
          }
          settled={settled}
        >
          <span className="flex h-11 gap-0.5 overflow-hidden rounded-lg">
            {order.map((band) => {
              const count = tiers[band.key];
              if (count === 0) return null;
              const share = (count / total) * 100;
              return (
                <span
                  key={band.key}
                  aria-hidden
                  className="grid place-items-center text-[13px] font-semibold tabular-nums text-white"
                  style={{
                    width: `${share}%`,
                    background: TIER_FILL[band.key],
                    textShadow: TIER_LABEL_SHADOW,
                  }}
                >
                  {/* A count needs roughly 2.5% of the width before it collides
                      with the segment edge — at 12 of 372 that is Gold, and
                      suppressing it was hiding the number people look for
                      first. Anything narrower falls back to the legend. */}
                  {share >= 2.5 ? count : ''}
                </span>
              );
            })}
          </span>
        </TierCompositionPopover>
      </div>

      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {TIER_DISPLAY_ORDER.map((band) => (
          <li key={band.key} className="flex items-center gap-2 text-[13px]">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: TIER_FILL[band.key] }}
            />
            <span className="text-muted-foreground">{band.label}</span>
            <span className="text-[13px] font-semibold tabular-nums text-foreground">
              {tiers[band.key]}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {total > 0
                ? `${Math.round((tiers[band.key] / total) * 100)}%`
                : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
