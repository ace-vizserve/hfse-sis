import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import type { SowState } from '@/lib/sow/access';

// A scheme of work's state, in the words every SOW screen uses. One component
// so "My schemes of work" and the SOW page can never name a state two ways.
//
// Tones follow 09a §9.3: approved is healthy, returned is blocked (the teacher
// must act), in review is informational, a draft is neutral. "Not started" is
// the absence of a scheme, so it is the quietest pill — an outline.

export function SowStatusBadge({
  state,
  step,
}: {
  /** null = no scheme of work yet. */
  state: SowState | null;
  /** The approval step it is waiting on, when known ("OIC"). */
  step?: string | null;
}) {
  switch (state) {
    case 'draft':
      return <StatusBadge tone="muted">Draft</StatusBadge>;
    case 'in_review':
      return (
        <StatusBadge tone="info">
          {step ? `In review · ${step}` : 'In review'}
        </StatusBadge>
      );
    case 'returned':
      return <StatusBadge tone="locked">Returned</StatusBadge>;
    case 'approved':
      return <StatusBadge tone="healthy">Approved</StatusBadge>;
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          Not started
        </Badge>
      );
  }
}
