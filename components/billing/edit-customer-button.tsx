'use client';

import { ChevronDown, ExternalLink } from 'lucide-react';
import { useState } from 'react';

import { EditCustomerSheet } from '@/components/billing/edit-customer-sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// QuickBooks' split Edit button on a customer: Edit opens the Customer form;
// ▾ opens the customer in QuickBooks.
export function EditCustomerButton({
  studentNumber,
  qbHref,
}: {
  studentNumber: string;
  qbHref: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <div className="flex">
        <Button
          variant="outline"
          className="rounded-r-none"
          onClick={() => {
            setKey((k) => k + 1);
            setOpen(true);
          }}
        >
          Edit
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="rounded-l-none border-l-0"
              aria-label="More for this customer"
            >
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {qbHref && (
              <DropdownMenuItem asChild>
                <a href={qbHref} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" />
                  Open in QuickBooks
                </a>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open && (
        <EditCustomerSheet
          key={key}
          open
          onOpenChange={setOpen}
          studentNumber={studentNumber}
        />
      )}
    </>
  );
}
