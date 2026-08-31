import { redirect } from 'next/navigation';

import { AwaitingQueue } from '@/components/p-files/document-validation/awaiting-queue';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import {
  countAwaitingVerification,
  loadAwaitingVerification,
} from '@/lib/p-files/document-validation';
import { getSessionUser } from '@/lib/supabase/server';

// Enrolled students — the P-File officer's daily queue, and so the default
// view. Header, tab strip and the OR-capability guard live in the layout.
//
// WHY BOTH SIDES OF ENROLMENT LIVE UNDER ONE PAGE. Documents belong to
// Admissions before a student enrols and to P-Files after (KD #147's ownership
// handoff), and the write route still enforces that line. But at HFSE one
// person does both jobs and holds exactly one role, so the old shape gave them
// a permission they could never reach: the applicant queue sits behind
// /admissions, which their role cannot open. The queues came to them instead.
export default async function DocumentValidationEnrolledPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const capabilities = await getCapabilitiesForRole(sessionUser.role);
  // A viewer who can only see the applicant queue lands there instead — this
  // is the old `defaultTab` rule, expressed as a route.
  if (!can(capabilities, 'documents_post_enrolment.read')) {
    redirect('/p-files/document-validation/applicants');
  }
  const canValidatePost = can(
    capabilities,
    'documents_post_enrolment.validate'
  );

  const currentAy = await getCurrentAcademicYear();
  if (!currentAy) return null; // The layout already renders the "no AY" notice.
  const ayCode = currentAy.ay_code;

  const [awaitingRows, awaitingCount] = await Promise.all([
    loadAwaitingVerification(ayCode),
    countAwaitingVerification(ayCode),
  ]);
  // Students with something ACTUALLY waiting, not students on the page. The
  // sentence reads "N documents from M students waiting for review", so both
  // halves have to describe the same set — pairing a filtered document count
  // with every student in the year says something untrue.
  const awaitingStudentCount = new Set(
    awaitingRows
      .filter((r) => r.status === 'Uploaded')
      .map((r) => r.enroleeNumber)
  ).size;

  // The table lists every student now, so the empty state keys on there being
  // nobody at all — not on there being nothing to review.
  if (awaitingRows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-hairline bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">
          No documents are waiting for review. New parent uploads will appear
          here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {awaitingCount.toLocaleString('en-SG')} document
        {awaitingCount === 1 ? '' : 's'} from{' '}
        {awaitingStudentCount.toLocaleString('en-SG')} student
        {awaitingStudentCount === 1 ? '' : 's'} waiting for review.
        {canValidatePost
          ? ' Approve the file or reject it with a reason — the parent will be notified by email.'
          : ''}
      </p>
      <AwaitingQueue
        rows={awaitingRows}
        ayCode={ayCode}
        isOfficer={canValidatePost}
      />
    </div>
  );
}
