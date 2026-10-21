'use client';

import {
  ChevronDown,
  FileMinus2,
  FilePlus2,
  HandCoins,
  Landmark,
  ReceiptText,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { CreateInvoiceSheet } from '@/components/billing/create-invoice-sheet';
import { RecordPaymentSheet } from '@/components/billing/record-payment-sheet';
import { RefundExpenseSheet } from '@/components/billing/refund-expense-sheet';
import {
  SalesDocSheet,
  type SalesDocStart,
} from '@/components/billing/sales-doc-sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  clearCreditNoteStart,
  readCreditNoteStart,
} from '@/lib/billing/invoice-copy';
import type {
  CreditSource,
  OpenCreditNote,
  OpenInvoice,
  PayableInvoice,
} from '@/lib/billing/payment-plan';
import { stageFromParams } from '@/lib/billing/stage-card';
import type { StageTarget } from '@/lib/billing/tie';

// The customer page's New transaction menu, as QuickBooks has it: Invoice,
// Payment, Credit note (QuickBooks' customer menu has no Refund receipt — it
// is on Sales transactions' menu, which opens it here). Paying a credit back
// is QuickBooks' + New → Expense / Cheque, payee the customer; the SIS has
// no + New, so those two sit here under their own heading. Each sheet mounts
// fresh on every open.
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
  /** Expenses / cheques still open (Receive payment's Outstanding rows). */
  charges?: PayableInvoice[];
  /** Credit notes with unused credit (Receive payment's Credits). */
  creditNotes?: OpenCreditNote[];
  /** Unused credit on the customer, the Expense / Cheque amount to start at. */
  credit?: number;
  depositAccounts: Array<{ id: string; label: string; isDefault?: boolean }>;
  paymentMethods?: Array<{ id: string; label: string }>;
  customerBalance?: number | null;
  /** Opened from a list's New transaction ▾ or an invoice's "Create a credit
   *  note" (`?new=payment|invoice|refund-receipt|credit-note`). */
  initialSheet?: CustomerSheet | null;
  /** With `?new=payment&invoice=<id>`: the form lists only that invoice. */
  initialInvoiceId?: string | null;
  /** With `?new=invoice&stage=…&ay=…` (a Registration / Fees card's Create
   *  invoice in Billing): the first Create invoice fills that stage. */
  initialStage?: StageTarget | null;
  /** `?new=credit-note&from=invoice`: start from the invoice's lines. */
  fromInvoice?: boolean;
}) {
  const [sheet, setSheet] = useState<CustomerSheet | null>(
    props.initialSheet ?? null
  );
  // An invoice's "Create a credit note": its lines, once.
  const [start, setStart] = useState<SalesDocStart | null>(() =>
    props.initialSheet === 'credit-note' && props.fromInvoice
      ? readCreditNoteStart(props.studentNumber)
      : null
  );
  useEffect(() => {
    if (props.fromInvoice) clearCreditNoteStart(props.studentNumber);
  }, [props.fromInvoice, props.studentNumber]);
  // Only the first open fills the stage; New transaction → Invoice later is a
  // plain invoice, as on any customer page.
  const [stage, setStage] = useState(
    props.initialSheet === 'invoice' ? (props.initialStage ?? null) : null
  );
  const [key, setKey] = useState(0);
  const [useStart, setUseStart] = useState(true);
  // Only the first open honours the row's invoice; New transaction → Payment
  // later lists everything owing.
  const [onlyInvoice, setOnlyInvoice] = useState(
    props.initialInvoiceId ?? null
  );
  // `?new=` on every arrival, not only the first: the app keeps a visited
  // page alive (cacheComponents), so coming back to this customer reuses this
  // component with its form closed and the server props of the first visit.
  // The first visit's request is already open from the props above, so only
  // a later change of the address opens one here (set during render, React's
  // pattern for state that follows a changed input).
  const params = useSearchParams();
  const requested = params.get('new');
  const [seenParams, setSeenParams] = useState(params);
  if (params !== seenParams) {
    setSeenParams(params);
    const s = CUSTOMER_SHEETS.find((x) => x === requested);
    if (s) {
      const fromInv = s === 'credit-note' && params.get('from') === 'invoice';
      setStart(fromInv ? readCreditNoteStart(props.studentNumber) : null);
      setUseStart(fromInv);
      setOnlyInvoice(s === 'payment' ? params.get('invoice') : null);
      setStage(
        s === 'invoice'
          ? stageFromParams(
              params.get('stage') ?? undefined,
              params.get('ay') ?? undefined
            )
          : null
      );
      setKey((k) => k + 1);
      setSheet(s);
    }
  }
  const fromInvoiceNow = params.get('from') === 'invoice';
  useEffect(() => {
    if (!requested) return;
    if (fromInvoiceNow) clearCreditNoteStart(props.studentNumber);
    // Drop `?new=` once used, so a reload doesn't open the form again.
    const u = new URL(window.location.href);
    for (const k of ['new', 'invoice', 'stage', 'ay', 'from'])
      u.searchParams.delete(k);
    window.history.replaceState(window.history.state, '', u);
  }, [requested, fromInvoiceNow, props.studentNumber]);
  const open = (s: CustomerSheet) => {
    setOnlyInvoice(null);
    setStage(null);
    setUseStart(false);
    setKey((k) => k + 1);
    setSheet(s);
  };
  const close = (o: boolean) => !o && setSheet(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            New transaction
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => open('invoice')}>
            <FilePlus2 className="size-4" />
            Invoice
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open('payment')}>
            <HandCoins className="size-4" />
            Payment
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open('credit-note')}>
            <FileMinus2 className="size-4" />
            Credit note
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Pay a credit back
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => open('expense')}>
            <ReceiptText className="size-4" />
            Expense
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open('check')}>
            <Landmark className="size-4" />
            Cheque
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {sheet === 'invoice' && (
        <CreateInvoiceSheet
          key={`i${key}`}
          open
          onOpenChange={close}
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
          onOpenChange={close}
          studentNumber={props.studentNumber}
          studentName={props.studentName}
          openInvoices={
            onlyInvoice && props.openInvoices.some((o) => o.id === onlyInvoice)
              ? props.openInvoices.filter((o) => o.id === onlyInvoice)
              : props.openInvoices
          }
          charges={onlyInvoice ? [] : props.charges}
          creditNotes={props.creditNotes}
          credits={props.credits}
          depositAccounts={props.depositAccounts}
          paymentMethods={props.paymentMethods}
          mode="pay"
          customerBalance={props.customerBalance}
        />
      )}
      {(sheet === 'refund-receipt' || sheet === 'credit-note') && (
        <SalesDocSheet
          key={`d${sheet}${key}`}
          open
          onOpenChange={close}
          kind={sheet === 'refund-receipt' ? 'refund_receipt' : 'credit_memo'}
          studentNumber={props.studentNumber}
          studentName={props.studentName}
          customerEmail={props.customerEmail}
          bankAccounts={props.depositAccounts}
          paymentMethods={props.paymentMethods}
          start={sheet === 'credit-note' && useStart ? start : null}
        />
      )}
      {(sheet === 'expense' || sheet === 'check') && (
        <RefundExpenseSheet
          key={`e${sheet}${key}`}
          open
          onOpenChange={close}
          kind={sheet}
          studentNumber={props.studentNumber}
          studentName={props.studentName}
          bankAccounts={props.depositAccounts}
          paymentMethods={props.paymentMethods}
          credit={props.credit ?? 0}
        />
      )}
    </>
  );
}

/** The forms the customer page opens. */
export type CustomerSheet =
  | 'invoice'
  | 'payment'
  | 'refund-receipt'
  | 'credit-note'
  | 'expense'
  | 'check';

/** The forms `?new=` may open. */
const CUSTOMER_SHEETS: readonly CustomerSheet[] = [
  'invoice',
  'payment',
  'refund-receipt',
  'credit-note',
];
