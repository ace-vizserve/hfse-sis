import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { STALENESS_LABELS, stalenessLabel } from '@/lib/admissions/staleness';

// Shared staleness pill for admissions application records. The label is the
// tier (Critical / Warning / Fresh / Never updated); colour is always paired
// with an icon + text so it never relies on colour alone (color-not-only).
// Tokens-only (Hard Rule #7): destructive / chart-4 / brand-mint + ink scale.

const BADGE_BASE =
  'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

export function StalenessBadge({ days }: { days: number | null }) {
  const label = stalenessLabel(days);

  if (label === STALENESS_LABELS.unknown) {
    return (
      <Badge
        variant="outline"
        className={`${BADGE_BASE} border-hairline bg-gradient-to-b from-muted to-muted/60 text-ink-3`}
      >
        <HelpCircle className="h-3 w-3" aria-hidden />
        Never updated
      </Badge>
    );
  }

  if (label === STALENESS_LABELS.critical) {
    return (
      <Badge
        variant="outline"
        className={`${BADGE_BASE} border-destructive/40 bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive`}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden />
        {days}d stale
      </Badge>
    );
  }

  if (label === STALENESS_LABELS.warning) {
    return (
      <Badge
        variant="outline"
        className={`${BADGE_BASE} border-chart-4/50 bg-chart-4/15 text-ink`}
      >
        <AlertCircle className="h-3 w-3" aria-hidden />
        {days}d stale
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={`${BADGE_BASE} border-brand-mint bg-gradient-to-b from-brand-mint/35 to-brand-mint/15 text-ink`}
    >
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      Fresh · {days}d
    </Badge>
  );
}
