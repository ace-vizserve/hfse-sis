'use client';

import { ChevronDown } from 'lucide-react';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// QuickBooks' "New transaction ▾" on a list page, item for item. Invoice and
// Payment are done in Billing (pick the customer, their page opens with the
// form); the others are made in QuickBooks, so they open there.

const IN_QUICKBOOKS: Array<{ label: string; path: string }> = [
  { label: 'Recurring payment', path: '/app/recurringtransactions' },
  { label: 'Estimate', path: '/app/estimate' },
  { label: 'Sales order', path: '/app/salesorder' },
  { label: 'Payment link', path: '/app/paymentlinks' },
  { label: 'Sales receipt', path: '/app/salesreceipt' },
  { label: 'Credit memo', path: '/app/creditmemo' },
  { label: 'Delayed charge', path: '/app/delayedcharge' },
  { label: 'Time activity', path: '/app/timeactivity' },
  { label: 'Statement', path: '/app/customerstatements' },
];

export function NewTransactionMenu({
  customers,
  qbBase,
}: {
  customers: Array<{ studentNumber: string; name: string }>;
  /** The QuickBooks web app's address. */
  qbBase: string;
}) {
  const router = useRouter();
  const [pick, setPick] = useState<'invoice' | 'payment' | null>(null);
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
          <DropdownMenuItem onSelect={() => setPick('invoice')}>
            Invoice
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPick('payment')}>
            Payment
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {IN_QUICKBOOKS.map((t) => (
            <DropdownMenuItem key={t.label} asChild>
              <a href={`${qbBase}${t.path}`} target="_blank" rel="noreferrer">
                {t.label}
              </a>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <CommandDialog
        open={!!pick}
        onOpenChange={(o) => !o && setPick(null)}
        title={pick === 'payment' ? 'Receive payment' : 'Create invoice'}
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
