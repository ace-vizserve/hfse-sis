import 'server-only';

import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AdmissionOptionWithLevel,
  AdmissionSchedule,
  AdmissionTrack,
} from '@/lib/admissions/options';

// Server-side loader for `admission_options` (migration 174). The table has RLS
// on and no policies, so the only client that can read it is the service
// client — callers pass one in.

/**
 * The cache tag for one AY's options. Every write to `admission_options` must
 * `revalidateTag(admissionOptionsTag(ayCode))` — the Phase 3 write routes call
 * this helper rather than spelling the string, so the reader and the writers
 * cannot drift apart by a character.
 *
 * ⚠ Deliberately NOT one of the `invalidateDrillTags()` families: nothing a
 * dashboard shows depends on which options are open, so busting a module's
 * drill tags on an option toggle would be pure collateral.
 */
export function admissionOptionsTag(ayCode: string): string {
  return `admission-options:${ayCode}`;
}

/** A full row joined with its level code — what the admin page and the endpoint read. */
export type AdmissionOptionRecord = AdmissionOptionWithLevel & {
  id: string;
  level_id: string;
  track: AdmissionTrack;
};

type AdmissionOptionDb = {
  id: string;
  level_label: string;
  level_id: string;
  class_type_label: string;
  track: AdmissionTrack;
  schedule: AdmissionSchedule;
  is_open: boolean;
  sort_order: number;
  levels: { code: string } | { code: string }[] | null;
};

/**
 * Every row for the AY, open and closed, in `sort_order`. The AY is matched by
 * code through an inner join on `academic_years`, so an unknown code simply
 * returns no rows. Exported for scripts, which cannot run `unstable_cache`.
 */
export async function loadAdmissionOptionsUncached(
  service: SupabaseClient,
  ayCode: string
): Promise<AdmissionOptionRecord[]> {
  const { data, error } = await service
    .from('admission_options')
    .select(
      'id, level_label, level_id, class_type_label, track, schedule, is_open, sort_order, levels(code), academic_years!inner(ay_code)'
    )
    .eq('academic_years.ay_code', ayCode)
    .order('sort_order', { ascending: true })
    .order('level_label', { ascending: true })
    .order('class_type_label', { ascending: true })
    .order('schedule', { ascending: true });

  if (error) throw error;

  return ((data ?? []) as unknown as AdmissionOptionDb[]).map((row) => {
    const level = Array.isArray(row.levels) ? row.levels[0] : row.levels;
    return {
      id: row.id,
      level_label: row.level_label,
      level_id: row.level_id,
      level_code: level?.code ?? null,
      class_type_label: row.class_type_label,
      track: row.track,
      schedule: row.schedule,
      is_open: row.is_open,
      sort_order: row.sort_order,
    };
  });
}

/**
 * Cached for 300s under `admissionOptionsTag(ayCode)`. Composed per call
 * because the tag is per-AY (11-performance-patterns §2); the service client
 * is captured by the closure so it never reaches the cache key, and `ayCode`,
 * which the closure also captures, is named in `keyParts` so two years can
 * never serve each other's rows.
 */
export function loadAdmissionOptions(
  service: SupabaseClient,
  ayCode: string
): Promise<AdmissionOptionRecord[]> {
  return unstable_cache(
    () => loadAdmissionOptionsUncached(service, ayCode),
    ['admission-options', ayCode],
    {
      revalidate: 300,
      tags: [admissionOptionsTag(ayCode)],
    }
  )();
}
