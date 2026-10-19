import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { ReportPaper } from '@/components/billing/report-paper';
import { ReportPeriodPicker } from '@/components/billing/report-period-picker';
import { PageShell } from '@/components/ui/page-shell';
import type { ParsedReport } from '@/lib/billing/report';
import { reportDef } from '@/lib/billing/report-catalog';
import { resolveReportPeriod } from '@/lib/billing/report-period';
import {
  readCompanyName,
  readReport,
  readStudentByCustomer,
} from '@/lib/billing/reports.server';
import { todaySg } from '@/lib/billing/view';
import { connectedRealmId, qboErrorMessage } from '@/lib/qbo/client';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Reports → one QuickBooks report, read live and printed as
// QuickBooks prints it (components/billing/report-paper.tsx). The period is
// QuickBooks' "Report period" control, kept in the address.

const longDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export default async function BillingReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<{
    period?: string;
    asOf?: string;
    from?: string;
    to?: string;
    account?: string;
  }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const [{ report: key }, sp] = await Promise.all([params, searchParams]);
  const def = reportDef(key);
  if (!def) notFound();

  const today = todaySg();
  const dates = resolveReportPeriod(
    sp,
    today,
    def.period === 'asOf' ? 'today' : 'this-month'
  );
  const service = createServiceClient();
  const realmId = await connectedRealmId(service).catch(() => null);

  let report: ParsedReport | null = null;
  let companyName = 'QuickBooks';
  let students: Record<string, string> = {};
  let error: string | null = null;
  if (realmId) {
    try {
      const [r, name, map] = await Promise.all([
        readReport(service, def, dates, { account: sp.account }),
        readCompanyName(service),
        def.customers === 'none'
          ? Promise.resolve({})
          : readStudentByCustomer(service, realmId),
      ]);
      report = r;
      if (name) companyName = name;
      students = map;
    } catch (e) {
      error = qboErrorMessage(e);
    }
  }

  const dateLine =
    def.period === 'asOf'
      ? `As of ${longDay(report?.reportDate ?? dates.asOf)}`
      : `${longDay(report?.startPeriod ?? dates.from)} – ${longDay(report?.endPeriod ?? dates.to)}`;
  const readAt = new Date().toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const csvName =
    def.period === 'asOf'
      ? `${def.key}-${dates.asOf}.csv`
      : `${def.key}-${dates.from}-to-${dates.to}.csv`;

  return (
    <PageShell>
      <header className="space-y-4">
        <Link
          href="/billing/reports"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          <ChevronLeft className="size-4" />
          Back to reports
        </Link>
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Billing · QuickBooks report
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          {def.title}.
        </h1>
      </header>

      {!realmId ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : (
        <>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <ReportPeriodPicker
              kind={def.period}
              period={dates.period}
              asOf={dates.asOf}
              from={dates.from}
              to={dates.to}
            />
            <RefreshButton />
          </div>
          {error || !report ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
              <p className="font-serif text-base font-semibold text-foreground">
                QuickBooks could not be read
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {error} Refresh the page to try again.
              </p>
            </div>
          ) : (
            <ReportPaper
              reportKey={def.key}
              companyName={companyName}
              title={def.paperTitle}
              dateLine={dateLine}
              report={report}
              customers={def.customers}
              countInHeader={def.countInHeader}
              studentByCustomer={students}
              readAt={readAt}
              csvName={csvName}
            />
          )}
        </>
      )}
    </PageShell>
  );
}
