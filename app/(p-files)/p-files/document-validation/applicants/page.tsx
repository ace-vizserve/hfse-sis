import { redirect } from 'next/navigation';

import { ValidationQueue } from '@/components/admissions/document-validation/validation-queue';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { loadPendingDocValidation } from '@/lib/admissions/document-validation';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getSessionUser } from '@/lib/supabase/server';

// Applicants — documents uploaded by parents of students who have not enrolled
// yet. Its own capability, checked here: the layout's guard is an OR of two, so
// passing it does not mean this queue is yours to see.
export default async function DocumentValidationApplicantsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const capabilities = await getCapabilitiesForRole(sessionUser.role);
  if (!can(capabilities, 'documents_pre_enrolment.read')) {
    redirect('/p-files/document-validation');
  }
  const canValidatePre = can(capabilities, 'documents_pre_enrolment.validate');

  const currentAy = await getCurrentAcademicYear();
  if (!currentAy) return null; // The layout already renders the "no AY" notice.
  const ayCode = currentAy.ay_code;

  const applicantRows = await loadPendingDocValidation(ayCode);
  // The loader now returns every applicant against every slot, so
  // `applicantRows.length` is the size of the TABLE, not the size of the job.
  // Both numbers in the sentence below describe work waiting for a decision:
  // documents actually uploaded, and the applicants they belong to.
  const awaiting = applicantRows.filter((r) => r.status === 'Uploaded');
  const applicantCount = awaiting.length;
  const applicantStudentCount = new Set(awaiting.map((r) => r.enroleeNumber))
    .size;

  // The table still lists everyone; only the empty state keys on the queue.
  if (applicantRows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-hairline bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">
          No applicant documents are waiting for review. New parent uploads will
          appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {applicantCount.toLocaleString('en-SG')} document
        {applicantCount === 1 ? '' : 's'} from{' '}
        {applicantStudentCount.toLocaleString('en-SG')} applicant
        {applicantStudentCount === 1 ? '' : 's'} waiting for review.
        {canValidatePre
          ? ' Approve the file or reject it with a reason — the parent will be notified to re-upload.'
          : ''}
      </p>
      <ValidationQueue
        rows={applicantRows}
        ayCode={ayCode}
        canValidate={canValidatePre}
      />
    </div>
  );
}
