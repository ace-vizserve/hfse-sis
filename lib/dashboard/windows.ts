import { unstable_cache } from 'next/cache';

import { createServiceClient } from '@/lib/supabase/service';
import { toISODate, type AYWindows, type DateRange, type TermWindows } from './range';

/**
 * Server-side window resolver — turns the `terms` table into the
 * `thisTerm`/`lastTerm` ranges and derives `thisAY`/`lastAY` deterministically
 * from the AY code per KD #13 (HFSE AY runs January through November of a
 * single calendar year — AY2026 = Jan 1 → Nov 30 2026).
 *
 * Term windows stay data-driven — the registrar configures real term-start /
 * term-end dates in `terms.start_date` / `terms.end_date` and those drive
 * "This term" / "Last term" presets. AY windows do NOT depend on term dates
 * being populated, so dashboards land on a sensible default range even when
 * a freshly-created AY's terms still have NULL dates.
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

  // AY windows are derived from the AY code per KD #13 (single calendar year
  // Jan–Nov). Robust to NULL term dates and matches the AY-label convention.
  const thisAY = computeAyWindowFromCode(ayCode);
  const priorAyCode = computePriorAyCode(ayCode);
  const lastAY = priorAyCode ? computeAyWindowFromCode(priorAyCode) : null;

  return {
    term: { thisTerm, lastTerm },
    ay: { thisAY, lastAY },
  };
}

/**
 * "AY2026" → { from: '2026-01-01', to: '2026-11-30' }.
 * Returns null if the code doesn't fit `^AY[0-9]{4}$`.
 *
 * KD #13: HFSE academic year runs January through November of a single
 * calendar year — the four digits in the AY code ARE the calendar year.
 */
export function computeAyWindowFromCode(ayCode: string): DateRange | null {
  const m = /^AY(\d{4})$/.exec(ayCode);
  if (!m) return null;
  const year = m[1];
  return { from: `${year}-01-01`, to: `${year}-11-30` };
}

/** "AY2026" → "AY2025". Returns null if the code doesn't fit that shape. */
function computePriorAyCode(ayCode: string): string | null {
  const m = /^AY(\d{4})$/.exec(ayCode);
  if (!m) return null;
  return `AY${Number(m[1]) - 1}`;
}

