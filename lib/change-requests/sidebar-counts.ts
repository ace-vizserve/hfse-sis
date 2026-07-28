import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/auth/roles';
import { fetchLabels } from '@/lib/change-requests/labels';

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
  } else if (role === 'school_admin') {
    query = query
      .eq('status', 'pending')
      .or(
        `primary_approver_id.eq.${userId},secondary_approver_id.eq.${userId},and(primary_approver_id.is.null,secondary_approver_id.is.null)`
      );
  } else if (role === 'superadmin') {
    // Oversight scope: full visibility across all pending requests,
    // regardless of designated approver.
    query = query.eq('status', 'pending');
  } else {
    return 0;
  }

  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}

export type ChangeRequestPreviewRow = {
  id: string;
  field_changed: string;
  reason_category: string;
  requested_at: string;
  grading_sheet_id: string;
  grade_entry_id: string;
  student_label: string | null;
  sheet_label: string | null;
};

// Row-level sibling of getSidebarChangeRequestCount above — same per-role,
// per-current-AY scope, copied rather than re-derived so the notification
// bell's dropdown list can never disagree with the badge count it's paired
// with (KD #124: a card's count and its drill must share one scope). Backs
// GET /api/change-requests/preview.
export async function getSidebarChangeRequestPreview(
  service: SupabaseClient,
  role: Role,
  userId: string,
  limit: number
): Promise<ChangeRequestPreviewRow[]> {
  const { data: ayData } = await service
    .from('academic_years')
    .select('id')
    .eq('is_current', true)
    .maybeSingle();
  const currentAyId = (ayData as { id: string } | null)?.id ?? null;
  if (!currentAyId) return [];

  let query = service
    .from('grade_change_requests')
    .select(
      `id, field_changed, reason_category, requested_at,
       grading_sheet_id, grade_entry_id,
       grading_sheet:grading_sheets!inner(section:sections!inner(academic_year_id))`
    )
    .eq('grading_sheet.section.academic_year_id', currentAyId)
    .order('requested_at', { ascending: false })
    .limit(limit);

  if (role === 'teacher') {
    query = query.eq('requested_by', userId).eq('status', 'pending');
  } else if (role === 'academic_coordinator') {
    query = query.eq('status', 'approved');
  } else if (role === 'school_admin') {
    query = query
      .eq('status', 'pending')
      .or(
        `primary_approver_id.eq.${userId},secondary_approver_id.eq.${userId},and(primary_approver_id.is.null,secondary_approver_id.is.null)`
      );
  } else if (role === 'superadmin') {
    // Oversight scope: full visibility across all pending requests,
    // regardless of designated approver.
    query = query.eq('status', 'pending');
  } else {
    return [];
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const rows = data as unknown as Array<{
    id: string;
    field_changed: string;
    reason_category: string;
    requested_at: string;
    grading_sheet_id: string;
    grade_entry_id: string;
  }>;

  const labels = await Promise.all(
    rows.map((r) => fetchLabels(service, r.grading_sheet_id, r.grade_entry_id))
  );

  return rows.map((r, i) => ({
    ...r,
    student_label: labels[i].student_label,
    sheet_label: labels[i].sheet_label,
  }));
}
