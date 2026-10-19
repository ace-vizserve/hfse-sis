import {
  AlertTriangle,
  ChevronLeft,
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
import { CustomerNavPanel } from '@/components/billing/customer-nav-panel';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { loadCustomerPage } from '@/lib/billing/customer-page.server';
import { loadCustomerNav } from '@/lib/billing/customer-nav.server';
import { hrefPathname, isRouteAllowed } from '@/lib/auth/roles';
import { connectedRealmId } from '@/lib/qbo/client';
import { qboAppUrl } from '@/lib/qbo/env';
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
  const service = createServiceClient();
  const page = await loadCustomerPage(
    service,
    decodeURIComponent(studentNumber)
  );
  if (!page) notFound();
  // The left panel's customers (QuickBooks' customer list on this page).
  const realmId = page.connected
    ? await connectedRealmId(service).catch(() => null)
    : null;
  const nav = realmId
    ? await loadCustomerNav(service, realmId).catch(() => [])
    : [];

  const name =
    page.student?.name ?? page.link?.displayName ?? page.studentNumber;
  const b = page.balances;

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
  const qbHref =
    page.link && page.environment
      ? `${qboAppUrl(page.environment, '')}/app/customerdetail?nameId=${encodeURIComponent(page.link.customerId)}`
      : null;
  const p = page.profile;

  if (!page.connected || !page.link)
    return (
      <PageShell>
        <Link
          href="/billing"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <ChevronLeft className="size-4" />
          Customers
        </Link>
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
        {!page.connected ? (
          <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
        ) : (
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
        )}
      </PageShell>
    );

  // Laid out as QuickBooks' customer page: ‹ Customers with Edit ▾ and New
  // transaction ▾ on one bar; the customer list down the left; the customer
  // card beside the Summary; then the tabs and the list.
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/billing"
          className="inline-flex w-fit items-center gap-1 text-[15px] text-primary hover:underline"
        >
          <ChevronLeft className="size-4" />
          Customers
        </Link>
        <div className="flex flex-wrap items-center gap-2">
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
              newSheet === 'payment' || newSheet === 'invoice' ? newSheet : null
            }
            initialInvoiceId={
              newSheet === 'payment' ? (newInvoice ?? null) : null
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="hidden lg:block">
          <div className="sticky top-4 h-[calc(100vh-7rem)]">
            <CustomerNavPanel customers={nav} current={page.studentNumber} />
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          {page.refreshError && (
            <p className="flex items-start gap-2 rounded-lg border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-sm text-ink">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Showing what the SIS last read: {page.refreshError} Refresh to try
              QuickBooks again.
            </p>
          )}
          {page.stageWarning && (
            <p className="flex items-start gap-2 rounded-lg border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-sm text-ink">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {page.stageWarning}
            </p>
          )}

          <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
            <Card className="py-5">
              <CardContent className="space-y-4 px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-serif text-[26px] font-semibold leading-tight tracking-tight text-foreground">
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
                <dl className="space-y-3 text-sm">
                  <div className="space-y-0.5">
                    <dt className="text-[12px] text-muted-foreground">
                      Company
                    </dt>
                    <dd className="text-foreground">{p?.companyName ?? '—'}</dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-[12px] text-muted-foreground">
                      Billing address
                    </dt>
                    <dd className="text-foreground">
                      {p?.billAddress.length ? p.billAddress.join(', ') : '—'}
                    </dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-[12px] text-muted-foreground">Notes</dt>
                    <dd className="text-foreground">
                      {p?.notes || (
                        <span className="text-muted-foreground">
                          Add notes with Edit
                        </span>
                      )}
                    </dd>
                  </div>
                  {/* QuickBooks' Custom Fields slot: what the SIS knows. */}
                  <div className="space-y-1">
                    <dt className="text-[12px] text-muted-foreground">
                      Student
                    </dt>
                    <dd className="space-y-1.5 text-foreground">
                      <div className="font-mono text-[12px] tabular-nums text-muted-foreground">
                        {page.studentNumber}
                        {page.student?.level
                          ? ` · ${page.student.level}, ${page.student.ayCode}`
                          : ''}
                        {page.stages
                          ? ` · Registration: ${page.stages.registration ?? '—'} · Fees: ${page.stages.fees ?? '—'}`
                          : ''}
                      </div>
                      {related.length > 0 && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {related.map((l) => (
                            <Link
                              key={l.href}
                              href={l.href}
                              className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
                            >
                              <l.icon className="size-3.5" />
                              {l.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            <Card className="py-5">
              <CardContent className="space-y-5 px-5">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-foreground">
                  Summary
                </p>
                <SummaryLine
                  bar="bg-brand-amber"
                  value={formatSgd(b.openBalance)}
                  label="Open balance"
                />
                <SummaryLine
                  bar="bg-destructive"
                  value={formatSgd(b.overdue)}
                  label="Overdue payment"
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
            qbBase={page.environment ? qboAppUrl(page.environment, '') : null}
            initialTab={initialTab}
          />
        </div>
      </div>
    </div>
  );
}

/** One figure in the Summary card, with QuickBooks' coloured bar beside it. */
function SummaryLine({
  bar,
  value,
  label,
}: {
  bar: string;
  value: string;
  label: string;
}) {
  return (
    <div className="flex gap-3">
      <span aria-hidden className={`w-1 shrink-0 rounded-full ${bar}`} />
      <div className="space-y-0.5">
        <p className="font-serif text-[22px] font-semibold leading-none tabular-nums text-foreground">
          {value}
        </p>
        <p className="text-sm text-foreground">{label}</p>
      </div>
    </div>
  );
}
