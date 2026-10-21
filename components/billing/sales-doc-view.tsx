import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  Coins,
  Landmark,
  ReceiptText,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { RefreshButton } from '@/components/billing/refresh-button';
import { SalesDocActions } from '@/components/billing/sales-doc-actions';
import { MetricCard } from '@/components/dashboard/metric-card';
import {
  Card,
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
import {
  SALES_DOC_NAME,
  type SalesDocKind,
} from '@/lib/billing/sales-doc-body';
import { docQbPath, docStatus } from '@/lib/billing/sales-docs';
import { loadSalesDocPage } from '@/lib/billing/sales-docs.server';
import { formatShortDay, round2 } from '@/lib/billing/view';
import { qboAppUrl } from '@/lib/qbo/env';
import { formatSgd } from '@/lib/qbo/format';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { cn } from '@/lib/utils';

const Empty = () => <span className="text-muted-foreground">—</span>;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm leading-relaxed text-foreground">{children}</dd>
    </div>
  );
}

// QuickBooks' words per kind (sandbox capture 2026-10-21).
const WORDS: Record<
  SalesDocKind,
  { date: string; message: string; total: string }
> = {
  refund_receipt: {
    date: 'Refund Receipt date',
    message: 'Message displayed on refund receipt',
    total: 'Total amount refunded',
  },
  credit_memo: {
    date: 'Credit Note date',
    message: 'Message displayed on credit note',
    total: 'Total credit',
  },
};

// One refund receipt or credit memo, read live from QuickBooks — the invoice
// page's layout (hero, stat tiles, details card). QuickBooks decides what is
// on it (its fields, its More ▾); the SIS decides how it looks.
export async function SalesDocView({
  kind,
  params,
}: {
  kind: SalesDocKind;
  params: Promise<{ studentNumber: string; docId: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');
  const { studentNumber: sn, docId } = await params;
  const studentNumber = decodeURIComponent(sn);
  const page = await loadSalesDocPage(
    createServiceClient(),
    studentNumber,
    kind,
    decodeURIComponent(docId)
  );
  if (!page) notFound();
  const name = SALES_DOC_NAME[kind];
  const words = WORDS[kind];
  const d = page.doc;
  const refund = kind === 'refund_receipt';
  const customerHref = `/billing/${encodeURIComponent(studentNumber)}`;
  const qbUrl = qboAppUrl(
    page.environment,
    docQbPath(refund ? 'refund' : 'credit', decodeURIComponent(docId))
  );
  const status = d
    ? docStatus({
        kind: refund ? 'refund' : 'credit',
        open: d.remainingCredit ?? 0,
        total: d.total,
      })
    : null;
  const subtotal = d ? round2(d.lines.reduce((s, l) => s + l.amount, 0)) : 0;

  return (
    <PageShell>
      <Link
        href={customerHref}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {page.customerName}
      </Link>

      <BillingPageHeader
        crumbs={[{ label: name }]}
        stackActions
        title={`${name} ${d?.docNumber ?? (d ? 'without a number' : '')}`.trim()}
        description={`A ${name.toLowerCase()} of ${page.customerName}, read live from QuickBooks.`}
        actions={
          <>
            <RefreshButton label="Refresh" />
            <SalesDocActions qbUrl={qbUrl} />
          </>
        }
      >
        {status && (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-sm text-foreground'
            )}
          >
            {status.tone === 'good' ? (
              <CheckCircle2 className="size-4 fill-brand-mint text-ink" />
            ) : (
              <CircleDashed className="size-4 text-brand-amber" />
            )}
            {status.status}
          </span>
        )}
      </BillingPageHeader>

      {page.error && (
        <div className="flex items-start gap-4 rounded-xl border border-brand-amber/40 bg-brand-amber/10 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-ink shadow-brand-tile">
            <AlertTriangle className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              QuickBooks couldn&rsquo;t be read just now
            </p>
            <p className="text-sm text-muted-foreground">
              {page.error} Refresh to try again.
            </p>
          </div>
        </div>
      )}

      {d && (
        <>
          <div className="@container/main">
            <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-3">
              <MetricCard
                label={words.total}
                value={formatSgd(d.total)}
                icon={ReceiptText}
                subtext={
                  refund
                    ? 'Paid back to the customer'
                    : `GST ${formatSgd(d.tax)}`
                }
              />
              {refund ? (
                <MetricCard
                  label="GST"
                  value={formatSgd(d.tax)}
                  icon={Landmark}
                  subtext={`From ${d.refundFrom ?? 'a bank account'}${d.paymentMethod ? ` · ${d.paymentMethod}` : ''}`}
                />
              ) : (
                <MetricCard
                  label="Unused credit"
                  value={formatSgd(d.remainingCredit ?? 0)}
                  icon={Coins}
                  tileClassName={
                    (d.remainingCredit ?? 0) > 0
                      ? 'from-brand-amber to-brand-amber/80'
                      : undefined
                  }
                  subtext={
                    (d.remainingCredit ?? 0) > 0
                      ? 'Use it with Receive payment, or pay it back'
                      : 'All of it has been used'
                  }
                />
              )}
              <MetricCard
                label={words.date}
                value={formatShortDay(d.txnDate) ?? '—'}
                icon={CalendarDays}
                subtext={`${d.txnDate?.slice(0, 4) ?? ''} · Created by ${page.createdBy ?? 'QuickBooks'}`}
              />
            </div>
          </div>

          <Card className="min-w-0 gap-0 py-0">
            <CardHeader className="border-b border-border py-5">
              <CardTitle className="font-serif text-lg font-semibold tracking-tight">
                {name} details
              </CardTitle>
              <CardDescription>
                GST follows each item&rsquo;s tax code in QuickBooks.
              </CardDescription>
            </CardHeader>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 border-b border-border px-6 py-5 sm:grid-cols-2 xl:grid-cols-3">
              <Detail label="Customer">
                <Link
                  href={customerHref}
                  className="font-medium text-foreground hover:underline"
                >
                  {page.customerName}
                </Link>
              </Detail>
              <Detail label="Email">{d.billEmail ?? <Empty />}</Detail>
              <Detail label="Billing address">
                {d.billAddress.length ? (
                  d.billAddress.map((l) => (
                    <span key={l} className="block">
                      {l}
                    </span>
                  ))
                ) : (
                  <Empty />
                )}
              </Detail>
              {refund && (
                <>
                  <Detail label="Payment method">
                    {d.paymentMethod ?? <Empty />}
                  </Detail>
                  <Detail label="Refund from">
                    {d.refundFrom ?? <Empty />}
                  </Detail>
                  <Detail label="Cheque no.">{d.checkNo ?? <Empty />}</Detail>
                </>
              )}
            </dl>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-6">#</TableHead>
                  <TableHead>Product or service</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>GST code</TableHead>
                  <TableHead className="pr-6 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6 tabular-nums text-muted-foreground">
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
                    <TableCell className="text-muted-foreground">
                      {l.taxCode ?? '—'}
                    </TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">
                      {formatSgd(l.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="grid grid-cols-1 gap-8 border-t border-border px-6 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
              <dl className="grid content-start gap-4">
                <Detail label={words.message}>{d.message ?? <Empty />}</Detail>
                <Detail label="Message displayed on statement">
                  <span className="whitespace-pre-line">
                    {d.statementMessage ?? <Empty />}
                  </span>
                </Detail>
              </dl>
              <dl className="grid h-fit grid-cols-[1fr_auto] gap-x-8 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="text-right tabular-nums">
                  {formatSgd(subtotal)}
                </dd>
                <dt className="text-muted-foreground">GST</dt>
                <dd className="text-right tabular-nums">{formatSgd(d.tax)}</dd>
                {!refund && (
                  <>
                    <dt className="text-muted-foreground">Used</dt>
                    <dd className="text-right tabular-nums">
                      −{formatSgd(round2(d.total - (d.remainingCredit ?? 0)))}
                    </dd>
                  </>
                )}
                <dt className="border-t border-border pt-2 font-serif text-base font-semibold text-foreground">
                  {words.total}
                </dt>
                <dd className="border-t border-border pt-2 text-right font-serif text-base font-semibold tabular-nums">
                  {formatSgd(d.total)}
                </dd>
              </dl>
            </div>
          </Card>
        </>
      )}
    </PageShell>
  );
}
