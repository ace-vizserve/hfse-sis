import { FileCheck } from 'lucide-react';
import { redirect } from 'next/navigation';

import { PageTabNav, type PageTab } from '@/components/sis/page-tab-nav';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getSessionUser } from '@/lib/supabase/server';

// Document validation — two review queues: whose documents are being reviewed,
// applicants or enrolled students.
//
// There was a third tab, "Expiring soon". It was removed as redundant: the
// P-Files sidebar already carries Expiring in 30 / 60 / 90 days
// (`/p-files?expiring=…`, lib/auth/roles.ts), the student's own file shows an
// expiry on every expiring document, and an expiring passport is not something
// anyone VALIDATES — it is already valid, it is just running out. This page is
// for reviewing what a parent has sent in.
//
// THE GUARD IS AN OR OF TWO CAPABILITIES, which is why this page keeps plain
// `requiresRoles` in the nav rather than `requiresCapability` (see the NavItem
// comment in lib/auth/roles.ts). It runs here, once, for the whole subtree;
// each child then re-checks the single capability ITS queue needs, because a
// route can be typed and a hidden tab is no longer a guard.
export default async function DocumentValidationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  // The holders of documents_post_enrolment.read are exactly the three roles
  // the old three-role check admitted; the canReadPre arm only ever adds
  // someone ROUTE_ACCESS already lets into the module.
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

  // No counts on the tabs. Each queue's own page already says how much is
  // waiting, in a sentence. Dropping them also drops two whole list reads per
  // view of this page.
  const readOnlyEverywhere =
    (!canReadPre || !canValidatePre) && (!canReadPost || !canValidatePost);

  // Named for WHOSE documents each holds, not for their state: with two review
  // queues on one page, "awaiting verification" described both. Ordered along
  // the student lifecycle.
  const tabs: PageTab[] = [
    ...(canReadPre
      ? [
          {
            href: '/p-files/document-validation/applicants',
            label: 'Applicants',
          },
        ]
      : []),
    ...(canReadPost
      ? [
          {
            href: '/p-files/document-validation',
            label: 'Enrolled students',
          },
        ]
      : []),
  ];

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
            ? 'Review documents uploaded by parents — for applicants and for enrolled students.'
            : canReadPre
              ? 'Review documents uploaded by parents of applicants.'
              : 'Review documents uploaded by parents of enrolled students.'}
          {readOnlyEverywhere && ' You have read-only access to these queues.'}
        </p>
      </header>

      <PageTabNav tabs={tabs} />

      {children}

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
