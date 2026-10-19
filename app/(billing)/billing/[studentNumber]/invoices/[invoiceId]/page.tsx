import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  History,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { InvoiceActivity } from '@/components/billing/invoice-activity';
import { InvoicePayButton } from '@/components/billing/invoice-pay-button';
import {
  InvoiceFooterBar,
  InvoiceManageMenu,
} from '@/components/billing/invoice-screen-actions';
import { InvoiceStatusBadge } from '@/components/billing/invoice-status-badge';
import { RefreshButton } from '@/components/billing/refresh-button';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { InvoiceCopy } from '@/lib/billing/invoice-copy';
import { loadInvoicePage } from '@/lib/billing/invoice-page.server';
import { formatDay, round2, todaySg } from '@/lib/billing/view';
import { qboAppUrl } from '@/lib/qbo/env';
import { formatSgd } from '@/lib/qbo/format';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { cn } from '@/lib/utils';

const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86_400_000
  );

/** A read-only value drawn as QuickBooks' form box, with its label above. */
function Box({
  label,
  children,
  className,
  tall,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  tall?: boolean;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <div
        className={cn(
          'rounded-md border border-border bg-card px-3 text-sm text-foreground shadow-input',
          tall ? 'min-h-20 py-2 leading-relaxed' : 'flex h-9 items-center'
        )}
      >
        {children}
      </div>
    </div>
  );
}

const Empty = () => <span className="text-muted-foreground">—</span>;

// One invoice as QuickBooks' invoice screen (Mr Ace, 2026-10-19: "use QB as
// reference"): a full screen with the title bar (history, Invoice no., close),
// the view switch, ‹ Invoice no. › and Receive payment / Manage; the invoice
// itself in QuickBooks' order; Invoice activity on the right; and QuickBooks'
// footer bar (Print or download, Make recurring, More actions | Edit in
// QuickBooks, Send ▾). The lines are read-only here — they are edited in
// QuickBooks.
export default async function BillingInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ studentNumber: string; invoiceId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');
  const [{ studentNumber: sn, invoiceId }, sp] = await Promise.all([
    params,
    searchParams,
  ]);
  const studentNumber = decodeURIComponent(sn);
  const page = await loadInvoicePage(
    createServiceClient(),
    studentNumber,
    decodeURIComponent(invoiceId)
  );
  if (!page) notFound();
  const pdfView = sp.view === 'pdf';

  const d = page.detail;
  const total = d?.total ?? page.row.total;
  const balance = d?.balance ?? page.row.balance;
  const paid = Math.max(0, round2(total - balance - (d?.deposit ?? 0)));
  const today = todaySg();
  const due = d?.dueDate ?? page.row.dueDate;
  const overdueDays =
    due && balance > 0 && due < today ? daysBetween(due, today) : 0;
  const isVoided = (d?.state ?? page.row.state) === 'voided';
  const sent = page.activity.some((e) => e.label === 'Sent');
  const email = d?.billEmail ?? page.profile?.email ?? null;
  const sendBlocked = isVoided
    ? 'A voided invoice can’t be sent.'
    : !email
      ? 'The QuickBooks customer has no email.'
      : null;
  // Void runs here only for an unpaid invoice; one with a payment is voided
  // in QuickBooks, where the payment is dealt with too.
  const unpaid = !isVoided && paid === 0 && page.payments.length === 0;
  const customerHref = `/billing/${encodeURIComponent(studentNumber)}`;
  const address = d?.billAddress.length
    ? d.billAddress
    : (page.profile?.billAddress ?? []);
  const docNo = page.row.docNumber;
  const invHref = (id: string, pdf = pdfView) =>
    `${customerHref}/invoices/${encodeURIComponent(id)}${pdf ? '?view=pdf' : ''}`;

  // Make a copy: the lines as QuickBooks has them; only when every line has
  // its product, so the copy is the same invoice.
  const copy: InvoiceCopy | null =
    d && d.lines.length > 0 && d.lines.every((l) => l.itemId)
      ? {
          from: docNo,
          memo: d.customerMemo,
          lines: d.lines.map((l) => {
            const qty = l.qty && l.qty > 0 ? l.qty : 1;
            return {
              itemId: l.itemId as string,
              description: l.description ?? '',
              qty,
              unitPrice: l.rate ?? round2(l.amount / qty),
            };
          }),
        }
      : null;

  const views = [
    { label: 'Invoice', href: invHref(page.row.id, false), on: !pdfView },
    { label: 'PDF view', href: invHref(page.row.id, true), on: pdfView },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Title bar: history, the invoice, close. */}
      <header className="shrink-0 border-b border-border bg-card">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-9"
            title="Invoice activity"
          >
            <a href="#invoice-activity" aria-label="Invoice activity">
              <History className="size-5" />
            </a>
          </Button>
          <h1 className="min-w-0 truncate font-serif text-[22px] font-semibold tracking-tight text-foreground">
            Invoice {docNo ?? ''}
          </h1>
          <InvoiceStatusBadge status={page.row.status} />
          {overdueDays > 0 && (
            <span className="hidden text-sm text-destructive sm:inline">
              Overdue {overdueDays} {overdueDays === 1 ? 'day' : 'days'}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <RefreshButton label="Refresh" />
            <Button asChild variant="ghost" size="icon" className="size-9">
              <Link
                href={customerHref}
                aria-label={`Close, back to ${page.customerName}`}
              >
                <X className="size-5" />
              </Link>
            </Button>
          </div>
        </div>
        {/* View switch | ‹ Invoice no. › | Receive payment, Manage. */}
        <div className="grid grid-cols-1 items-center gap-2 px-4 sm:px-6 lg:grid-cols-[1fr_auto_1fr]">
          <nav aria-label="Invoice view" className="flex gap-1">
            {views.map((v) => (
              <Link
                key={v.label}
                href={v.href}
                aria-current={v.on ? 'page' : undefined}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors',
                  v.on
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {v.label}
              </Link>
            ))}
          </nav>
          <nav
            aria-label="This customer's invoices"
            className="flex items-center justify-center gap-1"
          >
            <Stepper
              href={page.older ? invHref(page.older.id) : null}
              label={`Older: ${page.older?.docNumber ?? 'invoice'}`}
            >
              <ChevronLeft className="size-4" />
            </Stepper>
            <span className="text-sm tabular-nums text-foreground">
              Invoice {docNo ?? '—'}
            </span>
            <Stepper
              href={page.newer ? invHref(page.newer.id) : null}
              label={`Newer: ${page.newer?.docNumber ?? 'invoice'}`}
            >
              <ChevronRight className="size-4" />
            </Stepper>
          </nav>
          <div className="flex items-center justify-end gap-1 pb-1 lg:pb-0">
            {!isVoided && balance > 0 && (
              <InvoicePayButton
                variant="ghost"
                studentNumber={studentNumber}
                studentName={page.studentName}
                invoice={{
                  id: page.row.id,
                  docNumber: docNo,
                  txnDate: page.row.txnDate,
                  balance,
                  items: page.row.items,
                  dueDate: page.row.dueDate,
                  total: page.row.total,
                }}
                credits={page.credits}
                depositAccounts={page.depositAccounts}
                paymentMethods={page.paymentMethods}
                customerBalance={page.profile?.balance ?? null}
              />
            )}
            <InvoiceManageMenu
              qbUrl={page.qbUrl}
              qbSettingsUrl={qboAppUrl(
                page.environment,
                '/app/settings?p=Sales'
              )}
            />
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/50">
        <div className="mx-auto grid max-w-400 grid-cols-1 items-start gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            {page.detailError && (
              <div className="flex items-start gap-4 rounded-xl border border-brand-amber/40 bg-brand-amber/10 p-5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-ink shadow-brand-tile">
                  <AlertTriangle className="size-4" />
                </div>
                <div className="flex-1 space-y-1.5">
                  <p className="font-serif text-base font-semibold text-foreground">
                    Showing what the SIS last read
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {page.detailError} GST codes and the billing address need
                    QuickBooks; refresh to try again.
                  </p>
                </div>
              </div>
            )}

            {pdfView ? (
              <iframe
                title={`Invoice ${docNo ?? ''} PDF`}
                src={`/api/billing/invoices/${encodeURIComponent(page.row.id)}/pdf`}
                className="h-[calc(100dvh-14rem)] min-h-[480px] w-full rounded-xl border border-border bg-card shadow-sm"
              />
            ) : (
              <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                {/* INVOICE, the company, Balance due. */}
                <div className="flex flex-wrap items-start justify-between gap-6 px-6 py-6 sm:px-8">
                  <div className="space-y-3">
                    <h2 className="font-serif text-[32px] font-semibold leading-none tracking-tight text-brand-indigo">
                      INVOICE
                    </h2>
                    {page.company ? (
                      <div className="flex flex-wrap gap-x-10 gap-y-2 text-sm leading-relaxed text-foreground">
                        <div>
                          <p className="font-semibold">{page.company.name}</p>
                          {page.company.address.map((l) => (
                            <p key={l}>{l}</p>
                          ))}
                        </div>
                        <div>
                          {page.company.email && <p>{page.company.email}</p>}
                          {page.company.phone && <p>{page.company.phone}</p>}
                        </div>
                      </div>
                    ) : null}
                    <a
                      href={qboAppUrl(
                        page.environment,
                        '/app/settings?p=Company'
                      )}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
                    >
                      Edit company
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                  <div className="text-right">
                    <p className="text-[13px] text-muted-foreground">
                      Balance due
                    </p>
                    <p className="font-serif text-[30px] font-semibold leading-tight tabular-nums text-foreground">
                      {formatSgd(balance)}
                    </p>
                  </div>
                </div>

                {/* Customer, email, Cc, Bill to | Invoice no., Terms, dates. */}
                <div className="grid grid-cols-1 gap-x-8 gap-y-4 bg-accent/50 px-6 py-6 sm:px-8 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <Box label="Customer">
                      <Link
                        href={customerHref}
                        className="truncate font-medium text-foreground hover:underline"
                      >
                        {page.customerName}
                      </Link>
                    </Box>
                    <Box label="Customer email">
                      {email ? (
                        <span className="truncate">{email}</span>
                      ) : (
                        <Empty />
                      )}
                    </Box>
                    {d?.billEmailCc && <Box label="Cc">{d.billEmailCc}</Box>}
                    <Box label="Bill to" tall>
                      {page.profile?.companyName && (
                        <span className="block">
                          {page.profile.companyName}
                        </span>
                      )}
                      {address.length
                        ? address.map((l) => (
                            <span key={l} className="block">
                              {l}
                            </span>
                          ))
                        : !page.profile?.companyName && <Empty />}
                    </Box>
                    <Link
                      href={customerHref}
                      className="inline-block text-[13px] text-primary hover:underline"
                    >
                      Edit Customer
                    </Link>
                  </div>
                  <div className="space-y-3">
                    <Box label="Invoice no.">
                      <span className="tabular-nums">{docNo ?? <Empty />}</span>
                    </Box>
                    <Box label="Terms">{d?.terms ?? <Empty />}</Box>
                    <Box label="Invoice date">
                      <span className="tabular-nums">
                        {formatDay(d?.txnDate ?? page.row.txnDate)}
                      </span>
                    </Box>
                    <Box label="Due date">
                      <span
                        className={cn(
                          'tabular-nums',
                          overdueDays > 0 && 'text-destructive'
                        )}
                      >
                        {formatDay(due)}
                      </span>
                    </Box>
                    {d?.location && <Box label="Location">{d.location}</Box>}
                  </div>
                </div>

                {/* Product or service. */}
                <div className="px-6 pt-6 sm:px-8">
                  <h3 className="font-serif text-base font-semibold text-foreground">
                    Product or service
                  </h3>
                </div>
                <div className="px-2 sm:px-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 pl-4">#</TableHead>
                        <TableHead>Product/service</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="pr-4">Tax</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(d?.lines ?? []).map((l, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4 tabular-nums text-muted-foreground">
                            {i + 1}
                          </TableCell>
                          <TableCell className="text-foreground">
                            {l.itemName ?? '—'}
                          </TableCell>
                          <TableCell className="whitespace-normal text-muted-foreground">
                            {l.description ?? ''}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {l.qty ?? ''}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {l.rate != null ? formatSgd(l.rate) : ''}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatSgd(l.amount)}
                          </TableCell>
                          <TableCell className="pr-4 text-muted-foreground">
                            {l.taxCode ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                      {!d && (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className="px-4 text-muted-foreground"
                          >
                            {page.row.items}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Notes left, totals right. */}
                <div className="mt-4 grid grid-cols-1 gap-8 border-t border-border px-6 py-6 sm:px-8 md:grid-cols-[minmax(0,1fr)_340px]">
                  <div className="max-w-md space-y-4">
                    <Box label="Note to customer" tall>
                      {d?.customerMemo ?? page.row.memo ?? <Empty />}
                    </Box>
                    <Box label="Internal customer notes (hidden)" tall>
                      {page.profile?.notes ?? <Empty />}
                    </Box>
                    <Box label="Memo on statement (hidden)" tall>
                      {d?.privateNote ?? <Empty />}
                    </Box>
                  </div>
                  <dl className="grid h-fit grid-cols-[1fr_auto] gap-x-8 gap-y-2 text-sm">
                    {d && (
                      <>
                        <dt className="text-muted-foreground">Subtotal</dt>
                        <dd className="text-right tabular-nums">
                          {formatSgd(d.subtotal)}
                        </dd>
                        {d.discount > 0 && (
                          <>
                            <dt className="text-muted-foreground">Discount</dt>
                            <dd className="text-right tabular-nums">
                              −{formatSgd(d.discount)}
                            </dd>
                          </>
                        )}
                        <dt className="text-muted-foreground">GST</dt>
                        <dd className="text-right tabular-nums">
                          {formatSgd(d.tax)}
                        </dd>
                      </>
                    )}
                    <dt className="pt-2 font-semibold text-foreground">
                      Invoice total
                    </dt>
                    <dd className="pt-2 text-right font-semibold tabular-nums">
                      {formatSgd(total)}
                    </dd>
                    {d && d.deposit > 0 && (
                      <>
                        <dt className="text-muted-foreground">Deposit</dt>
                        <dd className="text-right tabular-nums">
                          −{formatSgd(d.deposit)}
                        </dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">Amount paid</dt>
                    <dd className="text-right tabular-nums">
                      −{formatSgd(paid)}
                    </dd>
                    <dt className="border-t border-border pt-2 font-serif text-base font-semibold text-foreground">
                      Balance due
                    </dt>
                    <dd className="border-t border-border pt-2 text-right font-serif text-base font-semibold tabular-nums">
                      {formatSgd(balance)}
                    </dd>
                  </dl>
                </div>
              </article>
            )}
          </div>

          <aside
            id="invoice-activity"
            className="scroll-mt-4 rounded-xl border border-border bg-card p-5 shadow-sm lg:sticky lg:top-0"
          >
            <h2 className="font-serif text-lg font-semibold tracking-tight text-foreground">
              Invoice activity
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Viewed is shown in QuickBooks only.
            </p>
            <div className="mt-4">
              <InvoiceActivity
                events={page.activity}
                paymentHref={`${customerHref}?tab=payments`}
              />
            </div>
          </aside>
        </div>
      </div>

      <InvoiceFooterBar
        invoiceId={page.row.id}
        docNumber={docNo}
        studentNumber={studentNumber}
        qbUrl={page.qbUrl}
        qbCreditMemoUrl={qboAppUrl(page.environment, '/app/creditmemo')}
        copy={copy}
        voidable={unpaid}
        voidBlocked={
          !isVoided && !unpaid
            ? 'This invoice has a payment, so it is voided in QuickBooks.'
            : null
        }
        sendLabel={sent ? 'Send again' : 'Send'}
        sendBlocked={sendBlocked}
      />
    </div>
  );
}

function Stepper({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: ReactNode;
}) {
  return (
    <Button
      asChild={!!href}
      variant="ghost"
      size="icon"
      className="size-8"
      disabled={!href}
    >
      {href ? (
        <Link href={href} aria-label={label}>
          {children}
        </Link>
      ) : (
        children
      )}
    </Button>
  );
}
