import { unstable_cache } from 'next/cache';

import { createServiceClient } from '@/lib/supabase/service';
import { toISODate, type AYWindows, type DateRange, type TermWindows } from './range';

/**
 * Server-side window resolver — turns the `terms` table into the
 * `thisTerm`/`lastTerm` and `thisAY`/`lastAY` ranges the ComparisonToolbar
 * and preset resolver need.
 *
 * `academic_years` has no start/end columns, so AY windows are computed
 * from min/max term dates per AY.
 */

type TermRow = {
  id: string;
  academic_year_id: string;
  term_number: number;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  ay_code: string;
};

async function loadTermsUncached(): Promise<TermRow[]> {
  // Service client — bypasses RLS. Safe here because we only read
  // `terms` + `academic_years` reference data, no per-user scoping.
  // Required by Next 16: `cookies()`-scoped clients cannot run inside
  // `unstable_cache`.
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('terms')
    .select(
      'id, academic_year_id, term_number, start_date, end_date, is_current, academic_years!inner(ay_code)',
    )
    .order('start_date', { ascending: true, nullsFirst: false });
  if (error) {
    console.error('[dashboard/windows] loadTerms failed', error);
    return [];
  }
  type JoinedRow = Omit<TermRow, 'ay_code'> & { academic_years: { ay_code: string } | { ay_code: string }[] };
  return (data as JoinedRow[] | null ?? []).map((row) => {
    const ay = Array.isArray(row.academic_years) ? row.academic_years[0] : row.academic_years;
    return {
      id: row.id,
      academic_year_id: row.academic_year_id,
      term_number: row.term_number,
      start_date: row.start_date,
      end_date: row.end_date,
      is_current: row.is_current,
      ay_code: ay?.ay_code ?? '',
    };
  });
}

const loadTerms = unstable_cache(loadTermsUncached, ['dashboard', 'windows', 'terms'], {
  revalidate: 300,
  tags: ['dashboard-windows'],
});

export async function getDashboardWindows(
  ayCode: string,
): Promise<{ term: TermWindows; ay: AYWindows }> {
  const terms = await loadTerms();
  const today = toISODate(new Date());

  const ayTerms = terms.filter((t) => t.ay_code === ayCode);
  const sortedAy = ayTerms
    .filter((t) => t.start_date && t.end_date)
    .sort((a, b) => (a.start_date! < b.start_date! ? -1 : 1));

  const current =
    sortedAy.find((t) => t.is_current) ??
    sortedAy.find((t) => t.start_date! <= today && today <= t.end_date!) ??
    sortedAy[sortedAy.length - 1] ??
    null;

  const thisTerm: DateRange | null = current?.start_date && current.end_date
    ? { from: current.start_date, to: current.end_date }
    : null;

  const prior = current
    ? sortedAy
        .filter((t) => t.end_date! < current.start_date!)
        .sort((a, b) => (a.end_date! < b.end_date! ? 1 : -1))[0]
    : null;
  const lastTerm: DateRange | null = prior?.start_date && prior.end_date
    ? { from: prior.start_date, to: prior.end_date }
    : null;

  // AY window = min(start_date) … max(end_date) across that AY's terms
  const thisAY: DateRange | null = sortedAy.length
    ? {
        from: sortedAy[0].start_date!,
        to: sortedAy[sortedAy.length - 1].end_date!,
      }
    : null;

  const priorAyCode = computePriorAyCode(ayCode);
  const priorAyTerms = priorAyCode
    ? terms
        .filter((t) => t.ay_code === priorAyCode && t.start_date && t.end_date)
        .sort((a, b) => (a.start_date! < b.start_date! ? -1 : 1))
    : [];
  const lastAY: DateRange | null = priorAyTerms.length
    ? {
        from: priorAyTerms[0].start_date!,
        to: priorAyTerms[priorAyTerms.length - 1].end_date!,
      }
    : null;

  return {
    term: { thisTerm, lastTerm },
    ay: { thisAY, lastAY },
  };
}

/** "AY2026" → "AY2025". Returns null if the code doesn't fit that shape. */
function computePriorAyCode(ayCode: string): string | null {
  const m = /^AY(\d{4})$/.exec(ayCode);
  if (!m) return null;
  return `AY${Number(m[1]) - 1}`;
}

