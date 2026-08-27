import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { isReliefLive } from '@/lib/auth/teacher-assignments';
import { ADVISER_ROLES } from '@/lib/schemas/teacher-assignment';
import { sgToday } from '@/lib/dates';

/**
 * Who advises a section, right now.
 *
 * ⚠ THE TYPESCRIPT TWIN OF `public.is_section_adviser(section, user)`
 * (migration 126). Same three arms, same order:
 *
 *   1. the form adviser of record
 *   2. a co-adviser (migration 124 — a co role carries the same access)
 *   3. whoever is covering the class, IF today falls inside their window
 *      (migrations 117 / 123)
 *
 * The window is applied here and not left to the policy, for the same reason
 * `loadEffectiveAssignmentsForUser` applies it in TypeScript: this runs on the
 * SERVICE client, which bypasses RLS outright. Relying on the policy would
 * hand a substitute a class they are not covering yet.
 *
 * ⚠ RESOLVED LIVE, NEVER FROZEN. Migration 126's header says why at length:
 * freezing the adviser when the declaration is filed would route a sick
 * child's absence to the teacher who is on leave — which is very often the
 * exact reason a relief teacher is standing in front of that class this week.
 */
export async function resolveAdviserPools(
  service: SupabaseClient,
  sectionIds: string[],
  today: string = sgToday()
): Promise<Map<string, string[]>> {
  const pools = new Map<string, string[]>();
  const unique = [...new Set(sectionIds.filter(Boolean))];
  if (unique.length === 0) return pools;
  for (const id of unique) pools.set(id, []);

  const { data, error } = await service
    .from('teacher_assignments')
    .select(
      'section_id, role, teacher_user_id, relief_teacher_user_id, relief_started_on, relief_ended_on'
    )
    .in('section_id', unique)
    .in('role', [...ADVISER_ROLES]);
  if (error) throw new Error(error.message);

  type Row = {
    section_id: string;
    teacher_user_id: string;
    relief_teacher_user_id: string | null;
    relief_started_on: string | null;
    relief_ended_on: string | null;
  };

  for (const row of (data ?? []) as unknown as Row[]) {
    const pool = pools.get(row.section_id);
    if (!pool) continue;
    if (!pool.includes(row.teacher_user_id)) pool.push(row.teacher_user_id);
    if (
      row.relief_teacher_user_id &&
      isReliefLive(row.relief_started_on, row.relief_ended_on, today) &&
      !pool.includes(row.relief_teacher_user_id)
    ) {
      pool.push(row.relief_teacher_user_id);
    }
  }
  return pools;
}

/** One section. Thin wrapper — the batch form is what avoids N queries. */
export async function resolveAdviserPool(
  service: SupabaseClient,
  sectionId: string,
  today: string = sgToday()
): Promise<string[]> {
  const pools = await resolveAdviserPools(service, [sectionId], today);
  return pools.get(sectionId) ?? [];
}

/**
 * The sections a user advises — the inverse question, and the one the queue
 * asks. Same three arms.
 */
export async function loadAdvisedSectionIds(
  service: SupabaseClient,
  userId: string,
  today: string = sgToday()
): Promise<string[]> {
  const { data, error } = await service
    .from('teacher_assignments')
    .select(
      'section_id, role, teacher_user_id, relief_teacher_user_id, relief_started_on, relief_ended_on'
    )
    .in('role', [...ADVISER_ROLES])
    .or(`teacher_user_id.eq.${userId},relief_teacher_user_id.eq.${userId}`);
  if (error) throw new Error(error.message);

  type Row = {
    section_id: string;
    teacher_user_id: string;
    relief_teacher_user_id: string | null;
    relief_started_on: string | null;
    relief_ended_on: string | null;
  };

  const out = new Set<string>();
  for (const row of (data ?? []) as unknown as Row[]) {
    if (row.teacher_user_id === userId) {
      out.add(row.section_id);
      continue;
    }
    // Holding wins over covering and has no window; only the relief arm is
    // date-bounded. Reaching here means the match was on the relief column.
    if (isReliefLive(row.relief_started_on, row.relief_ended_on, today)) {
      out.add(row.section_id);
    }
  }
  return [...out];
}
