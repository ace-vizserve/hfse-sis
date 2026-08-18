import 'server-only';

import {
  computeAwardsOverview,
  NO_AWARD_FILTERS,
  type AwardsOverview,
  type AwardsOverviewFilters,
} from '@/lib/markbook/awards-overview-compute';
import { getOverviewData } from '@/lib/markbook/overview-data';

// School-wide Awards.
//
// The database read lives in overview-data.ts and is shared with the Academic
// Summary, so both pages see one set of rows and one set of award thresholds;
// everything left here is the pure aggregation over it.
//
// Filters are applied AFTER the cache rather than baked into its key: they
// change only the maths, so narrowing to one class or one subject's award
// recomputes in memory instead of re-reading the year.
export async function getAwardsOverview(
  ayCode: string,
  academicYearId: string,
  filters: AwardsOverviewFilters = NO_AWARD_FILTERS
): Promise<AwardsOverview> {
  const data = await getOverviewData(ayCode, academicYearId);
  return computeAwardsOverview({ ...data, filters });
}
