import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Inbox, ShieldAlert } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { getSessionUser } from '@/lib/supabase/server';

const M365_ENV_KEYS = [
  'M365_TENANT_ID',
  'M365_CLIENT_ID',
  'M365_CLIENT_SECRET',
  'SHAREPOINT_SITE_ID',
  'SHAREPOINT_LIST_ID',
] as const;

export default async function AdmissionsInquiriesPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'admissions' &&
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  // All 5 M365 env vars must be set together; if any is missing the sync
  // silently no-ops (per env-vars.md).
  const missingKeys = M365_ENV_KEYS.filter((k) => !process.env[k]);
  const configured = missingKeys.length === 0;

  return (
    <PageShell>
      <Link
        href="/admissions"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Admissions dashboard
      </Link>

      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Admissions · Inquiries
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          SharePoint inquiries.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          One-way read of the admissions-inquiries SharePoint list (Microsoft Graph
          client-credentials flow). Closes the loop from &ldquo;inquiry received&rdquo; to
          &ldquo;application submitted&rdquo;; stale inquiries surface as alerts.
        </p>
      </header>

      {configured ? (
        <Card>
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Inquiry list
            </CardDescription>
            <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
              <span className="inline-flex items-center gap-2">
                <Inbox className="size-4 text-primary" />
                Ready to wire
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              All 5 M365 env vars are set. Implementation of the Graph API fetch lands as
              a follow-up bite — see <code className="font-mono">docs/context/08-admission-dashboard.md</code> §2.1.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
              Not configured
            </CardDescription>
            <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
              <span className="inline-flex items-center gap-2">
                <ShieldAlert className="size-4 text-amber-600" />
                SharePoint credentials missing
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              The admissions-inquiries sync requires all 5 M365 / SharePoint environment
              variables to be set together:
            </p>
            <ul className="list-disc space-y-1 pl-6 font-mono text-[12px]">
              {M365_ENV_KEYS.map((k) => (
                <li key={k} className={missingKeys.includes(k) ? 'text-destructive' : 'text-foreground'}>
                  {k}
                  {missingKeys.includes(k) && <span className="ml-2 text-[10px] uppercase">missing</span>}
                </li>
              ))}
            </ul>
            <p>
              Setup requires an Azure AD app registration with <code className="font-mono">Sites.Read.All</code>{' '}
              application permission + admin consent in the HFSE tenant. See{' '}
              <code className="font-mono">docs/context/08-admission-dashboard.md</code> §2.1 for details.
            </p>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
