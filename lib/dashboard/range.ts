/**
 * Dashboard range utilities — canonical home for preset resolution,
 * comparison-period auto-compute, and delta math. Imported by every
 * `lib/<module>/dashboard.ts` *Range helper and by the client-side
 * ComparisonToolbar + DateRangePicker.
 *
 * Pure (no Supabase). For DB-sourced term/AY windows, compose with
 * `lib/dashboard/windows.ts` on the server.
 */

export type DateRange = {
  /** yyyy-MM-dd, inclusive. */
  from: string;
  /** yyyy-MM-dd, inclusive. */
  to: string;
};

export type Preset =
  | 'last7d'
  | 'last30d'
  | 'last90d'
  | 'thisTerm'
  | 'lastTerm'
  | 'thisAY'
  | 'lastAY'
  | 'custom';

export const PRESET_LABEL: Record<Preset, string> = {
  last7d: 'Last 7 days',
  last30d: 'Last 30 days',
  last90d: 'Last 90 days',
  thisTerm: 'This term',
  lastTerm: 'Last term',
  thisAY: 'This AY',
  lastAY: 'Last AY',
  custom: 'Custom',
};

export type TermWindows = {
  thisTerm: DateRange | null;
  lastTerm: DateRange | null;
};

export type AYWindows = {
  thisAY: DateRange | null;
  lastAY: DateRange | null;
};

export type RangeInput = {
  ayCode: string;
  /** yyyy-MM-dd */
  from: string;
  to: string;
  /**
   * Comparison range. Both null when the user hasn't opted into a
   * comparison — dashboards default to "current state only" and the user
   * adds a comparison explicitly via the date-range picker.
   */
  cmpFrom: string | null;
  cmpTo: string | null;
};

export type Delta = {
  abs: number;
  /** null when comparison = 0 (undefined %). */
  pct: number | null;
  direction: 'up' | 'down' | 'flat';
};

export type RangeResult<T> = {
  current: T;
  /** Null when the user hasn't opted into a comparison. */
  comparison: T | null;
  /** Null when there's no comparison to compare against. */
  delta: Delta | null;
  range: DateRange;
  /** Null when no comparison is set. */
  comparisonRange: DateRange | null;
};

// ---------------------------------------------------------------------------
// Date primitives — local-midnight to avoid the UTC-shift trap that
// `new Date('2026-04-20')` falls into.

export function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(d: Date, n: number): Date {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  next.setDate(next.getDate() + n);
  return next;
}

/** Inclusive day count: Mar 1 → Mar 3 = 3. */
export function daysInRange(range: DateRange): number {
  const from = parseLocalDate(range.from);
  const to = parseLocalDate(range.to);
  if (!from || !to) return 0;
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

export function isValidRange(range: Partial<DateRange> | null | undefined): range is DateRange {
  if (!range || typeof range.from !== 'string' || typeof range.to !== 'string') return false;
  const f = parseLocalDate(range.from);
  const t = parseLocalDate(range.to);
  return !!f && !!t && f.getTime() <= t.getTime();
}

// ---------------------------------------------------------------------------
// Comparison period — back-to-back prior period of equal length. Pure
// calendar math; suitable for rolling windows (last7d / last30d / last90d).
// For AY-aware comparisons, prefer `autoComparisonAcademic` which year-shifts
// so the comparison lands on the equivalent slice of the prior AY (HFSE AY
// runs Jan–Nov per KD #13; sliding 91 days back from T1 lands on December
// break — academically meaningless).

export function autoComparison(range: DateRange): DateRange | null {
  const from = parseLocalDate(range.from);
  const to = parseLocalDate(range.to);
  if (!from || !to) return null;
  const length = daysInRange(range);
  const cmpTo = addDays(from, -1);
  const cmpFrom = addDays(cmpTo, -(length - 1));
  return { from: toISODate(cmpFrom), to: toISODate(cmpTo) };
}

/**
 * Shift a range back by exactly N years, preserving month + day. Used as
 * the academic-aware comparison default — same dates last AY = same point
 * in the school cycle.
 *
 * Feb 29 in a leap year clamps to Feb 28 when the target year isn't a leap
 * year (matches `lib/attendance/calendar.ts::shiftYearPreserveMonthDay`).
 */
export function shiftRangeByYears(range: DateRange, yearDelta: number): DateRange | null {
  const from = parseLocalDate(range.from);
  const to = parseLocalDate(range.to);
  if (!from || !to) return null;
  const shift = (d: Date): Date => {
    const next = new Date(d.getFullYear() + yearDelta, d.getMonth(), d.getDate());
    // If JS rolled Feb 29 forward to Mar 1 in a non-leap year, clamp back.
    if (d.getMonth() === 1 && d.getDate() === 29 && next.getMonth() !== 1) {
      return new Date(d.getFullYear() + yearDelta, 1, 28);
    }
    return next;
  };
  return { from: toISODate(shift(from)), to: toISODate(shift(to)) };
}

/**
 * Academic-aware comparison auto-compute. Defaults to year-shift (same
 * range, prior AY) so dashboards compare term-on-term and AY-on-AY across
 * the HFSE Jan–Nov cycle. Falls back to back-to-back only for the rolling-
 * window presets (last7d / last30d / last90d) where the user explicitly
 * wants "the previous N days."
 *
 * Pass `windows` so the helper can detect which preset the range matches;
 * use `autoComparison(range)` for the back-to-back math.
 */
export function autoComparisonAcademic(
  range: DateRange,
  windows: { term: TermWindows; ay: AYWindows },
  today?: Date,
): DateRange | null {
  const preset = detectPreset(range, windows, today);
  if (preset === 'last7d' || preset === 'last30d' || preset === 'last90d') {
    return autoComparison(range);
  }
  return shiftRangeByYears(range, -1) ?? autoComparison(range);
}

// ---------------------------------------------------------------------------
// Delta.

export function computeDelta(current: number, comparison: number): Delta {
  const abs = current - comparison;
  const direction: Delta['direction'] = abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat';
  if (comparison === 0) {
    return { abs, pct: current === 0 ? 0 : null, direction };
  }
  return { abs, pct: (abs / Math.abs(comparison)) * 100, direction };
}

/**
 * Format a delta as a short label (e.g. "+12%", "-3", "↔"). Handles the
 * `pct === null` undefined-comparison case.
 */
export function formatDeltaLabel(
  delta: Delta,
  opts?: { format?: 'percent' | 'absolute'; unit?: string },
): string {
  const mode = opts?.format ?? 'percent';
  const unit = opts?.unit ?? '';
  if (delta.direction === 'flat') return '±0' + (unit ? ` ${unit}` : '');
  const sign = delta.direction === 'up' ? '+' : '−';
  if (mode === 'percent') {
    if (delta.pct === null) return sign + '—';
    return `${sign}${Math.abs(delta.pct).toFixed(1)}%`;
  }
  return `${sign}${Math.abs(delta.abs).toLocaleString('en-SG')}${unit ? ` ${unit}` : ''}`;
}

// ---------------------------------------------------------------------------
// Preset resolution.

function lastNDays(n: number, today = new Date()): DateRange {
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const from = addDays(to, -(n - 1));
  return { from: toISODate(from), to: toISODate(to) };
}

export function resolvePreset(
  preset: Preset,
  windows: { term: TermWindows; ay: AYWindows },
  today?: Date,
): DateRange | null {
  switch (preset) {
    case 'last7d':
      return lastNDays(7, today);
    case 'last30d':
      return lastNDays(30, today);
    case 'last90d':
      return lastNDays(90, today);
    case 'thisTerm':
      return windows.term.thisTerm;
    case 'lastTerm':
      return windows.term.lastTerm;
    case 'thisAY':
      return windows.ay.thisAY;
    case 'lastAY':
      return windows.ay.lastAY;
    case 'custom':
      return null;
  }
}

/**
 * Reverse-map a range to the preset it matches (if any). Used by the
 * DateRangePicker to highlight the active preset row.
 */
export function detectPreset(
  range: DateRange,
  windows: { term: TermWindows; ay: AYWindows },
  today?: Date,
): Preset {
  const presets: Preset[] = [
    'last7d',
    'last30d',
    'last90d',
    'thisTerm',
    'lastTerm',
    'thisAY',
    'lastAY',
  ];
  for (const p of presets) {
    const candidate = resolvePreset(p, windows, today);
    if (candidate && candidate.from === range.from && candidate.to === range.to) return p;
  }
  return 'custom';
}

// ---------------------------------------------------------------------------
// URL-param contract.

export type DashboardSearchParams = {
  ay?: string | string[];
  from?: string | string[];
  to?: string | string[];
  cmpFrom?: string | string[];
  cmpTo?: string | string[];
};

function pickString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

/** Two ranges overlap if neither ends before the other begins. */
function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/**
 * Parse URL search params → `RangeInput`. The server auto-computes the
 * comparison period when the URL doesn't supply one. Malformed `from`/`to`
 * fall back to the default (this term → this AY → last 30d).
 *
 * Stale-AY guard: if the URL's `from`/`to` parse cleanly but fall entirely
 * outside the resolved AY's calendar window (e.g., user picked AY2027 from
 * the AY-switcher while the URL still carried `?from=2025-04-01&to=2025-06-30`
 * from the previous AY's view), the stale dates are discarded and the
 * fallback cascade kicks in. The matching `cmpFrom`/`cmpTo` are also
 * dropped so `autoComparisonAcademic` recomputes against the new range.
 */
export function resolveRange(
  params: DashboardSearchParams,
  windows: { term: TermWindows; ay: AYWindows },
  defaultAy: string,
  today?: Date,
): RangeInput {
  const ayCode = pickString(params.ay) || defaultAy;

  const rawFrom = pickString(params.from);
  const rawTo = pickString(params.to);
  const explicitRange: DateRange | null = isValidRange({
    from: rawFrom ?? '',
    to: rawTo ?? '',
  })
    ? { from: rawFrom!, to: rawTo! }
    : null;

  // Reject the explicit range when it sits entirely outside the AY's
  // calendar window. `windows.ay.thisAY` is null only for malformed AY
  // codes — when null, accept any well-formed URL range so non-standard
  // AY codes don't break legitimate pages.
  const ayWindow = windows.ay.thisAY;
  const explicitInAy =
    explicitRange && ayWindow ? rangesOverlap(explicitRange, ayWindow) : true;
  const explicitRangeAccepted = explicitRange != null && explicitInAy;

  const current: DateRange =
    explicitRangeAccepted
      ? explicitRange!
      : windows.term.thisTerm ?? windows.ay.thisAY ?? lastNDays(30, today);

  // Comparison is OPT-IN. The server only honors a comparison range when
  // the URL explicitly carries `cmpFrom` + `cmpTo`. No auto-compute,
  // no default — dashboards land on "current state only" until the user
  // adds a comparison via the date-range picker.
  //
  // Also dropped when the explicit current range was rejected (e.g., a
  // stale AY-mismatched range): the comparison is scoped to that view.
  const rawCmpFrom = explicitRangeAccepted ? pickString(params.cmpFrom) : undefined;
  const rawCmpTo = explicitRangeAccepted ? pickString(params.cmpTo) : undefined;
  const hasCmp =
    !!rawCmpFrom && !!rawCmpTo && isValidRange({ from: rawCmpFrom, to: rawCmpTo });

  return {
    ayCode,
    from: current.from,
    to: current.to,
    cmpFrom: hasCmp ? rawCmpFrom! : null,
    cmpTo: hasCmp ? rawCmpTo! : null,
  };
}

// ---------------------------------------------------------------------------
// Formatting for trust-strip display.

export function formatRangeLabel(range: DateRange): string {
  const from = parseLocalDate(range.from);
  const to = parseLocalDate(range.to);
  if (!from || !to) return `${range.from} – ${range.to}`;
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const sameYear = from.getFullYear() === to.getFullYear();
  const fromStr = from.toLocaleDateString('en-SG', {
    ...opts,
    year: sameYear ? undefined : 'numeric',
  });
  const toStr = to.toLocaleDateString('en-SG', { ...opts, year: 'numeric' });
  return `${fromStr} – ${toStr}`;
}
