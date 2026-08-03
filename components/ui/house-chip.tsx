import { houseSwatchClass } from '@/lib/sis/houses';
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
        'inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-foreground',
        className
      )}
    >
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          houseSwatchClass(colourToken)
        )}
        aria-hidden
      />
      {name}
    </span>
  );
}
