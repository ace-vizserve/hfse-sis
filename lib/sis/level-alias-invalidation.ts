import 'server-only';

import { revalidateTag } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import { LEVEL_ALIASES_TAG } from '@/lib/sis/levels';

/**
 * Bust everything a `level_aliases` write moves.
 *
 * An alias is not scoped to a year: it changes the level a name resolves to
 * in EVERY academic year that carries that name (makeLevelLabelResolver). So
 * the operational dashboards and drills of every year are stale, not only the
 * current one — busting a subset left a non-current year's chart (600s cache)
 * disagreeing with its drill (60s) for up to ten minutes.
 *
 * Used by every alias writer: /api/sis/level-aliases and the enrolment form
 * options' POST and group PATCH. A failed academic_years read still busts the
 * alias tag itself; it only logs, since the alias write has already committed.
 */
export async function invalidateAfterLevelAliasChange(
  service: SupabaseClient
): Promise<void> {
  revalidateTag(LEVEL_ALIASES_TAG, 'max');

  const { data, error } = await service
    .from('academic_years')
    .select('ay_code');
  if (error) {
    console.warn(
      '[sis/level-alias-invalidation] academic_years read failed:',
      error.message
    );
    return;
  }
  for (const row of (data ?? []) as { ay_code: string | null }[]) {
    if (row.ay_code) invalidateAllOperationalDrills(row.ay_code);
  }
}
