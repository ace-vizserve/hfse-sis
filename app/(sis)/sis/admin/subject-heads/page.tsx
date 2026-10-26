import { redirect } from 'next/navigation';

import { PageShell } from '@/components/ui/page-shell';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { SubjectHeadsClient } from '@/components/sis/subject-heads-client';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { listStaffUsers } from '@/lib/sis/users/queries';
import { loadSubjectHeadsScreen } from '@/lib/sow/subject-heads';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// /sis/admin/subject-heads — who heads each subject (migration 198).
//
// ── PURPOSE (design-system §5, step 1) ─────────────────────────────────────
// A superadmin names, for each subject taught this year, the people who
// approve its schemes of work. The primary action is adding a person.
//
// ── PATTERN ────────────────────────────────────────────────────────────────
// SIS Admin settings page: header, one `DataTable` (one row per subject), and
// an inline picker per row — one or two fields, so no drawer.
//
// ⚠ GATED LIKE APPROVERS (superadmin; the route checks `approvers.manage`).
// A subject head step on the approvers screen lists nobody: this screen is
// where its people are set.

export default async function SubjectHeadsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (sessionUser.role !== 'superadmin') redirect('/sis');

  const ay = await getCurrentAcademicYear();
  const service = createServiceClient();
  const [rows, staff] = await Promise.all([
    ay ? loadSubjectHeadsScreen(service, ay.id) : Promise.resolve([]),
    listStaffUsers(),
  ]);

  return (
    <PageShell>
      <SisPageHeader
        group="Access & system"
        title="Subject heads."
        description={`Who heads each subject${ay ? ` in ${ay.label}` : ''}. A subject’s heads approve its schemes of work; a head set for Primary or Secondary only sees that half’s.`}
      />
      <SubjectHeadsClient
        rows={rows}
        // Switched-off accounts are passed too, so a head whose account was
        // turned off still shows by name; the picker leaves them out.
        staff={staff
          .map((u) => ({
            userId: u.id,
            email: u.email,
            displayName: u.display_name,
            disabled: u.disabled,
          }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName))}
      />
    </PageShell>
  );
}
