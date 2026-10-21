import { CalendarClock, ReceiptText, Wallet, ClipboardPen } from 'lucide-react';
import { redirect } from 'next/navigation';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { ReadyForInvoicingQueue } from '@/components/admissions/ready-for-invoicing-queue';
import { MetricCard } from '@/components/dashboard/metric-card';
import { PageShell } from '@/components/ui/page-shell';
import type { Role } from '@/lib/auth/roles';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { daysSince } from '@/lib/admissions/ready-for-invoicing';
import { loadReadyForInvoicing } from '@/lib/admissions/ready-for-invoicing-loader';
import { sgToday } from '@/lib/dates';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// /admissions/ready-for-invoicing — every Registration / Fees stage a staff
// member ticked "Ready for invoicing" (spec 2026-10-21, Registration and Fees
// filled from Billing). The list whoever invoices works down. The rule is
// lib/admissions/ready-for-invoicing.ts.
//
// Year: the Admissions `?ay=` switcher, defaulting to the current year.
// Audience: the same as "Enrolled, steps still open"; only the roles that may
// invoice (`canInvoiceInQbo`, the stage card's rule) get Create invoice.
const ALLOWED_ROLES: Role[] = [
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
];

export default async function ReadyForInvoicingPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!sessionUser.role || !ALLOWED_ROLES.includes(sessionUser.role))
    redirect('/');

  const service = createServiceClient();
  const [currentAy, ayCodes, { ay: ayParam }] = await Promise.all([
    getCurrentAcademicYear(service),
    listAyCodes(service),
    searchParams,
  ]);
  if (!currentAy) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          No current academic year configured.
        </div>
      </PageShell>
    );
  }
  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;

  const rows = await loadReadyForInvoicing(selectedAy);

  const registration = rows.filter((r) => r.stage === 'registration').length;
  const fees = rows.length - registration;
  // Rows arrive oldest tick first; unknown dates sort last.
  const oldest = rows.find((r) => r.tickedOn)?.tickedOn ?? null;
  const oldestDays = oldest ? daysSince(oldest, sgToday()) : null;
  // Rows with no stage date (set before the stage kept one) can't be aged.
  const undated = rows.filter((r) => !r.tickedOn).length;
  const undatedNote =
    undated > 0 ? ` · ${undated.toLocaleString('en-SG')} with no date` : '';

  const countLabel =
    rows.length === 0
      ? `Nobody is waiting to be invoiced for ${selectedAy}.`
      : `${rows.length.toLocaleString('en-SG')} ${rows.length === 1 ? 'invoice' : 'invoices'} to create.`;

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Admissions · {selectedAy}
          </p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Ready for invoicing
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Registration and Fees marked Ready for invoicing on the application.
            A child ready on both appears twice, once per invoice. Each row
            leaves the list once its invoice is created. {countLabel}
          </p>
        </div>
        <div className="w-full md:w-48">
          <AySwitcher current={selectedAy} options={ayCodes} />
        </div>
      </header>

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
          <MetricCard
            label="Waiting"
            value={rows.length}
            format="number"
            icon={ReceiptText}
            subtext="Invoices to create"
          />
          <MetricCard
            label="Registration"
            value={registration}
            format="number"
            icon={ClipboardPen}
            subtext="Registration invoices"
          />
          <MetricCard
            label="Fees"
            value={fees}
            format="number"
            icon={Wallet}
            subtext="Fees invoices"
          />
          <MetricCard
            label="Oldest tick"
            value={oldestDays === null ? '—' : oldestDays}
            format={oldestDays === null ? undefined : 'number'}
            icon={CalendarClock}
            subtext={
              oldestDays === null
                ? rows.length === 0
                  ? 'Nothing waiting'
                  : `${undated.toLocaleString('en-SG')} with no date`
                : `${oldestDays === 1 ? 'day' : 'days'} waiting${undatedNote}`
            }
          />
        </div>
      </div>

      <ReadyForInvoicingQueue
        rows={rows}
        ayCode={selectedAy}
        canInvoice={canInvoiceInQbo(sessionUser.role)}
      />
    </PageShell>
  );
}
