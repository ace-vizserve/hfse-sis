import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { redirect } from 'next/navigation';

import { QboConnectionCard } from '@/components/billing/qbo-connection-card';
import { DepositAccountsCard } from '@/components/billing/settings/deposit-accounts-card';
import { LinkRunCard } from '@/components/billing/settings/link-run-card';
import { MappingCard } from '@/components/billing/settings/mapping-card';
import { YearsCard } from '@/components/billing/settings/years-card';
import { PageShell } from '@/components/ui/page-shell';
import { listAyCodes } from '@/lib/academic-year';
import { loadSettings } from '@/lib/billing/settings.server';
import { getQboStatus } from '@/lib/qbo/status';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Settings (superadmin). The QuickBooks connection (moved here from
// SIS Admin), which invoices fill the Registration and Fees tiles, each
// year's invoice dates, the payment accounts, and the bulk link run.
export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (sessionUser.role !== 'superadmin') redirect('/billing');
  const service = createServiceClient();
  const [status, params, settings, ayCodes, review] = await Promise.all([
    getQboStatus(),
    searchParams,
    loadSettings(service),
    listAyCodes(service),
    service
      .from('billing_link_review')
      .select('student_number', { count: 'exact', head: true }),
  ]);
  const years = [...ayCodes].sort().reverse().slice(0, 4).sort();

  return (
    <PageShell>
      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Billing · superadmin
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Settings.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Which invoices fill the Registration and Fees stages, the dates each
          school year&rsquo;s invoices fall in, and the accounts Record payment
          offers. Saving the tiles shows what would change first.
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

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <MappingCard settings={settings} />
        <div className="flex min-w-0 flex-col gap-6">
          <QboConnectionCard status={status} />
          <YearsCard ayCodes={years} ranges={settings.ranges} />
          <DepositAccountsCard settings={settings} />
          <LinkRunCard reviewCount={review.count ?? 0} />
        </div>
      </div>
    </PageShell>
  );
}
