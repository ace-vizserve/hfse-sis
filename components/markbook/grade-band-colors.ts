import type { GradeBand } from '@/lib/markbook/drill-filter';

// The single source of truth for what a mastery band LOOKS like.
//
// Hoisted out of grade-distribution-chart.client.tsx when the school-wide
// Academic Overview added a second visual keyed on the same bands (a spread bar
// per grade level and per subject, plus the school donut). Design system 09a
// §10.2: the cells own the colour and the legend reads from it — a legend that
// hand-picks a "looks similar" tint is a broken key.
//
// Values are CSS custom properties, never literals (Hard Rule #7), so they
// follow the theme and cannot drift from globals.css.
// An ORDINAL ramp, best to worst: mint → sky → indigo → amber → red. The bands
// are a ladder, so the colours have to move in one direction; the previous
// mapping ran mint → navy → mid-blue → light indigo → red, which reversed
// lightness halfway and read as unordered wherever the five sat side by side.
// Changing it here also restyles the Markbook grade-distribution chart, which
// is the point — the same five bands must look the same on every surface.
export const GRADE_BAND_FILL: Record<GradeBand, string> = {
  dnm: 'var(--destructive)',
  fs: 'var(--color-brand-amber)',
  s: 'var(--color-brand-indigo-soft)',
  vs: 'var(--color-brand-sky)',
  o: 'var(--color-brand-mint)',
};
