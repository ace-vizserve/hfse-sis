// Turns a chart click on /admissions/insights into the drill target's
// segment and year (KD #229). Pure and client-safe — the 'use client'
// wrappers in components/admissions/drills/insights-drill-cards.tsx call it.

import {
  encodePairSegment,
  OTHER_REASONS_BAR_KEY,
  OVERFLOW_SEGMENT,
} from '@/lib/admissions/insights-predicates';

/** Shown under every Insights drill's title in place of the date anchor —
 *  Admissions Insights is whole-year, so its drills take no date range. */
export const INSIGHTS_SCOPE_LABEL = 'Whole academic year';

/** TrendChart reports 'current' | 'comparison'; this page's GroupedBarChart
 *  series keys are 'current' | 'compare'. Either comparison name, or the
 *  comparison year itself, opens the comparison year (Review Focus #1). */
export function resolveSeriesAy(
  series: string | undefined,
  ays: { selectedAy: string; compareAy: string | null }
): string {
  if (!ays.compareAy || series === undefined) return ays.selectedAy;
  if (
    series === 'comparison' ||
    series === 'compare' ||
    series === ays.compareAy
  ) {
    return ays.compareAy;
  }
  return ays.selectedAy;
}

/** '4★' → '4'. */
export function ratingSegmentFromCategory(category: string): string | null {
  const match = /^\s*(\d+)/.exec(category);
  return match ? match[1] : null;
}

const ASSESSMENT_SUBJECT: Readonly<Record<string, 'math' | 'eng'>> = {
  Math: 'math',
  English: 'eng',
};
const ASSESSMENT_OUTCOME: ReadonlySet<string> = new Set([
  'pass',
  'fail',
  'notAssessed',
]);

/** ('English', 'notAssessed') → 'eng:notAssessed'. */
export function assessmentSegment(
  subject: string,
  series: string | undefined
): string | null {
  const subj = ASSESSMENT_SUBJECT[subject];
  if (!subj || !series || !ASSESSMENT_OUTCOME.has(series)) return null;
  return `${subj}:${series}`;
}

/** A cancellation-reasons donut slice (drawn by label) → its reason code,
 *  or the overflow bucket for "Other reasons". */
export function reasonSegmentForSlice(
  sliceName: string,
  bars: ReadonlyArray<{ key: string; label: string }>
): string | null {
  const bar = bars.find((b) => b.label === sliceName);
  if (!bar) return null;
  return encodePairSegment(
    '',
    bar.key === OTHER_REASONS_BAR_KEY ? OVERFLOW_SEGMENT : bar.key
  );
}

/** A by-source donut slice → its source, or the overflow bucket when it is
 *  the folded Other row. */
export function referralSegmentForSlice(
  sliceName: string,
  rows: ReadonlyArray<{ source: string; folded?: true }>
): string {
  const folded = rows.find((r) => r.folded === true);
  return folded && folded.source === sliceName ? OVERFLOW_SEGMENT : sliceName;
}

/** The nationality pie (no level) or the nationality × level bars. */
export function nationalitySegment(
  nationality: string,
  level?: string
): string {
  return encodePairSegment(level ?? '', nationality);
}

/** Every cancellation reason recorded for one level. */
export function levelReasonsSegment(level: string): string {
  return encodePairSegment(level, '');
}
