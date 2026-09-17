import { houseChipClass, houseTileClass } from '@/lib/sis/houses';
import { cn } from '@/lib/utils';

// A student's house, as a small swatch + name.
//
// The name is ALWAYS rendered, never the colour alone. House colours are
// identity rather than semantics, and a swatch on its own is unreadable to
// anyone who cannot distinguish the hues — §9.3's rule that colour must not be
// the sole carrier of meaning applies here more than anywhere, because these
// four colours mean nothing except "which house".
//
// Renders nothing at all when unassigned. A student without a house is a real
// and common state (every new enrolee, until someone puts them in one), and an
// empty chip reads as a bug rather than as information. Surfaces that need to
// SAY "no house yet" — the setter, for one — do so in their own words.
export function HouseChip({
  name,
  colourToken,
  className,
}: {
  name: string | null;
  colourToken: string | null;
  className?: string;
}) {
  if (!name || !colourToken) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium',
        houseChipClass(colourToken),
        className
      )}
    >
      {/* The house TILE at chip scale — same gradient and shadow as the 40px
          one on the permanent record (§7.4: icon tiles are crafted, not flat),
          so the two read as one object at two sizes. Round rather than
          rounded-square: Mr Ace's call, it keeps the dot silhouette in a table
          row. size-3.5 against the old size-2 — at 8px and flat it read as
          punctuation rather than as the house. */}
      <span
        className={cn(
          'size-3.5 shrink-0 rounded-full shadow-brand-tile',
          houseTileClass(colourToken)
        )}
        aria-hidden
      />
      {name}
    </span>
  );
}
