'use client';

import * as React from 'react';

import { CustomerTransactions } from '@/components/billing/customer-transactions';
import { Badge } from '@/components/ui/badge';
import {
  Card,
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
import type { CreditSource, OpenInvoice } from '@/lib/billing/payment-plan';
import { formatDay } from '@/lib/billing/view';

// The customer page's tabs, named as QuickBooks names them: Transaction List
// and Customer Details.

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children ?? '—'}</dd>
    </>
  );
}

function CustomerDetails({
  profile,
  studentNumber,
  studentName,
  level,
  linkedName,
}: {
  profile: CustomerProfile | null;
  studentNumber: string;
  studentName: string;
  level: string | null;
  linkedName: string;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            From QuickBooks
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight">
            Customer details
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!profile ? (
            <p className="text-sm text-muted-foreground">
              QuickBooks couldn&rsquo;t be reached, so the customer&rsquo;s
              details can&rsquo;t be shown. Refresh to try again.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-x-10 gap-y-6 text-sm md:grid-cols-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <Detail label="Customer">
                  <span className="font-mono text-[13px]">
                    {profile.displayName}
                  </span>
                </Detail>
                <Detail label="First name">{profile.givenName}</Detail>
                <Detail label="Middle name">{profile.middleName}</Detail>
                <Detail label="Last name">{profile.familyName}</Detail>
                <Detail label="Company">{profile.companyName}</Detail>
                <Detail label="Status">
                  {profile.active ? (
                    <Badge
                      variant="outline"
                      className="h-6 border-brand-mint bg-brand-mint/30 text-ink"
                    >
                      Active
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="h-6 border-destructive/40 bg-destructive/10 text-destructive"
                    >
                      Inactive
                    </Badge>
                  )}
                </Detail>
                <Detail label="Customer since">
                  {profile.createdAt ? formatDay(profile.createdAt) : null}
                </Detail>
              </dl>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <Detail label="Email">{profile.email}</Detail>
                <Detail label="Phone">
                  {profile.phone && (
                    <span className="font-mono text-[13px]">
                      {profile.phone}
                    </span>
                  )}
                </Detail>
                <Detail label="Mobile">
                  {profile.mobile && (
                    <span className="font-mono text-[13px]">
                      {profile.mobile}
                    </span>
                  )}
                </Detail>
                <Detail label="Other">
                  {profile.otherPhone && (
                    <span className="font-mono text-[13px]">
                      {profile.otherPhone}
                    </span>
                  )}
                </Detail>
              </dl>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <Detail label="Billing address">
                  {profile.billAddress.length
                    ? profile.billAddress.map((l) => <div key={l}>{l}</div>)
                    : null}
                </Detail>
                <Detail label="Shipping address">
                  {profile.shipAddress
                    ? profile.shipAddress.map((l) => <div key={l}>{l}</div>)
                    : 'Same as billing'}
                </Detail>
              </dl>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <Detail label="Terms">{profile.terms}</Detail>
                <Detail label="Payment method">{profile.paymentMethod}</Detail>
                <Detail label="Send invoices by">
                  {profile.deliveryMethod}
                </Detail>
                <Detail label="Currency">{profile.currency}</Detail>
                <Detail label="Notes">{profile.notes}</Detail>
              </dl>
            </div>
          )}
          <p className="mt-6 text-[12px] text-muted-foreground">
            Change these in QuickBooks; they show here the next time the page
            opens.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight">
            Linked student
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <Detail label="Student">{studentName}</Detail>
            <Detail label="Student no.">
              <span className="font-mono text-[13px]">{studentNumber}</span>
            </Detail>
            <Detail label="Level">{level}</Detail>
            <Detail label="QuickBooks customer">{linkedName}</Detail>
          </dl>
        </CardContent>
      </Card>
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
  canRecord,
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
  canRecord: boolean;
  /** `?tab=payments` (the invoice page's "View payment") opens the list on
   *  Payments; `?tab=details` opens Customer Details. */
  initialTab: 'transactions' | 'payments' | 'details';
}) {
  return (
    <Tabs
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
          openInvoices={openInvoices}
          credits={credits}
          depositAccounts={depositAccounts}
          canRecord={canRecord}
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
        />
      </TabsContent>
    </Tabs>
  );
}
