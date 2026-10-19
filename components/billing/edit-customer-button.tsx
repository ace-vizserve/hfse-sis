'use client';

import { ChevronDown, ExternalLink, Pencil } from 'lucide-react';
import { useState } from 'react';

import { EditCustomerSheet } from '@/components/billing/edit-customer-sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// QuickBooks' Edit ▾ on a customer, the SIS way: one outline menu with Edit
// customer (the Customer sheet) and Open in QuickBooks.
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Pencil className="size-4" />
            Edit
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onSelect={() => {
              setKey((k) => k + 1);
              setOpen(true);
            }}
          >
            <Pencil className="size-4" />
            Edit customer
          </DropdownMenuItem>
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
