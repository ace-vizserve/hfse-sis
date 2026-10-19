'use client';

import { ChevronDown, ExternalLink, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { NewCustomerSheet } from '@/components/billing/new-customer-sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Customers' split "New customer" button: the button opens the New customer
// sheet; ▾ holds To review and QuickBooks' Import customers.
export function NewCustomerButton({ importHref }: { importHref: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <div className="flex">
      <Button
        className="rounded-r-none"
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        New customer
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            className="rounded-l-none border-l border-primary-foreground/30"
            aria-label="More ways to add customers"
          >
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem asChild>
            <Link href="/billing/review">
              <ListChecks className="size-4" />
              To review
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={importHref} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
              Import customers in QuickBooks
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {open && <NewCustomerSheet key={key} open onOpenChange={setOpen} />}
    </div>
  );
}
