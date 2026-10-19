'use client';

import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

// QuickBooks' split "Create invoice" button on a list page: the button asks
// for the customer first, then their page opens with the invoice form; ▾
// holds QuickBooks' Import invoices (done in QuickBooks).
export function CreateInvoicePicker({
  customers,
  importHref,
}: {
  customers: Array<{ studentNumber: string; name: string }>;
  /** QuickBooks' page to import invoices from; omitted = no ▾. */
  importHref?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button className={importHref ? 'rounded-r-none' : undefined}>
            Create invoice
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <Command>
            <CommandInput placeholder="Choose a customer" />
            <CommandList>
              <CommandEmpty>No linked customer by that name.</CommandEmpty>
              {customers.map((c) => (
                <CommandItem
                  key={c.studentNumber}
                  value={`${c.name} ${c.studentNumber}`}
                  onSelect={() => {
                    setOpen(false);
                    router.push(
                      `/billing/${encodeURIComponent(c.studentNumber)}?new=invoice`
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
          </Command>
        </PopoverContent>
      </Popover>
      {importHref && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              className="rounded-l-none border-l border-primary-foreground/20"
              aria-label="More ways to create invoices"
            >
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild>
              <a href={importHref} target="_blank" rel="noreferrer">
                Import invoices
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
