import { redirect } from 'next/navigation';

import { ExpiringQueue } from '@/components/p-files/document-validation/expiring-queue';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { loadExpiringSoon } from '@/lib/p-files/document-validation';
import { getSessionUser } from '@/lib/supabase/server';

// Expiring soon — travel documents inside the 90-day window. Read-only by
// nature: the action is to contact the parent, not to approve anything.
export default async function DocumentValidationExpiringPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const capabilities = await getCapabilitiesForRole(sessionUser.role);
  if (!can(capabilities, 'documents_post_enrolment.read')) {
    redirect('/p-files/document-validation/applicants');
  }

  const currentAy = await getCurrentAcademicYear();
  if (!currentAy) return null; // The layout already renders the "no AY" notice.

  const expiringRows = await loadExpiringSoon(currentAy.ay_code, 90);
  const expiringCount = expiringRows.length;
  const expiringStudentCount = new Set(expiringRows.map((r) => r.enroleeNumber))
    .size;

  if (expiringCount === 0) {
    return (
      <div className="rounded-xl border border-dashed border-hairline bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">
          No documents expiring within 90 days. Use the filter to narrow the
          window.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {expiringCount.toLocaleString('en-SG')} document
        {expiringCount === 1 ? '' : 's'} from{' '}
        {expiringStudentCount.toLocaleString('en-SG')} student
        {expiringStudentCount === 1 ? '' : 's'} expiring within 90 days. Open
        the student profile to send a reminder.
      </p>
      <ExpiringQueue rows={expiringRows} />
    </div>
  );
}
