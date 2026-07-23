import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/auth/roles';

// Returns the badge count to show on the "Change requests" sidebar item
// for the given role. Single indexed query per layout render. No caching
// (layout already runs per-request and we want a live-ish number).
//
// Per-role scope MUST mirror what /markbook/change-requests actually shows
// — otherwise the sidebar badge over-counts and the user clicks through to
// an empty inbox (the bug we hit during demo prep). Specifically:
//   - school_admin / superadmin: pending CRs WHERE the user is the primary
//     or secondary designated approver (KD #41), OR legacy rows with both
//     approver columns NULL (broadcast-visible during the migration).
//   - registrar: approved CRs (the ones they apply via Path A — they have
//     full visibility regardless of approver assignment).
//   - teacher: their OWN pending requests.
export async function getSidebarChangeRequestCount(
  service: SupabaseClient,
  role: Role,
  userId: string
): Promise<number> {
  // Resolve current AY id once; if none, no CRs are in-scope for any role.
  const { data: ayData } = await service
    .from('academic_years')
    .select('id')
    .eq('is_current', true)
    .maybeSingle();
  const currentAyId = (ayData as { id: string } | null)?.id ?? null;
  if (!currentAyId) return 0;

  // Nested !inner join via grading_sheet → section.academic_year_id mirrors
  // the page query at app/(markbook)/markbook/change-requests/page.tsx so
  // the badge and the page agree on which AY's CRs are in-scope. Without
  // this, stale pending CRs from prior/test AYs inflate the badge.
  let query = service
    .from('grade_change_requests')
    .select(
      'id, grading_sheet:grading_sheets!inner(section:sections!inner(academic_year_id))',
      { count: 'exact', head: true }
    )
    .eq('grading_sheet.section.academic_year_id', currentAyId);

  if (role === 'teacher') {
    query = query.eq('requested_by', userId).eq('status', 'pending');
  } else if (role === 'academic_coordinator') {
    query = query.eq('status', 'approved');
  } else if (role === 'school_admin' || role === 'superadmin') {
    query = query
      .eq('status', 'pending')
      .or(
        `primary_approver_id.eq.${userId},secondary_approver_id.eq.${userId},and(primary_approver_id.is.null,secondary_approver_id.is.null)`
      );
  } else {
    return 0;
  }

  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}
