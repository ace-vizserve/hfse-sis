'use client';

import { ExternalLink } from 'lucide-react';
import * as React from 'react';

import { CustomerTransactions } from '@/components/billing/customer-transactions';
import { EditCustomerSheet } from '@/components/billing/edit-customer-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  InvoiceRowView,
  PaymentRowView,
} from '@/lib/billing/customer-page.server';
import type { CustomerProfile } from '@/lib/billing/live.server';
import type { CreditSource, OpenInvoice } from '@/lib/billing/payment-plan';

// The customer page's tabs, named as QuickBooks names them: Transaction List
// and Customer Details.

/** One label/value row of QuickBooks' Customer Details, "-" when empty. */
function Detail({
  label,
  children,
}: {
  label: string;
  children?: React.ReactNode;
}) {
  const empty =
    children === null ||
    children === undefined ||
    children === false ||
    children === '' ||
    (Array.isArray(children) && children.length === 0);
  return (
    <div className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-4 border-b border-border px-3 py-3 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">
        {empty ? '-' : children}
      </dd>
    </div>
  );
}

function DetailSection({
  title,
  action,
  listClassName,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  listClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-center justify-between gap-3 border-b border-hairline-strong pb-2">
        <h3 className="font-serif text-base font-semibold text-foreground">
          {title}
        </h3>
        {action}
      </div>
      <dl className={listClassName}>{children}</dl>
    </section>
  );
}

const lines = (l: string[] | null) =>
  l && l.length ? l.map((x) => <div key={x}>{x}</div>) : null;

const mono = (v: string | null) =>
  v ? <span className="font-mono text-[13px] tabular-nums">{v}</span> : null;

// QuickBooks' Customer Details tab: Contact info and Additional info, side by
// side, as label/value rows; Edit opens the same Customer form as the page's
// Edit button. The SIS adds the linked student after QuickBooks' sections.
// QuickBooks doesn't give apps a customer's Cc, Bcc, Credit limit or
// Customer language, so those rows aren't listed.
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
  const qbCustomer =
    qbBase && profile
      ? `${qbBase}/app/customerdetail?nameId=${encodeURIComponent(profile.id)}`
      : null;
  return (
    <div className="space-y-8">
      {!profile ? (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          QuickBooks couldn&rsquo;t be reached, so the customer&rsquo;s details
          can&rsquo;t be shown. Refresh to try again.
        </p>
      ) : (
        <div className="grid grid-cols-1 items-start gap-x-10 gap-y-8 lg:grid-cols-2">
          <DetailSection
            title="Contact info"
            action={
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => setEditing(true)}
              >
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
            <Detail label="Notes">
              {profile.notes && (
                <span className="whitespace-pre-line">{profile.notes}</span>
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
          </DetailSection>
          <DetailSection title="Additional info">
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
          </DetailSection>
        </div>
      )}
      <DetailSection
        title="Linked student"
        listClassName="grid grid-cols-1 lg:grid-cols-2 lg:gap-x-10 lg:[&>div:nth-last-child(2)]:border-b-0"
        action={
          qbCustomer && (
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <a href={qbCustomer} target="_blank" rel="noreferrer">
                Open in QuickBooks
                <ExternalLink className="size-3" />
              </a>
            </Button>
          )
        }
      >
        <Detail label="Student">{studentName}</Detail>
        <Detail label="Student no.">{mono(studentNumber)}</Detail>
        <Detail label="Level">{level}</Detail>
        <Detail label="QuickBooks customer">{linkedName}</Detail>
      </DetailSection>
      {editing && (
        <EditCustomerSheet
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
}: {
  studentNumber: string;
  studentName: string;
  level: string | null;
  linkedName: string;
  invoices: InvoiceRowView[];
  payments: PaymentRowView[];
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
      defaultValue={initialTab === 'details' ? 'details' : 'transactions'}
      className="gap-4"
    >
      <TabsList variant="line">
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
