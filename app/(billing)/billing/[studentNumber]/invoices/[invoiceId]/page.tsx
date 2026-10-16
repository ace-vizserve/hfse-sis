import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CalendarX2,
  ExternalLink,
  ReceiptText,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { InvoiceActivity } from '@/components/billing/invoice-activity';
import { InvoicePayButton } from '@/components/billing/invoice-pay-button';
import { InvoiceStatusBadge } from '@/components/billing/invoice-status-badge';
import { RefreshButton } from '@/components/billing/refresh-button';
import { SendInvoiceButton } from '@/components/billing/send-invoice-button';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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

// One invoice, laid out like QuickBooks' own view (Mr Ace, 2026-10-16):
// lines with each line's GST code, totals, billing address, Invoice activity.
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

  return (
    <PageShell>
      <Link
        href={customerHref}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {page.studentName}
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Billing · {page.customerName} · Invoice
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Invoice {page.row.docNumber ?? 'without a number'}.
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <InvoiceStatusBadge status={page.row.status} />
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
              }}
              credits={page.credits}
              depositAccounts={page.depositAccounts}
            />
          )}
        </div>
      </header>

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

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @3xl/main:grid-cols-4">
          <MetricCard
            label="Total"
            value={formatSgd(total)}
            icon={ReceiptText}
            subtext={d ? `GST ${formatSgd(d.tax)}` : undefined}
          />
          <MetricCard
            label="Balance"
            value={formatSgd(balance)}
            icon={Wallet}
            intent={overdueDays > 0 ? 'bad' : 'default'}
            subtext={`${formatSgd(paid)} paid`}
          />
          <MetricCard
            label="Invoice date"
            value={formatDay(d?.txnDate ?? page.row.txnDate)}
            icon={CalendarDays}
            subtext={d?.terms ? `Terms: ${d.terms}` : undefined}
          />
          <MetricCard
            label="Due date"
            value={formatDay(due)}
            icon={CalendarX2}
            intent={overdueDays > 0 ? 'bad' : 'default'}
            subtext={
              overdueDays > 0
                ? `${overdueDays} days overdue`
                : balance > 0
                  ? 'Not overdue'
                  : 'Nothing owing'
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b border-border py-4">
            <CardTitle className="font-serif text-lg font-semibold tracking-tight">
              Lines
            </CardTitle>
            <CardDescription>
              GST follows each item&rsquo;s tax code in QuickBooks.
            </CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>GST</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(d?.lines ?? []).map((l, i) => (
                <TableRow key={i}>
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
                  <TableCell className="text-muted-foreground">
                    {l.taxCode ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatSgd(l.amount)}
                  </TableCell>
                </TableRow>
              ))}
              {!d && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    {page.row.items}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <dl className="ml-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-8 gap-y-1.5 border-t border-border px-6 py-4 text-sm">
            {d && (
              <>
                <dt className="text-right text-muted-foreground">Subtotal</dt>
                <dd className="text-right tabular-nums">
                  {formatSgd(d.subtotal)}
                </dd>
                <dt className="text-right text-muted-foreground">GST</dt>
                <dd className="text-right tabular-nums">{formatSgd(d.tax)}</dd>
              </>
            )}
            <dt className="text-right font-semibold">Total</dt>
            <dd className="text-right font-semibold tabular-nums">
              {formatSgd(total)}
            </dd>
            <dt className="text-right text-muted-foreground">Paid</dt>
            <dd className="text-right tabular-nums">−{formatSgd(paid)}</dd>
            <dt className="text-right font-serif text-base font-semibold">
              Balance due
            </dt>
            <dd className="text-right font-serif text-base font-semibold tabular-nums">
              {formatSgd(balance)}
            </dd>
          </dl>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-border px-6 py-4 text-sm">
            <dt className="text-muted-foreground">Message on invoice</dt>
            <dd>{d?.customerMemo ?? page.row.memo ?? '—'}</dd>
            <dt className="text-muted-foreground">Memo</dt>
            <dd>{d?.privateNote ?? '—'}</dd>
            <dt className="text-muted-foreground">Location</dt>
            <dd>{d?.location ?? '—'}</dd>
          </dl>
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
                Billing address
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="leading-relaxed">
                {page.customerName}
                {page.profile?.companyName && (
                  <>
                    <br />
                    {page.profile.companyName}
                  </>
                )}
                {address.map((l) => (
                  <span key={l}>
                    <br />
                    {l}
                  </span>
                ))}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
                <dt className="text-muted-foreground">Email</dt>
                <dd>
                  {[d?.billEmail ?? page.profile?.email, d?.billEmailCc]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </dd>
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
