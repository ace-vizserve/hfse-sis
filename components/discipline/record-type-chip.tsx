import { Badge } from '@/components/ui/badge';
import { DISCIPLINE_CHIP_CLASS } from '@/lib/discipline/display';
import {
  DISCIPLINE_RECORD_TYPE_LABELS,
  type DisciplineRecordType,
} from '@/lib/schemas/discipline';
import { cn } from '@/lib/utils';

// The one chip that says whether a record is an incident or a letter.
//
// No `'use client'` on purpose: the class list and the Records tab are server
// components, and marking this a client module would drag them into the client
// bundle to render a coloured word.
//
// `Badge variant="outline"` plus a §9.3 wash recipe, not a bespoke pill — this
// has to sit beside every other status badge in the SIS and read as the same
// kind of thing, so it inherits the mono-uppercase micro-label voice from the
// primitive rather than inventing a second one.
export function DisciplineTypeChip({
  type,
  className,
}: {
  type: DisciplineRecordType;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn('h-6 shrink-0', DISCIPLINE_CHIP_CLASS[type], className)}
    >
      {DISCIPLINE_RECORD_TYPE_LABELS[type]}
    </Badge>
  );
}
