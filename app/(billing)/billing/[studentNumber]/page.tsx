import {
  AlertTriangle,
  ArrowLeft,
  FileText,
  FolderOpen,
  Mail,
  Phone,
  UserRound,
  UserSearch,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { CreditPanel } from '@/components/billing/credit-panel';
import { CustomerActions } from '@/components/billing/customer-actions';
import { EditCustomerButton } from '@/components/billing/edit-customer-button';
import { CustomerTabs } from '@/components/billing/customer-tabs';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { loadCustomerPage } from '@/lib/billing/customer-page.server';
import { formatDay } from '@/lib/billing/view';
import { hrefPathname, isRouteAllowed } from '@/lib/auth/roles';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { formatSgd } from '@/lib/qbo/format';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → one student. Everything billed to their QuickBooks customer,
// newest first, no year filter (Mr Ace: "historical not focused on AY …
// just like an audit log"). Reads the customer from QuickBooks every time it
// opens.
export default async function BillingCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentNumber: string }>;
  searchParams: Promise<{ tab?: string; new?: string; invoice?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');
  const [{ studentNumber }, { tab, new: newSheet, invoice: newInvoice }] =
    await Promise.all([params, searchParams]);
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

  // QuickBooks' own page for this customer, where Edit lives.
  const qbHref =
    page.link && page.environment
      ? `https://${page.environment === 'sandbox' ? 'app.sandbox.' : ''}qbo.intuit.com/app/customerdetail?nameId=${encodeURIComponent(page.link.customerId)}`
      : null;
  const p = page.profile;

  return (
    <PageShell>
      {/* Laid out as QuickBooks' customer page: back to Customers, Edit and
          New transaction on the right, the customer card beside a Summary,
          then Transaction List / Customer Details. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/billing"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Customers
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {related.map((l) => (
            <Button key={l.href} asChild variant="ghost" size="sm">
              <Link href={l.href}>
                <l.icon className="size-3.5" />
                {l.label}
              </Link>
            </Button>
          ))}
          {page.link && page.connected && (
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
                maps={page.maps}
                existing={page.invoices.map((i) => ({
                  docNumber: i.docNumber,
                  ayCode: i.ayCode,
                  stageKeys: i.stageKeys,
                  state: i.state,
                }))}
                openInvoices={page.openInvoices}
                credits={page.credits}
                depositAccounts={page.depositAccounts}
                paymentMethods={page.paymentMethods}
                customerBalance={b.openBalance}
                initialSheet={
                  newSheet === 'payment' || newSheet === 'invoice'
                    ? newSheet
                    : null
                }
                initialInvoiceId={
                  newSheet === 'payment' ? (newInvoice ?? null) : null
                }
              />
            </>
          )}
        </div>
      </div>

      {!page.connected || !page.link ? (
        <header className="space-y-2">
          <h1 className="font-serif text-[30px] font-semibold leading-tight tracking-tight text-foreground">
            {name}
          </h1>
          <p className="font-mono text-[12px] tabular-nums text-muted-foreground">
            {page.studentNumber}
            {page.student?.level
              ? ` · ${page.student.level}, ${page.student.ayCode}`
              : ''}
          </p>
        </header>
      ) : null}

      {!page.connected ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : !page.link ? (
        <div className="flex items-start gap-4 rounded-xl border border-primary/30 bg-accent p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <UserSearch className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              Find their QuickBooks customer
            </p>
            <p className="text-sm text-muted-foreground">
              The SIS couldn&rsquo;t match this student to a QuickBooks customer
              by itself. Pick the right one, or add them to QuickBooks.
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

          <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card>
              <CardContent className="space-y-5">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="font-serif text-[30px] font-semibold leading-tight tracking-tight text-foreground">
                      {page.link.displayName}
                    </h1>
                    {p?.email && (
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="size-8"
                      >
                        <a
                          href={`mailto:${p.email}`}
                          aria-label={`Email ${p.email}`}
                          title={p.email}
                        >
                          <Mail className="size-4" />
                        </a>
                      </Button>
                    )}
                    {(p?.phone || p?.mobile) && (
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="size-8"
                      >
                        <a
                          href={`tel:${p.phone ?? p.mobile}`}
                          aria-label={`Call ${p.phone ?? p.mobile}`}
                          title={p.phone ?? p.mobile ?? undefined}
                        >
                          <Phone className="size-4" />
                        </a>
                      </Button>
                    )}
                  </div>
                  <p className="font-mono text-[12px] tabular-nums text-muted-foreground">
                    {page.studentNumber}
                    {page.student?.level
                      ? ` · ${page.student.level}, ${page.student.ayCode}`
                      : ''}
                  </p>
                </div>
                <dl className="grid grid-cols-1 gap-x-10 gap-y-4 text-sm sm:grid-cols-2">
                  <div className="space-y-1">
                    <dt className="text-[12px] text-muted-foreground">
                      Company
                    </dt>
                    <dd className="text-foreground">{p?.companyName ?? '—'}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-[12px] text-muted-foreground">
                      Billing address
                    </dt>
                    <dd className="text-foreground">
                      {p?.billAddress.length ? p.billAddress.join(', ') : '—'}
                    </dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-[12px] text-muted-foreground">Notes</dt>
                    <dd className="text-foreground">{p?.notes || '—'}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-[12px] text-muted-foreground">
                      {page.stages
                        ? `Admissions · ${page.stages.ayCode}`
                        : 'Admissions'}
                    </dt>
                    <dd className="text-foreground">
                      {page.stages
                        ? `Registration: ${page.stages.registration ?? '—'} · Fees: ${page.stages.fees ?? '—'}`
                        : 'No application on record'}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="font-serif text-lg font-semibold tracking-tight">
                  Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <SummaryLine
                  bar="bg-brand-amber"
                  value={formatSgd(b.openBalance)}
                  label="Open balance"
                  note={`${openCount} open ${openCount === 1 ? 'invoice' : 'invoices'}`}
                />
                <SummaryLine
                  bar="bg-destructive"
                  value={formatSgd(b.overdue)}
                  label="Overdue payment"
                  note={
                    page.overdueOldest
                      ? `Oldest: ${page.overdueOldest.docNumber ?? 'an invoice'}, due ${formatDay(page.overdueOldest.dueDate)}`
                      : undefined
                  }
                />
                {b.credit > 0 && (
                  <SummaryLine
                    bar="bg-brand-mint"
                    value={formatSgd(b.credit)}
                    label="Unused credit"
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {b.credit > 0 && (
            <CreditPanel
              studentNumber={page.studentNumber}
              studentName={name}
              credit={b.credit}
              openInvoices={page.openInvoices}
              credits={page.credits}
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
            profile={page.profile}
            openInvoices={page.openInvoices}
            credits={page.credits}
            depositAccounts={page.depositAccounts}
            paymentMethods={page.paymentMethods}
            canRecord={page.connected}
            customerBalance={b.openBalance}
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

/** One figure in the Summary card, with QuickBooks' coloured bar beside it. */
function SummaryLine({
  bar,
  value,
  label,
  note,
}: {
  bar: string;
  value: string;
  label: string;
  note?: string;
}) {
  return (
    <div className="flex gap-3">
      <span aria-hidden className={`w-1 shrink-0 rounded-full ${bar}`} />
      <div className="space-y-0.5">
        <p className="font-serif text-[24px] font-semibold leading-none tabular-nums text-foreground">
          {value}
        </p>
        <p className="text-sm text-foreground">{label}</p>
        {note && <p className="text-[12px] text-muted-foreground">{note}</p>}
      </div>
    </div>
  );
}
