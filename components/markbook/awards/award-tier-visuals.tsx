import type { AwardTier } from '@/lib/markbook/awards-overview-compute';

// The single source of truth for what an award band LOOKS like.
//
// The medals are the actual medals — gold, silver, bronze — from the
// `--color-medal-*` tokens. The first cut of this page borrowed brand-amber for
// gold, slate for silver and SKY BLUE for bronze, which is the kind of thing
// that makes a reader distrust every other colour on the screen.
//
// Design system 09a §10.2: the cells own the colour and every legend reads from
// it. Segments, chips and ladder strips all pull from here, so none of them can
// drift into a "looks similar" tint. Values are CSS custom properties, never
// literals (Hard Rule #7), so they follow the theme.

export const TIER_FILL: Record<AwardTier, string> = {
  gold: 'var(--color-medal-gold)',
  silver: 'var(--color-medal-silver)',
  bronze: 'var(--color-medal-bronze)',
  none: 'var(--color-muted-foreground)',
};

/**
 * Counts sitting on a segment are white on every band — Mr Ace's call, and it
 * is the right one for scanning: a row of labels that changes colour per
 * segment reads as four different kinds of thing rather than one series.
 *
 * White on a bright metallic is a low ratio on its own (gold is about 1.9:1),
 * so the labels carry a soft dark shadow to hold their edges. That is what
 * `TIER_LABEL_SHADOW` is for — drop it and the numbers dissolve into the fill.
 */
export const TIER_LABEL_SHADOW = '0 1px 2px rgba(15, 23, 42, 0.55)';

export const TIER_LABEL: Record<AwardTier, string> = {
  gold: 'Gold',
  silver: 'Silver',
  bronze: 'Bronze',
  none: 'Not eligible',
};

/**
 * Chip styles, split by whether the result is settled.
 *
 * ⚠ THE TWO MUST NEVER LOOK ALIKE. A settled award is solid; a standing is an
 * outline and carries the words "so far". Painting a provisional reading like a
 * final one is the one way this page could actually mislead someone — see the
 * header of lib/markbook/awards-overview-compute.ts.
 *
 * Solid chips take `text-ink`, not white: a metallic is a light-to-mid tone, so
 * white on gold lands near 2:1. Outline chips take the `-deep` partner of the
 * same medal, because the bright fill as TEXT fails on white for the same
 * reason. Bright is a fill, deep is a text colour — never swap them.
 */
const SETTLED_CHIP: Record<AwardTier, string> = {
  gold: 'border-medal-gold bg-medal-gold text-ink',
  silver: 'border-medal-silver bg-medal-silver text-ink',
  bronze: 'border-medal-bronze bg-medal-bronze text-ink',
  none: 'border-border bg-muted text-muted-foreground',
};

const STANDING_CHIP: Record<AwardTier, string> = {
  gold: 'border-medal-gold bg-medal-gold/15 text-medal-gold-deep',
  silver: 'border-medal-silver bg-medal-silver/20 text-medal-silver-deep',
  bronze: 'border-medal-bronze bg-medal-bronze/15 text-medal-bronze-deep',
  none: 'border-border bg-muted/60 text-muted-foreground',
};

export function TierChip({
  tier,
  settled,
}: {
  tier: AwardTier | null;
  /** True only for an award the year has actually settled. */
  settled: boolean;
}) {
  if (tier == null) {
    return <span className="text-muted-foreground">–</span>;
  }
  const style = settled ? SETTLED_CHIP[tier] : STANDING_CHIP[tier];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] ${style}`}
    >
      {TIER_LABEL[tier]}
      {settled ? '' : ' · so far'}
    </span>
  );
}
