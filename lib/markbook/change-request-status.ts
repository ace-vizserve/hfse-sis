import {
  CheckCircle2,
  Circle,
  CircleCheck,
  CircleX,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import type { BadgeProps } from '@/components/ui/badge';

// Single source of truth for the grade-change-request status badge.
// Both surfaces (admin queue at /markbook/change-requests + teacher's
// own-requests view at /markbook/grading/requests) consume this — keeps
// the labels, icons, and §9.3 wash recipes from drifting between views.

export type ChangeRequestStatus =
  | 'pending'
  | 'approved'
  | 'applied'
  | 'rejected'
  | 'cancelled';

export type ChangeRequestStatusConfig = {
  label: string;
  icon: LucideIcon;
  /** Maps to the Badge primitive's variant prop. */
  variant: NonNullable<BadgeProps['variant']>;
  /** Per-status §9.3 wash override; empty when the variant carries the colour. */
  className: string;
};

export const CHANGE_REQUEST_STATUS_CONFIG: Record<
  ChangeRequestStatus,
  ChangeRequestStatusConfig
> = {
  pending: {
    label: 'Awaiting Review',
    icon: Circle,
    variant: 'secondary',
    className: '',
  },
  approved: {
    label: 'Approved · Awaiting Changes',
    icon: CheckCircle2,
    variant: 'outline',
    className: 'border-primary/30 bg-primary/10 text-primary',
  },
  applied: {
    label: 'Changes Applied',
    icon: CircleCheck,
    variant: 'outline',
    className: 'border-brand-mint bg-brand-mint/30 text-ink',
  },
  rejected: {
    label: 'Declined',
    icon: XCircle,
    variant: 'outline',
    className: 'border-destructive/40 bg-destructive/10 text-destructive',
  },
  cancelled: {
    label: 'Cancelled',
    icon: CircleX,
    variant: 'secondary',
    className: '',
  },
};
