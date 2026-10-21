'use client';

import { Coins } from 'lucide-react';
import { useState } from 'react';

import { RecordPaymentSheet } from '@/components/billing/record-payment-sheet';
import { Button } from '@/components/ui/button';
import type {
  CreditSource,
  OpenCreditNote,
  OpenInvoice,
  PayableInvoice,
} from '@/lib/billing/payment-plan';
import { formatDay } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';

// §9.4 attention panel: unused credit on the customer — unused payments and
// credit notes. HFSE's QuickBooks never applies credit by itself, so it waits
// here until someone uses it on an invoice (Use credit), or pays it back
// (New transaction → Expense / Cheque, then Use credit on it).
export function CreditPanel(props: {
  studentNumber: string;
  studentName: string;
  credit: number;
  openInvoices: Array<OpenInvoice & { items: string }>;
  credits: Array<CreditSource & { reference: string | null }>;
  charges?: PayableInvoice[];
  creditNotes?: OpenCreditNote[];
  depositAccounts: Array<{ id: string; label: string }>;
  paymentMethods?: Array<{ id: string; label: string }>;
  customerBalance?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const charges = props.charges ?? [];
  const from = [
    ...props.credits.map(
      (c) => `${c.reference ?? 'a payment'} on ${formatDay(c.txnDate)}`
    ),
    ...(props.creditNotes ?? []).map(
      (n) =>
        `credit note${n.docNumber ? ` ${n.docNumber}` : ''} on ${formatDay(n.txnDate)}`
    ),
  ].join(', ');
  const nothingToUseOn =
    props.openInvoices.length === 0 && charges.length === 0;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-brand-amber/40 bg-brand-amber/10 p-5 sm:flex-row sm:items-center">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-ink shadow-brand-tile">
        <Coins className="size-4" />
      </div>
      <div className="flex-1 space-y-1">
        <p className="font-serif text-base font-semibold text-foreground">
          {formatSgd(props.credit)} unused credit
        </p>
        <p className="text-sm text-muted-foreground">
          From {from}. QuickBooks doesn&rsquo;t use credit by itself — use it on
          an open invoice, or pay it back with New transaction → Expense or
          Cheque, then use it on that.
        </p>
      </div>
      <Button
        variant="outline"
        disabled={nothingToUseOn}
        title={nothingToUseOn ? 'Nothing is owing to use it on.' : undefined}
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        Use credit
      </Button>
      {open && (
        <RecordPaymentSheet
          key={key}
          open
          onOpenChange={setOpen}
          studentNumber={props.studentNumber}
          studentName={props.studentName}
          openInvoices={props.openInvoices}
          charges={charges}
          creditNotes={props.creditNotes}
          credits={props.credits}
          depositAccounts={props.depositAccounts}
          paymentMethods={props.paymentMethods}
          mode="credit"
          customerBalance={props.customerBalance}
        />
      )}
    </div>
  );
}
