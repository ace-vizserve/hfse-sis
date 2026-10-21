'use client';

import { ChevronDown, FilePlus2, HandCoins } from 'lucide-react';
import { useEffect, useState } from 'react';

import { CreateInvoiceSheet } from '@/components/billing/create-invoice-sheet';
import { RecordPaymentSheet } from '@/components/billing/record-payment-sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { CreditSource, OpenInvoice } from '@/lib/billing/payment-plan';
import type { StageTarget } from '@/lib/billing/tie';

// The customer page's New transaction menu, as QuickBooks has it: Invoice or
// Payment. Each sheet mounts fresh on every open.
export function CustomerActions(props: {
  studentNumber: string;
  studentName: string;
  customerEmail: string | null;
  existing: Array<{
    docNumber: string | null;
    ayCode: string | null;
    stageKeys: string[];
    state: 'open' | 'paid' | 'voided';
  }>;
  openInvoices: Array<OpenInvoice & { items: string }>;
  credits: Array<CreditSource & { reference: string | null }>;
  depositAccounts: Array<{ id: string; label: string }>;
  paymentMethods?: Array<{ id: string; label: string }>;
  customerBalance?: number | null;
  /** Opened from the Customers list' Receive payment / Create invoice
   *  (`?new=payment` / `?new=invoice`), as QuickBooks opens the form. */
  initialSheet?: 'invoice' | 'payment' | null;
  /** With `?new=payment&invoice=<id>`: the form lists only that invoice. */
  initialInvoiceId?: string | null;
  /** With `?new=invoice&stage=…&ay=…` (a Registration / Fees card's Create
   *  invoice in Billing): the first Create invoice fills that stage. */
  initialStage?: StageTarget | null;
}) {
  const [sheet, setSheet] = useState<'invoice' | 'payment' | null>(
    props.initialSheet ?? null
  );
  // Drop `?new=` once used, so a reload doesn't open the form again.
  useEffect(() => {
    if (!props.initialSheet) return;
    const u = new URL(window.location.href);
    u.searchParams.delete('new');
    u.searchParams.delete('invoice');
    u.searchParams.delete('stage');
    u.searchParams.delete('ay');
    window.history.replaceState(window.history.state, '', u);
  }, [props.initialSheet]);
  // Only the first open fills the stage; New transaction → Invoice later is a
  // plain invoice, as on any customer page.
  const [stage, setStage] = useState(
    props.initialSheet === 'invoice' ? (props.initialStage ?? null) : null
  );
  const [key, setKey] = useState(0);
  // Only the first open honours the row's invoice; New transaction → Payment
  // later lists everything owing.
  const [onlyInvoice, setOnlyInvoice] = useState(
    props.initialInvoiceId ?? null
  );
  const open = (s: 'invoice' | 'payment') => {
    setOnlyInvoice(null);
    setStage(null);
    setKey((k) => k + 1);
    setSheet(s);
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            New transaction
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => open('invoice')}>
            <FilePlus2 className="size-4" />
            Invoice
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open('payment')}>
            <HandCoins className="size-4" />
            Payment
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {sheet === 'invoice' && (
        <CreateInvoiceSheet
          key={`i${key}`}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          studentNumber={props.studentNumber}
          studentName={props.studentName}
          customerEmail={props.customerEmail}
          existing={props.existing}
          stage={stage}
        />
      )}
      {sheet === 'payment' && (
        <RecordPaymentSheet
          key={`p${key}`}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          studentNumber={props.studentNumber}
          studentName={props.studentName}
          openInvoices={
            onlyInvoice && props.openInvoices.some((o) => o.id === onlyInvoice)
              ? props.openInvoices.filter((o) => o.id === onlyInvoice)
              : props.openInvoices
          }
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
