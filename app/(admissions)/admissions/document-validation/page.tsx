import { FileCheck } from 'lucide-react';
import { redirect } from 'next/navigation';

import { ValidationQueue } from '@/components/admissions/document-validation/validation-queue';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { loadPendingDocValidation } from '@/lib/admissions/document-validation';
import { getSessionUser } from '@/lib/supabase/server';

// /admissions/document-validation — triage queue for un-enrolled applicants'
// uploaded documents. Per KD #70, this is the "awaiting validation" half of
// the document workflow (we owe a review). KD #71 keeps the page admissions-
// side only — enrolled applicants flow through P-Files renewal.
//
// Visible to admissions / registrar / school_admin / superadmin per KD #74.
// Mutation route gates already permit the same set after the Chunk A patch.

export default async function DocumentValidationPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'admissions' &&
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

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

  const rows = await loadPendingDocValidation(currentAy.ay_code);
  const applicantCount = new Set(rows.map((r) => r.enroleeNumber)).size;

  return (
    <PageShell>
      <header className="space-y-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Admissions · Awaiting validation
        </p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          Document validation
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {rows.length === 0
            ? 'No documents are waiting for review right now. New parent uploads will land here for approval.'
            : `${rows.length.toLocaleString('en-SG')} document${rows.length === 1 ? '' : 's'} from ${applicantCount.toLocaleString('en-SG')} applicant${applicantCount === 1 ? '' : 's'} waiting for review. Approve the file or reject it with a reason — the parent will be notified to re-upload.`}
        </p>
      </header>

      <ValidationQueue rows={rows} ayCode={currentAy.ay_code} />

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <FileCheck className="size-3" strokeWidth={2.25} />
        <span>{currentAy.ay_code}</span>
        <span className="text-border">·</span>
        <span>Un-enrolled applicants only</span>
        <span className="text-border">·</span>
        <span>Status: Uploaded</span>
      </div>
    </PageShell>
  );
}
