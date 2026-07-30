import {
  CalendarX,
  Check,
  CircleDashed,
  CircleSlash,
  Clock,
  MessageSquare,
  Undo2,
  type LucideIcon,
} from 'lucide-react';

import type { DocumentStatus } from '@/lib/p-files/document-config';

// ──────────────────────────────────────────────────────────────────────────
// Single source of truth for "how does a document slot render" — design
// system §10.2 (the cells own the colour map, the legend reads it). The
// completeness strip, its popover, the outstanding chips and the legend all
// import from here, so a swatch can never drift from the thing it documents.
//
// The split below is the whole point of this module:
//
//   DocumentAction — what the officer must DO. Five of them, five fills.
//   DocumentStatus — what HAPPENED. Seven of them, seven words + icons.
//
// Two statuses can share a fill when they demand the same next move, and
// `expired` / `rejected` do: either way the parent has to send the document
// again. The chip's word and icon carry the difference. That keeps the
// legend honest — six swatches, six distinct meanings, no duplicates
// (§10.5) — where the previous 13-column dot matrix painted seven statuses
// in five colours, leaving `expired`/`rejected` and `missing`/`na`
// genuinely indistinguishable.
// ──────────────────────────────────────────────────────────────────────────

export type DocumentAction =
  /** On file and current — nothing to do. */
  | 'clear'
  /** Parent has uploaded it; we owe them a review. */
  | 'check'
  /** Parent has committed to sending it; we're waiting on them. */
  | 'waiting'
  /** Lapsed or sent back — the parent must upload it again. */
  | 'reupload'
  /** Never received. */
  | 'collect'
  /** Doesn't apply to this student (e.g. no father on file). */
  | 'na';

export const STATUS_ACTION: Record<DocumentStatus, DocumentAction> = {
  valid: 'clear',
  uploaded: 'check',
  'to-follow': 'waiting',
  expired: 'reupload',
  rejected: 'reupload',
  missing: 'collect',
  na: 'na',
};

/**
 * Segment / swatch paint. Gradient pills per §10.1 — the strip segments and
 * the legend swatches render these exact classes.
 *
 * `collect` and `na` are deliberately flat: "not collected" and "doesn't
 * apply" are absence states, not semantic colours (same reasoning as
 * `bg-muted` elsewhere in the design system, and as the `not-started`
 * branch of the SIS year-setup tiles).
 */
export const ACTION_FILL: Record<DocumentAction, string> = {
  clear: 'bg-gradient-to-b from-brand-mint to-brand-sky',
  check: 'bg-gradient-to-b from-brand-amber to-brand-amber/70',
  waiting: 'bg-gradient-to-b from-brand-indigo-soft to-brand-indigo',
  reupload: 'bg-gradient-to-b from-destructive to-destructive/75',
  collect: 'bg-ink-5',
  na: 'bg-hairline',
};

/** Chip paint per action — the §9.3 outline-badge recipes. */
export const ACTION_CHIP_CLASS: Record<DocumentAction, string> = {
  clear: 'border-brand-mint/60 bg-brand-mint/15 text-ink',
  check: 'border-brand-amber/45 bg-brand-amber/10 text-brand-amber',
  waiting: 'border-brand-indigo/30 bg-accent text-accent-foreground',
  reupload: 'border-destructive/40 bg-destructive/10 text-destructive',
  collect: 'border-hairline-strong bg-muted text-muted-foreground',
  na: 'border-hairline-strong bg-muted text-muted-foreground',
};

/**
 * Legend copy. Names the ACTION, because that is what the colour encodes and
 * what the officer is scanning for. Order runs from "settled" to
 * "outstanding" so the strip reads left-to-right as a health gradient.
 */
export const ACTION_LEGEND: {
  action: DocumentAction;
  label: string;
  hint: string;
}[] = [
  { action: 'clear', label: 'On file', hint: 'nothing to do' },
  { action: 'check', label: 'Uploaded', hint: 'waiting on us' },
  { action: 'waiting', label: 'Promised', hint: 'waiting on the parent' },
  {
    action: 'reupload',
    label: 'Needs re-upload',
    hint: 'lapsed or sent back',
  },
  { action: 'collect', label: 'Not collected', hint: 'never received' },
  { action: 'na', label: 'Not applicable', hint: 'no parent on file' },
];

/**
 * Per-status word + icon. This is where the seven real statuses stay
 * distinct — the chip always shows an icon alongside its tint, so status is
 * never carried by colour alone.
 */
export const STATUS_CHIP: Record<
  DocumentStatus,
  { label: string; icon: LucideIcon }
> = {
  valid: { label: 'On file', icon: Check },
  uploaded: { label: 'Uploaded', icon: Clock },
  'to-follow': { label: 'Promised', icon: MessageSquare },
  expired: { label: 'Lapsed', icon: CalendarX },
  rejected: { label: 'Sent back', icon: Undo2 },
  missing: { label: 'Not collected', icon: CircleDashed },
  na: { label: 'Not applicable', icon: CircleSlash },
};

export function fillForStatus(status: DocumentStatus): string {
  return ACTION_FILL[STATUS_ACTION[status]];
}

export function chipClassForStatus(status: DocumentStatus): string {
  return ACTION_CHIP_CLASS[STATUS_ACTION[status]];
}

/** A slot the officer still has to act on. `na` is not outstanding — it
 *  doesn't apply to this student — and neither is `valid`. */
export function isOutstanding(status: DocumentStatus): boolean {
  return status !== 'valid' && status !== 'na';
}
