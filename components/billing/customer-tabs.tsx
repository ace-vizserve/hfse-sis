'use client';

import { ExternalLink, Pencil } from 'lucide-react';
import * as React from 'react';

import { CustomerTransactions } from '@/components/billing/customer-transactions';
import type { SalesDocRow } from '@/lib/billing/sales-docs';
import { EditCustomerSheet } from '@/components/billing/edit-customer-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  InvoiceRowView,
  PaymentRowView,
} from '@/lib/billing/customer-page.server';
import type { CustomerProfile } from '@/lib/billing/live.server';
import type {
  CreditSource,
  OpenCreditNote,
  OpenInvoice,
} from '@/lib/billing/payment-plan';
import { cn } from '@/lib/utils';

// The customer page's tabs, named as QuickBooks names them: Transaction List
// and Customer Details — in the SIS look (default Tabs, Cards, dl grids).

/** One label/value pair of a Customer Details grid, "—" when empty. */
function Detail({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children?: React.ReactNode;
}) {
  const empty =
    children === null ||
    children === undefined ||
    children === false ||
    children === '' ||
    (Array.isArray(children) && children.length === 0);
  return (
    <div className={cn('min-w-0 space-y-0.5', wide && 'sm:col-span-2')}>
      <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          'break-words text-sm leading-relaxed',
          empty ? 'text-muted-foreground' : 'text-foreground'
        )}
      >
        {empty ? '—' : children}
      </dd>
    </div>
  );
}

function DetailCard({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {children}
        </dl>
      </CardContent>
    </Card>
  );
}

const lines = (l: string[] | null) =>
  l && l.length ? l.map((x) => <div key={x}>{x}</div>) : null;

const mono = (v: string | null) =>
  v ? <span className="font-mono text-[13px] tabular-nums">{v}</span> : null;

// QuickBooks' Customer Details tab: Contact info and Additional info, then
// the linked student the SIS adds. Edit opens the same Customer sheet as the
// page's Edit ▾. QuickBooks doesn't give apps a customer's Cc, Bcc, Credit
// limit or Customer language, so those aren't listed.
function CustomerDetails({
  profile,
  studentNumber,
  studentName,
  level,
  linkedName,
  qbBase,
}: {
  profile: CustomerProfile | null;
  studentNumber: string;
  studentName: string;
  level: string | null;
  linkedName: string;
  qbBase?: string | null;
}) {
  const [editing, setEditing] = React.useState(false);
  const [key, setKey] = React.useState(0);
  const qbCustomer =
    qbBase && profile
      ? `${qbBase}/app/customerdetail?nameId=${encodeURIComponent(profile.id)}`
      : null;
  return (
    <div className="space-y-4">
      {!profile ? (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          QuickBooks couldn&rsquo;t be reached, so the customer&rsquo;s details
          can&rsquo;t be shown. Refresh to try again.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DetailCard
            eyebrow="QuickBooks"
            title="Contact info"
            description="Who QuickBooks bills, and how to reach them."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setKey((k) => k + 1);
                  setEditing(true);
                }}
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>
            }
          >
            <Detail label="Customer">
              {profile.displayName}
              {!profile.active && (
                <Badge
                  variant="outline"
                  className="ml-2 h-5 border-destructive/40 bg-destructive/10 text-destructive"
                >
                  Inactive
                </Badge>
              )}
            </Detail>
            <Detail label="Email">
              {profile.email && (
                <a
                  href={`mailto:${profile.email}`}
                  className="text-primary hover:underline"
                >
                  {profile.email}
                </a>
              )}
            </Detail>
            <Detail label="Phone">{mono(profile.phone)}</Detail>
            <Detail label="Mobile">{mono(profile.mobile)}</Detail>
            <Detail label="Fax">{mono(profile.fax)}</Detail>
            <Detail label="Other">{mono(profile.otherPhone)}</Detail>
            <Detail label="Website">
              {profile.website && (
                <a
                  href={
                    /^https?:\/\//i.test(profile.website)
                      ? profile.website
                      : `https://${profile.website}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {profile.website}
                </a>
              )}
            </Detail>
            {profile.attachments !== null && (
              <Detail label="Attachments">
                <div className="space-y-1">
                  <div>
                    {profile.attachments === 0
                      ? 'None'
                      : profile.attachments === 1
                        ? '1 file'
                        : `${profile.attachments} files`}
                  </div>
                  {qbCustomer && (
                    <a
                      href={qbCustomer}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
                    >
                      Show existing attachments
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              </Detail>
            )}
            <Detail label="Notes" wide>
              {profile.notes && (
                <span className="whitespace-pre-line">{profile.notes}</span>
              )}
            </Detail>
          </DetailCard>
          <DetailCard
            eyebrow="QuickBooks"
            title="Additional info"
            description="Addresses, and how QuickBooks invoices this customer."
          >
            <Detail label="Billing address">
              {lines(profile.billAddress)}
            </Detail>
            <Detail label="Shipping address">
              {profile.shipAddress
                ? lines(profile.shipAddress)
                : lines(profile.billAddress)}
            </Detail>
            <Detail label="Terms">{profile.terms}</Detail>
            <Detail label="Payment method">{profile.paymentMethod}</Detail>
            <Detail label="Preferred delivery method">
              {profile.deliveryMethod}
            </Detail>
            <Detail label="Customer type">{profile.customerType}</Detail>
            <Detail label="Currency">{profile.currency}</Detail>
          </DetailCard>
        </div>
      )}
      <DetailCard
        eyebrow="SIS"
        title="Linked student"
        description="The student this QuickBooks customer is billed for."
        action={
          qbCustomer && (
            <Button asChild variant="outline" size="sm">
              <a href={qbCustomer} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                Open in QuickBooks
              </a>
            </Button>
          )
        }
      >
        <Detail label="Student">{studentName}</Detail>
        <Detail label="Student no.">{mono(studentNumber)}</Detail>
        <Detail label="Level">{level}</Detail>
        <Detail label="QuickBooks customer">{linkedName}</Detail>
      </DetailCard>
      {editing && (
        <EditCustomerSheet
          key={key}
          open
          onOpenChange={setEditing}
          studentNumber={studentNumber}
        />
      )}
    </div>
  );
}

export function CustomerTabs({
  studentNumber,
  studentName,
  level,
  linkedName,
  invoices,
  payments,
  profile,
  openInvoices,
  credits,
  depositAccounts,
  paymentMethods,
  canRecord,
  customerBalance,
  qbBase,
  initialTab,
  docs = [],
  creditNotes = [],
}: {
  /** Credit notes with unused credit, for Receive payment's Credits. */
  creditNotes?: OpenCreditNote[];
  studentNumber: string;
  studentName: string;
  level: string | null;
  linkedName: string;
  invoices: InvoiceRowView[];
  payments: PaymentRowView[];
  /** Refund receipts, credit memos, expenses and checks (read live). */
  docs?: SalesDocRow[];
  profile: CustomerProfile | null;
  openInvoices: Array<OpenInvoice & { items: string }>;
  credits: Array<CreditSource & { reference: string | null }>;
  depositAccounts: Array<{ id: string; label: string }>;
  paymentMethods?: Array<{ id: string; label: string }>;
  canRecord: boolean;
  customerBalance?: number | null;
  qbBase?: string | null;
  /** `?tab=payments` (the invoice page's "View payment") opens the list on
   *  Payments; `?tab=details` opens Customer Details. */
  initialTab: 'transactions' | 'payments' | 'details';
}) {
  return (
    <Tabs
      // Keyed on `?tab=`: the page stays mounted across visits
      // (cacheComponents), so a later link with another tab ("View payment",
      // Customer Details) must open it — defaultValue alone kept the first.
      key={initialTab}
      defaultValue={initialTab === 'details' ? 'details' : 'transactions'}
      className="gap-4"
    >
      <TabsList>
        <TabsTrigger value="transactions">Transaction List</TabsTrigger>
        <TabsTrigger value="details">Customer Details</TabsTrigger>
      </TabsList>
      <TabsContent value="transactions" className="space-y-4">
        <CustomerTransactions
          studentNumber={studentNumber}
          studentName={studentName}
          customerName={linkedName}
          invoices={invoices}
          payments={payments}
          docs={docs}
          creditNotes={creditNotes}
          openInvoices={openInvoices}
          credits={credits}
          depositAccounts={depositAccounts}
          paymentMethods={paymentMethods}
          canRecord={canRecord}
          customerBalance={customerBalance}
          qbBase={qbBase}
          initialType={initialTab === 'payments' ? 'payments' : 'all'}
        />
      </TabsContent>
      <TabsContent value="details">
        <CustomerDetails
          profile={profile}
          studentNumber={studentNumber}
          studentName={studentName}
          level={level}
          linkedName={linkedName}
          qbBase={qbBase}
        />
      </TabsContent>
    </Tabs>
  );
}
