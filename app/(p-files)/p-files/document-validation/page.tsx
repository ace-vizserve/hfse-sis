import { FileCheck } from 'lucide-react';
import { redirect } from 'next/navigation';

import { ValidationQueue } from '@/components/admissions/document-validation/validation-queue';
import { AwaitingQueue } from '@/components/p-files/document-validation/awaiting-queue';
import { ExpiringQueue } from '@/components/p-files/document-validation/expiring-queue';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { loadPendingDocValidation } from '@/lib/admissions/document-validation';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import {
  countAwaitingVerification,
  loadAwaitingVerification,
  loadExpiringSoon,
} from '@/lib/p-files/document-validation';
import { getSessionUser } from '@/lib/supabase/server';

// /p-files/document-validation — one place to review every document waiting on
// a decision, whichever side of enrolment the student sits on.
//
// WHY BOTH SIDES LIVE HERE. Documents belong to Admissions before a student
// enrols and to P-Files after (KD #147's ownership handoff), and the write route
// still enforces that line. But at HFSE one person does both jobs, and a person
// holds exactly one role — so the old shape gave them a permission they could
// never reach: the applicant queue sits behind /admissions, which their role
// cannot open, and adding them to that module would drop them into a sidebar
// full of surfaces they have no business in.
//
// So the queues came to them. Each tab renders only if the viewer holds the
// matching read capability, and each one's actions only if they hold the
// matching validate capability. The enrolment rule is untouched — it is now a
// question about what you may do rather than what you are called.
//
// The Admissions module keeps its own applicant queue: that is the admissions
// team's daily surface, and this page is not reachable by them.

type TabKey = 'applicants' | 'enrolled' | 'expiring';

export default async function PFilesDocumentValidationPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const capabilities = await getCapabilitiesForRole(sessionUser.role);
  const canReadPre = can(capabilities, 'documents_pre_enrolment.read');
  const canReadPost = can(capabilities, 'documents_post_enrolment.read');
  const canValidatePre = can(capabilities, 'documents_pre_enrolment.validate');
  const canValidatePost = can(
    capabilities,
    'documents_post_enrolment.validate'
  );

  // Replaces the previous three-role check. The holders of
  // documents_post_enrolment.read are exactly the three roles that chain
  // admitted (p_file_officer / school_admin / superadmin), so this is a
  // like-for-like swap; the `canReadPre` arm only ever adds someone who is
  // already allowed into the module by ROUTE_ACCESS.
  if (!canReadPost && !canReadPre) redirect('/');

  const currentAy = await getCurrentAcademicYear();
  if (!currentAy) {
    return (
      <PageShell>
        <div className="rounded-xl border border-hairline bg-card p-6 text-center text-sm text-muted-foreground">
          No active academic year is set. Ask a system administrator to set one
          in Settings.
        </div>
      </PageShell>
    );
  }

  const ayCode = currentAy.ay_code;

  // Only fetch what the viewer can see — the applicant queue reads three
  // admissions tables, so it costs nothing for someone without the capability.
  const [applicantRows, awaitingRows, expiringRows, awaitingCount] =
    await Promise.all([
      canReadPre ? loadPendingDocValidation(ayCode) : Promise.resolve([]),
      canReadPost ? loadAwaitingVerification(ayCode) : Promise.resolve([]),
      canReadPost ? loadExpiringSoon(ayCode, 90) : Promise.resolve([]),
      canReadPost ? countAwaitingVerification(ayCode) : Promise.resolve(0),
    ]);

  const applicantCount = applicantRows.length;
  const expiringCount = expiringRows.length;
  const applicantStudentCount = new Set(
    applicantRows.map((r) => r.enroleeNumber)
  ).size;
  const awaitingStudentCount = new Set(awaitingRows.map((r) => r.enroleeNumber))
    .size;
  const expiringStudentCount = new Set(expiringRows.map((r) => r.enroleeNumber))
    .size;

  // Tabs are named for WHOSE documents they hold, not for their state: with two
  // review queues on one page, "awaiting verification" described both of them.
  // Ordered along the student lifecycle. `defaultTab` never lands on a tab the
  // viewer can't see, and keeps the enrolled queue as the opening view for the
  // officer whose daily work it is.
  const visibleTabs: TabKey[] = [
    ...(canReadPre ? (['applicants'] as const) : []),
    ...(canReadPost ? (['enrolled', 'expiring'] as const) : []),
  ];
  const defaultTab: TabKey = visibleTabs.includes('enrolled')
    ? 'enrolled'
    : visibleTabs[0];

  const readOnlyEverywhere =
    (!canReadPre || !canValidatePre) && (!canReadPost || !canValidatePost);

  return (
    <PageShell>
      <header className="space-y-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          P-Files · {ayCode}
        </p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          Document validation
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {canReadPre && canReadPost
            ? 'Review documents uploaded by parents — for applicants and for enrolled students — and keep track of travel documents about to expire.'
            : canReadPre
              ? 'Review documents uploaded by parents of applicants.'
              : 'Review documents uploaded by parents and monitor expiring travel documents for enrolled students.'}
          {readOnlyEverywhere && ' You have read-only access to these queues.'}
        </p>
      </header>

      <Tabs defaultValue={defaultTab}>
        <TabsList className="mb-4">
          {canReadPre && (
            <TabsTrigger value="applicants" className="gap-2">
              Applicants
              {applicantCount > 0 && (
                <span className="rounded-full bg-destructive px-1.5 py-0.5 font-mono text-[10px] font-semibold text-destructive-foreground tabular-nums">
                  {applicantCount}
                </span>
              )}
            </TabsTrigger>
          )}
          {canReadPost && (
            <>
              <TabsTrigger value="enrolled" className="gap-2">
                Enrolled students
                {awaitingCount > 0 && (
                  <span className="rounded-full bg-destructive px-1.5 py-0.5 font-mono text-[10px] font-semibold text-destructive-foreground tabular-nums">
                    {awaitingCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="expiring" className="gap-2">
                Expiring soon
                {expiringCount > 0 && (
                  <span className="rounded-full bg-brand-amber px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink tabular-nums">
                    {expiringCount}
                  </span>
                )}
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {canReadPre && (
          <TabsContent value="applicants">
            {applicantRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-hairline bg-card p-10 text-center">
                <p className="text-sm text-muted-foreground">
                  No applicant documents are waiting for review. New parent
                  uploads will appear here.
                </p>
              </div>
            ) : (
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
            )}
          </TabsContent>
        )}

        {canReadPost && (
          <>
            <TabsContent value="enrolled">
              {awaitingRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-hairline bg-card p-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    No documents are waiting for review. New parent uploads will
                    appear here.
                  </p>
                </div>
              ) : (
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
              )}
            </TabsContent>

            <TabsContent value="expiring">
              {expiringRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-hairline bg-card p-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    No documents expiring within 90 days. Use the filter to
                    narrow the window.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {expiringCount.toLocaleString('en-SG')} document
                    {expiringCount === 1 ? '' : 's'} from{' '}
                    {expiringStudentCount.toLocaleString('en-SG')} student
                    {expiringStudentCount === 1 ? '' : 's'} expiring within 90
                    days. Open the student profile to send a reminder.
                  </p>
                  <ExpiringQueue rows={expiringRows} />
                </div>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <FileCheck className="size-3" strokeWidth={2.25} />
        <span>{ayCode}</span>
        <span className="text-border">·</span>
        <span>
          {canReadPre && canReadPost
            ? 'Applicants and enrolled students'
            : canReadPre
              ? 'Applicants only'
              : 'Enrolled students only'}
        </span>
      </div>
    </PageShell>
  );
}
