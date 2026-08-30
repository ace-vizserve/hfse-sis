import { cn } from '@/lib/utils';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // `bg-border` (not `bg-white`) — hard rule #7 bans `bg-white` here.
        // `--border` is the only NEUTRAL fill in the palette that survives
        // both themes: `#e2e8f0` on a white card, and a mid-grey that sits
        // lighter than `--card` in dark. `--muted` is near-white and
        // disappears on a card; `--secondary` resolves to exactly `--card`
        // in dark and disappears there; `--accent` is the indigo hover wash
        // and tints the whole page blue. Using a border value as a fill is
        // the trade for not branching on theme (§2 rule 5).
        // The former `from-muted via-muted/60 to-muted` were inert: nothing
        // ever set `bg-gradient-*` to activate them.
        'animate-pulse rounded-md border border-hairline bg-border',
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
