import 'server-only';

import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  PARENT_ACADEMIC_YEARS_TAG,
  toParentAcademicYears,
  type AcademicYearFlagsRow,
  type ParentAcademicYear,
} from '@/lib/admissions/parent-academic-years';

// Server-side loader for the parent portal's year picker. The caller passes a
// service client: the endpoint is public, so there is no session to read with.

/** Uncached read. Exported for scripts, which cannot run `unstable_cache`. */
export async function loadParentAcademicYearsUncached(
  service: SupabaseClient
): Promise<ParentAcademicYear[]> {
  const { data, error } = await service
    .from('academic_years')
    .select(
      'ay_code, is_current, accepting_applications, vizschool_accepting_applications'
    )
    .or(
      'accepting_applications.eq.true,vizschool_accepting_applications.eq.true'
    )
    .not('ay_code', 'like', 'AY9%')
    .order('ay_code', { ascending: true });

  if (error) throw error;
  // Filtered in SQL and again in the pure shaper — the shaper is the rule of
  // record (and the tested one); the SQL filter only keeps the read small.
  return toParentAcademicYears((data ?? []) as AcademicYearFlagsRow[]);
}

/**
 * Cached for 300s under `parent-academic-years`. Busted by the
 * accepting-applications route (both programmes) and by the switch of the
 * current year. The service client is captured by the closure, so it never
 * reaches the cache key.
 */
export function loadParentAcademicYears(
  service: SupabaseClient
): Promise<ParentAcademicYear[]> {
  return unstable_cache(
    () => loadParentAcademicYearsUncached(service),
    ['parent-academic-years'],
    { revalidate: 300, tags: [PARENT_ACADEMIC_YEARS_TAG] }
  )();
}
