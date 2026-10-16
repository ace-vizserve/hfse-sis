'use client';

import { FilePlus2, HandCoins } from 'lucide-react';
import { useState } from 'react';

import { CreateInvoiceSheet } from '@/components/billing/create-invoice-sheet';
import { RecordPaymentSheet } from '@/components/billing/record-payment-sheet';
import { Button } from '@/components/ui/button';
import type { CreditSource, OpenInvoice } from '@/lib/billing/payment-plan';
import type { MapsData } from '@/lib/billing/view';

// The customer page's two actions. Create invoice is the page's one primary
// button; Record payment is outline. Each sheet mounts fresh on every open.
export function CustomerActions(props: {
  studentNumber: string;
  studentName: string;
  customerEmail: string | null;
  maps: MapsData;
  existing: Array<{
    docNumber: string | null;
    ayCode: string | null;
    stageKeys: string[];
    state: 'open' | 'paid' | 'voided';
  }>;
  openInvoices: Array<OpenInvoice & { items: string }>;
  credits: Array<CreditSource & { reference: string | null }>;
  depositAccounts: Array<{ id: string; label: string }>;
}) {
  const [sheet, setSheet] = useState<'invoice' | 'payment' | null>(null);
  const [key, setKey] = useState(0);
  const open = (s: 'invoice' | 'payment') => {
    setKey((k) => k + 1);
    setSheet(s);
  };
  return (
    <>
      <Button variant="outline" onClick={() => open('payment')}>
        <HandCoins className="size-4" />
        Record payment
      </Button>
      <Button onClick={() => open('invoice')}>
        <FilePlus2 className="size-4" />
        Create invoice
      </Button>
      {sheet === 'invoice' && (
        <CreateInvoiceSheet
          key={`i${key}`}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          studentNumber={props.studentNumber}
          studentName={props.studentName}
          customerEmail={props.customerEmail}
          maps={props.maps}
          existing={props.existing}
        />
      )}
      {sheet === 'payment' && (
        <RecordPaymentSheet
          key={`p${key}`}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          studentNumber={props.studentNumber}
          studentName={props.studentName}
          openInvoices={props.openInvoices}
          credits={props.credits}
          depositAccounts={props.depositAccounts}
          mode="pay"
        />
      )}
    </>
  );
}
