import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { InvoiceActivity } from '@/components/billing/invoice-activity';
import { InvoicePayButton } from '@/components/billing/invoice-pay-button';
import { InvoiceStatusBadge } from '@/components/billing/invoice-status-badge';
import { RefreshButton } from '@/components/billing/refresh-button';
import { SendInvoiceButton } from '@/components/billing/send-invoice-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { loadInvoicePage } from '@/lib/billing/invoice-page.server';
import { formatDay, todaySg } from '@/lib/billing/view';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { formatSgd } from '@/lib/qbo/format';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86_400_000
  );

// One invoice, laid out like QuickBooks' own invoice (Mr Ace, 2026-10-16;
// redone to match the QuickBooks screen 2026-10-19).
export default async function BillingInvoicePage({
  params,
}: {
  params: Promise<{ studentNumber: string; invoiceId: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');
  const { studentNumber: sn, invoiceId } = await params;
  const studentNumber = decodeURIComponent(sn);
  const page = await loadInvoicePage(
    createServiceClient(),
    studentNumber,
    decodeURIComponent(invoiceId)
  );
  if (!page) notFound();

  const d = page.detail;
  const total = d?.total ?? page.row.total;
  const balance = d?.balance ?? page.row.balance;
  const paid = Math.max(0, Math.round((total - balance) * 100) / 100);
  const today = todaySg();
  const due = d?.dueDate ?? page.row.dueDate;
  const overdueDays =
    due && balance > 0 && due < today ? daysBetween(due, today) : 0;
  const isVoided = (d?.state ?? page.row.state) === 'voided';
  const sent = page.activity.some((e) => e.label === 'Sent');
  const sendBlocked = isVoided
    ? 'A voided invoice can’t be sent.'
    : !(d?.billEmail ?? page.profile?.email)
      ? 'The QuickBooks customer has no email.'
      : null;
  const customerHref = `/billing/${encodeURIComponent(studentNumber)}`;
  const address = d?.billAddress.length
    ? d.billAddress
    : (page.profile?.billAddress ?? []);

  const invHref = (id: string) =>
    `${customerHref}/invoices/${encodeURIComponent(id)}`;

  // Laid out as QuickBooks' invoice: ‹ Invoice no. › to step through this
  // customer's invoices, Receive payment and Send on the right, then the
  // invoice as a document — customer and Bill to beside Invoice no. / Terms
  // / dates, the lines with their GST code, notes left and totals right.
  return (
    <PageShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={customerHref}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {page.customerName}
        </Link>
        <nav
          aria-label="This customer's invoices"
          className="flex items-center gap-1"
        >
          <Button
            asChild={!!page.older}
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={!page.older}
          >
            {page.older ? (
              <Link
                href={invHref(page.older.id)}
                aria-label={`Older: ${page.older.docNumber ?? 'invoice'}`}
              >
                <ChevronLeft className="size-4" />
              </Link>
            ) : (
              <ChevronLeft className="size-4" />
            )}
          </Button>
          <span className="font-mono text-[13px] tabular-nums text-foreground">
            Invoice {page.row.docNumber ?? '—'}
          </span>
          <Button
            asChild={!!page.newer}
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={!page.newer}
          >
            {page.newer ? (
              <Link
                href={invHref(page.newer.id)}
                aria-label={`Newer: ${page.newer.docNumber ?? 'invoice'}`}
              >
                <ChevronRight className="size-4" />
              </Link>
            ) : (
              <ChevronRight className="size-4" />
            )}
          </Button>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshButton label="Refresh" />
          <Button asChild variant="ghost">
            <a href={page.qbUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
              Open in QuickBooks
            </a>
          </Button>
          <SendInvoiceButton
            qboInvoiceId={page.row.id}
            label={sent ? 'Send again' : 'Send'}
            disabledReason={sendBlocked}
          />
          {!isVoided && balance > 0 && (
            <InvoicePayButton
              studentNumber={studentNumber}
              studentName={page.studentName}
              invoice={{
                id: page.row.id,
                docNumber: page.row.docNumber,
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
        </div>
      </div>

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

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="gap-0 py-0">
          {/* The document's head: what it is, its state, what's owed. */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
            <div className="space-y-2">
              <h1 className="font-serif text-[32px] font-semibold leading-none tracking-tight text-foreground">
                Invoice
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <InvoiceStatusBadge status={page.row.status} />
                {overdueDays > 0 && (
                  <span className="text-sm text-destructive">
                    Overdue {overdueDays} {overdueDays === 1 ? 'day' : 'days'}
                  </span>
                )}
                {page.row.tile && (
                  <Badge
                    variant="secondary"
                    className="h-6 font-mono text-[10px] uppercase tracking-wider"
                  >
                    {page.row.tile}
                  </Badge>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-[12px] text-muted-foreground">Balance due</p>
              <p className="font-serif text-[30px] font-semibold leading-none tabular-nums text-foreground">
                {formatSgd(balance)}
              </p>
            </div>
          </div>

          {/* Customer and Bill to | Invoice no., Terms, dates. */}
          <div className="grid grid-cols-1 gap-6 bg-accent/40 px-6 py-5 text-sm md:grid-cols-[minmax(0,1fr)_260px]">
            <dl className="space-y-3">
              <div className="space-y-0.5">
                <dt className="text-[12px] text-muted-foreground">Customer</dt>
                <dd>
                  <Link
                    href={customerHref}
                    className="font-medium text-foreground hover:underline"
                  >
                    {page.customerName}
                  </Link>
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-[12px] text-muted-foreground">
                  Customer email
                </dt>
                <dd className="text-foreground">
                  {[d?.billEmail ?? page.profile?.email, d?.billEmailCc]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-[12px] text-muted-foreground">Bill to</dt>
                <dd className="leading-relaxed text-foreground">
                  {page.profile?.companyName && (
                    <span className="block">{page.profile.companyName}</span>
                  )}
                  {address.length
                    ? address.map((l) => (
                        <span key={l} className="block">
                          {l}
                        </span>
                      ))
                    : !page.profile?.companyName && '—'}
                </dd>
              </div>
            </dl>
            <dl className="grid grid-cols-[auto_1fr] content-start gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">Invoice no.</dt>
              <dd className="font-mono text-[13px] tabular-nums text-foreground">
                {page.row.docNumber ?? '—'}
              </dd>
              <dt className="text-muted-foreground">Terms</dt>
              <dd className="text-foreground">{d?.terms ?? '—'}</dd>
              <dt className="text-muted-foreground">Invoice date</dt>
              <dd className="tabular-nums text-foreground">
                {formatDay(d?.txnDate ?? page.row.txnDate)}
              </dd>
              <dt className="text-muted-foreground">Due date</dt>
              <dd
                className={
                  overdueDays > 0
                    ? 'tabular-nums text-destructive'
                    : 'tabular-nums text-foreground'
                }
              >
                {formatDay(due)}
              </dd>
              {d?.location && (
                <>
                  <dt className="text-muted-foreground">Location</dt>
                  <dd className="text-foreground">{d.location}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="border-t border-border">
            <p className="px-6 pt-5 font-serif text-base font-semibold text-foreground">
              Product or service
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-6">#</TableHead>
                  <TableHead>Product/service</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="pr-6">GST</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(d?.lines ?? []).map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6 tabular-nums text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell className="text-foreground">
                      {l.itemName ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
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
                    <TableCell className="pr-6 text-muted-foreground">
                      {l.taxCode ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
                {!d && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="px-6 text-muted-foreground"
                    >
                      {page.row.items}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Notes left, totals right, as QuickBooks' invoice foot. */}
          <div className="grid grid-cols-1 gap-6 border-t border-border px-6 py-5 text-sm md:grid-cols-[minmax(0,1fr)_320px]">
            <dl className="space-y-3">
              <div className="space-y-0.5">
                <dt className="text-[12px] text-muted-foreground">
                  Note to customer
                </dt>
                <dd className="text-foreground">
                  {d?.customerMemo ?? page.row.memo ?? '—'}
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-[12px] text-muted-foreground">
                  Memo on statement (hidden)
                </dt>
                <dd className="text-foreground">{d?.privateNote ?? '—'}</dd>
              </div>
            </dl>
            <dl className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-1.5">
              {d && (
                <>
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="text-right tabular-nums">
                    {formatSgd(d.subtotal)}
                  </dd>
                  <dt className="text-muted-foreground">GST</dt>
                  <dd className="text-right tabular-nums">
                    {formatSgd(d.tax)}
                  </dd>
                </>
              )}
              <dt className="font-semibold text-foreground">Invoice total</dt>
              <dd className="text-right font-semibold tabular-nums">
                {formatSgd(total)}
              </dd>
              <dt className="text-muted-foreground">Amount paid</dt>
              <dd className="text-right tabular-nums">−{formatSgd(paid)}</dd>
              <dt className="border-t border-border pt-2 font-serif text-base font-semibold text-foreground">
                Balance due
              </dt>
              <dd className="border-t border-border pt-2 text-right font-serif text-base font-semibold tabular-nums">
                {formatSgd(balance)}
              </dd>
            </dl>
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg font-semibold tracking-tight">
                Invoice activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InvoiceActivity
                events={page.activity}
                paymentHref={`${customerHref}?tab=payments`}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg font-semibold tracking-tight">
                Contact
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="font-mono text-[13px]">
                  {page.profile?.phone ?? '—'}
                </dd>
                <dt className="text-muted-foreground">Mobile</dt>
                <dd className="font-mono text-[13px]">
                  {page.profile?.mobile ?? '—'}
                </dd>
                <dt className="text-muted-foreground">Other</dt>
                <dd className="font-mono text-[13px]">
                  {page.profile?.otherPhone ?? '—'}
                </dd>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Read from QuickBooks just now · Viewed is shown in QuickBooks only ·
        Every action is in the audit log
      </p>
    </PageShell>
  );
}
