'use client';

import { ChevronDown, FilePlus2, HandCoins } from 'lucide-react';
import { useState } from 'react';

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
import type { MapsData } from '@/lib/billing/view';

// The customer page's New transaction menu, as QuickBooks has it: Invoice or
// Payment. Each sheet mounts fresh on every open.
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
