import { ArrowLeft, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshIcon } from '@/components/billing/toolbar-icons';
import {
  ReportExportButton,
  ReportPaper,
} from '@/components/billing/report-paper';
import { ReportPeriodPicker } from '@/components/billing/report-period-picker';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { qboAppUrl, qboEnv } from '@/lib/qbo/env';
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

  const qbReportsUrl = qboAppUrl(
    qboEnv()?.environment ?? 'sandbox',
    '/app/standardreports'
  );

  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <Link
          href="/billing/reports"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to reports
        </Link>
        <BillingPageHeader
          crumbs={[{ label: 'Reports' }]}
          title={def.title}
          description={def.blurb}
          actions={
            realmId ? (
              <>
                <Button asChild variant="outline">
                  <a href={qbReportsUrl} target="_blank" rel="noreferrer">
                    <SlidersHorizontal className="size-4" />
                    Customize
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href={qbReportsUrl} target="_blank" rel="noreferrer">
                    Save As
                  </a>
                </Button>
                {report && !error && (
                  <ReportExportButton report={report} csvName={csvName} />
                )}
                <RefreshIcon />
              </>
            ) : undefined
          }
        />
      </div>

      {!realmId ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : (
        <>
          <ReportPeriodPicker
            kind={def.period}
            period={dates.period}
            asOf={dates.asOf}
            from={dates.from}
            to={dates.to}
          />
          {error || !report ? (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardHeader>
                <CardTitle className="font-serif text-base">
                  QuickBooks could not be read
                </CardTitle>
                <CardDescription>
                  {error} Refresh the page to try again.
                </CardDescription>
              </CardHeader>
            </Card>
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
              qbReportsUrl={qbReportsUrl}
            />
          )}
        </>
      )}
    </PageShell>
  );
}
