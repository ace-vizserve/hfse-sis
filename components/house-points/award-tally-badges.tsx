import { Badge } from '@/components/ui/badge';
import { placeBadgeClass } from '@/components/house-points/place-badge';
import type { AwardTally } from '@/lib/house-points/house-breakdown';
import { cn } from '@/lib/utils';

// "Gold ×2 · Participation ×5" as badges — one per award label, in the same
// medal colours the rubric and score sheet use (place-badge.tsx), so an award
// reads the same on the house page as on the event it came from.
//
// No 'use client': renders in the server page and in the client tables alike.

export function AwardTallyBadges({
  awards,
  emptyLabel = 'No award yet',
  className,
}: {
  awards: readonly AwardTally[];
  emptyLabel?: string;
  className?: string;
}) {
  if (awards.length === 0) {
    return <span className="text-sm text-muted-foreground">{emptyLabel}</span>;
  }
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {awards.map((award) => (
        <Badge
          key={award.label}
          variant="outline"
          className={cn('h-6 gap-1', placeBadgeClass(award))}
        >
          {award.label}
          <span className="font-mono text-[11px] tabular-nums opacity-80">
            ×{award.count.toLocaleString('en-SG')}
          </span>
        </Badge>
      ))}
    </div>
  );
}
