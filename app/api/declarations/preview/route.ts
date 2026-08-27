import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { listInboxStages } from '@/lib/approvals/inbox';
import { loadStaffDeclarations } from '@/lib/declarations/staff';
import { DECLARATION_APPROVAL_FLOW } from '@/lib/schemas/approval-flows';

// GET /api/declarations/preview
//
// Backs the declaration half of the header notification bell's dropdown.
//
// ⚠ BUILT FROM `listInboxStages` AND ITS `canDecide` FLAG — the same call the
// "Waiting for you" panel counts and the same one the queue page lists. That is
// not tidiness: the bell's number and the bell's list disagreeing is the exact
// bug this feature's older sibling shipped, where the change-request scope was
// re-written by hand in six places and three of them disagreed about what a
// superadmin sees. One source, so they cannot drift.
//
// ⚠ `canDecide`, NOT merely visible. An academic coordinator can see the whole
// school's queue but approves nobody's absence; putting those rows on their
// bell would be a notification about somebody else's job.

const PREVIEW_LIMIT = 5;

export async function GET() {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();

  try {
    const stages = await listInboxStages(service, {
      flow: DECLARATION_APPROVAL_FLOW,
      userId: auth.user.id,
      role: auth.role,
    });

    const mine = stages
      .filter((s) => s.canDecide)
      .sort((a, b) => b.filedAt.localeCompare(a.filedAt))
      .slice(0, PREVIEW_LIMIT);

    if (mine.length === 0) return NextResponse.json({ rows: [] });

    // Keyed by declaration id so the ladder's request id can be carried back
    // out — the bell links to the REQUEST, which is what the queue page opens.
    const requestByDeclaration = new Map(
      mine.map((s) => [s.subjectId, s.requestId])
    );

    const declarations = await loadStaffDeclarations(service, [
      ...requestByDeclaration.keys(),
    ]);

    const rows = declarations.map((d) => ({
      id: d.id,
      request_id: requestByDeclaration.get(d.id) ?? '',
      // "Last, First (STU-001)" — the shape `deriveInitials` on the bell reads.
      student_label: `${d.studentName} (${d.studentNumber})`,
      kind: d.declarationType,
      start_date: d.startDate,
      end_date: d.endDate,
      filed_at: d.filedAt,
    }));

    return NextResponse.json({ rows });
  } catch (e) {
    // ⚠ A failure here must never blank the bell. The change-request rows are
    // fetched independently and the panel merges whichever arrived, so an empty
    // list from this side costs one source rather than the whole dropdown.
    console.error(
      '[declarations] preview failed:',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json({ rows: [] });
  }
}
