import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/auth/roles';

// Returns the badge count to show on the "Change requests" sidebar item
// for the given role. Single indexed query per layout render. No caching
// (layout already runs per-request and we want a live-ish number).
export async function getSidebarChangeRequestCount(
  service: SupabaseClient,
  role: Role,
  userId: string,
): Promise<number> {
  let query = service
    .from('grade_change_requests')
    .select('id', { count: 'exact', head: true });

  if (role === 'teacher') {
    query = query.eq('requested_by', userId).eq('status', 'pending');
  } else if (role === 'registrar') {
    query = query.eq('status', 'approved');
  } else if (role === 'school_admin' || role === 'superadmin') {
    query = query.eq('status', 'pending');
  } else {
    return 0;
  }

  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}
