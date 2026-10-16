import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { redirect } from 'next/navigation';

import { QboConnectionCard } from '@/components/billing/qbo-connection-card';
import { PageShell } from '@/components/ui/page-shell';
import { getQboStatus } from '@/lib/qbo/status';
import { getSessionUser } from '@/lib/supabase/server';

// Billing → QuickBooks (superadmin): the QuickBooks connection only (moved
// here from SIS Admin). Nothing else is set up in the SIS — which invoices
// fill the Registration and Fees stages, each invoice's school year and the
// accounts Record payment offers all come from QuickBooks and the student's
// applications (KD #232 update 2026-10-16).
export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (sessionUser.role !== 'superadmin') redirect('/billing');
  const [status, params] = await Promise.all([getQboStatus(), searchParams]);

  return (
    <PageShell>
      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Billing · superadmin
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          QuickBooks connection.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          The SIS reads and writes every invoice and payment through this
          connection to the school&rsquo;s QuickBooks company.
        </p>
      </header>

      {params.connected === '1' && status.connected && !status.loadFailed && (
        <div className="flex items-start gap-4 rounded-xl border border-brand-mint/60 bg-brand-mint/20 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-mint to-brand-mint/80 text-ink shadow-brand-tile">
            <CheckCircle2 className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              QuickBooks connected
            </p>
            <p className="text-sm text-muted-foreground">
              Billing now reads {status.companyName ?? 'QuickBooks'}.
            </p>
          </div>
        </div>
      )}
      {params.error && (
        <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
            <AlertTriangle className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              QuickBooks wasn&apos;t connected
            </p>
            <p className="text-sm text-muted-foreground">{params.error}</p>
          </div>
        </div>
      )}

      <div className="max-w-4xl">
        <QboConnectionCard status={status} />
      </div>
    </PageShell>
  );
}
