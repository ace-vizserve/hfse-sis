// ⚠ NO `import 'server-only'`, for the same reason as `materialise.ts` beside
// it: `scripts/repair-declaration-approvals.ts` reaches this (through
// `lib/declarations/approval.ts`) and runs under tsx, where the `server-only`
// package throws outright.
//
//   THIS IS SERVER CODE. Call it with the service-role client.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ApproverLevelScope } from '@/lib/schemas/approval-flows';

/**
 * `section_id` → which half of the school it belongs to.
 *
 * Every consumer of the approval engine needs this, because a named step only
 * freezes the people who cover the child's half (migration 128). It lived in
 * `lib/declarations/approval.ts` while declarations were the only consumer;
 * grade changes are the second, so it moved here. The declarations module
 * re-exports it, so every existing importer keeps working.
 *
 * Read from `levels.level_type` rather than derived from a level CODE. The
 * column is the school's own answer and already carries preschool; a code map
 * is a second copy of it that can drift.
 */
export async function loadLevelTypesBySection(
  service: SupabaseClient,
  sectionIds: string[]
): Promise<Map<string, ApproverLevelScope | null>> {
  const out = new Map<string, ApproverLevelScope | null>();
  const ids = [...new Set(sectionIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const { data, error } = await service
    .from('sections')
    .select('id, levels(level_type)')
    .in('id', ids);
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    levels:
      | { level_type: ApproverLevelScope }
      | { level_type: ApproverLevelScope }[]
      | null;
  };
  for (const row of (data ?? []) as unknown as Row[]) {
    // PostgREST returns an embedded to-one as an object or a single-element
    // array depending on how it infers the relationship; both shapes appear in
    // this codebase, so normalise rather than assume.
    const level = Array.isArray(row.levels) ? row.levels[0] : row.levels;
    out.set(row.id, level?.level_type ?? null);
  }
  return out;
}
