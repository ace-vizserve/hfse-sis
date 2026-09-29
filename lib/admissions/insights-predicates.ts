// The ONE copy of every rule an Admissions Insights number is counted with.
// The Insights loaders (dashboard.ts, insights-compare.ts, insights-funnel.ts,
// insights.ts) count with these, and the drill targets that list the rows
// behind those numbers (drill.ts) filter with the same functions — a drill
// with its own copy of a rule drifts from the number it opens from
// (KD #82/#124, KD #229).
//
// ⚠ CLIENT-SAFE ON PURPOSE. lib/admissions/drill.ts is imported by the client
// drill sheet and imports this file, so nothing here may import
// 'server-only', next/cache or a Supabase client.

import { COUNTRY_NAME_SET } from '@/lib/data/countries';
import {
  APPLICATION_TERMINAL_REASON_LABELS,
  ENROLEE_CATEGORIES,
} from '@/lib/schemas/sis';

// ── Ranking ────────────────────────────────────────────────────────────────

export type KeyCount = { key: string; count: number };

/** Count each key; most frequent first, ties broken by key (localeCompare).
 *  The single ordering every Insights top-N ranks with — reasons, referral
 *  sources, nationalities — so a drill's overflow bucket is the chart's. */
export function rankKeys(keys: Iterable<string>): KeyCount[] {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Segment value for a top-N chart's folded "Other" slice. */
export const OVERFLOW_SEGMENT = '__other__';

// ── Two-part segments ──────────────────────────────────────────────────────
// A level label can contain '|' ("Youngstarters | Little Stars"), so both
// halves are URI-encoded (encodeURIComponent turns '|' into %7C) and the one
// literal '|' left is the separator. An empty half means "any".

export function encodePairSegment(first: string, second: string): string {
  return `${encodeURIComponent(first)}|${encodeURIComponent(second)}`;
}

export function decodePairSegment(
  segment: string
): { first: string; second: string } | null {
  const bar = segment.indexOf('|');
  if (bar === -1) return null;
  try {
    return {
      first: decodeURIComponent(segment.slice(0, bar)),
      second: decodeURIComponent(segment.slice(bar + 1)),
    };
  } catch {
    return null;
  }
}

// ── Funnel ─────────────────────────────────────────────────────────────────
// Cumulative: every enrolled application also passed verification and
// processing. A blank, unrecognised, Cancelled or Withdrawn status reaches no
// stage — the statuses getConversionFunnel has always left out.

export const FUNNEL_STAGES = [
  'Submitted',
  'Ongoing Verification',
  'Processing',
  'Enrolled',
] as const;
export type FunnelStageName = (typeof FUNNEL_STAGES)[number];

const ENROLLED_STATUSES = ['Enrolled', 'Enrolled (Conditional)'] as const;

const REACHED_STAGE: Record<FunnelStageName, ReadonlySet<string>> = {
  Submitted: new Set([
    'Submitted',
    'Ongoing Verification',
    'Processing',
    ...ENROLLED_STATUSES,
  ]),
  'Ongoing Verification': new Set([
    'Ongoing Verification',
    'Processing',
    ...ENROLLED_STATUSES,
  ]),
  Processing: new Set(['Processing', ...ENROLLED_STATUSES]),
  Enrolled: new Set(ENROLLED_STATUSES),
};

export function isFunnelStageName(
  value: string | null | undefined
): value is FunnelStageName {
  return (FUNNEL_STAGES as readonly string[]).includes(value ?? '');
}

export function hasReachedFunnelStage(
  status: string | null | undefined,
  stage: FunnelStageName
): boolean {
  return REACHED_STAGE[stage].has((status ?? '').trim());
}

// ── Enrolment ──────────────────────────────────────────────────────────────

export function isEnrolledApplication(
  status: string | null | undefined
): boolean {
  return (ENROLLED_STATUSES as readonly string[]).includes(
    (status ?? '').trim()
  );
}

/** Whole days from application (`created_at`) to enrolment (`enrolledAt`,
 *  migration 075). Null when not enrolled, when either timestamp is missing
 *  or unreadable, or when enrolment is stamped before the application. */
export function daysToEnrol(input: {
  status: string | null | undefined;
  createdAt: string | null | undefined;
  enrolledAt: string | null | undefined;
}): number | null {
  if (!isEnrolledApplication(input.status)) return null;
  if (!input.createdAt || !input.enrolledAt) return null;
  const start = Date.parse(input.createdAt);
  const end = Date.parse(input.enrolledAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000);
}

// ── Intake month ───────────────────────────────────────────────────────────

/** HFSE AY months in order (Jan = 0 … Nov = 10). December is excluded — it
 *  falls outside the HFSE academic year window (KD #13). */
export const AY_MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
] as const;

export type AyMonthLabel = (typeof AY_MONTH_LABELS)[number];

/** The intake chart's month for an application: the UTC month of
 *  `created_at`, year ignored. Null for December, blank or unreadable. */
export function intakeMonthIndex(
  createdAt: string | null | undefined
): number | null {
  if (!createdAt) return null;
  const month = new Date(createdAt).getUTCMonth();
  if (Number.isNaN(month) || month > 10) return null;
  return month;
}

// ── Level as applied / withdrawal ─────────────────────────────────────────

/** The application's own `levelApplied`, blank as 'Unknown' — the level the
 *  withdrawn and cancellation-reason charts group by. */
export function levelAsAppliedKey(raw: string | null | undefined): string {
  return (raw ?? '').trim() || 'Unknown';
}

export function isWithdrawnApplication(
  status: string | null | undefined
): boolean {
  return (status ?? '').trim() === 'Withdrawn';
}

// ── Terminal (cancellation) reasons ────────────────────────────────────────

export type ReasonCount = { reason: string; count: number };

export const UNSPECIFIED_REASON = 'Unspecified';

/** How many individual reasons the donut names before folding the rest into
 *  a single "Other reasons" bucket. */
export const TOP_REASON_COUNT = 5;

/** The overflow bar's key in selectTopReasonBars (lib/admissions/insights.ts). */
export const OTHER_REASONS_BAR_KEY = 'other_reasons';

/** Null = no reason recorded (not on the chart at all); a blank reason is
 *  'Unspecified'. */
export function terminalReasonKey(
  raw: string | null | undefined
): string | null {
  if (raw === null || raw === undefined) return null;
  return raw.trim() || UNSPECIFIED_REASON;
}

export function sortReasonCounts(keys: Iterable<string>): ReasonCount[] {
  return rankKeys(keys).map(({ key, count }) => ({ reason: key, count }));
}

export function topReasonKeys(keys: Iterable<string>): Set<string> {
  return new Set(
    sortReasonCounts(keys)
      .slice(0, TOP_REASON_COUNT)
      .map((r) => r.reason)
  );
}

/** Humanize a terminal-reason code via the schema label map; fall back to the
 *  raw stored string (e.g. 'Unspecified' / 'Other free-text') when unmapped. */
export function reasonLabel(reason: string): string {
  return (
    (APPLICATION_TERMINAL_REASON_LABELS as Record<string, string>)[reason] ??
    reason
  );
}

// ── Referral source ────────────────────────────────────────────────────────

export const REFERRAL_TOP_COUNT = 8;

export function referralSourceKey(raw: string | null | undefined): string {
  return (raw ?? '').trim() || 'Not specified';
}

/** Maps a source key to itself when it is among the top eight, else to
 *  OVERFLOW_SEGMENT. Every source keeps its name when there are ≤ 8. */
export function referralBucketer(
  keys: Iterable<string>
): (key: string) => string {
  const ranked = rankKeys(keys);
  if (ranked.length <= REFERRAL_TOP_COUNT) return (key) => key;
  const named = new Set(ranked.slice(0, REFERRAL_TOP_COUNT).map((r) => r.key));
  return (key) => (named.has(key) ? key : OVERFLOW_SEGMENT);
}

// ── Category ───────────────────────────────────────────────────────────────

export const UNSPECIFIED_CATEGORY = 'Unspecified';

const CATEGORY_SET: ReadonlySet<string> = new Set(ENROLEE_CATEGORIES);

export function categoryMixKey(raw: string | null | undefined): string {
  const cat = (raw ?? '').trim();
  return cat && CATEGORY_SET.has(cat) ? cat : UNSPECIFIED_CATEGORY;
}

// ── Nationality ────────────────────────────────────────────────────────────
// Moved verbatim from lib/admissions/insights-funnel.ts (which re-exports
// them) — see the measurement notes there (probe 2026-08-17).

/** Spelling variants seen in production that `countries-list` names
 *  differently. Keyed lowercase; extend only from probe output, never from
 *  imagination. */
const NATIONALITY_ALIASES: Record<string, string> = {
  'viet nam': 'Vietnam',
};

/** lowercase country name → its canonical casing, built once. */
const CANONICAL_BY_LOWER: Map<string, string> = new Map(
  Array.from(COUNTRY_NAME_SET, (name) => [name.toLowerCase(), name])
);

/**
 * Trim, collapse internal whitespace, apply a known alias, then snap to the
 * canonical country-name casing when we recognise it. An unrecognised value
 * is preserved exactly as the parent typed it. Returns null for blank/null,
 * which the caller buckets as 'Unspecified'.
 */
export function canonicaliseNationality(value: string | null): string | null {
  const trimmed = (value ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const aliased = NATIONALITY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
  return CANONICAL_BY_LOWER.get(aliased.toLowerCase()) ?? aliased;
}

/**
 * Admissions' `levelApplied` is free text and drifts (measured 2026-08-17).
 * Folds the SPELLING variants of the Youngstarters programme together and
 * nothing else; blank → 'Not specified'; anything unrecognised passes
 * through untouched.
 */
export function canonicaliseLevelApplied(raw: string | null): string {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Not specified';
  const flat = trimmed.toLowerCase().replace(/[^a-z]/g, '');
  if (flat.startsWith('youngstarter')) {
    if (flat.includes('little')) return 'Youngstarters | Little Stars';
    if (flat.includes('junior')) return 'Youngstarters | Junior Stars';
    if (flat.includes('senior')) return 'Youngstarters | Senior Stars';
    return 'Youngstarters';
  }
  return trimmed;
}

/** Top nationalities named on the mix pie. */
export const NATIONALITY_MIX_LIMIT = 8;
/** Top nationalities named on the nationality × level bars. */
export const NATIONALITY_BY_LEVEL_LIMIT = 6;

/** Maps a raw nationality to the bucket the chart draws it in: its canonical
 *  name when among the top `limit`, 'Other' past it, 'Unspecified' blank. */
export function nationalityBucketer(
  values: Iterable<string | null>,
  limit: number
): (value: string | null) => string {
  const names: string[] = [];
  for (const v of values) {
    const name = canonicaliseNationality(v);
    if (name) names.push(name);
  }
  const top = new Set(
    rankKeys(names)
      .slice(0, Math.max(0, limit))
      .map((r) => r.key)
  );
  return (value) => {
    const name = canonicaliseNationality(value);
    if (!name) return 'Unspecified';
    return top.has(name) ? name : 'Other';
  };
}
