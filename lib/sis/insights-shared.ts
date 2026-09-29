// Records Insights — pure helpers shared by the Insights loaders
// (lib/sis/records-insights.ts, server-only) and the drill filter
// (lib/sis/drill.ts, imported by client components). One function per rule so
// the number on the page and the list behind it can never count differently
// (KD #82/#124).
//
// ⚠ CLIENT-SAFE. No `server-only`, no database client, no import from a
// server-only module — `lib/sis/drill.ts` imports this file and is itself
// imported by 'use client' components.

import {
  WITHDRAWAL_REASON_VALUES,
  type WithdrawalReason,
} from '@/lib/schemas/enrolment';
import { ENROLEE_CATEGORIES } from '@/lib/schemas/sis';
import { LEVEL_LABELS } from '@/lib/sis/levels';

// ── Months ──────────────────────────────────────────────────────────────────

export const MONTH_LABELS = [
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
  'Dec',
] as const;

/** HFSE's AY runs January–November (KD #13) — the movement chart's axis. */
export const INSIGHTS_MOVEMENT_MONTHS: readonly string[] = MONTH_LABELS.slice(
  0,
  11
);

/** 0-based month of an ISO `yyyy-mm-dd`, or -1 when it cannot be read. */
export function movementMonthIndex(date: string | null | undefined): number {
  const n = Number((date ?? '').slice(5, 7)) - 1;
  return Number.isInteger(n) && n >= 0 && n <= 11 ? n : -1;
}

// ── Levels ──────────────────────────────────────────────────────────────────

/**
 * Terminal grade codes. A prior-year student in one of these levels GRADUATED
 * — their absence the next year is completion, not attrition — so they are
 * excluded from retention entirely (the overall rate, the by-level chart, and
 * the retention drill).
 */
export const TERMINAL_LEVEL_CODES: ReadonlySet<string> = new Set(['S4']);

const TERMINAL_LEVEL_LABELS: ReadonlySet<string> = new Set(
  [...TERMINAL_LEVEL_CODES].map(
    (code) => LEVEL_LABELS[code as keyof typeof LEVEL_LABELS]
  )
);

/** True for a terminal grade, given its label ("Secondary Four") or code ("S4"). */
export function isTerminalLevel(levelValue: string): boolean {
  const v = levelValue.trim();
  return TERMINAL_LEVEL_CODES.has(v) || TERMINAL_LEVEL_LABELS.has(v);
}

const LABEL_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(LEVEL_LABELS).map(([code, label]) => [label, code])
);

/**
 * Level label → short code ("Primary One" → "P1") for the compact Insights
 * axes. A label outside the fixed catalog (e.g. "Youngstarters") is returned
 * as it is — so a chart axis and a drill segment built from it still agree.
 */
export function levelShortCode(label: string): string {
  return LABEL_TO_CODE[label] ?? label;
}

/**
 * Does a row's level label answer a clicked segment? Charts plot the short
 * code (Distribution, Retention) or the label (late, withdrawals, nationality
 * by level); both resolve here, through the same `levelShortCode` the charts
 * use.
 */
export function levelMatchesSegment(
  levelLabel: string | null | undefined,
  segment: string
): boolean {
  const label = (levelLabel ?? '').trim() || 'Unknown';
  return label === segment || levelShortCode(label) === segment;
}

export type LevelEmbed = { label?: string | null; code?: string | null };

/** The loaders' level rule: the label, else the code, else 'Unknown'. */
export function levelLabelOf(
  levels: LevelEmbed | LevelEmbed[] | null | undefined
): string {
  const lvl = Array.isArray(levels) ? levels[0] : levels;
  return lvl?.label?.trim() || lvl?.code?.trim() || 'Unknown';
}

/** On roll = any class row that is not withdrawn (graduated included). */
export function isOnRoll(enrollmentStatus: string | null | undefined): boolean {
  return enrollmentStatus !== 'withdrawn';
}

// ── Enrolee category ────────────────────────────────────────────────────────

export const UNSPECIFIED_CATEGORY = 'Unspecified';

/**
 * The enrolled category mix's bucket for one class row: the admissions
 * category for its enrolee number when it is one of ENROLEE_CATEGORIES,
 * otherwise 'Unspecified' — never dropped.
 */
export function enrolledCategoryBucket(
  enroleeNumber: string | null | undefined,
  categoryByEnroleeNumber: Map<string, string>
): string {
  const en = enroleeNumber?.trim();
  const cat = (en ? categoryByEnroleeNumber.get(en) : undefined)?.trim();
  return cat && (ENROLEE_CATEGORIES as readonly string[]).includes(cat)
    ? cat
    : UNSPECIFIED_CATEGORY;
}

// ── Movement events ─────────────────────────────────────────────────────────

export type WithdrawalControllability = 'controllable' | 'structural';
export type ControllabilityBucket = WithdrawalControllability | 'unspecified';

/**
 * controllable = the school can realistically act on it; structural = largely
 * external. 'other' is structural so the preventable share is never inflated
 * by unknowns.
 */
export const WITHDRAWAL_CONTROLLABILITY: Record<
  WithdrawalReason,
  WithdrawalControllability
> = {
  financial: 'controllable',
  disciplinary: 'controllable',
  academic_fit: 'controllable',
  transferred_other_school: 'structural',
  family_relocation: 'structural',
  health: 'structural',
  other: 'structural',
} satisfies Record<WithdrawalReason, WithdrawalControllability>;

/** The raw reason's class; blank or unrecognised → 'unspecified'. */
export function controllabilityOf(
  rawReason: string | null | undefined
): ControllabilityBucket {
  const raw = (rawReason ?? '').trim();
  if (raw && (WITHDRAWAL_REASON_VALUES as readonly string[]).includes(raw)) {
    return WITHDRAWAL_CONTROLLABILITY[raw as WithdrawalReason];
  }
  return 'unspecified';
}

export const UNSPECIFIED_REASON = 'Unspecified';

export function withdrawalReasonLabelOf(e: {
  reasonLabel?: string | null;
}): string {
  return (e.reasonLabel ?? '').trim() || UNSPECIFIED_REASON;
}

export function movementLevelOf(e: { level?: string | null }): string {
  return (e.level ?? '').trim() || 'Unknown';
}

/** Mid-year joins: late enrollees and re-enrolments. Transfers move nobody. */
export function isMidYearJoinKind(kind: string): boolean {
  return kind === 'late-enrolled' || kind === 're-enrolled';
}

// ── Drill segments ──────────────────────────────────────────────────────────

export type InsightsSegmentKey =
  | 'level'
  | 'term'
  | 'flow'
  | 'month'
  | 'reason'
  | 'outcome'
  | 'category'
  | 'nationality';
export type InsightsSegment = Partial<Record<InsightsSegmentKey, string>>;

const SEGMENT_KEY_ORDER: readonly InsightsSegmentKey[] = [
  'level',
  'term',
  'flow',
  'month',
  'reason',
  'outcome',
  'category',
  'nationality',
];

/** `{ level: 'P1', outcome: 'returned' }` → `'level:P1|outcome:returned'`. */
export function encodeInsightsSegment(parts: InsightsSegment): string | null {
  const bits = SEGMENT_KEY_ORDER.filter(
    (k) => parts[k] !== undefined && parts[k] !== ''
  ).map((k) => `${k}:${parts[k]}`);
  return bits.length > 0 ? bits.join('|') : null;
}

/**
 * The reverse. `{}` for no segment (the whole population); `null` when the
 * segment is present but unreadable — the filter then opens an empty list
 * rather than silently showing everyone.
 */
export function parseInsightsSegment(
  segment: string | null | undefined
): InsightsSegment | null {
  if (!segment) return {};
  const out: InsightsSegment = {};
  for (const part of segment.split('|')) {
    const i = part.indexOf(':');
    if (i <= 0) return null;
    const key = part.slice(0, i) as InsightsSegmentKey;
    if (!SEGMENT_KEY_ORDER.includes(key)) return null;
    out[key] = part.slice(i + 1);
  }
  return out;
}

// ── Chart wrapper helpers ───────────────────────────────────────────────────

/** A click on the comparison series opens the comparison year (Review Focus #1). */
export function pickSeriesAy(
  series: string | undefined,
  compareSeriesKey: string,
  selectedAy: string,
  compareAy: string | null
): string {
  return series === compareSeriesKey && compareAy ? compareAy : selectedAy;
}

/** 'Term 2' (the late-by-term bar's category) → 'term:2'. */
export function termSegmentFromLabel(label: string): string | null {
  const m = /(\d+)\s*$/.exec(label);
  return m ? encodeInsightsSegment({ term: m[1] }) : null;
}
