import {
  AlertTriangle,
  ArrowLeft,
  Coins,
  FileText,
  FolderOpen,
  Layers,
  UserRound,
  UserSearch,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { CreditPanel } from '@/components/billing/credit-panel';
import { CustomerActions } from '@/components/billing/customer-actions';
import { CustomerTabs } from '@/components/billing/customer-tabs';
import { EditCustomerButton } from '@/components/billing/edit-customer-button';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { StageCustomerSheet } from '@/components/billing/stage-customer-sheet';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/ui/page-shell';
import { hrefPathname, isRouteAllowed } from '@/lib/auth/roles';
import { loadCustomerPage } from '@/lib/billing/customer-page.server';
import { stageFromParams } from '@/lib/billing/stage-card';
import { formatDay } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';
import { qboAppUrl } from '@/lib/qbo/env';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → one student. Everything billed to their QuickBooks customer,
// newest first, no year filter (Mr Ace: "historical not focused on AY …
// just like an audit log"). Reads the customer from QuickBooks every time it
// opens. QuickBooks decides what the page holds (Edit ▾, New transaction ▾,
// Open balance / Overdue, Transaction List / Customer Details); the SIS
// decides how it looks — a SIS detail page.
export default async function BillingCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentNumber: string }>;
  searchParams: Promise<{
    tab?: string;
    new?: string;
    invoice?: string;
    stage?: string;
    ay?: string;
    from?: string;
  }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');
  const [
    { studentNumber },
    { tab, new: newSheet, invoice: newInvoice, stage: stageParam, ay, from },
  ] = await Promise.all([params, searchParams]);
  // A Registration / Fees card's Create invoice in Billing.
  const fromStage =
    newSheet === 'invoice' ? stageFromParams(stageParam, ay) : null;
  const initialTab =
    tab === 'payments' || tab === 'details' ? tab : 'transactions';
  const page = await loadCustomerPage(
    createServiceClient(),
    decodeURIComponent(studentNumber)
  );
  if (!page) notFound();

  const name =
    page.student?.name ?? page.link?.displayName ?? page.studentNumber;
  const b = page.balances;
  const openCount = page.openInvoices.length;
  const p = page.profile;

  // The same student in the other modules — the application and documents of
  // their newest year, and the record. Only links this role can open.
  const en = page.student?.enroleeNumber;
  const ayQ = page.student?.ayCode
    ? `?ay=${encodeURIComponent(page.student.ayCode)}`
    : '';
  const related = [
    en && {
      label: `Application${page.student?.ayCode ? ` · ${page.student.ayCode}` : ''}`,
      href: `/admissions/applications/${encodeURIComponent(en)}${ayQ}`,
      icon: FileText,
    },
    en && {
      label: 'Documents',
      href: `/p-files/${encodeURIComponent(en)}${ayQ}`,
      icon: FolderOpen,
    },
    {
      label: 'Student record',
      href: `/records/students/${encodeURIComponent(page.studentNumber)}`,
      icon: UserRound,
    },
  ].filter(
    (l): l is { label: string; href: string; icon: typeof FileText } =>
      !!l && isRouteAllowed(hrefPathname(l.href), sessionUser.role)
  );

  // QuickBooks' own page for this customer.
  const qbBase = page.environment ? qboAppUrl(page.environment, '') : null;
  const qbHref =
    page.link && qbBase
      ? `${qbBase}/app/customerdetail?nameId=${encodeURIComponent(page.link.customerId)}`
      : null;

  const description = page.link ? (
    <>
      QuickBooks customer{' '}
      <span className="font-mono text-[13px] text-foreground">
        {page.link.displayName}
      </span>
      {p?.companyName ? ` · Parents: ${p.companyName}` : ''}
      {page.student?.level
        ? ` · ${page.student.level}, ${page.student.ayCode}`
        : ''}
    </>
  ) : (
    'Not linked to a QuickBooks customer yet.'
  );

  return (
    <PageShell>
      <Link
        href="/billing"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Customers
      </Link>

      <BillingPageHeader
        crumbs={[{ label: page.studentNumber }]}
        title={name.replace(/\.+$/, '')}
        description={description}
        actions={
          page.link &&
          page.connected && (
            <>
              <RefreshButton label="Refresh" />
              <EditCustomerButton
                studentNumber={page.studentNumber}
                qbHref={qbHref}
              />
              <CustomerActions
                studentNumber={page.studentNumber}
                studentName={name}
                customerEmail={p?.email ?? null}
                existing={page.invoices.map((i) => ({
                  docNumber: i.docNumber,
                  ayCode: i.ayCode,
                  stageKeys: i.stageKeys,
                  state: i.state,
                }))}
                openInvoices={page.openInvoices}
                credits={page.credits}
                charges={page.openCharges}
                creditNotes={page.openCredits}
                credit={b.credit}
                depositAccounts={page.depositAccounts}
                paymentMethods={page.paymentMethods}
                customerBalance={b.openBalance}
                initialSheet={
                  newSheet === 'payment' ||
                  newSheet === 'invoice' ||
                  newSheet === 'refund-receipt' ||
                  newSheet === 'credit-note'
                    ? newSheet
                    : null
                }
                initialInvoiceId={
                  newSheet === 'payment' ? (newInvoice ?? null) : null
                }
                initialStage={fromStage}
                fromInvoice={newSheet === 'credit-note' && from === 'invoice'}
              />
            </>
          )
        }
      >
        {related.length > 0 && (
          <nav
            aria-label="This student elsewhere"
            className="flex flex-wrap gap-2"
          >
            {related.map((l) => (
              <Button key={l.href} asChild variant="outline" size="sm">
                <Link href={l.href}>
                  <l.icon className="size-3.5" />
                  {l.label}
                </Link>
              </Button>
            ))}
          </nav>
        )}
      </BillingPageHeader>

      {!page.connected ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : !page.link ? (
        <>
          {/* Create invoice from a stage, for a student with no customer yet:
            step 1 finds or adds the customer, then the page reloads linked and
            Create invoice opens (the URL keeps new / stage / ay). */}
          {fromStage && (
            <StageCustomerSheet
              studentNumber={page.studentNumber}
              studentName={name}
              initialSearch={name.split(',')[0]?.trim() ?? ''}
            />
          )}
          <div className="flex items-start gap-4 rounded-xl border border-primary/30 bg-accent p-5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <UserSearch className="size-4" />
            </div>
            <div className="flex-1 space-y-1.5">
              <p className="font-serif text-base font-semibold text-foreground">
                Find their QuickBooks customer
              </p>
              <p className="text-sm text-muted-foreground">
                The SIS couldn&rsquo;t match this student to a QuickBooks
                customer by itself. Pick the right one, or add them to
                QuickBooks.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-2">
                <Link
                  href={`/billing/review?student=${encodeURIComponent(page.studentNumber)}`}
                >
                  Open in To review
                </Link>
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          {page.refreshError && (
            <div className="flex items-start gap-4 rounded-xl border border-brand-amber/40 bg-brand-amber/10 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-ink shadow-brand-tile">
                <AlertTriangle className="size-4" />
              </div>
              <div className="flex-1 space-y-1.5">
                <p className="font-serif text-base font-semibold text-foreground">
                  Showing what the SIS last read
                </p>
                <p className="text-sm text-muted-foreground">
                  {page.refreshError} Refresh to try QuickBooks again.
                </p>
              </div>
            </div>
          )}

          {page.stageWarning && (
            <p className="flex items-start gap-2 rounded-lg border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-sm text-ink">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {page.stageWarning}
            </p>
          )}

          <div className="@container/main">
            <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
              <MetricCard
                label="Open balance"
                value={formatSgd(b.openBalance)}
                icon={Wallet}
                subtext={
                  b.credit > 0
                    ? `${openCount} open invoices · ${formatSgd(b.owedOnInvoices)} before credit`
                    : `${openCount} open invoices`
                }
                href="?billing-txns.status=open"
              />
              <MetricCard
                label="Overdue"
                value={formatSgd(b.overdue)}
                icon={AlertTriangle}
                tileClassName={
                  b.overdue > 0
                    ? 'from-destructive to-destructive/80'
                    : undefined
                }
                subtext={
                  page.overdueOldest
                    ? `${page.overdueOldest.docNumber ?? 'An invoice'}, due ${formatDay(page.overdueOldest.dueDate)}`
                    : 'Nothing past its due date'
                }
                href="?billing-txns.status=overdue"
              />
              <MetricCard
                label="Unused credit"
                value={formatSgd(b.credit)}
                icon={Coins}
                tileClassName={
                  b.credit > 0
                    ? 'from-brand-amber to-brand-amber/80'
                    : undefined
                }
                subtext={
                  b.credit > 0
                    ? 'Use it on an invoice below'
                    : 'No unused credit'
                }
              />
              <MetricCard
                // The Registration and Fees stages: two words don't fit one
                // tile's figure, so Fees rides in the line under it.
                label={
                  page.stages
                    ? `Registration · ${page.stages.ayCode}`
                    : 'Registration · Fees'
                }
                value={page.stages ? (page.stages.registration ?? '—') : '—'}
                icon={Layers}
                subtext={
                  page.stages
                    ? `Fees: ${page.stages.fees ?? '—'} · filled from these invoices`
                    : 'No application on record'
                }
              />
            </div>
          </div>

          {b.credit > 0 && (
            <CreditPanel
              studentNumber={page.studentNumber}
              studentName={name}
              credit={b.credit}
              openInvoices={page.openInvoices}
              credits={page.credits}
              charges={page.openCharges}
              creditNotes={page.openCredits}
              depositAccounts={page.depositAccounts}
              paymentMethods={page.paymentMethods}
              customerBalance={b.openBalance}
            />
          )}

          <CustomerTabs
            studentNumber={page.studentNumber}
            studentName={name}
            level={page.student?.level ?? null}
            linkedName={page.link.displayName}
            invoices={page.invoices}
            payments={page.payments}
            docs={page.docs}
            profile={page.profile}
            openInvoices={page.openInvoices}
            credits={page.credits}
            creditNotes={page.openCredits}
            depositAccounts={page.depositAccounts}
            paymentMethods={page.paymentMethods}
            canRecord={page.connected}
            customerBalance={b.openBalance}
            qbBase={qbBase}
            initialTab={initialTab}
          />

          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {b.source === 'quickbooks'
              ? 'Read from QuickBooks just now'
              : 'Balances added up from the last QuickBooks read'}{' '}
            · QuickBooks is the record for money · Every action is in the audit
            log
          </p>
        </>
      )}
    </PageShell>
  );
}
