import { redirect } from 'next/navigation';

import { PageTabNav } from '@/components/sis/page-tab-nav';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { PageShell } from '@/components/ui/page-shell';
import { getSessionUser } from '@/lib/supabase/server';

// The SIS audit log's two cuts, now child routes rather than `?view=` tabs.
//
// This layout is the shared guard: it runs for `/sis/audit-log` and everything
// beneath it, so neither page repeats the session and role check.
export default async function SisAuditLogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  return (
    <PageShell>
      <SisPageHeader
        group="Access & system"
        title="Audit log."
        description="A history of every administrative change — sections created, teachers assigned, templates applied, approvers managed, school config edited, users added, and environment operations. Past entries are kept on the record."
      />

      {/* Log first — it is the default view, and tab order should match visit
          frequency rather than build order. Overview is the deliberate second
          stop for review. */}
      <PageTabNav
        tabs={[
          { href: '/sis/audit-log', label: 'Log' },
          { href: '/sis/audit-log/overview', label: 'Overview' },
        ]}
      />

      {children}
    </PageShell>
  );
}
