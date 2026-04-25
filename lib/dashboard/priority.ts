import type { LucideIcon } from 'lucide-react';

import type { InsightSeverity } from '@/lib/dashboard/insights';

/**
 * PriorityPanel payload shape.
 *
 * The PriorityPanel is the top-of-fold "what should I act on right now?"
 * answer that sits ABOVE the KPI strip on operational dashboards
 * (Markbook, Attendance, P-Files). It is a single Card composed of:
 *   1. an eyebrow + serif title + optional gradient icon tile
 *   2. a headline metric (big serif tabular-nums number + severity chip)
 *   3. a horizontal flex-wrap row of action chips (label · count · href)
 *   4. an optional secondary CTA at the footer
 *
 * Per-module data loaders that build this payload land in subsequent bites.
 * This module is type-only.
 */

export type PriorityChip = {
  label: string;
  count: number;
  href: string;
  severity?: InsightSeverity;
};

export type PriorityCta = {
  label: string;
  href: string;
};

export type PriorityHeadline = {
  value: number;
  /** e.g. "sheets need locking by Tue" */
  label: string;
  /** Drives the dot color next to the headline value. */
  severity?: InsightSeverity;
};

export type PriorityPayload = {
  /** Eyebrow stays "Priority" by default; overridable per-module. */
  eyebrow?: string;
  title: string;
  headline: PriorityHeadline;
  chips: PriorityChip[];
  cta?: PriorityCta;
  /** Optional gradient icon for the CardAction slot. */
  icon?: LucideIcon;
};
