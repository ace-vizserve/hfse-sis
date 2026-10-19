import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getCurrentAcademicYear,
  listAyCodes,
  type CurrentAcademicYear,
} from '@/lib/academic-year';

export type SelectedAy = {
  /** The year the page is showing: `?ay=` when it names a real year, else the current one. */
  selected: CurrentAcademicYear;
  /** The school's current year. */
  current: CurrentAcademicYear;
  ayCodes: string[];
  isCurrent: boolean;
};

/**
 * Resolves the academic year a Markbook page is about. `?ay=` is validated
 * against the real list of years (an unknown code falls back to the current
 * year). Returns null only when no current year is configured.
 */
export async function resolveSelectedAy(
  service: SupabaseClient,
  ayParam: string | string[] | undefined
): Promise<SelectedAy | null> {
  const [current, ayCodes] = await Promise.all([
    getCurrentAcademicYear(service),
    listAyCodes(service),
  ]);
  if (!current) return null;
  const requested = typeof ayParam === 'string' ? ayParam : undefined;
  if (
    !requested ||
    requested === current.ay_code ||
    !ayCodes.includes(requested)
  ) {
    return { selected: current, current, ayCodes, isCurrent: true };
  }
  const { data } = await service
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('ay_code', requested)
    .maybeSingle();
  if (!data) return { selected: current, current, ayCodes, isCurrent: true };
  return {
    selected: data as CurrentAcademicYear,
    current,
    ayCodes,
    isCurrent: false,
  };
}
