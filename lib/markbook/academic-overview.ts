import 'server-only';

import { sgToday } from '@/lib/dates';
import {
  computeAcademicOverview,
  NO_FILTERS,
  type AcademicOverview,
  type AcademicOverviewFilters,
} from '@/lib/markbook/academic-overview-compute';
import { getOverviewData } from '@/lib/markbook/overview-data';

// School-wide Academic Overview.
//
// The database read lives in overview-data.ts and is shared with the Awards
// page; everything left here is the pure aggregation over it.

/**
 * `today` is resolved per request rather than inside the cached sweep so the
 * page rolls over at the Singapore date boundary (KD #32) — otherwise a term
 * that finished overnight would keep reporting as in progress for as long as
 * the cache entry lived.
 *
 * Filters are applied AFTER the cache, not baked into its key: they change only
 * the maths, so narrowing to one class recomputes in memory rather than
 * re-reading the year.
 */
export async function getAcademicOverview(
  ayCode: string,
  academicYearId: string,
  filters: AcademicOverviewFilters = NO_FILTERS
): Promise<AcademicOverview> {
  const data = await getOverviewData(ayCode, academicYearId);
  return computeAcademicOverview({ ...data, today: sgToday(), filters });
}
