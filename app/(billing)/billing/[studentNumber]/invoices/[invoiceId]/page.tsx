import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  ReceiptText,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import type { InvoiceEdit } from '@/components/billing/create-invoice-sheet';
import { InvoiceActivity } from '@/components/billing/invoice-activity';
import { InvoicePayButton } from '@/components/billing/invoice-pay-button';
import { InvoiceScreenActions } from '@/components/billing/invoice-screen-actions';
import { InvoiceStatusBadge } from '@/components/billing/invoice-status-badge';
import { RefreshButton } from '@/components/billing/refresh-button';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { InvoiceCopy } from '@/lib/billing/invoice-copy';
import { loadInvoicePage } from '@/lib/billing/invoice-page.server';
import { formatShortDay, round2, todaySg } from '@/lib/billing/view';
import { qboAppUrl } from '@/lib/qbo/env';
import { formatSgd } from '@/lib/qbo/format';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86_400_000
  );

const Empty = () => <span className="text-muted-foreground">—</span>;

/** One labelled value in the invoice card's details grid. */
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

// One invoice. QuickBooks decides what is here (its actions and menus, the
// invoice's own fields, each line's GST code, Invoice activity); the SIS
// decides how it looks — a detail page inside Billing with the hero, stat
// tiles, Invoice / PDF view tabs and cards. Edit invoice (open invoices)
// changes the lines, dates and notes in QuickBooks, as QuickBooks' own does.
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
          statementMemo: d.privateNote,
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

  // Edit invoice, as in QuickBooks: an open invoice (not voided, not fully
  // paid), read live, whose every line has its product.
  const edit: InvoiceEdit | null =
    d && copy && d.state === 'open' && d.txnDate
      ? {
          invoiceId: page.row.id,
          docNumber: docNo,
          syncToken: d.syncToken,
          txnDate: d.txnDate,
          dueDate: d.dueDate,
          memo: d.customerMemo ?? '',
          statementMemo: d.privateNote ?? '',
          lines: d.lines.map((l, i) => ({
            lineId: l.lineId,
            itemName: l.itemName,
            ...copy.lines[i],
          })),
        }
      : null;
  // The Registration / Fees stage the invoice is tied to.
  const tiedStage =
    page.row.ayCode &&
    (['registration', 'fees'] as const).find((s) =>
      page.row.stageKeys.includes(s)
    );
  const stage =
    page.row.ayCode && tiedStage
      ? { stage: tiedStage, ayCode: page.row.ayCode }
      : null;

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
        crumbs={[{ label: 'Invoice' }]}
        stackActions
        title={`Invoice ${docNo ?? 'without a number'}`}
        description={
          edit
            ? `An invoice of ${page.customerName}, read live from QuickBooks. Edit invoice changes it in QuickBooks.`
            : `An invoice of ${page.customerName}, read live from QuickBooks.`
        }
        actions={
          <>
            <RefreshButton label="Refresh" />
            <ButtonGroup aria-label="This customer's other invoices">
              <Stepper
                href={page.older ? invHref(page.older.id) : null}
                label={`Older invoice${page.older?.docNumber ? ` ${page.older.docNumber}` : ''}`}
              >
                <ChevronLeft className="size-4" />
              </Stepper>
              <Stepper
                href={page.newer ? invHref(page.newer.id) : null}
                label={`Newer invoice${page.newer?.docNumber ? ` ${page.newer.docNumber}` : ''}`}
              >
                <ChevronRight className="size-4" />
              </Stepper>
            </ButtonGroup>
            <InvoiceScreenActions
              invoiceId={page.row.id}
              docNumber={docNo}
              studentNumber={studentNumber}
              edit={edit}
              studentName={page.studentName}
              customerEmail={email}
              stage={stage}
              qbUrl={page.qbUrl}
              qbCreditMemoUrl={qboAppUrl(page.environment, '/app/creditmemo')}
              qbSettingsUrl={qboAppUrl(
                page.environment,
                '/app/settings?p=Sales'
              )}
              qbCompanyUrl={qboAppUrl(
                page.environment,
                '/app/settings?p=Company'
              )}
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
            {!isVoided && balance > 0 && (
              <InvoicePayButton
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
          </>
        }
      >
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
      </BillingPageHeader>

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
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
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
            subtext={`${formatSgd(paid)} paid`}
          />
          <MetricCard
            label="Invoice date"
            // Day and month as the figure, the year below — a full date wraps
            // at laptop width.
            value={formatShortDay(d?.txnDate ?? page.row.txnDate) ?? '—'}
            icon={CalendarDays}
            subtext={[
              (d?.txnDate ?? page.row.txnDate)?.slice(0, 4),
              d?.terms ? `Terms: ${d.terms}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
          <MetricCard
            label="Due date"
            value={formatShortDay(due) ?? '—'}
            icon={CalendarX2}
            subtext={
              (due ? `${due.slice(0, 4)} · ` : '') +
              (overdueDays > 0
                ? `${overdueDays} ${overdueDays === 1 ? 'day' : 'days'} overdue`
                : balance > 0
                  ? 'Not overdue'
                  : 'Nothing owing')
            }
          />
        </div>
      </div>

      <Tabs value={pdfView ? 'pdf' : 'invoice'}>
        <TabsList>
          <TabsTrigger value="invoice" asChild>
            <Link href={invHref(page.row.id, false)}>Invoice</Link>
          </TabsTrigger>
          <TabsTrigger value="pdf" asChild>
            <Link href={invHref(page.row.id, true)}>PDF view</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {pdfView ? (
          <iframe
            title={`Invoice ${docNo ?? ''} PDF`}
            src={`/api/billing/invoices/${encodeURIComponent(page.row.id)}/pdf`}
            className="h-[calc(100dvh-12rem)] min-h-[480px] w-full rounded-xl border border-border bg-card shadow-sm"
          />
        ) : (
          <Card className="min-w-0 gap-0 py-0">
            <CardHeader className="border-b border-border py-5">
              <CardTitle className="font-serif text-lg font-semibold tracking-tight">
                Invoice details
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
              <Detail label="Customer email">
                {email ? (
                  <span className="block truncate" title={email}>
                    {email}
                  </span>
                ) : (
                  <Empty />
                )}
              </Detail>
              {d?.billEmailCc && <Detail label="Cc">{d.billEmailCc}</Detail>}
              <Detail label="Bill to">
                {page.profile?.companyName && (
                  <span className="block">{page.profile.companyName}</span>
                )}
                {address.length
                  ? address.map((l) => (
                      <span key={l} className="block">
                        {l}
                      </span>
                    ))
                  : !page.profile?.companyName && <Empty />}
              </Detail>
              <Detail label="Terms">{d?.terms ?? <Empty />}</Detail>
              {d?.location && <Detail label="Location">{d.location}</Detail>}
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
                {(d?.lines ?? []).map((l, i) => (
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

            <div className="grid grid-cols-1 gap-8 border-t border-border px-6 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
              <dl className="grid content-start gap-4">
                <Detail label="Note to customer">
                  {(d ? d.customerMemo : page.row.customerMemo) ?? <Empty />}
                </Detail>
                <Detail label="Internal customer notes (hidden)">
                  {page.profile?.notes ?? <Empty />}
                </Detail>
                <Detail label="Memo on statement (hidden)">
                  {/* As QuickBooks keeps it, line breaks included. */}
                  <span className="whitespace-pre-line">
                    {(d ? d.privateNote : page.row.memo) ?? <Empty />}
                  </span>
                </Detail>
              </dl>
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
                <dt className="font-semibold text-foreground">Invoice total</dt>
                <dd className="text-right font-semibold tabular-nums">
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
        )}

        <Card id="invoice-activity" className="scroll-mt-4">
          <CardHeader>
            <CardTitle className="font-serif text-lg font-semibold tracking-tight">
              Invoice activity
            </CardTitle>
            <CardDescription>
              Viewed is shown in QuickBooks only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InvoiceActivity
              events={page.activity}
              paymentHref={`${customerHref}?tab=payments`}
            />
          </CardContent>
        </Card>
      </div>
    </PageShell>
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
      variant="outline"
      size="icon"
      disabled={!href}
      aria-label={href ? undefined : label}
      title={label}
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
