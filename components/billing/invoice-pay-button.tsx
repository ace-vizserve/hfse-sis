'use client';

import { HandCoins } from 'lucide-react';
import { useState } from 'react';

import { RecordPaymentSheet } from '@/components/billing/record-payment-sheet';
import { Button } from '@/components/ui/button';
import type { CreditSource, PayableInvoice } from '@/lib/billing/payment-plan';

// The invoice page's primary action: Record payment with only this invoice
// listed.
export function InvoicePayButton(props: {
  studentNumber: string;
  studentName: string;
  invoice: PayableInvoice;
  credits: Array<CreditSource & { reference: string | null }>;
  depositAccounts: Array<{ id: string; label: string }>;
  paymentMethods?: Array<{ id: string; label: string }>;
  customerBalance?: number | null;
  /** 'outline' as a secondary action. A Billing button is never ghost (Mr
   *  Ace). */
  variant?: 'default' | 'outline';
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <Button
        variant={props.variant ?? 'default'}
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <HandCoins className="size-4" />
        Receive payment
      </Button>
      {open && (
        <RecordPaymentSheet
          key={key}
          open
          onOpenChange={setOpen}
          studentNumber={props.studentNumber}
          studentName={props.studentName}
          openInvoices={[props.invoice]}
          credits={props.credits}
          depositAccounts={props.depositAccounts}
          paymentMethods={props.paymentMethods}
          mode="pay"
          customerBalance={props.customerBalance}
        />
      )}
    </>
  );
}
