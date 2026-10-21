'use client';

import { ChevronDown, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// QuickBooks' "New transaction ▾" on Sales transactions, item for item and in
// its order (sandbox capture 2026-10-21; Singapore names). Invoice, Payment,
// Credit note and Refund receipt are done in Billing (pick the customer,
// their page opens with the form); the others are made in QuickBooks, so
// they open there.

type Entry = { label: string; sheet: Pick } | { label: string; path: string };
type Pick = 'invoice' | 'payment' | 'credit-note' | 'refund-receipt';

const ENTRIES: Entry[] = [
  { label: 'Invoice', sheet: 'invoice' },
  { label: 'Payment', sheet: 'payment' },
  { label: 'Estimate', path: '/app/estimate' },
  { label: 'Payment link', path: '/app/paymentlinks' },
  { label: 'Sales receipt', path: '/app/salesreceipt' },
  { label: 'Credit note', sheet: 'credit-note' },
  { label: 'Refund receipt', sheet: 'refund-receipt' },
  { label: 'Delayed credit', path: '/app/delayedcredit' },
  { label: 'Delayed charge', path: '/app/delayedcharge' },
  { label: 'Time activity', path: '/app/timeactivity' },
  { label: 'Sales order', path: '/app/salesorder' },
];

const TITLE: Record<Pick, string> = {
  invoice: 'Create invoice',
  payment: 'Receive payment',
  'credit-note': 'Credit note',
  'refund-receipt': 'Refund receipt',
};

export function NewTransactionMenu({
  customers,
  qbBase,
}: {
  customers: Array<{ studentNumber: string; name: string }>;
  /** The QuickBooks web app's address. */
  qbBase: string;
}) {
  const router = useRouter();
  const [pick, setPick] = useState<Pick | null>(null);
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
          {ENTRIES.map((t) =>
            'sheet' in t ? (
              <DropdownMenuItem key={t.label} onSelect={() => setPick(t.sheet)}>
                {t.label}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem key={t.label} asChild>
                <a href={`${qbBase}${t.path}`} target="_blank" rel="noreferrer">
                  {t.label}
                  <ExternalLink className="ml-auto size-3.5 text-muted-foreground" />
                </a>
              </DropdownMenuItem>
            )
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <CommandDialog
        open={!!pick}
        onOpenChange={(o) => !o && setPick(null)}
        title={pick ? TITLE[pick] : 'New transaction'}
        description="Choose the customer"
      >
        <CommandInput placeholder="Choose a customer" />
        <CommandList>
          <CommandEmpty>No linked customer by that name.</CommandEmpty>
          {customers.map((c) => (
            <CommandItem
              key={c.studentNumber}
              value={`${c.name} ${c.studentNumber}`}
              onSelect={() => {
                const next = pick;
                setPick(null);
                router.push(
                  `/billing/${encodeURIComponent(c.studentNumber)}?new=${next}`
                );
              }}
            >
              <span className="flex-1 truncate">{c.name}</span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {c.studentNumber}
              </span>
            </CommandItem>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
