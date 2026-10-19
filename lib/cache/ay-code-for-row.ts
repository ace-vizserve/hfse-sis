import type { SupabaseClient } from '@supabase/supabase-js';

import { requireCurrentAyCode } from '@/lib/academic-year';

// The academic year a written row belongs to, for cache invalidation. A write
// from a past year's page must clear THAT year's cached dashboards, not the
// current year's. Falls back to the current year when the row can't be placed
// (so behaviour is never worse than before). Never throws: this runs after the
// write has succeeded.

type AyJoin = {
  academic_years: { ay_code: string } | { ay_code: string }[] | null;
};

function codeFrom(row: unknown): string | null {
  const joined = (row as AyJoin | null)?.academic_years;
  if (!joined) return null;
  const one = Array.isArray(joined) ? joined[0] : joined;
  return one?.ay_code ?? null;
}

async function ayCodeFor(
  service: SupabaseClient,
  table: 'terms' | 'sections',
  id: string | null | undefined
): Promise<string> {
  if (id) {
    try {
      const { data } = await service
        .from(table)
        .select('academic_years(ay_code)')
        .eq('id', id)
        .maybeSingle();
      const code = codeFrom(data);
      if (code) return code;
    } catch {
      // fall through to the current year
    }
  }
  return requireCurrentAyCode(service);
}

export function ayCodeForTerm(
  service: SupabaseClient,
  termId: string | null | undefined
): Promise<string> {
  return ayCodeFor(service, 'terms', termId);
}

export function ayCodeForSection(
  service: SupabaseClient,
  sectionId: string | null | undefined
): Promise<string> {
  return ayCodeFor(service, 'sections', sectionId);
}
