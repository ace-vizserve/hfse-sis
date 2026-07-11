import { unstable_cache } from 'next/cache';

import { getAyIdByCode } from '@/lib/dashboard/ay-id';
import { createServiceClient } from '@/lib/supabase/service';

// SIS Admin sidebar "Sections" count chip (SIS Admin visual pass, Task V2).
// One cheap head-count query, cached per KD #46's hoist-uncached /
// wrap-unstable_cache idiom and tagged `sis:${ayCode}` so it invalidates
// alongside every other sis-scoped loader (section create/delete, AY
// rollover, template apply).
async function loadSectionsCountUncached(ayCode: string): Promise<number> {
  const ayId = await getAyIdByCode(ayCode);
  if (ayId == null) return 0;

  const service = createServiceClient();
  const { count } = await service
    .from('sections')
    .select('id', { count: 'exact', head: true })
    .eq('academic_year_id', ayId);

  return count ?? 0;
}

export function getSectionsCount(ayCode: string): Promise<number> {
  return unstable_cache(
    loadSectionsCountUncached,
    ['sis', 'sidebar-sections-count', ayCode],
    { tags: ['sis', `sis:${ayCode}`], revalidate: 120 }
  )(ayCode);
}
