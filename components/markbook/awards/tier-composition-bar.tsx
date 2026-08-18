'use client';

import {
  TIER_FILL,
  TIER_LABEL,
} from '@/components/markbook/awards/award-tier-visuals';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  NEAR_BAND_POINTS,
  TIER_DISPLAY_ORDER,
  tierTotal,
  type TierCounts,
} from '@/lib/markbook/awards-overview-compute';

// A four-segment bar showing how a group is spread across the award bands,
// sized to sit inside a table cell. Clicking it opens the breakdown.
//
// It is a popover for the same reason the Academic Summary spread bar is: four
// unlabelled colours in a table cell are a riddle, and the counts behind them
// exist nowhere else on the page at this grain. Content you have to keep
// hovering to read is content you cannot compare against the row beside it.
//
// Segments run WORST FIRST, left to right, so the ladder reads upward and
// "moving up" is always the same direction — matching the threshold strip above
// it. Swatch and segment share one map (09a §10.2), so the popover is a real
// key rather than a lookalike.

/** The bar's own key. Wraps any paint, so a wide strip and a narrow one share it. */
export function TierCompositionPopover({
  tiers,
  title,
  withinReach,
  settled,
  children,
}: {
  tiers: TierCounts;
  /** The group this bar describes, e.g. "Primary Six". */
  title: string;
  /** How many of this group are within a point of the next band up. */
  withinReach?: number;
  /** Changes the wording only — a standing is not an award. */
  settled?: boolean;
  children: React.ReactNode;
}) {
  const total = tierTotal(tiers);
  const order = [...TIER_DISPLAY_ORDER].reverse();
  const description = order
    .filter((b) => tiers[b.key] > 0)
    .map((b) => `${tiers[b.key]} ${b.label.toLowerCase()}`)
    .join(', ');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${title}: ${description}. Open the breakdown.`}
          className="group/bar block w-full rounded-lg outline-hidden transition-all hover:ring-2 hover:ring-ring/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {title} · {total} {total === 1 ? 'student' : 'students'}
          </p>
          <ul className="space-y-2">
            {/* Every band, including the empty ones — a four-rung ladder with
                rungs missing is not a scale you can read a shape off, and an
                empty Gold is itself the finding on the Secondary levels. */}
            {TIER_DISPLAY_ORDER.map((band) => {
              const count = tiers[band.key];
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
                      style={{ background: TIER_FILL[band.key] }}
                    />
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {TIER_LABEL[band.key]}
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
            {settled
              ? 'Counted by each student’s award for the full year.'
              : 'Counted by where each student’s marks so far sit against the school’s thresholds — not awards.'}
            {withinReach != null && withinReach > 0 ? (
              <>
                {' '}
                <span className="text-foreground">
                  {withinReach} within {NEAR_BAND_POINTS.toFixed(1)} point
                </span>{' '}
                of the next band up.
              </>
            ) : null}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The narrow, table-cell version — 10px of paint on a 24px target. */
export function TierCompositionBar({
  tiers,
  title,
  withinReach,
  settled,
}: {
  tiers: TierCounts;
  title: string;
  withinReach?: number;
  settled?: boolean;
}) {
  const total = tierTotal(tiers);
  if (total === 0) {
    return <span className="text-muted-foreground">&ndash;</span>;
  }
  const order = [...TIER_DISPLAY_ORDER].reverse();

  return (
    <TierCompositionPopover
      tiers={tiers}
      title={title}
      withinReach={withinReach}
      settled={settled}
    >
      {/* The paint stays 10px so the table row keeps its rhythm; the button
          around it is 24px, because a 10px click target is not one. */}
      <span className="flex h-6 min-w-32 items-center">
        <span className="flex h-2.5 w-full items-stretch overflow-hidden rounded-full bg-muted transition-all group-hover/bar:h-3.5">
          {order.map((band) =>
            tiers[band.key] === 0 ? null : (
              <span
                key={band.key}
                aria-hidden
                className="block h-full"
                style={{
                  width: `${(tiers[band.key] / total) * 100}%`,
                  background: TIER_FILL[band.key],
                }}
              />
            )
          )}
        </span>
      </span>
    </TierCompositionPopover>
  );
}
