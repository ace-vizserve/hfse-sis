import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createServiceClient } from '@/lib/supabase/service';
import type { DateRange } from './range';

/**
 * Compare-mode primitives — types, URL parser, cell builder.
 *
 * Pure (no Supabase) URL parsing; database access only inside
 * `buildCompareCells` for term-window resolution. Consumed by per-module
 * compare RSCs (`/markbook/compare`, `/admissions/compare`, etc.).
 */

/**
 * Compare-mode input. `kind` decides whether cells are term-numbered
 * (academic modules) or month-string (flexible modules). The picker UI
 * enforces the correct kind per route.
 */
export type CompareInput =
  | { kind: 'term'; ays: string[]; terms: number[] }
  // Month-kind is AY-agnostic: each month resolves to its own AY by calendar
  // year inside buildCompareCells (AY codes are single calendar years, KD #13),
  // so the user picks months only — no separate AY axis.
  | { kind: 'month'; months: string[] };

/** A single (AY × term-or-month) intersection — what gets rendered in one cell. */
export type CompareCell = {
  ayCode: string;
  /** Display label e.g. "AY9999 · T1" or "AY9999 · Apr 2026". */
  label: string;
  range: DateRange;
  kind: 'term' | 'month';
  termNumber?: number;
  month?: string;
  termId?: string;
};

export type CompareCellResult<T> = {
  cell: CompareCell;
  data: T;
};

export type CompareResult<T> = {
  cells: CompareCellResult<T>[];
};

/**
 * URL → CompareInput. Returns null on malformed input so the page can
 * render an empty-state prompt.
 */
export function parseCompareParams(params: {
  ays?: string | string[];
  terms?: string | string[];
  months?: string | string[];
}): CompareInput | null {
  const pickStr = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const termsRaw = pickStr(params.terms);
  const monthsRaw = pickStr(params.months);

  // Month-kind (flexible modules) is AY-agnostic — months carry their own year
  // and each resolves to its AY by calendar year in buildCompareCells. No `ays`
  // param required.
  if (monthsRaw) {
    const months = monthsRaw.split(',').filter((m) => /^\d{4}-\d{2}$/.test(m));
    if (months.length === 0) return null;
    return { kind: 'month', months };
  }

  // Term-kind (academic modules) needs the AY axis — terms are AY-relative, so
  // "AY × term" is the meaningful comparison.
  const aysRaw = pickStr(params.ays);
  if (!aysRaw) return null;
  const ays = aysRaw.split(',').filter((c) => /^AY\d{4}$/.test(c));
  if (ays.length === 0) return null;

  if (termsRaw) {
    const terms = termsRaw
      .split(',')
      .map((t) => Number(t.replace(/^T/i, '')))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 4);
    if (terms.length === 0) return null;
    return { kind: 'term', ays, terms };
  }

  return null;
}

/**
 * CompareInput → CompareCell[]. Resolves each (ayCode × term-or-month) to
 * an actual DateRange. Term ranges come from a single cross-AY terms query;
 * month ranges are first-of-month to last-of-month arithmetic (no DB call
 * needed).
 */
export async function buildCompareCells(
  input: CompareInput,
  service?: SupabaseClient
): Promise<CompareCell[]> {
  if (input.kind === 'month') {
    // Each month resolves to the AY whose code matches its calendar year (AY
    // codes are single calendar years, KD #13). Validate against existing AYs so
    // we never query a non-existent ay{YYYY}_* table; the label is just the
    // month (no AY prefix) since the year is already in it.
    const supabase = service ?? createServiceClient();
    const { data: ayRows } = await supabase
      .from('academic_years')
      .select('ay_code');
    const validAys = new Set(
      (ayRows ?? []).map((r) => (r as { ay_code: string }).ay_code)
    );
    const cells: CompareCell[] = [];
    for (const m of input.months) {
      const ay = `AY${m.slice(0, 4)}`;
      if (!validAys.has(ay)) continue;
      cells.push({
        ayCode: ay,
        label: formatMonthLabel(m),
        range: monthToRange(m),
        kind: 'month',
        month: m,
      });
    }
    return cells;
  }

  // Term-kind: pull all relevant terms in one cross-AY query.
  const supabase = service ?? createServiceClient();
  const { data: termsData } = await supabase
    .from('terms')
    .select(
      'id, term_number, start_date, end_date, academic_years!inner(ay_code)'
    )
    .in('academic_years.ay_code', input.ays);
  type Row = {
    id: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
    academic_years: { ay_code: string } | { ay_code: string }[];
  };
  const termsByAy = new Map<
    string,
    Map<number, { range: DateRange; termId: string }>
  >();
  for (const row of (termsData ?? []) as Row[]) {
    if (!row.start_date || !row.end_date) continue;
    const ay = Array.isArray(row.academic_years)
      ? row.academic_years[0]
      : row.academic_years;
    if (!ay?.ay_code) continue;
    if (!termsByAy.has(ay.ay_code)) termsByAy.set(ay.ay_code, new Map());
    termsByAy.get(ay.ay_code)!.set(row.term_number, {
      range: { from: row.start_date, to: row.end_date },
      termId: row.id,
    });
  }

  const cells: CompareCell[] = [];
  for (const ay of input.ays) {
    const ayTerms = termsByAy.get(ay);
    for (const t of input.terms) {
      const termData = ayTerms?.get(t);
      if (!termData) continue;
      cells.push({
        ayCode: ay,
        label: `${ay} · T${t}`,
        range: termData.range,
        kind: 'term',
        termNumber: t,
        termId: termData.termId,
      });
    }
  }
  return cells;
}

function monthToRange(month: string): DateRange {
  // 'YYYY-MM' → first to last day of that month
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${y}-${pad(m)}-01`,
    to: `${y}-${pad(m)}-${pad(last)}`,
  };
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' });
}
