import { FileCheck } from 'lucide-react';
import { redirect } from 'next/navigation';

import { AwaitingQueue } from '@/components/p-files/document-validation/awaiting-queue';
import { ExpiringQueue } from '@/components/p-files/document-validation/expiring-queue';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import {
  countAwaitingVerification,
  loadAwaitingVerification,
  loadExpiringSoon,
} from '@/lib/p-files/document-validation';
import { getSessionUser } from '@/lib/supabase/server';

// /p-files/document-validation — two-tab monitoring surface for enrolled
// student documents. "Awaiting Verification" tab (default): non-expiring
// slots with status='Uploaded' awaiting officer review (Approve / Reject).
// "Expiring Soon" tab: expiring slots with status='Valid' expiring within
// 90 days. isOfficer gates action buttons per KD #74.

export default async function PFilesDocumentValidationPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'p_file_officer' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const isOfficer =
    sessionUser.role === 'p_file_officer' || sessionUser.role === 'superadmin';

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

  const [awaitingRows, expiringRows, awaitingCount] = await Promise.all([
    loadAwaitingVerification(ayCode),
    loadExpiringSoon(ayCode, 90),
    countAwaitingVerification(ayCode),
  ]);

  const expiringCount = expiringRows.length;
  const awaitingStudentCount = new Set(awaitingRows.map((r) => r.enroleeNumber))
    .size;
  const expiringStudentCount = new Set(expiringRows.map((r) => r.enroleeNumber))
    .size;

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
          Review documents uploaded by parents and monitor expiring travel
          documents for enrolled students.
          {!isOfficer && ' You have read-only access to this queue.'}
        </p>
      </header>

      <Tabs defaultValue="awaiting">
        <TabsList className="mb-4">
          <TabsTrigger value="awaiting" className="gap-2">
            Awaiting verification
            {awaitingCount > 0 && (
              <span className="rounded-full bg-destructive px-1.5 py-0.5 font-mono text-[10px] font-semibold text-destructive-foreground tabular-nums">
                {awaitingCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="expiring" className="gap-2">
            Expiring soon
            {expiringCount > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white tabular-nums">
                {expiringCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="awaiting">
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
                {isOfficer
                  ? ' Approve the file or reject it with a reason — the parent will be notified by email.'
                  : ''}
              </p>
              <AwaitingQueue
                rows={awaitingRows}
                ayCode={ayCode}
                isOfficer={isOfficer}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="expiring">
          {expiringRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-hairline bg-card p-10 text-center">
              <p className="text-sm text-muted-foreground">
                No documents expiring within 90 days. Use the filter to narrow
                the window.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {expiringCount.toLocaleString('en-SG')} document
                {expiringCount === 1 ? '' : 's'} from{' '}
                {expiringStudentCount.toLocaleString('en-SG')} student
                {expiringStudentCount === 1 ? '' : 's'} expiring within 90 days.
                Open the student profile to send a reminder.
              </p>
              <ExpiringQueue rows={expiringRows} />
            </div>
          )}
        </TabsContent>
      </Tabs>

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <FileCheck className="size-3" strokeWidth={2.25} />
        <span>{ayCode}</span>
        <span className="text-border">·</span>
        <span>Enrolled students only</span>
      </div>
    </PageShell>
  );
}
