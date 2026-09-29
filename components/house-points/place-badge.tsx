import { Badge } from '@/components/ui/badge';
import type { Place } from '@/lib/house-points/compute';
import { formatPoints } from '@/lib/house-points/standings';
import { cn } from '@/lib/utils';

// An award on an event's rubric — ranks 1, 2, 3 wear the medal tokens, every
// other award a plain outline. The rank decides nothing else: awards are
// picked by hand (KD #228). Used by the rubric panel above the score sheet
// and by the Award column inside it, so an award looks the same in the key
// as it does on the row (09a §10: a legend is pixel-identical to what it keys).
//
// Outline recipe, not solid: the bright medal stop is a FILL and fails as text
// on white, so the ink is always the `-deep` partner (see
// components/markbook/awards/award-tier-visuals.tsx). Literal strings only —
// Tailwind cannot see an interpolated class name.

const MEDAL_BADGE: Record<1 | 2 | 3, string> = {
  1: 'border-medal-gold bg-medal-gold/15 text-medal-gold-deep',
  2: 'border-medal-silver bg-medal-silver/20 text-medal-silver-deep',
  3: 'border-medal-bronze bg-medal-bronze/15 text-medal-bronze-deep',
};

export function placeBadgeClass(place: Pick<Place, 'rank'>): string {
  const rank = place.rank;
  if (rank === 1 || rank === 2 || rank === 3) return MEDAL_BADGE[rank];
  return 'border-border bg-card text-foreground';
}

export function PlaceBadge({
  place,
  withPoints = false,
  className,
}: {
  place: Place;
  /** The rubric key shows what each place is worth; a row shows it in its own column. */
  withPoints?: boolean;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn('h-6 gap-1.5', placeBadgeClass(place), className)}
    >
      {place.label}
      {withPoints && (
        <span className="font-mono text-[11px] tabular-nums opacity-80">
          {formatPoints(place.points)} pt{place.points === 1 ? '' : 's'}
        </span>
      )}
    </Badge>
  );
}
