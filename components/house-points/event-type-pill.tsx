import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { EventType } from '@/lib/house-points/compute';
import { EVENT_TYPE_SHORT_LABELS } from '@/lib/house-points/standings';

// Single coloured chip labelling a house-points event type. Delegates to the
// shared <Badge> variants, as the movement kind pill does, so the four types
// read apart at a glance in the events list.

const LABELS = EVENT_TYPE_SHORT_LABELS;

const VARIANT: Record<EventType, NonNullable<BadgeProps['variant']>> = {
  // Indigo gradient — the biggest occasion of the year.
  major: 'default',
  // Mint gradient — a competition against other schools.
  external: 'success',
  // Quiet grey — the everyday in-school event.
  internal: 'secondary',
  // Muted — points from attendance, not a competition.
  attendance: 'muted',
};

export function EventTypePill({ type }: { type: EventType }) {
  return <Badge variant={VARIANT[type]}>{LABELS[type]}</Badge>;
}
