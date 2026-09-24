import { Check } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

// The section picker's hint (09a §9.3 mint recipe): this section's track and
// schedule are the ones the application asked for. A hint only — shared by
// AssignSectionDialog and EditStageDialog's inline picker so both say it the
// same way. Render it INSIDE the option button so the words join the
// option's accessible name.
export function ApplicationMatchBadge() {
  return (
    <Badge
      variant="outline"
      className="h-5 gap-1 border-brand-mint bg-brand-mint/30 px-1.5 text-[11px] font-medium text-ink"
    >
      <Check className="size-3" aria-hidden="true" />
      Matches their application
    </Badge>
  );
}
