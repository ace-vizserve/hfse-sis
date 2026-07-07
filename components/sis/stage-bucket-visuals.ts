import type { StageStatusBucket } from '@/lib/sis/process';

// ──────────────────────────────────────────────────────────────────────────
// Single source of truth for "how does a StageStatusBucket render" (design
// system §10.2 — the cells own the color map, everything else reads it).
// Originally lived only in student-lifecycle-timeline.tsx as a private
// BUCKET_DOT map; hoisted here so the applications-table pipeline strip
// (components/sis/pipeline-strip.tsx) reads the exact same classes — a
// segment and its popover swatch can never drift out of sync.
// ──────────────────────────────────────────────────────────────────────────

export const BUCKET_FILL: Record<StageStatusBucket, string> = {
  done: 'bg-gradient-to-b from-chart-5 to-chart-3 ring-2 ring-chart-5/30',
  in_progress:
    'bg-gradient-to-b from-brand-indigo to-brand-navy ring-2 ring-brand-indigo/25',
  blocked:
    'bg-gradient-to-b from-destructive to-destructive/80 ring-2 ring-destructive/30',
  not_started: 'bg-ink-3 ring-2 ring-ink-3/30',
};

export const BUCKET_LABEL: Record<StageStatusBucket, string> = {
  done: 'Done',
  in_progress: 'In progress',
  blocked: 'Blocked',
  not_started: 'Not started',
};
